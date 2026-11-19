/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revokeRoleHandler } from "@/server/http/handlers";
import { createAccount } from "../factories/accounts";
import { revokedAdmin } from "../factories/revocation";
import { ownerPool, resetDb } from "../helpers/db";
import { AD2, AD2_NAME, ADMIN_NAME, FIXED_INSTANT, makeHistoryApi, recorrerFh, seedAd2, seedEvents, type FhIds } from "../helpers/history";
import { seedListing } from "../helpers/listing-data";
import { validateSchema } from "../helpers/openapi";
import { A6, ADMIN, makeReviewListingApi, NAME_ONE, NAME_TWO, P2P, REASON, seedWorld, UNKNOWN_ID, VISITOR, type World } from "../helpers/review-listing";
import { changedTables, snapshotAll } from "../helpers/role-denial";
import { makeSelfRevokeApi } from "../helpers/self-revoke-http";
import { signInitData, tma } from "../helpers/telegram";

// F029, criterios 1, 4, 5, 7 a 9, 11 (API), 12, 14 a 16 y 19: historial de estados de una ficha por HTTP.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let world: World;
let fh: FhIds;
const api = makeReviewListingApi();
const history = makeHistoryApi(api.deps);
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const json = async (res: Response) => (await res.json()) as any;
const nameOf = async (telegramId: number) => (await rows("select telegram_display_name as n from app.accounts where telegram_user_id = $1", [telegramId]))[0]?.n as string;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  await resetDb(owner);
  world = await seedWorld(owner);
  await seedAd2(owner);
  fh = await recorrerFh(api, owner, world, afterTasks);
});
afterEach(() => vi.restoreAllMocks());

describe("criterio 1: respuesta 200 con el esquema del openapi y sin escribir", () => {
  it("devuelve un arreglo de ListingStatusEvent, application/json y no cambia la instantánea", async () => {
    const before = await snapshotAll(owner);
    const res = await history(ADMIN, fh.listingId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const events = await json(res);
    expect(Array.isArray(events)).toBe(true);
    for (const event of events) {
      expect(validateSchema("ListingStatusEvent", event)).toEqual([]);
      expect(event.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    // `processed_updates` y otras tablas no se tocan: la consulta no escribe.
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterio 4: seis eventos en orden", () => {
  it("los pares (versionNumber, fromStatus, toStatus) y los versionId", async () => {
    const events = await json(await history(ADMIN, fh.listingId));
    expect(events.map((e: any) => [e.versionNumber, e.fromStatus, e.toStatus])).toEqual([
      [1, null, "draft"], [1, "draft", "pending"], [1, "pending", "rejected"], [2, null, "draft"], [2, "draft", "pending"], [2, "pending", "published"],
    ]);
    const times = events.map((e: any) => new Date(e.occurredAt).getTime());
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]!);
    const ids = events.map((e: any) => e.versionId);
    expect(new Set(ids.slice(0, 3)).size).toBe(1);
    expect(new Set(ids.slice(3)).size).toBe(1);
    expect(ids[0]).toBe(fh.v1);
    expect(ids[3]).toBe(fh.v2);
    expect(ids[0]).not.toBe(ids[3]);
  });
});

describe("criterio 5: orden estable con instantes iguales", () => {
  it("3 eventos de una misma transacción salen por id ascendente, en 5 consultas", async () => {
    const seeded = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Ficha Empates" });
    // Motivos en orden alfabético inverso al de inserción: ordenar por motivo no coincidiría con el orden por id.
    await seedEvents(owner, seeded.listingId, seeded.versionId, [
      { from: "draft", to: "pending", reason: "c" }, { from: "pending", to: "rejected", reason: "b" }, { from: "rejected", to: "draft", reason: "a" },
    ]);
    const stamps = (await rows("select distinct occurred_at from app.listing_status_events where listing_id = $1 and reason is not null", [seeded.listingId])).length;
    expect(stamps).toBe(1);
    for (let i = 0; i < 5; i++) {
      const events = await json(await history(ADMIN, seeded.listingId));
      expect(events.filter((e: any) => e.reason !== null).map((e: any) => e.reason)).toEqual(["c", "b", "a"]);
    }
  });
});

describe("criterios 7 a 9: responsable, motivo y fecha", () => {
  it("7: roles y nombres; sin número de identidad, ID de Telegram ni ID de cuenta", async () => {
    const res = await history(ADMIN, fh.listingId);
    const text = await res.clone().text();
    const events = await json(res);
    expect(events.map((e: any) => e.actor.role)).toEqual(["provider", "provider", "admin", "provider", "provider", "admin"]);
    const a6Name = await nameOf(A6);
    expect(events.map((e: any) => e.actor.displayName)).toEqual([a6Name, a6Name, ADMIN_NAME, a6Name, a6Name, AD2_NAME]);
    for (const event of events) expect(Object.keys(event.actor).sort()).toEqual(["displayName", "role"]);
    const secrets = [String(A6), String(ADMIN), String(AD2), "9000070310", ...(await rows("select id from app.accounts")).map((r) => r.id as string)];
    for (const secret of secrets) expect(text, secret).not.toContain(secret);
  });

  it("8: reason es el motivo exacto en el evento 3 y null en los otros 5", async () => {
    const events = await json(await history(ADMIN, fh.listingId));
    expect(events.map((e: any) => e.reason)).toEqual([null, null, REASON, null, null, null]);
    expect(REASON).toBe("Falta el horario real.");
  });

  it("9: occurredAt es el occurred_at guardado, con el evento 3 fijado en 2026-11-20T03:30:00Z", async () => {
    const events = await json(await history(ADMIN, fh.listingId));
    const stored = await rows("select occurred_at from app.listing_status_events where listing_id = $1 order by occurred_at, id", [fh.listingId]);
    expect(events.map((e: any) => new Date(e.occurredAt).getTime())).toEqual(stored.map((r) => new Date(r.occurred_at).getTime()));
    expect(events[2].occurredAt).toBe(new Date(FIXED_INSTANT).toISOString());
  });
});

describe("criterio 11: responsable ausente (API)", () => {
  async function ficha(name: string) {
    return seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name });
  }

  it("a, b y c: siembra exacta del nulo, sin error", async () => {
    const seeded = await ficha("Ficha Ausentes");
    const noName = await createAccount(owner, 900007111, "Cuenta Sin Nombre");
    await owner.query("update app.accounts set telegram_display_name = null where id = $1", [noName]);
    await seedEvents(owner, seeded.listingId, seeded.versionId, [
      { from: "draft", to: "pending", role: "admin", accountId: null, at: "2026-11-21T01:00:00Z" },
      { from: "pending", to: "rejected", role: "provider", accountId: noName, at: "2026-11-21T02:00:00Z" },
      { from: "rejected", to: "draft", role: "system", accountId: null, at: "2026-11-21T03:00:00Z" },
    ]);
    const res = await history(ADMIN, seeded.listingId);
    expect(res.status).toBe(200);
    const actors = (await json(res)).slice(-3).map((e: any) => e.actor);
    expect(actors).toEqual([{ displayName: null, role: "admin" }, { displayName: null, role: "provider" }, { displayName: null, role: "system" }]);
  });

  it("d: tras la autorrevocación real de A6 sus 4 eventos quedan con nombre nulo y rol provider", async () => {
    const revoked = await makeSelfRevokeApi(api.db).revoke(A6);
    expect(revoked.status).toBe(200);
    const res = await history(ADMIN, fh.listingId);
    expect(res.status).toBe(200);
    const events = await json(res);
    expect(events.map((e: any) => e.actor)).toEqual([
      { displayName: null, role: "provider" }, { displayName: null, role: "provider" },
      { displayName: ADMIN_NAME, role: "admin" },
      { displayName: null, role: "provider" }, { displayName: null, role: "provider" },
      { displayName: AD2_NAME, role: "admin" },
    ]);
  });

  it("e: el rol revocado por el administrador conserva el nombre en el evento 3", async () => {
    const grant = (await rows("select id from app.role_grants where telegram_user_id = $1 and role = 'admin'", [ADMIN]))[0].id as string;
    const revoke = revokeRoleHandler(api.deps);
    const res = await revoke(
      new Request(`http://localhost/api/v1/role-grants/${grant}/revocation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tma(signInitData({ userId: AD2 })) },
        body: JSON.stringify({ confirmed: true }),
      }),
      { params: Promise.resolve({ grantId: grant }) },
    );
    expect(res.status).toBe(200);
    const events = await json(await history(AD2, fh.listingId));
    expect(events[2].actor).toEqual({ displayName: ADMIN_NAME, role: "admin" });
  });
});

describe("criterio 12: orden de comprobaciones", () => {
  it("401, 403 consent_required, 403 forbidden y 404, sin cambios y sin datos de la ficha", async () => {
    await revokedAdmin(owner, 900007112);
    await createAccount(owner, 900007113, "Cuenta Sin Rol");
    const before = await snapshotAll(owner);
    const noAccessText: string[] = [];
    const expectDenied = async (res: Response, status: number, code: string) => {
      const text = await res.text();
      expect(res.status).toBe(status);
      expect(JSON.parse(text).code).toBe(code);
      noAccessText.push(text);
    };
    await expectDenied(await history(null, fh.listingId), 401, "unauthenticated");
    await expectDenied(await history(900008002, fh.listingId), 403, "consent_required");
    for (const user of [A6, P2P, VISITOR, 900007112, 900007113]) await expectDenied(await history(user, fh.listingId), 403, "forbidden");
    await expectDenied(await history(ADMIN, UNKNOWN_ID), 404, "not_found");
    await expectDenied(await history(ADMIN, "no-es-uuid"), 404, "not_found");
    for (const text of noAccessText) {
      expect(text).not.toContain(NAME_ONE);
      expect(text).not.toContain(fh.v1);
    }
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });

  it("un administrador común autorrevocado (cuenta borrada) recibe 403 consent_required", async () => {
    expect((await makeSelfRevokeApi(api.db).revoke(ADMIN)).status).toBe(200);
    const before = await snapshotAll(owner);
    const res = await history(ADMIN, fh.listingId);
    const text = await res.text();
    expect(res.status).toBe(403);
    expect(JSON.parse(text).code).toBe("consent_required");
    expect(text).not.toContain(NAME_ONE);
    expect(text).not.toContain(fh.v1);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterio 14: fichas sin eventos posteriores", () => {
  it("un borrador recién creado devuelve 1 evento y un atractivo del administrador (published, admin)", async () => {
    const created = await json(await api.create(A6, { kind: "establishment", confirmed: true, content: { name: "Solo Borrador", municipalityId: world.municipalityOne } }));
    const draft = await json(await history(ADMIN, created.id));
    expect(draft.map((e: any) => [e.versionNumber, e.fromStatus, e.toStatus, e.actor.role])).toEqual([[1, null, "draft", "provider"]]);

    const attraction = await json(
      await api.create(ADMIN, {
        kind: "attraction",
        confirmed: true,
        content: {
          name: "Atractivo Ficticio Uno", municipalityId: world.municipalityOne, categoryId: world.categoryOne, description: "Descripción ficticia.",
          schedule: "Todos los días de 8:00 a 17:00", contact: "contacto@ejemplo.invalid", mapsUrl: "https://maps.app.goo.gl/AbCdEf123",
        },
      }),
    );
    const events = await json(await history(ADMIN, attraction.id));
    expect(events.map((e: any) => [e.versionNumber, e.fromStatus, e.toStatus, e.actor.role])).toEqual([[1, null, "published", "admin"]]);
  });
});

describe("criterio 15: separación entre fichas", () => {
  it("el historial de FH no trae versionId ni eventos de FP2 ni FP3", async () => {
    const fp2 = await api.pending(world, NAME_TWO, A6);
    const fp3 = await api.pending(world, "Establecimiento Ficticio Tres", P2P);
    const events = await json(await history(ADMIN, fh.listingId));
    expect(events).toHaveLength(6);
    const own = new Set([fh.v1, fh.v2]);
    for (const event of events) expect(own.has(event.versionId)).toBe(true);
    const text = JSON.stringify(events);
    for (const other of [fp2.versionId, fp3.versionId]) expect(text).not.toContain(other);
    expect((await json(await history(ADMIN, fp2.listingId))).map((e: any) => e.versionId)).not.toContain(fh.v1);
  });
});

describe("criterio 16: solo lectura", () => {
  it("la ruta exporta solo GET (el resto responde 405) y eje_app no puede UPDATE ni DELETE", async () => {
    const source = readFileSync("src/app/api/v1/managed-listings/[listingId]/status-history/route.ts", "utf8");
    expect([...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1])).toEqual(["GET"]);
    const app = new Pool({ connectionString: process.env.TEST_APP_URL, max: 1 });
    try {
      await expect(app.query("update app.listing_status_events set reason = 'x'")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("delete from app.listing_status_events")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.end();
    }
  });
});

describe("criterio 19: sin datos personales ni integraciones nuevas", () => {
  it("el flujo no escribe registros con valores sembrados y el código nuevo no importa servicios externos", async () => {
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
    const res = await history(ADMIN, fh.listingId);
    const text = await res.text();
    await history(900008002, fh.listingId);
    for (const secret of ["9000070310", String(A6), String(ADMIN), String(AD2)]) {
      expect(text).not.toContain(secret);
      expect(logs.join("\n")).not.toContain(secret);
    }
    for (const file of ["src/server/services/listing-history.ts", "src/bot/history.ts"]) {
      const imports = [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
      for (const spec of imports) expect(spec, `${file}: ${spec}`).toMatch(/^(@\/|\.\/|\.\.\/|kysely$|zod$|grammy$)/);
    }
  });
});
