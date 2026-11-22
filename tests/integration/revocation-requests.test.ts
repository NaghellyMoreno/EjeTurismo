/* eslint-disable @typescript-eslint/no-explicit-any -- filas y cuerpos JSON sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInformationRequestHandler, getPublishedListingHandler, listMyBusinessInformationRequestsHandler, getInformationRequestHandler, listPublishedListingsHandler } from "@/server/http/handlers";
import { deliverNotifications } from "@/server/notifications";
import { revokeMyAuthorization } from "@/server/services";
import { memoryStorage } from "@/server/storage";
import { createAccount } from "../factories/accounts";
import { testConfig } from "../helpers/config";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { ADMIN, P1, P3, V, V2, requestCount, revokeProvider } from "../helpers/information-request";
import { seedListing } from "../helpers/listing-data";
import { insertRequest, outboxRows, seedWorld32, type World32 } from "../helpers/provider-requests";
import { makeSelfRevokeApi } from "../helpers/self-revoke-http";
import { signInitData, tma } from "../helpers/telegram";

// F037: efectos de revocar la autorización sobre solicitudes y fichas (criterios 1, 4, 5, 7 a 10, 13, 15 a 17, 19 a 21 y 23 a 27).
let owner: Pool;
let world: World32;
const db = appDb();
const config = testConfig();
const WITHDRAWN = "information_request_withdrawn";
const PROVIDER_REVOKED = "information_request_provider_revoked";
const WITHDRAWN_TEXT = "Una solicitud de información que habías recibido ya no está disponible porque la persona que la envió retiró su autorización.";
const PROVIDER_REVOKED_TEXT = "Una solicitud que enviaste ya no está disponible porque el prestador que la recibió retiró su autorización.";
const logs = { log: vi.spyOn(console, "log"), warn: vi.spyOn(console, "warn"), error: vi.spyOn(console, "error") };

const deps = { config: () => config, db: () => db, now: () => new Date(), storage: () => memoryStorage() };
const headers = (user: number) => ({ "Content-Type": "application/json", ...tma(signInitData({ userId: user })) });
const ctx = <K extends string>(key: K, id: string) => ({ params: Promise.resolve({ [key]: id } as Record<K, string>) });
const listReq = (user: number) => listMyBusinessInformationRequestsHandler(deps)(new Request("http://localhost/api/v1/information-requests", { headers: headers(user) }));
const getReq = (user: number, id: string) => getInformationRequestHandler(deps)(new Request(`http://localhost/api/v1/information-requests/${id}`, { headers: headers(user) }), ctx("requestId", id));
const detail = (user: number, id: string) => getPublishedListingHandler(deps)(new Request(`http://localhost/api/v1/public/listings/${id}`, { headers: headers(user) }), ctx("listingId", id));
const publicList = (user: number) => listPublishedListingsHandler(deps)(new Request("http://localhost/api/v1/public/listings", { headers: headers(user) }));
const create = (user: number, listingId: string) =>
  createInformationRequestHandler(deps)(
    new Request(`http://localhost/api/v1/public/listings/${listingId}/information-requests`, {
      method: "POST",
      headers: headers(user),
      body: JSON.stringify({ requesterName: "Persona de prueba", interestDate: "2099-01-15", partySize: 2, message: "Mensaje de prueba", confirmed: true }),
    }),
    ctx("listingId", listingId),
  );

const revoke = (user: number, onQueued?: (ids: string[]) => void) => revokeMyAuthorization(db, config, { telegramUserId: String(user) } as any, { confirmed: true }, "bot", new Date(), onQueued);
const ids = async (table: string) => (await owner.query(`select id from app.${table} order by id`)).rows.map((r) => r.id as string);
const notices = async (template?: string) => (await outboxRows(owner)).filter((r) => (template ? r.template === template : [WITHDRAWN, PROVIDER_REVOKED].includes(r.template)));
const add = (visitor: number, w: { listingId: string; businessId: string } = world.l1) => insertRequest(owner, { listingId: w.listingId, businessId: w.businessId, visitorAccountId: world.accounts[visitor] });
// Respuesta del dueño y cambio de estado, con el rol propietario (deja respuesta y evento que la revocación debe borrar).
async function reply(requestId: string, provider: number) {
  await owner.query("insert into app.information_request_replies (request_id, body, sent_by_account_id) values ($1, 'Respuesta de prueba', $2)", [requestId, world.accounts[provider]]);
  await owner.query("insert into app.information_request_status_events (request_id, from_status, to_status, actor_account_id) values ($1, 'new', 'attended', $2)", [requestId, world.accounts[provider]]);
}
const sent: Array<[string, string]> = [];
const sender = async (chat: string, text: string) => void sent.push([chat, text]);
const flush = async (queued: string[]) => deliverNotifications(queued, { db: () => db, now: () => new Date(), send: sender });
async function revokeAndSend(user: number) {
  let queued: string[] = [];
  await revoke(user, (q) => (queued = q));
  await flush(queued);
}

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld32(owner);
  sent.length = 0;
  for (const spy of Object.values(logs)) spy.mockClear().mockImplementation(() => undefined);
});
afterEach(async () => {
  await owner.query("drop trigger if exists test_fail_f037 on app.notification_outbox");
  await owner.query("drop function if exists app.test_fail_f037()");
});

describe("revoca un visitante (criterios 1, 4 a 10)", () => {
  it("borra la solicitud con respuestas e historial, la lista del prestador ya no la ve y se avisa solo al prestador con texto literal", async () => {
    const r1 = await add(V);
    await reply(r1, P1);
    expect(await (await listReq(P1)).json()).toMatchObject({ items: [{ id: r1 }] });
    await revokeAndSend(V);
    for (const table of ["information_requests", "information_request_replies", "information_request_status_events"]) expect(await ids(table)).toEqual([]);
    expect((await (await listReq(P1)).json()).items).toEqual([]);
    // El contrato de getInformationRequest solo define 403 (D-011): una solicitud que ya no existe no se distingue de una ajena.
    expect((await getReq(P1, r1)).status).toBe(403);
    const rows = await notices();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ template: WITHDRAWN, recipient_telegram_user_id: String(P1), status: "sent" });
    expect(sent).toEqual([[String(P1), WITHDRAWN_TEXT]]);
    expect(JSON.stringify(rows[0].payload)).toBe("{}");
  });

  it("9: dos solicitudes a prestadores distintos avisan a cada uno; las dos se borran", async () => {
    await add(V);
    await add(V, world.l2b);
    await revokeAndSend(V);
    expect(await requestCount(owner)).toBe(0);
    expect(sent.map(([chat]) => chat).sort()).toEqual([String(P1), String(P3)].sort());
  });

  it("10: si el negocio ya no tiene prestador con rol activo, se borra sin aviso", async () => {
    await add(V);
    await revokeProvider(owner, P1);
    await revokeAndSend(V);
    expect(await requestCount(owner)).toBe(0);
    expect(await notices()).toEqual([]);
  });
});

describe("revoca un prestador (criterios 11, 13, 15, 16, 17, 19, 20)", () => {
  it("borra las solicitudes recibidas y avisa a cada visitante con el literal de D-057; no toca fichas", async () => {
    const base = { accountId: world.accounts[P1], municipalityId: world.municipalityId, categoryId: world.categoryId };
    const draftListing = await seedListing(owner, { ...base, name: "Borrador F037", status: "draft" });
    const pendingListing = await seedListing(owner, { ...base, name: "Pendiente F037", status: "pending" });
    const draft = [{ id: draftListing.listingId }, { id: pendingListing.listingId }];
    const snapshot = async () => ({
      listings: (await owner.query("select id, kind, business_id, created_at from app.listings order by id")).rows,
      versions: (await owner.query("select id, listing_id, status, version_number from app.listing_versions order by id")).rows,
    });
    const before = await snapshot();
    const detailBefore = await (await detail(V, world.l1.listingId)).json();
    const r1 = await add(V);
    await add(V2);
    const other = await add(V, world.l2b);
    await reply(r1, P1);
    await revokeAndSend(P1);
    expect((await owner.query("select id from app.information_requests")).rows.map((r) => r.id)).toEqual([other]);
    expect(await ids("information_request_replies")).toEqual([]);
    expect(await ids("information_request_status_events")).toEqual([]);
    expect(sent.map(([chat]) => chat).sort()).toEqual([String(V), String(V2)].sort());
    for (const [, text] of sent) expect(text).toBe(PROVIDER_REVOKED_TEXT);
    expect(await notices(WITHDRAWN)).toEqual([]);
    // Cuenta y permiso fuera; fichas intactas.
    expect((await owner.query("select 1 from app.accounts where telegram_user_id = $1", [P1])).rows).toEqual([]);
    expect((await owner.query("select 1 from app.role_grants where telegram_user_id = $1", [P1])).rows).toEqual([]);
    expect(await snapshot()).toEqual(before);
    // Ficha publicada: visible, sin solicitudes. Borrador: no visible.
    const published = await detail(V, world.l1.listingId);
    expect(published.status).toBe(200);
    const after = await published.json();
    expect(after.acceptsRequests).toBe(false);
    expect({ ...after, acceptsRequests: undefined }).toEqual({ ...detailBefore, acceptsRequests: undefined });
    expect(detailBefore.acceptsRequests).toBe(true);
    for (const row of draft) expect((await detail(V, row.id)).status).toBe(404);
    const names = JSON.stringify(await (await publicList(V)).json());
    for (const row of draft) expect(names).not.toContain(row.id);
    // 19: nueva solicitud rechazada sin crear fila.
    const count = await requestCount(owner);
    const res = await create(V2, world.l1.listingId);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "listing_not_accepting_requests" });
    expect(await requestCount(owner)).toBe(count);
  });

  it("16a y 16b: la solicitud enviada a otro prestador se borra con aviso a este; la enviada a su propio negocio, sin aviso", async () => {
    await add(P1, world.l2b);
    const own = await add(P1);
    expect(own).toBeTruthy();
    await revokeAndSend(P1);
    expect(await requestCount(owner)).toBe(0);
    expect(sent).toEqual([[String(P3), WITHDRAWN_TEXT]]);
    expect((await notices()).filter((n) => n.recipient_telegram_user_id === String(P1))).toEqual([]);
  });

  it("un prestador con el permiso ya revocado conserva las solicitudes recibidas (D-043) y no avisa a nadie", async () => {
    await add(V, world.l2b);
    await revokeProvider(owner, P3);
    await revokeAndSend(P3);
    expect(await requestCount(owner)).toBe(1);
    expect(await notices()).toEqual([]);
  });
});

describe("atomicidad, acceso y casos límite (criterios 21 a 27)", () => {
  it("21: un fallo al insertar el aviso deja todo intacto", async () => {
    await add(V);
    await owner.query("create function app.test_fail_f037() returns trigger language plpgsql as $$ begin raise exception 'fallo inyectado'; end $$");
    await owner.query("create trigger test_fail_f037 before insert on app.notification_outbox for each row execute function app.test_fail_f037()");
    await expect(revoke(V)).rejects.toThrow();
    expect(await requestCount(owner)).toBe(1);
    expect((await owner.query("select 1 from app.accounts where telegram_user_id = $1", [V])).rows).toHaveLength(1);
    expect(await notices()).toEqual([]);
  });

  it("21: la regla de F035 (409) no borra solicitudes ni encola avisos", async () => {
    await createAccount(owner, ADMIN + 100, "Otro");
    await add(ADMIN);
    await expect(revoke(ADMIN)).rejects.toMatchObject({ status: 409 });
    expect(await requestCount(owner)).toBe(1);
    expect(await notices()).toEqual([]);
  });

  it("24: sin sesión 401, sin cuenta 403 y sin confirmar 422; no se borra nada", async () => {
    await add(V);
    const api = makeSelfRevokeApi();
    expect((await api.revoke(null)).status).toBe(401);
    expect((await api.revoke(990037001)).status).toBe(403);
    expect((await api.revoke(V, {})).status).toBe(422);
    expect((await api.revoke(V, { confirmed: false })).status).toBe(422);
    expect(await requestCount(owner)).toBe(1);
    expect(await notices()).toEqual([]);
  });

  it("25: revocar a V1 no borra las de V2 ni las de otros negocios; revocar a P1 no borra las del negocio de P3", async () => {
    const mine = await add(V);
    const v2 = await add(V2);
    const other = await add(V, world.l2b);
    await revoke(V);
    expect((await ids("information_requests")).sort()).toEqual([v2].sort());
    expect(mine).not.toBe(other);
    const again = await add(V2, world.l2b);
    await revoke(P1);
    expect((await ids("information_requests")).sort()).toEqual([again].sort());
  });

  it("26: una segunda revocación responde 403 sin avisos duplicados", async () => {
    await add(V);
    await revoke(V);
    await expect(revoke(V)).rejects.toMatchObject({ status: 403 });
    expect(await notices()).toHaveLength(1);
  });

  it("27: una cuenta sin solicitudes revoca sin avisos (visitante y prestador)", async () => {
    await revoke(V);
    await revoke(P3);
    expect(await notices()).toEqual([]);
  });

  it("23: ni los avisos ni los registros llevan nombre, mensaje, fecha ni identificadores", async () => {
    await add(V);
    await add(V2, world.l2b);
    await revokeAndSend(V);
    await revokeAndSend(P3);
    const all = JSON.stringify(await notices()) + sent.map(([, t]) => t).join("|");
    for (const canary of ["Ana de Prueba", "CANARIO-F031-4420", "2026-11-25", "25/11/2026", String(V), String(V2)]) {
      expect(JSON.stringify((await notices()).map((n) => n.payload))).not.toContain(canary);
      expect(sent.map(([, t]) => t).join("|")).not.toContain(canary);
    }
    expect(all).toBeTruthy();
    const lines = [...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls].map((args) => args.map(String).join(" ")).join("\n");
    expect(lines).not.toContain("Ana de Prueba");
    expect(lines).not.toContain("CANARIO-F031-4420");
  });
});
