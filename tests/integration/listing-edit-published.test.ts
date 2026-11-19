/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type InsertQueryNode, type KyselyPlugin } from "kysely";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { listPublishedListingsHandler, revokeRoleHandler, saveListingDraftHandler, submitListingForReviewHandler } from "@/server/http/handlers";
import { createAccount } from "../factories/accounts";
import { TEST_PRINCIPAL_ADMIN_ID, testConfig } from "../helpers/config";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { A6B, draftBody, SUBMIT_BODY } from "../helpers/listing-http";
import { seedListing } from "../helpers/listing-data";
import { validateSchema } from "../helpers/openapi";
import { A6, ADMIN, flush, makeReviewListingApi, NAME_ONE, NAME_THREE, NAME_TWO, P2P, REASON, seedWorld, VISITOR, type World } from "../helpers/review-listing";
import { changedTables, PERSON_IDS, snapshotAll } from "../helpers/role-denial";
import { signInitData, tma } from "../helpers/telegram";

// F015, criterios 1 a 4, 6 a 8, 9a (HTTP), 10a, 11, 12 (HTTP y base), 14 a 18: editar una ficha publicada sin ocultarla.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

const OLD = "Lunes a viernes de 8:00 a 17:00";
const NEW = "Todos los días de 7:00 a 19:00";
const RENAMED = "Establecimiento Ficticio Uno Renovado";
const EDIT_REASON = "Falta el horario del domingo.";

let owner: Pool;
let world: World;
const api = makeReviewListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const versions = (listingId: string) =>
  rows("select id, version_number, status, schedule, name, decided_by, decided_at, rejection_reason from app.listing_versions where listing_id = $1 order by version_number", [listingId]);
const publicNames = async (query = "") => ((await body(await api.published(VISITOR, query))).items as any[]).map((i) => i.name as string);

// FPub: ficha publicada con el flujo real (crear, enviar y aprobar el administrador de prueba).
async function publish(name = NAME_ONE, user = A6, schedule = OLD) {
  const p = await api.pending(world, name, user, { schedule });
  expect((await api.approve(ADMIN, p.versionId)).status).toBe(200);
  await flush(afterTasks);
  api.sent.length = 0;
  return p.listingId;
}
const edit = (listingId: string, content: Record<string, unknown> = {}, user = A6) => api.save(user, listingId, draftBody(world, { schedule: NEW, ...content }));
const pendingEdit = async (listingId: string, content: Record<string, unknown> = {}) => {
  expect((await edit(listingId, content)).status).toBe(200);
  const res = await api.submit(A6, listingId, SUBMIT_BODY);
  expect(res.status).toBe(200);
  return (await body(res)).working.id as string;
};
const revoke = async (role: "provider" | "admin", telegramId: number, by: number) => {
  const grant = (await rows("select id from app.role_grants where telegram_user_id = $1 and role = $2", [telegramId, role]))[0].id;
  const res = await revokeRoleHandler(api.deps)(
    new Request(`http://localhost/api/v1/role-grants/${grant}/revocation`, { method: "POST", headers: { "Content-Type": "application/json", ...tma(signInitData({ userId: by })) }, body: JSON.stringify({ confirmed: true }) }),
    { params: Promise.resolve({ grantId: grant }) },
  );
  expect(res.status).toBe(200);
};

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  api.sent.length = 0;
  api.state.mode = "ok";
  api.state.now = () => new Date();
  await resetDb(owner);
  world = await seedWorld(owner);
});
afterEach(() => vi.restoreAllMocks());

describe("criterio 1: editar el horario de la ficha publicada", () => {
  it("crea la versión 2 en borrador sin tocar la publicada y la segunda llamada actualiza la misma versión", async () => {
    const fp = await publish();
    const [v1Before] = await versions(fp);
    const eventsOfV1 = await rows("select count(*)::int as n from app.listing_status_events where version_id = $1", [v1Before.id]);
    const eventsBefore = await rows("select count(*)::int as n from app.listing_status_events");
    const res = await edit(fp);
    const json = await body(res);
    expect(res.status).toBe(200);
    expect(validateSchema("ManagedListing", json)).toEqual([]);
    expect(json).toMatchObject({ displayStatus: "draft", hasPublishedVersion: true, published: { versionNumber: 1 }, working: { status: "draft", versionNumber: 2 } });
    expect(json.published.content.schedule).toBe(OLD);
    expect(json.working.content.schedule).toBe(NEW);
    expect(json.lastRejection).toBeUndefined();
    const vs = await versions(fp);
    expect(vs.map((v) => [v.version_number, v.status])).toEqual([[1, "published"], [2, "draft"]]);
    expect(vs[0]).toEqual(v1Before);
    expect(await rows("select count(*)::int as n from app.listing_status_events")).toEqual([{ n: eventsBefore[0].n + 1 }]);
    expect(await rows("select from_status, to_status, actor_role, actor_account_id, reason from app.listing_status_events where version_id = $1", [vs[1].id])).toEqual([
      { from_status: null, to_status: "draft", actor_role: "provider", actor_account_id: world.a6Account, reason: null },
    ]);
    expect(await rows("select count(*)::int as n from app.listing_status_events where version_id = $1", [vs[0].id])).toEqual(eventsOfV1);

    expect((await edit(fp, { schedule: "Sábados de 9:00 a 12:00" })).status).toBe(200);
    const after = await versions(fp);
    expect(after).toHaveLength(2);
    expect(after[1].schedule).toBe("Sábados de 9:00 a 12:00");
    expect(after[0]).toEqual(v1Before);
  });

  it("sin confirmed: true responde 422 confirmation_required sin cambios", async () => {
    const fp = await publish();
    const before = await snapshotAll(owner);
    for (const root of [{ confirmed: undefined }, { confirmed: false }]) {
      const res = await api.save(A6, fp, draftBody(world, { schedule: NEW }, root));
      expect(res.status).toBe(422);
      expect((await body(res)).errors).toEqual([expect.objectContaining({ field: "confirmed", code: "confirmation_required" })]);
    }
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterio 2: enviar la edición", () => {
  it("pasa la versión 2 a pending con evento y auditoría, y exige confirmación y declaración", async () => {
    const fp = await publish();
    await edit(fp);
    const before = await snapshotAll(owner);
    const both = await api.submit(A6, fp, {});
    expect(both.status).toBe(422);
    expect(((await body(both)).errors as any[]).map((e) => e.code).sort()).toEqual(["confirmation_required", "declaration_required"]);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect((await versions(fp))[1].status).toBe("draft");

    const res = await api.submit(A6, fp, SUBMIT_BODY);
    const json = await body(res);
    expect(res.status).toBe(200);
    expect(validateSchema("ManagedListing", json)).toEqual([]);
    expect(json).toMatchObject({ displayStatus: "pending", hasPublishedVersion: true, published: { versionNumber: 1 }, working: { status: "pending", versionNumber: 2 } });
    expect(json.published.content.schedule).toBe(OLD);
    expect(json.working.submittedAt).toBeTruthy();
    expect(json.working.thirdPartyDeclaredAt).toBeTruthy();
    const vs = await versions(fp);
    expect(vs.map((v) => v.status)).toEqual(["published", "pending"]);
    expect(await rows("select from_status, to_status, actor_role from app.listing_status_events where version_id = $1 order by id", [vs[1].id])).toEqual([
      { from_status: null, to_status: "draft", actor_role: "provider" },
      { from_status: "draft", to_status: "pending", actor_role: "provider" },
    ]);
    const audit = await rows("select details from app.audit_events where action = 'listing.submitted' and details->>'versionId' = $1", [vs[1].id]);
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toMatchObject({ kind: "establishment" });
  });
});

describe("criterio 3: edición pendiente y simultaneidad", () => {
  it("con la edición pendiente, PUT y envío responden 409 sin cambios", async () => {
    const fp = await publish();
    await pendingEdit(fp);
    const before = await snapshotAll(owner);
    for (const res of [await edit(fp), await api.submit(A6, fp, SUBMIT_BODY)]) {
      const json = await body(res);
      expect(res.status).toBe(409);
      expect(json.code).toBe("invalid_state_transition");
      expect(json.detail).toBe("La ficha está pendiente de revisión y no se puede editar.");
    }
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect((await versions(fp)).map((v) => v.status)).toEqual(["published", "pending"]);
  });

  it("dos PUT simultáneos dan un 200 y un 409 y queda una sola versión abierta", async () => {
    const fp = await publish();
    // Cada solicitud usa su propia conexión (como dos invocaciones de la función); con una sola conexión se atenderían en serie.
    const other = makeReviewListingApi();
    try {
      await other.get(A6, fp); // abre la conexión antes de la carrera
      const results = await Promise.all([edit(fp), other.save(A6, fp, draftBody(world, { schedule: "Sábados de 9:00 a 12:00" }))]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await body(results.find((r) => r.status === 409)!)).code).toBe("invalid_state_transition");
    } finally {
      await other.destroy();
    }
    expect((await versions(fp)).map((v) => [v.version_number, v.status])).toEqual([[1, "published"], [2, "draft"]]);
  });
});

describe("criterio 4: duplicados y alcance de la copia", () => {
  it("editar con el mismo nombre y municipio no es duplicado; con el nombre de otra ficha de otro negocio sí, en cada estado", async () => {
    const fp = await publish();
    expect((await edit(fp, { name: NAME_ONE })).status).toBe(200);
    for (const status of ["draft", "pending", "published", "rejected"] as const) {
      const name = `Ficha Ajena ${status}`;
      await seedListing(owner, { accountId: world.p2pAccount, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name, status });
      const before = await snapshotAll(owner);
      const res = await edit(fp, { name });
      const json = await body(res);
      expect([res.status, json.code, json.detail], status).toEqual([409, "duplicate", "Ya existe una ficha con ese nombre en ese municipio."]);
      expect(changedTables(before, await snapshotAll(owner)), status).toEqual([]);
    }
  });

  it("una ficha rechazada que nunca se publicó sigue creando su versión nueva (regresión de F014)", async () => {
    const p = await api.pending(world, NAME_ONE);
    expect((await api.reject(ADMIN, p.versionId)).status).toBe(200);
    expect((await api.save(A6, p.listingId, draftBody(world, { name: NAME_ONE }))).status).toBe(200);
    expect((await versions(p.listingId)).map((v) => [v.version_number, v.status])).toEqual([[1, "rejected"], [2, "draft"]]);
  });
});

describe("criterio 6: el visitante sigue viendo la publicada", () => {
  it("con la edición en draft y en pending el listado trae FPub una vez con el nombre anterior", async () => {
    const fp = await publish();
    const published = (await body(await api.get(A6, fp))).published;
    const query = `municipalityId=${published.content.municipality.id}&categoryId=${published.content.category.id}`;
    const check = async () => {
      for (const q of ["", query]) {
        const json = await body(await api.published(VISITOR, q));
        expect(json.items.filter((i: any) => i.name === NAME_ONE)).toHaveLength(1);
        expect(JSON.stringify(json)).not.toContain(RENAMED);
        for (const key of ["working", "rejectionReason", "lastRejection", "provider"]) expect(JSON.stringify(json)).not.toContain(`"${key}"`);
      }
      expect(await rows("select schedule from app.listing_versions where listing_id = $1 and status = 'published'", [fp])).toEqual([{ schedule: OLD }]);
    };
    await edit(fp, { name: RENAMED });
    await check();
    expect((await api.submit(A6, fp, SUBMIT_BODY)).status).toBe(200);
    await check();
  });
});

describe("criterio 7: el administrador ve qué cambió", () => {
  it("getReview trae published, proposed y changedFields; listPendingReviews marca isEditOfPublished", async () => {
    const fp = await publish();
    await edit(fp);
    const versionId = (await body(await api.submit(A6, fp, SUBMIT_BODY))).working.id;
    const list = await body(await api.reviews(ADMIN));
    expect(list.items.find((i: any) => i.versionId === versionId)).toMatchObject({ isEditOfPublished: true });
    const res = await api.review(ADMIN, versionId);
    const json = await body(res);
    expect(res.status).toBe(200);
    expect(validateSchema("Review", json)).toEqual([]);
    expect(json.published).toMatchObject({ versionNumber: 1 });
    expect(json.published.content.schedule).toBe(OLD);
    expect(json.proposed.content.schedule).toBe(NEW);
    expect(json.changedFields).toEqual(["schedule"]);
  });

  it("con el nombre además cambiado: name y schedule; sin cambios de contenido: lista vacía; en draft el administrador recibe 403", async () => {
    const a = await publish();
    await edit(a, { name: RENAMED });
    expect((await api.get(ADMIN, a)).status).toBe(403);
    const va = (await body(await api.submit(A6, a, SUBMIT_BODY))).working.id;
    expect((await body(await api.review(ADMIN, va))).changedFields).toEqual(["name", "schedule"]);
    const b = await publish(NAME_TWO);
    const vb = await pendingEdit(b, { name: NAME_TWO, schedule: OLD });
    expect((await body(await api.review(ADMIN, vb))).changedFields).toEqual([]);
  });
});

describe("criterios 8, 9a, 10a, 11 y 18: rechazar, corregir, aprobar", () => {
  it("recorrido completo con la publicada siempre visible hasta aprobar y sin datos personales", async () => {
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const bodies: string[] = [];
    const record = async (res: Response) => (bodies.push(await res.clone().text()), res);
    const fp = await publish();
    const v2 = await pendingEdit(fp, { name: RENAMED });

    // Criterio 8: rechazo.
    const res = await record(await api.reject(ADMIN, v2, { confirmed: true, reason: EDIT_REASON }));
    const json = await body(res);
    expect(res.status).toBe(200);
    expect(validateSchema("ManagedListing", json)).toEqual([]);
    expect(json).toMatchObject({ displayStatus: "published", hasPublishedVersion: true, published: { versionNumber: 1 }, working: { status: "rejected", versionNumber: 2 }, lastRejection: { reason: EDIT_REASON } });
    expect(json.lastRejection.rejectedAt).toBeTruthy();
    expect(json.published.content.schedule).toBe(OLD);
    const vs = await versions(fp);
    expect(vs.map((v) => v.status)).toEqual(["published", "rejected"]);
    expect(vs[1]).toMatchObject({ rejection_reason: EDIT_REASON });
    expect(vs[1].decided_by).not.toBeNull();
    expect(await rows("select from_status, to_status, actor_role from app.listing_status_events where version_id = $1 order by id desc limit 1", [v2])).toEqual([{ from_status: "pending", to_status: "rejected", actor_role: "admin" }]);
    const audit = await rows("select details from app.audit_events where action = 'listing.rejected'");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(EDIT_REASON);
    expect(await rows("select template, recipient_telegram_user_id, payload from app.notification_outbox where template = 'listing_rejected'")).toEqual([
      { template: "listing_rejected", recipient_telegram_user_id: String(A6), payload: { listingName: RENAMED, reason: EDIT_REASON, isEdit: true } },
    ]);
    expect(await publicNames()).toEqual([NAME_ONE]);
    expect(await rows("select count(*)::int as n from app.listing_versions where listing_id = $1 and status = 'published'", [fp])).toEqual([{ n: 1 }]);
    expect((await api.review(ADMIN, v2)).status).toBe(404);
    expect((await api.approve(ADMIN, v2)).status).toBe(409);

    // Criterio 9a: entrega y lo que ve el prestador.
    await flush(afterTasks);
    expect(api.sent).toEqual([{ chatId: String(A6), text: es.provider.editRejected(RENAMED, EDIT_REASON) }]);
    expect(await rows("select status from app.notification_outbox where template = 'listing_rejected'")).toEqual([{ status: "sent" }]);
    expect((await body(await record(await api.get(A6, fp)))).lastRejection.reason).toBe(EDIT_REASON);
    const list = await body(await record(await api.list(A6)));
    expect(list.items.find((i: any) => i.id === fp)).toMatchObject({ displayStatus: "published", hasPublishedVersion: true });
    const other = await api.get(P2P, fp);
    expect(other.status).toBe(403);
    expect(await other.text()).not.toContain(EDIT_REASON);
    expect(JSON.stringify(await body(await api.list(P2P)))).not.toContain(NAME_ONE);
    expect(JSON.stringify(await body(await api.published(VISITOR)))).not.toContain(EDIT_REASON);

    // Criterio 10a: corregir.
    const corrected = await body(await record(await edit(fp, { name: RENAMED, schedule: "Todos los días de 8:00 a 20:00" })));
    expect(corrected).toMatchObject({ displayStatus: "draft", published: { versionNumber: 1 }, working: { versionNumber: 3, status: "draft" }, lastRejection: { reason: EDIT_REASON } });
    const vs3 = await versions(fp);
    expect(vs3.map((v) => [v.version_number, v.status])).toEqual([[1, "published"], [2, "rejected"], [3, "draft"]]);
    expect(vs3[1]).toMatchObject({ rejection_reason: EDIT_REASON });
    expect((await api.save(A6, fp, { confirmed: true })).status).toBe(422);
    const resubmitted = await body(await record(await api.submit(A6, fp, SUBMIT_BODY)));
    expect(resubmitted.displayStatus).toBe("pending");
    expect(resubmitted.lastRejection).toBeUndefined();
    const v3 = resubmitted.working.id as string;
    expect((await body(await api.reviews(ADMIN))).items.find((i: any) => i.versionId === v3)).toMatchObject({ isEditOfPublished: true });

    // Criterio 11: aprobar.
    const before = await snapshotAll(owner);
    for (const payload of [{}, { confirmed: false }]) expect((await api.approve(ADMIN, v3, payload)).status).toBe(422);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect(await publicNames()).toEqual([NAME_ONE]);
    const approval = await record(await api.approve(ADMIN, v3));
    const approved = await body(approval);
    expect(approval.status).toBe(200);
    expect(validateSchema("ManagedListing", approved)).toEqual([]);
    expect(approved).toMatchObject({ displayStatus: "published", hasPublishedVersion: true, published: { versionNumber: 3 }, working: null });
    expect(approved.published.content.schedule).toBe("Todos los días de 8:00 a 20:00");
    const final = await versions(fp);
    expect(final.map((v) => [v.version_number, v.status])).toEqual([[1, "superseded"], [2, "rejected"], [3, "published"]]);
    const admin = (await rows("select id from app.accounts where telegram_user_id = $1", [ADMIN]))[0].id;
    expect(final[2]).toMatchObject({ decided_by: admin });
    expect(final[2].decided_at).not.toBeNull();
    expect(await rows("select to_status, actor_role from app.listing_status_events where version_id = $1 and to_status = 'published'", [v3])).toEqual([{ to_status: "published", actor_role: "admin" }]);
    expect(await rows("select from_status, to_status, actor_role from app.listing_status_events where version_id = $1 and to_status = 'superseded'", [final[0].id])).toEqual([{ from_status: "published", to_status: "superseded", actor_role: "admin" }]);
    expect(await rows("select count(*)::int as n from app.audit_events where action = 'listing.approved'")).toEqual([{ n: 2 }]); // la primera publicación y esta
    expect(await rows("select payload from app.notification_outbox where template = 'listing_approved' and payload->>'isEdit' = 'true'")).toEqual([{ payload: { listingName: RENAMED, isEdit: true } }]);
    expect(await publicNames()).toEqual([RENAMED]);
    expect(await rows("select schedule from app.listing_versions where listing_id = $1 and status = 'published'", [fp])).toEqual([{ schedule: "Todos los días de 8:00 a 20:00" }]);
    await flush(afterTasks);
    expect(api.sent.at(-1)).toEqual({ chatId: String(A6), text: es.provider.editApproved(RENAMED) });

    // Criterio 18: sin número de identidad ni ID de Telegram en nada de lo anterior.
    const everything = [...bodies, ...logs, ...api.sent.map((m) => m.text), JSON.stringify(await rows("select payload from app.notification_outbox")), JSON.stringify(await rows("select details from app.audit_events"))].join("\n");
    for (const secret of ["9000070310", String(A6), String(ADMIN), String(P2P)]) expect(everything, secret).not.toContain(secret);
  });

  it("aprobar y rechazar a la vez da un 200 y un 409 con una sola decisión y un aviso", async () => {
    const fp = await publish();
    const v2 = await pendingEdit(fp);
    const outboxBefore = (await rows("select count(*)::int as n from app.notification_outbox"))[0].n;
    const results = await Promise.all([api.approve(ADMIN, v2), api.reject(ADMIN, v2)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await rows("select count(*)::int as n from app.listing_status_events where version_id = $1 and from_status = 'pending'", [v2])).toEqual([{ n: 1 }]);
    expect((await rows("select count(*)::int as n from app.notification_outbox"))[0].n).toBe(outboxBefore + 1);
    expect(await rows("select count(*)::int as n from app.listing_versions where listing_id = $1 and status = 'published'", [fp])).toEqual([{ n: 1 }]);
  });
});

describe("criterio 12: sin despublicar, eliminar ni archivar", () => {
  it("el contrato y las rutas no definen esas operaciones", () => {
    const yaml = readFileSync(resolve(__dirname, "../../api/openapi.yaml"), "utf8");
    const paths = yaml.slice(yaml.indexOf("\npaths:"), yaml.indexOf("\ncomponents:"));
    const operations = [...paths.matchAll(/operationId:\s*(\S+)/g)].map((m) => m[1]!);
    expect(operations.filter((o) => /unpublish|delete|remove|archive/i.test(o) && o !== "removePhoto")).toEqual([]);
    const listingPaths = [...paths.matchAll(/^ {2}(\/api\/v1\/(?:managed-listings|public\/listings)\S*):\s*$/gm)].map((m) => m[1]!);
    expect(listingPaths.length).toBeGreaterThan(0);
    for (const path of listingPaths) {
      const start = paths.indexOf(`\n  ${path}:`);
      const next = paths.slice(start + 3 + path.length).search(/^ {2}\//m);
      const block = paths.slice(start, next === -1 ? undefined : start + 3 + path.length + next);
      if (!path.includes("/photos")) expect(block, path).not.toMatch(/^ {4}(delete|patch):/m);
      expect(path).not.toMatch(/unpublish|archive|\/status$/);
    }
    const base = resolve(__dirname, "../../src/app/api/v1/managed-listings/[listingId]");
    expect(readFileSync(resolve(base, "route.ts"), "utf8")).not.toMatch(/export const (DELETE|PATCH|PUT|POST)/);
    for (const dir of ["unpublish", "status", "archive"]) expect(existsSync(resolve(base, dir))).toBe(false);
  });

  it("con eje_app, DELETE de listings y de versiones fallan por permisos", async () => {
    const fp = await publish();
    const app = new Pool({ connectionString: process.env.TEST_APP_URL, max: 1 });
    try {
      await expect(app.query("delete from app.listings")).rejects.toMatchObject({ code: "42501" });
      await expect(app.query("delete from app.listing_versions")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.end();
    }
    expect((await versions(fp)).map((v) => v.status)).toEqual(["published"]);
  });

  // P7 (D-155): la migración 20261119100000_f015_published_guard.sql rechaza sacar una versión de published salvo hacia superseded.
  it("con eje_app, UPDATE de la versión publicada a draft falla con 23514", async () => {
    const fp = await publish();
    const app = new Pool({ connectionString: process.env.TEST_APP_URL, max: 1 });
    try {
      const error = await app.query("update app.listing_versions set status = 'draft' where listing_id = $1 and status = 'published'", [fp]).then(() => null, (e) => e);
      expect(error).toMatchObject({ code: "23514", constraint: "listing_versions_published_transition" });
    } finally {
      await app.end();
    }
  });
});

describe("criterio 14: control de acceso sobre fichas publicadas", () => {
  it("401 sin consultar la base, consent_required, forbidden y sin cambios", async () => {
    const fp = await publish();
    const failing = failingDb();
    const deps = { config: () => testConfig(), db: () => failing.db, now: () => new Date() };
    const save = saveListingDraftHandler(deps);
    const submit = submitListingForReviewHandler(deps);
    const ctx = { params: Promise.resolve({ listingId: fp }) };
    const causes: Record<string, Record<string, string>> = {
      "sin cabecera": {},
      "firma de otro token": tma(signInitData({ userId: A6, token: "9:otro" })),
      "user.id cambiado": tma(signInitData({ userId: VISITOR, tamperUserId: A6 })),
    };
    for (const [cause, headers] of Object.entries(causes)) {
      const init = (method: string, payload: unknown) => ({ method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
      const a = await save(new Request(`http://localhost/api/v1/managed-listings/${fp}/draft`, init("PUT", draftBody(world, { schedule: NEW }))), ctx);
      const b = await submit(new Request(`http://localhost/api/v1/managed-listings/${fp}/submission`, init("POST", SUBMIT_BODY)), ctx);
      expect([a.status, b.status], cause).toEqual([401, 401]);
      expect((await body(a)).code).toBe("unauthenticated");
    }
    expect(failing.queries).toHaveLength(0);

    await createAccount(owner, TEST_PRINCIPAL_ADMIN_ID, "Principal Ficticio");
    for (const key of ["A4", "A5"] as const) await createAccount(owner, PERSON_IDS[key], `Persona Ficticia ${key}`);
    for (const phase of ["publicada", "con borrador"]) {
      if (phase === "con borrador") await edit(fp);
      const cases: [string, number, string][] = [
        ["A1", PERSON_IDS.A1, "consent_required"], ["A3", PERSON_IDS.A3, "consent_required"], ["A6b", A6B, "consent_required"],
        ["A2", PERSON_IDS.A2, "forbidden"], ["A4", PERSON_IDS.A4, "forbidden"], ["A5", PERSON_IDS.A5, "forbidden"],
        ["P2p", P2P, "forbidden"], ["admin", ADMIN, "forbidden"], ["principal", TEST_PRINCIPAL_ADMIN_ID, "forbidden"],
      ];
      for (const [label, user, code] of cases) {
        const before = await snapshotAll(owner);
        const empty = label === "A1" || label === "A3";
        for (const res of [await api.save(user, fp, empty ? {} : draftBody(world, { schedule: NEW })), await api.submit(user, fp, empty ? {} : SUBMIT_BODY)]) {
          expect([res.status, (await body(res)).code], `${phase} ${label}`).toEqual([403, code]);
        }
        expect(changedTables(before, await snapshotAll(owner)), `${phase} ${label}`).toEqual([]);
      }
    }
    expect((await versions(fp)).map((v) => v.status)).toEqual(["published", "draft"]);

    await revoke("provider", A6, ADMIN);
    const before = await snapshotAll(owner);
    for (const res of [await edit(fp), await api.submit(A6, fp, SUBMIT_BODY)]) expect([res.status, (await body(res)).code]).toEqual([403, "forbidden"]);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterio 15: el prestador no cambia el estado por la vía directa", () => {
  it("campos de estado en el cuerpo dan 422 unknown_field; decidir su edición da 403; la base lo impone", async () => {
    const fp = await publish();
    await edit(fp);
    const before = await snapshotAll(owner);
    for (const extra of [{ status: "published" }, { decidedBy: "x" }, { decidedAt: "2026-01-01T00:00:00Z" }, { rejectionReason: "x" }, { versionNumber: 9 }]) {
      for (const res of [await api.save(A6, fp, draftBody(world, { schedule: NEW }, extra)), await api.submit(A6, fp, { ...SUBMIT_BODY, ...extra })]) {
        const json = await body(res);
        expect(res.status, JSON.stringify(extra)).toBe(422);
        expect(json.errors.map((e: any) => e.code)).toContain("unknown_field");
      }
    }
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    const v2 = (await body(await api.submit(A6, fp, SUBMIT_BODY))).working.id as string;
    const snap = await snapshotAll(owner);
    for (const res of [await api.approve(A6, v2), await api.reject(A6, v2)]) expect([res.status, (await body(res)).code]).toEqual([403, "forbidden"]);
    expect(changedTables(snap, await snapshotAll(owner))).toEqual([]);
    expect((await versions(fp)).map((v) => v.status)).toEqual(["published", "pending"]);

    const app = new Pool({ connectionString: process.env.TEST_APP_URL, max: 1 });
    try {
      await expect(app.query("update app.listing_versions set status = 'published', decided_by = $2 where id = $1", [v2, world.a6Account])).rejects.toMatchObject({ code: "23514", constraint: "listing_versions_decision_actor" });
      const v1 = (await versions(fp))[0]!.id;
      await expect(app.query("update app.listing_versions set status = 'rejected', rejection_reason = 'x' where id = $1", [v1])).rejects.toMatchObject({ code: "23514", constraint: "listing_versions_decision_transition" });
    } finally {
      await app.end();
    }
  });
});

describe("criterio 16: separación entre negocios y prestador revocado", () => {
  it("cada prestador edita y envía solo lo suyo y el visitante no ve ningún working", async () => {
    const fp = await publish();
    const fp2 = await publish(NAME_TWO);
    const fp3 = await publish(NAME_THREE, P2P);
    await pendingEdit(fp);
    await pendingEdit(fp2, { name: NAME_TWO });
    expect((await api.save(P2P, fp3, draftBody(world, { name: NAME_THREE, schedule: NEW }))).status).toBe(200);
    expect((await api.submit(P2P, fp3, SUBMIT_BODY)).status).toBe(200);
    const before = await snapshotAll(owner);
    expect((await api.save(P2P, fp, draftBody(world, { schedule: NEW }))).status).toBe(403);
    expect((await api.save(A6, fp3, draftBody(world, { schedule: NEW }))).status).toBe(403);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect((await body(await api.list(A6))).items.map((i: any) => [i.id, i.displayStatus]).sort()).toEqual([[fp, "pending"], [fp2, "pending"]].sort());
    expect((await body(await api.list(P2P))).items.map((i: any) => [i.id, i.displayStatus])).toEqual([[fp3, "pending"]]);
    expect(JSON.stringify(await body(await api.published(VISITOR)))).not.toContain('"working"');
  });

  it("con el permiso del dueño revocado: aprobar da 409, rechazar 200 sin aviso y la publicada sigue visible antes del 31 de enero de 2027", async () => {
    const fp = await publish();
    const v2 = await pendingEdit(fp, { name: RENAMED });
    await revoke("provider", A6, ADMIN);
    // Reloj simulado anterior al 31 de enero de 2027 (D-043); las firmas de initData llevan la misma fecha.
    const clock = new Date("2026-12-15T12:00:00Z");
    api.state.now = () => clock;
    const as = (userId: number) => tma(signInitData({ userId, authDate: Math.floor(clock.getTime() / 1000) }));
    const visible = async () => ((await body(await listPublishedListingsHandler(api.deps)(new Request("http://localhost/api/v1/public/listings", { headers: as(VISITOR) })))).items as any[]).map((i) => i.name);
    expect(await visible()).toEqual([NAME_ONE]);
    expect((await api.approve(ADMIN, v2, { confirmed: true }, as(ADMIN))).status).toBe(409);
    const outboxBefore = (await rows("select count(*)::int as n from app.notification_outbox"))[0].n;
    expect((await api.reject(ADMIN, v2, { confirmed: true, reason: REASON }, as(ADMIN))).status).toBe(200);
    expect((await rows("select count(*)::int as n from app.notification_outbox"))[0].n).toBe(outboxBefore);
    expect(await visible()).toEqual([NAME_ONE]);
  });
});

describe("criterio 17: solo el administrador activo decide una edición", () => {
  it("el administrador revocado recibe 403 y la edición sigue pending", async () => {
    await createAccount(owner, 900007002, "Administrador Ficticio Dos");
    await owner.query("insert into app.role_grants (telegram_user_id, role) values (900007002, 'admin')");
    const fp = await publish();
    const v2 = await pendingEdit(fp);
    await revoke("admin", ADMIN, 900007002);
    const before = await snapshotAll(owner);
    for (const res of [await api.approve(ADMIN, v2), await api.reject(ADMIN, v2)]) expect([res.status, (await body(res)).code]).toEqual([403, "forbidden"]);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });

  it("decidir un borrador da 409 sin cambios", async () => {
    const fp = await publish();
    await edit(fp);
    const draft = (await versions(fp))[1]!.id as string;
    const before = await snapshotAll(owner);
    for (const res of [await api.approve(ADMIN, draft), await api.reject(ADMIN, draft)]) expect([res.status, (await body(res)).code]).toEqual([409, "invalid_state_transition"]);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });

  it.each(["notification_outbox", "audit_events"])("si falla el insert de %s la edición sigue pending, la publicada no pasa a superseded y responde 500", async (table) => {
    const failInsertInto = (name: string): KyselyPlugin => ({
      transformQuery: ({ node }) => {
        if (node.kind === "InsertQueryNode" && (node as InsertQueryNode).into?.table.identifier.name === name) throw new Error("fallo-inyectado");
        return node;
      },
      transformResult: async ({ result }) => result,
    });
    const failing = appDb();
    const bad = makeReviewListingApi(failing.withPlugin(failInsertInto(table)) as never);
    try {
      const fp = await publish();
      const v2 = await pendingEdit(fp);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      for (const kind of ["approve", "reject"] as const) {
        const before = await snapshotAll(owner);
        const res = kind === "approve" ? await bad.approve(ADMIN, v2) : await bad.reject(ADMIN, v2);
        expect([res.status, (await body(res)).code], kind).toEqual([500, "internal_error"]);
        expect(changedTables(before, await snapshotAll(owner)), kind).toEqual([]);
      }
      expect((await versions(fp)).map((v) => v.status)).toEqual(["published", "pending"]);
    } finally {
      await failing.destroy();
      await bad.destroy();
    }
  });
});

describe("criterio 18: confirmación en las cuatro operaciones sobre una ficha publicada", () => {
  it("sin confirmed: true fallan con 422 y la instantánea no cambia", async () => {
    const fp = await publish();
    const start = await snapshotAll(owner);
    expect((await api.save(A6, fp, draftBody(world, { schedule: NEW }, { confirmed: false }))).status).toBe(422);
    expect(changedTables(start, await snapshotAll(owner))).toEqual([]);
    await edit(fp);
    const draft = await snapshotAll(owner);
    expect((await api.submit(A6, fp, { thirdPartyAuthorizationDeclared: true })).status).toBe(422);
    expect(changedTables(draft, await snapshotAll(owner))).toEqual([]);
    const v2 = (await body(await api.submit(A6, fp, SUBMIT_BODY))).working.id as string;
    const pending = await snapshotAll(owner);
    expect((await api.approve(ADMIN, v2, {})).status).toBe(422);
    expect((await api.reject(ADMIN, v2, { reason: REASON })).status).toBe(422);
    expect(changedTables(pending, await snapshotAll(owner))).toEqual([]);
  });
});
