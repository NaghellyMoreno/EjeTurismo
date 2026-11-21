/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInformationRequestHandler, getPublishedListingHandler, listPublishedListingsHandler } from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { RECEIPT_NOTICE } from "@/server/domain/information-request";
import { memoryStorage } from "@/server/storage";
import { testConfig } from "../helpers/config";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import {
  ADMIN, CHANGED_NAME, CLOCK, counterOf, FUTURE, LATE_CLOCK, MESSAGE, P1, P3, PARTY_SIZE, PAST, requestCount, requestRows, TODAY, V, V0, V2, V_OLD, type InfoWorld, seedInfoWorld,
} from "../helpers/information-request";
import { createOldVersionAccount } from "../factories/accounts";
import { seedListing } from "../helpers/listing-data";
import { signInitData, tma } from "../helpers/telegram";

// F030, criterios 5, 17 a 23 (HTTP): manejadores reales, base de pruebas y reloj fijo.
let owner: Pool;
let world: InfoWorld;
let clock = CLOCK;
const db = appDb();
const deps = (env: Record<string, string | undefined> = {}, override?: Deps["db"]): Deps => ({ config: () => testConfig(env), db: override ?? (() => db), now: () => clock, storage: () => memoryStorage() });
let create = createInformationRequestHandler(deps());
const getDetail = getPublishedListingHandler(deps());
const list = listPublishedListingsHandler(deps());

const headers = (user: number | null, extra?: Record<string, string>) =>
  extra ?? (user === null ? {} : tma(signInitData({ userId: user, authDate: Math.floor(clock.getTime() / 1000) })));
const valid = (over: Record<string, unknown> = {}) => ({ requesterName: CHANGED_NAME, interestDate: FUTURE.api, partySize: PARTY_SIZE, message: MESSAGE, confirmed: true, ...over });
const post = (user: number | null, listingId: string, body: unknown, extra?: Record<string, string>, handler = create) =>
  handler(
    new Request(`http://localhost/api/v1/public/listings/${listingId}/information-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers(user, extra) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ listingId }) },
  );
const detail = (user: number, id: string) => getDetail(new Request(`http://localhost/api/v1/public/listings/${id}`, { headers: headers(user) }), { params: Promise.resolve({ listingId: id }) });

const logs = { log: vi.spyOn(console, "log"), warn: vi.spyOn(console, "warn"), error: vi.spyOn(console, "error") };
const CANARIES = [CHANGED_NAME, MESSAGE, "CANARIO-F030-7731"];
const noCanaryInLogs = () => {
  const lines = [...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls].map((args) => args.map(String).join(" "));
  for (const line of lines) for (const canary of CANARIES) expect(line).not.toContain(canary);
};

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await db.destroy();
});
beforeEach(async () => {
  clock = CLOCK;
  create = createInformationRequestHandler(deps());
  await resetDb(owner);
  world = await seedInfoWorld(owner);
  for (const spy of Object.values(logs)) spy.mockClear().mockImplementation(() => undefined);
});
afterEach(noCanaryInLogs);

describe("criterio 5: acceptsRequests", () => {
  it("true para L1, false para el atractivo y para la ficha del prestador revocado", async () => {
    const accepts = async (id: string) => ((await (await detail(V, id)).json()) as any).acceptsRequests;
    expect(await accepts(world.l1.listingId)).toBe(true);
    expect(await accepts(world.a1.listingId)).toBe(false);
    expect(await accepts(world.l2.listingId)).toBe(false);
  });
});

describe("criterio 17: recibo", () => {
  it("201 con InformationRequestReceipt y la solicitud queda en new dirigida al negocio de la ficha", async () => {
    const res = await post(V, world.l1.listingId, valid());
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(Object.keys(body).sort()).toEqual(["createdAt", "id", "notice", "status"]);
    expect(body).toMatchObject({ status: "new", notice: RECEIPT_NOTICE });
    expect(body.notice).toContain("No es una reserva confirmada.");
    expect(new Date(body.createdAt).toISOString()).toBe(CLOCK.toISOString());
    const [row] = await requestRows(owner);
    expect(row).toMatchObject({
      id: body.id, status: "new", listing_id: world.l1.listingId, business_id: world.l1.businessId, visitor_account_id: world.accounts[V],
      requester_name: CHANGED_NAME, party_size: PARTY_SIZE, message: MESSAGE,
    });
    expect(String(row.interest_date instanceof Date ? row.interest_date.toISOString().slice(0, 10) : row.interest_date)).toContain("2026-12-25");
  });
});

describe("criterio 18: validación", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["fecha pasada", { interestDate: PAST.api }],
    ["fecha 2027-02-31", { interestDate: "2027-02-31" }],
    ["fecha 31/02/2027", { interestDate: "31/02/2027" }],
    ["fecha ausente", { interestDate: undefined }],
    ["partySize 0", { partySize: 0 }],
    ["partySize decimal", { partySize: 2.5 }],
    ["partySize texto", { partySize: "3" }],
    ["mensaje vacío", { message: "" }],
    ["mensaje de solo espacios", { message: "   " }],
    ["mensaje de más de 4096", { message: "x".repeat(4097) }],
    ["nombre vacío", { requesterName: "" }],
    ["nombre de más de 4096", { requesterName: "x".repeat(4097) }],
    ["confirmed falso", { confirmed: false }],
    ["confirmed ausente", { confirmed: undefined }],
    ["clave adicional", { extra: "x" }],
    ["businessId adicional", { businessId: "00000000-0000-4000-8000-000000000001" }],
  ];
  for (const [name, over] of cases) {
    it(`${name}: 422 y sin fila`, async () => {
      const res = await post(V, world.l1.listingId, valid(over));
      expect(res.status).toBe(422);
      expect(((await res.json()) as any).code).toBe("validation_failed");
      expect(await requestCount(owner)).toBe(0);
    });
  }

  it("un cuerpo que no es JSON o no es un objeto da 422", async () => {
    expect((await post(V, world.l1.listingId, "no es json")).status).toBe(422);
    expect((await post(V, world.l1.listingId, [])).status).toBe(422);
    expect(await requestCount(owner)).toBe(0);
  });

  it("hoy en America/Bogota se acepta con el reloj a las 23:30 de Bogotá (ya es mañana en UTC)", async () => {
    clock = LATE_CLOCK;
    create = createInformationRequestHandler(deps());
    expect((await post(V, world.l1.listingId, valid({ interestDate: TODAY.api }))).status).toBe(201);
    expect((await post(V, world.l1.listingId, valid({ interestDate: PAST.api }))).status).toBe(422);
    expect(await requestCount(owner)).toBe(1);
  });
});

describe("criterio 19: autenticación, aviso y otros roles", () => {
  it("sin initData, alterado y vencido: 401 sin fila", async () => {
    expect((await post(null, world.l1.listingId, valid())).status).toBe(401);
    expect((await post(V, world.l1.listingId, valid(), tma(signInitData({ userId: V, tamperUserId: V2, authDate: Math.floor(clock.getTime() / 1000) })))).status).toBe(401);
    expect((await post(V, world.l1.listingId, valid(), tma(signInitData({ userId: V, authDate: Math.floor(clock.getTime() / 1000) - 86401 - 60 })))).status).toBe(401);
    expect(await requestCount(owner)).toBe(0);
  });

  it("sin aviso (V0) y con una versión anterior del aviso: 403 consent_required, sin fila ni contador", async () => {
    await createOldVersionAccount(owner, V_OLD);
    for (const user of [V0, V_OLD]) {
      const res = await post(user, world.l1.listingId, valid());
      expect(res.status).toBe(403);
      expect(((await res.json()) as any).code).toBe("consent_required");
    }
    expect(await requestCount(owner)).toBe(0);
    expect(Number((await owner.query("select count(*) from app.rate_limit_counters")).rows[0].count)).toBe(0);
  });

  it("administrador, P1 sobre su propia L1 y otro prestador P3: 201 con su propio visitor_account_id (D-183)", async () => {
    for (const user of [ADMIN, P1, P3]) expect((await post(user, world.l1.listingId, valid())).status, String(user)).toBe(201);
    const rows = await requestRows(owner);
    expect(rows.map((r) => r.visitor_account_id).sort()).toEqual([world.accounts[ADMIN], world.accounts[P1], world.accounts[P3]].sort());
    expect(rows.every((r) => r.business_id === world.l1.businessId && r.status === "new")).toBe(true);
  });
});

describe("criterio 20: fichas que no reciben solicitudes", () => {
  it("atractivo y prestador sin rol: 409 listing_not_accepting_requests", async () => {
    for (const id of [world.a1.listingId, world.l2.listingId]) {
      const res = await post(V, id, valid());
      expect(res.status).toBe(409);
      expect(((await res.json()) as any).code).toBe("listing_not_accepting_requests");
    }
    expect(await requestCount(owner)).toBe(0);
  });

  it("ficha en borrador, pendiente, inexistente o con ID mal formado: 404", async () => {
    const attempt = async (id: string) => {
      const res = await post(V, id, valid());
      expect(res.status, id).toBe(404);
      expect(((await res.json()) as any).code).toBe("not_found");
    };
    await attempt(world.l3.listingId); // borrador
    const pending = await seedListing(owner, { accountId: world.accounts[P1], municipalityId: world.municipalityId, categoryId: world.categoryId, name: "Pendiente Ficticia De Solicitudes", status: "pending" });
    await attempt(pending.listingId);
    await attempt("00000000-0000-4000-8000-000000000000");
    await attempt("no-es-uuid");
    expect(await requestCount(owner)).toBe(0);
  });
});

describe("criterio 21: límite de intentos", () => {
  it("10 solicitudes en el día; la 11.ª da 429 con Retry-After; otra cuenta no queda afectada", async () => {
    for (let i = 0; i < 10; i++) expect((await post(V, world.l1.listingId, valid())).status, `intento ${i + 1}`).toBe(201);
    const limited = await post(V, world.l1.listingId, valid());
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as any).code).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await requestCount(owner)).toBe(10);
    expect((await post(V2, world.l1.listingId, valid())).status).toBe(201);
  });

  it("la cifra sale de la configuración", async () => {
    create = createInformationRequestHandler(deps({ RATE_LIMITS: JSON.stringify({ information_request: { limit: 2, windowSeconds: 3600 } }) }));
    expect((await post(V, world.l1.listingId, valid())).status).toBe(201);
    expect((await post(V, world.l1.listingId, valid())).status).toBe(201);
    expect((await post(V, world.l1.listingId, valid())).status).toBe(429);
  });

  it("las peticiones rechazadas con 422 cuentan; las rechazadas con 401 o 403 no", async () => {
    for (let i = 0; i < 3; i++) expect((await post(V, world.l1.listingId, valid({ partySize: 0 }))).status).toBe(422);
    expect(await counterOf(owner, world.accounts[V])).toBe(3);
    await post(null, world.l1.listingId, valid());
    await post(V0, world.l1.listingId, valid());
    expect(await counterOf(owner, world.accounts[V])).toBe(3);
  });

  it("con 10 intentos de 422 ya consumidos, la siguiente petición válida da 429", async () => {
    for (let i = 0; i < 10; i++) await post(V, world.l1.listingId, valid({ partySize: 0 }));
    expect((await post(V, world.l1.listingId, valid())).status).toBe(429);
    expect(await requestCount(owner)).toBe(0);
  });
});

describe("criterio 22: fallos internos y registros", () => {
  it("un fallo de base da 500 genérico sin nombre, mensaje ni texto de la solicitud", async () => {
    const failing = failingDb();
    const res = await post(V, world.l1.listingId, valid(), undefined, createInformationRequestHandler(deps({}, () => failing.db)));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ code: "internal_error" });
    for (const secret of [...CANARIES, failing.errorText]) expect(text).not.toContain(secret);
    noCanaryInLogs();
  });

  it("un fallo de la inserción (la base responde pero la restricción falla) tampoco filtra datos", async () => {
    // Un disparador que falla de forma inesperada simula el fallo interno al insertar.
    await owner.query("create function app.f030_boom() returns trigger language plpgsql as $$ begin raise exception 'detalle-interno-secreto %', new.message; end $$");
    await owner.query("create trigger a_boom before insert on app.information_requests for each row execute function app.f030_boom()");
    try {
      const res = await post(V, world.l1.listingId, valid());
      expect(res.status).toBe(500);
      const text = await res.text();
      for (const secret of [...CANARIES, "detalle-interno-secreto"]) expect(text).not.toContain(secret);
      noCanaryInLogs();
    } finally {
      await owner.query("drop trigger a_boom on app.information_requests");
      await owner.query("drop function app.f030_boom()");
    }
  });

  it("los errores 4xx de los criterios 17 a 21 no incluyen lo escrito por el visitante", async () => {
    const bodies: string[] = [];
    for (const [user, id, over] of [[V, world.l1.listingId, { interestDate: PAST.api }], [V, world.a1.listingId, {}], [V, world.l3.listingId, {}], [V0, world.l1.listingId, {}], [null, world.l1.listingId, {}]] as const) {
      bodies.push(await (await post(user, id, valid(over))).text());
    }
    for (const body of bodies) for (const canary of CANARIES) expect(body).not.toContain(canary);
  });
});

describe("criterio 23: el visitante no ve datos de solicitudes", () => {
  it("las respuestas de la ficha, del listado y de createInformationRequest no llevan los canarios de V ni de V2", async () => {
    const canaries = [CHANGED_NAME, FUTURE.api, "CANARIO-F030-7731", "Otro Nombre V2", "Mensaje distinto de V2", "2027-03-03"];
    const responses: string[] = [];
    responses.push(await (await post(V, world.l1.listingId, valid())).text());
    responses.push(await (await post(V2, world.l1.listingId, valid({ requesterName: "Otro Nombre V2", message: "Mensaje distinto de V2", interestDate: "2027-03-03", partySize: 7 }))).text());
    responses.push(await (await post(V, world.l1.listingId, valid({ partySize: 0 }))).text());
    responses.push(await (await post(V, world.a1.listingId, valid())).text());
    responses.push(await (await detail(V, world.l1.listingId)).text());
    responses.push(await (await list(new Request("http://localhost/api/v1/public/listings", { headers: headers(V) }))).text());
    // V2 solo recibe su propio recibo: nada de lo de V.
    const own = (JSON.parse(responses[1]) as any);
    expect(Object.keys(own).sort()).toEqual(["createdAt", "id", "notice", "status"]);
    for (const response of [responses[0], ...responses.slice(2)]) {
      expect(response).not.toContain("Otro Nombre V2");
      expect(response).not.toContain("Mensaje distinto de V2");
      expect(response).not.toContain("2027-03-03");
    }
    for (const response of responses.slice(2)) for (const canary of canaries) expect(response).not.toContain(canary);
    expect(responses[0]).not.toContain(MESSAGE);
    expect(responses[0]).not.toContain(CHANGED_NAME);
  });
});
