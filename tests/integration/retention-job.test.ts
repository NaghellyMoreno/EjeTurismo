import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runMaintenanceJob, runRetentionJob } from "@/server/jobs";
import { getCurrentPrivacyNoticeHandler, runMaintenanceJobHandler, runRetentionJobHandler } from "@/server/http/handlers";
import { getPublishedListing } from "@/server/services";
import { MemoryStorage } from "@/server/storage";
import { appDb, ownerPool } from "../helpers/db";
import {
  CRON_SECRET, contentSnapshot, count, cronDeps, cronRequest, expectedProcessed, nonNullAccountReferences, restoreRetention, seedRetention,
  setDeadline, tableCounts, todayInBogota, type Seed,
} from "../helpers/retention";
import { signInitData, tma } from "../helpers/telegram";
import { validateSchema } from "../helpers/openapi";

// F038, criterios 2 a 15 y 18: la tarea de eliminación y el mantenimiento de fotos, por las rutas reales y con datos en todas las tablas.
const owner = ownerPool();
const storage = new MemoryStorage();
const deps = cronDeps(storage);
const retention = runRetentionJobHandler(deps);
const maintenance = runMaintenanceJobHandler(deps);
let seed: Seed;

const KEPT = ["municipalities", "categories", "experience_types", "establishment_types"];
const ATTRACTION_TABLES = ["listings", "listing_versions", "listing_photos", "photo_uploads"];
const executedAt = async () => (await owner.query("select executed_at from app.retention_settings")).rows[0].executed_at as Date | null;
const run = async () => {
  const response = await retention(cronRequest("retention"));
  return { status: response.status, body: (await response.json()) as { job: string; processed: number; skippedReason: string | null; ranAt: string } };
};

beforeEach(async () => {
  seed = await seedRetention(owner, storage);
  await setDeadline(owner, await todayInBogota(owner));
});
afterAll(async () => {
  await restoreRetention(owner);
  await owner.end();
  await deps.destroy();
});

describe("criterios 2 a 5: la ejecución borra el alcance de D-043", () => {
  it("responde con el entero exacto N y deja en 0 las tablas del alcance", async () => {
    const n = await expectedProcessed(owner);
    expect(n).toBeGreaterThan(0);
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toMatchObject({ job: "retention", processed: n, skippedReason: null });
    expect(validateSchema("JobResult", body)).toEqual([]);
    for (const table of ["accounts", "bot_sessions", "rate_limit_counters", "role_grants", "consent_events", "provider_registrations"]) expect(await count(owner, table), table).toBe(0);
    for (const table of ["information_requests", "information_request_replies", "information_request_status_events", "audit_events", "listing_status_events", "notification_outbox", "processed_updates"]) expect(await count(owner, table), table).toBe(0);
  });

  it("no queda negocio ni ficha de prestador, y las subidas del atractivo se conservan con responsable nulo", async () => {
    const attractionUploads = (await owner.query("select * from app.photo_uploads where version_id = $1", [seed.attractionPublishedVersionId])).rows;
    expect(attractionUploads.length).toBeGreaterThan(0);
    await run();
    expect(await count(owner, "businesses")).toBe(0);
    expect(await count(owner, "listings where kind <> 'attraction'")).toBe(0);
    expect(await count(owner, "listing_versions v where exists (select 1 from app.listings l where l.id = v.listing_id and l.kind <> 'attraction')")).toBe(0);
    expect(await count(owner, "listing_photos p where not exists (select 1 from app.listing_versions v join app.listings l on l.id = v.listing_id where v.id = p.version_id and l.kind = 'attraction')")).toBe(0);
    expect(await count(owner, "photo_uploads p where not exists (select 1 from app.listing_versions v join app.listings l on l.id = v.listing_id where v.id = p.version_id and l.kind = 'attraction')")).toBe(0);
    const after = (await owner.query("select * from app.photo_uploads where version_id = $1", [seed.attractionPublishedVersionId])).rows;
    expect(after).toEqual(attractionUploads.map((row) => ({ ...row, requested_by_account_id: null })));
    expect(after.map((row) => row.id)).toContain(seed.attractionUploadId);
  });
});

describe("criterios 6 y 7: fotos en Blob", () => {
  it("el mantenimiento borra las fotos de las fichas eliminadas y el archivo sin referencia, y conserva las del atractivo", async () => {
    await run();
    const response = await maintenance(cronRequest("maintenance"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ job: "maintenance", processed: seed.providerPhotoPaths.length + 1, skippedReason: null });
    expect(validateSchema("JobResult", body)).toEqual([]);
    expect((await storage.list()).sort()).toEqual([...seed.attractionPhotoPaths].sort());
  });

  it("un fallo al borrar un archivo no detiene a los demás ni toca la base, y se reintenta en la siguiente ejecución", async () => {
    await run();
    const flaky = new MemoryStorage();
    for (const path of await storage.list()) flaky.put(path, new Uint8Array([1]), "image/jpeg");
    const failing = seed.providerPhotoPaths[0];
    let failedOnce = false;
    const realDelete = flaky.delete.bind(flaky);
    flaky.delete = async (pathname: string) => {
      if (pathname === failing && !failedOnce) {
        failedOnce = true;
        throw new Error("fallo del almacén");
      }
      return realDelete(pathname);
    };
    const before = await tableCounts(owner);
    const first = await runMaintenanceJob(appDb(), new Date(), flaky);
    expect(first.processed).toBe(seed.providerPhotoPaths.length);
    expect(await flaky.list()).toContain(failing);
    expect(await tableCounts(owner)).toEqual(before);
    const second = await runMaintenanceJob(appDb(), new Date(), flaky);
    expect(second.processed).toBe(1);
    expect(await flaky.list()).not.toContain(failing);
  });
});

describe("criterios 8 a 11: lo que se conserva", () => {
  it("catálogos, atractivos y aviso conservan contenido; los responsables quedan en nulo", async () => {
    const tables = [...KEPT, ...ATTRACTION_TABLES, "privacy_notice_versions"];
    const fkColumns = [...KEPT, ...ATTRACTION_TABLES];
    expect(await nonNullAccountReferences(owner, fkColumns)).toBeGreaterThan(0);
    // Del snapshot previo solo se comparan las filas de atractivo (las de prestador desaparecen).
    const attractionIds = new Set<string>();
    for (const row of (await owner.query("select v.id as version_id, l.id as listing_id from app.listing_versions v join app.listings l on l.id = v.listing_id where l.kind = 'attraction'")).rows) {
      attractionIds.add(row.version_id);
      attractionIds.add(row.listing_id);
    }
    const photoIds = new Set((await owner.query("select p.id from app.listing_photos p where p.version_id = any ($1::uuid[])", [[...attractionIds]])).rows.map((r) => r.id));
    const uploadIds = new Set((await owner.query("select p.id from app.photo_uploads p where p.version_id = any ($1::uuid[])", [[...attractionIds]])).rows.map((r) => r.id));
    const belongs = (table: string, row: unknown) => {
      const r = row as { id: string };
      if (table === "listings" || table === "listing_versions") return attractionIds.has(r.id);
      if (table === "listing_photos") return photoIds.has(r.id);
      if (table === "photo_uploads") return uploadIds.has(r.id);
      return true;
    };
    const before = await contentSnapshot(owner, tables);
    const noticeBefore = await (await getCurrentPrivacyNoticeHandler(deps)()).json();
    await run();
    const after = await contentSnapshot(owner, tables);
    for (const table of tables) expect(after[table], table).toEqual(before[table].filter((row) => belongs(table, row)));
    expect(await nonNullAccountReferences(owner, fkColumns)).toBe(0);
    expect(await count(owner, "listings where kind = 'attraction'")).toBeGreaterThan(0);
    expect(await count(owner, "establishment_types")).toBeGreaterThan(0);
    const noticeAfterResponse = await getCurrentPrivacyNoticeHandler(deps)();
    expect(noticeAfterResponse.status).toBe(200);
    expect(await noticeAfterResponse.json()).toEqual(noticeBefore);
    expect(await count(owner, "privacy_notice_versions")).toBe(2);
    const settings = (await owner.query("select count(*)::int as n, bool_and(executed_at is not null) as done from app.retention_settings")).rows[0];
    expect(settings).toMatchObject({ n: 1, done: true });
  });

  it("el atractivo publicado sigue legible como ficha publicada", async () => {
    await run();
    await owner.query("insert into app.accounts (telegram_user_id, telegram_display_name, consent_notice_version, consent_accepted_at, consent_channel) select 910099, 'Nueva Visitante', version, now(), 'bot' from app.privacy_notice_versions where is_current");
    const detail = await getPublishedListing(appDb(), { telegramUserId: "910099", displayName: null }, seed.attractionId, new Date(), storage);
    expect(detail).toMatchObject({ id: seed.attractionId, kind: "attraction" });
  });
});

describe("criterios 12 a 14: se ejecuta una sola vez", () => {
  it("la segunda llamada no cambia nada (criterio 12)", async () => {
    await run();
    const tables = ["municipalities", "categories", "experience_types", "establishment_types", ...ATTRACTION_TABLES, "privacy_notice_versions", "retention_settings"];
    const snapshot = await contentSnapshot(owner, tables);
    const counts = await tableCounts(owner);
    const marked = await executedAt();
    const second = await run();
    expect(second).toMatchObject({ status: 200, body: { processed: 0, skippedReason: "retention_already_executed" } });
    expect(await tableCounts(owner)).toEqual(counts);
    expect(await contentSnapshot(owner, tables)).toEqual(snapshot);
    expect(await executedAt()).toEqual(marked);
  });

  it("los datos nuevos posteriores permanecen (criterio 13)", async () => {
    await run();
    await owner.query("insert into app.accounts (telegram_user_id, telegram_display_name, consent_notice_version, consent_accepted_at, consent_channel) select 910098, 'Cuenta Nueva', version, now(), 'bot' from app.privacy_notice_versions where is_current");
    await owner.query("insert into app.processed_updates (update_id) values (99)");
    const again = await run();
    expect(again.body).toMatchObject({ processed: 0, skippedReason: "retention_already_executed" });
    expect(await count(owner, "accounts")).toBe(1);
    expect(await count(owner, "processed_updates")).toBe(1);
  });

  it("dos llamadas simultáneas producen exactamente una eliminación (criterio 14)", async () => {
    const n = await expectedProcessed(owner);
    const other = cronDeps(storage);
    try {
      const responses = await Promise.all([retention(cronRequest("retention")), runRetentionJobHandler(other)(cronRequest("retention"))]);
      const bodies = await Promise.all(responses.map((r) => r.json() as Promise<{ processed: number; skippedReason: string | null }>));
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      expect(bodies.map((b) => b.processed).sort((x, y) => x - y)).toEqual([0, n]);
      expect(bodies.find((b) => b.processed === 0)?.skippedReason).toBe("retention_already_executed");
      expect(bodies.find((b) => b.processed === n)?.skippedReason).toBeNull();
      expect(await count(owner, "retention_settings")).toBe(1);
      expect(await executedAt()).not.toBeNull();
    } finally {
      await other.destroy();
    }
  });
});

describe("criterio 15: antes del plazo", () => {
  it("no borra nada y executed_at sigue nulo", async () => {
    await restoreRetention(owner);
    const before = await tableCounts(owner);
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toMatchObject({ job: "retention", processed: 0, skippedReason: "retention_deadline_not_reached" });
    expect(await tableCounts(owner)).toEqual(before);
    expect(await executedAt()).toBeNull();
  });

  it("el servicio responde igual por su cuenta", async () => {
    await restoreRetention(owner);
    expect(await runRetentionJob(appDb())).toMatchObject({ job: "retention", processed: 0, skippedReason: "retention_deadline_not_reached" });
  });
});

describe("criterio 18: solo con el secreto de las tareas programadas", () => {
  const initData = tma(signInitData({ userId: 910011 })).Authorization;
  const cases: [string, string | null][] = [
    ["sin cabecera", null],
    ["secreto incorrecto", "Bearer otro-secreto"],
    ["token de sesión de Telegram", initData],
    ["token de administrador", "Bearer admin-token-de-prueba"],
    ["Bearer vacío", "Bearer "],
    ["Bearer undefined", "Bearer undefined"],
  ];

  it.each(cases)("ambas rutas responden 401 %s y no cambian nada", async (_name, authorization) => {
    const before = await tableCounts(owner);
    const objects = await storage.list();
    for (const job of ["retention", "maintenance"] as const) {
      const handler = job === "retention" ? retention : maintenance;
      expect((await handler(cronRequest(job, authorization))).status, job).toBe(401);
    }
    expect(await tableCounts(owner)).toEqual(before);
    expect(await storage.list()).toEqual(objects);
    expect(await executedAt()).toBeNull();
  });

  it.each([undefined, ""])("con CRON_SECRET sin definir (%j) niegan todo, incluso con un secreto cualquiera", async (secret) => {
    const closed = cronDeps(storage, { cronSecret: () => secret });
    try {
      const before = await tableCounts(owner);
      for (const authorization of ["Bearer ", "Bearer undefined", `Bearer ${CRON_SECRET}`, null]) {
        expect((await runRetentionJobHandler(closed)(cronRequest("retention", authorization))).status).toBe(401);
        expect((await runMaintenanceJobHandler(closed)(cronRequest("maintenance", authorization))).status).toBe(401);
      }
      expect(await tableCounts(owner)).toEqual(before);
      expect(await executedAt()).toBeNull();
    } finally {
      await closed.destroy();
    }
  });
});
