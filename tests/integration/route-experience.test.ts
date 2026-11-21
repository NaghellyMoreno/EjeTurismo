/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createListingHandler, getPublishedListingHandler, saveListingDraftHandler, submitListingForReviewHandler } from "@/server/http/handlers";
import { ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { testConfig } from "../helpers/config";
import { CONTACT, MAPS_URL, SUBMIT_BODY, UNKNOWN_ID, A6, A6B, ADMIN, P2P, VISITOR, seedWorld, type World } from "../helpers/listing-http";
import { makeReviewListingApi } from "../helpers/review-listing";
import { PERSON_IDS, changedTables, snapshotAll } from "../helpers/role-denial";
import { signInitData, tma } from "../helpers/telegram";

// F018, criterios 1 a 8, 11, 13 a 18, 20 a 25 y 28: ruta o experiencia del prestador por HTTP, con base real.
const GUIDE = "Guía ficticia: Ana Prueba, 3000000000";
const ROUTE = "Ruta del café ficticia";
let owner: Pool;
let world: World;
let typeA: string;
let typeB: string;
const api = makeReviewListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld(owner);
  typeA = (await rows("select id from app.experience_types where name = 'Sabores de Caldas'"))[0].id;
  typeB = (await rows("insert into app.experience_types (name, name_normalized) values ('Ruta de aventura ficticia', 'ruta de aventura ficticia') returning id"))[0].id;
});
afterEach(() => vi.restoreAllMocks());

const minimal = (name = ROUTE, extra: Record<string, unknown> = {}) => ({ name, municipalityId: world.municipalityOne, ...extra });
const full = (name = ROUTE, extra: Record<string, unknown> = {}) =>
  minimal(name, { categoryId: world.categoryOne, description: "Descripción ficticia.", schedule: "Sábados de 8:00 a 12:00", contact: CONTACT, mapsUrl: MAPS_URL, experienceTypeId: typeA, guidesInfo: GUIDE, ...extra });
const route = (content: Record<string, unknown>, root: Record<string, unknown> = {}) => ({ kind: "route_experience", content, confirmed: true, ...root });
const draft = (content: Record<string, unknown>, root: Record<string, unknown> = {}) => ({ content, confirmed: true, ...root });

async function expect422(call: () => Promise<Response>, label: string) {
  const before = await snapshotAll(owner);
  const res = await call();
  const json = await body(res);
  expect(res.status, label).toBe(422);
  expect(json.code, label).toBe("validation_failed");
  expect(changedTables(before, await snapshotAll(owner)), label).toEqual([]);
  return json.errors as { field: string; code: string; message: string }[];
}
const publicDetail = (id: string) =>
  getPublishedListingHandler(api.deps)(new Request(`http://localhost/api/v1/public/listings/${id}`, { headers: tma(signInitData({ userId: VISITOR })) }), { params: Promise.resolve({ listingId: id }) });
const created = async (content = minimal(), user = A6) => {
  const res = await api.create(user, route(content));
  expect(res.status).toBe(201);
  return body(res);
};

describe("criterios 1 a 3: crear y guardar el borrador", () => {
  it("1: contenido mínimo, 201 con tipo y guía nulos y negocio y ficha del prestador", async () => {
    const json = await created();
    expect(json).toMatchObject({ kind: "route_experience", displayStatus: "draft" });
    expect(json.working.content.experienceType).toBeNull();
    expect(json.working.content.guidesInfo).toBeNull();
    expect(json.businessId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await count("businesses")).toBeGreaterThan(0);
    expect((await rows("select kind from app.listings where id = $1", [json.id]))[0].kind).toBe("route_experience");
  });

  it("2: contenido completo, el tipo y la guía se leen tal como se enviaron (recortados)", async () => {
    const json = await created(full(ROUTE, { guidesInfo: `  ${GUIDE}  ` }));
    const read = await body(await api.get(A6, json.id));
    expect(read.working.content.experienceType).toEqual({ id: typeA, name: "Sabores de Caldas" });
    expect(read.working.content.guidesInfo).toBe(GUIDE);
    expect(read.working.content.mapsUrl).toBe(MAPS_URL);
  });

  it("3: guardar refleja tipo y guía y reemplaza el contenido completo; vacío se guarda como nulo (D-169)", async () => {
    const { id } = await created();
    const saved = await api.save(A6, id, draft(full(ROUTE, { guidesInfo: `${GUIDE}  ` })));
    expect(saved.status).toBe(200);
    const json = await body(saved);
    expect(json.working.content.experienceType.id).toBe(typeA);
    expect(json.working.content.guidesInfo).toBe(GUIDE);
    const again = await body(await api.save(A6, id, draft(full(ROUTE, { guidesInfo: undefined, experienceTypeId: typeB }))));
    expect(again.working.content.guidesInfo).toBeNull();
    expect(again.working.content.experienceType.id).toBe(typeB);
    for (const empty of ["", "   ", null]) {
      const res = await body(await api.save(A6, id, draft(full(ROUTE, { guidesInfo: empty }))));
      expect(res.working.content.guidesInfo, JSON.stringify(empty)).toBeNull();
    }
  });
});

describe("criterios 4 y 5: casos inválidos y combinaciones no permitidas", () => {
  const cases: [string, Record<string, unknown>, string, string][] = [
    ["tipo no UUID", { experienceTypeId: "no-uuid" }, "experienceTypeId", "invalid"],
    ["tipo inexistente", { experienceTypeId: UNKNOWN_ID }, "experienceTypeId", "invalid"],
    ["guía no texto", { guidesInfo: 5 }, "guidesInfo", "invalid"],
    ["guía de 4097", { guidesInfo: "g".repeat(4097) }, "guidesInfo", "too_long"],
    ["maps no válido", { mapsUrl: "https://ejemplo.invalid/x" }, "mapsUrl", "invalid_maps_url"],
    ["tipo de establecimiento", { establishmentTypeId: world?.typeOne ?? UNKNOWN_ID }, "establishmentTypeId", "not_allowed"],
    ["campo desconocido", { otro: 1 }, "otro", "unknown_field"],
  ];
  it.each(cases)("4 y 5: crear con %s", async (label, extra, field, code) => {
    const errors = await expect422(() => api.create(A6, route(full(ROUTE, extra))), label);
    expect(errors).toContainEqual(expect.objectContaining({ field, code }));
    for (const error of errors) expect(error.message).toBeTruthy();
  });
  it.each(cases)("4 y 5: guardar con %s", async (label, extra, field, code) => {
    const { id } = await created();
    const errors = await expect422(() => api.save(A6, id, draft(full(ROUTE, extra))), label);
    expect(errors).toContainEqual(expect.objectContaining({ field, code }));
  });

  it("4: guía de 4096 aceptada; kind omitido y sin confirmar", async () => {
    expect((await api.create(A6, route(full(ROUTE, { guidesInfo: "g".repeat(4096) })))).status).toBe(201);
    const noKind = await expect422(() => api.create(A6, { content: full("Otra ruta ficticia"), confirmed: true }), "kind");
    expect(noKind).toContainEqual(expect.objectContaining({ field: "kind", code: "required" }));
    const noConfirm = await expect422(() => api.create(A6, { kind: "route_experience", content: full("Otra ruta ficticia") }), "confirmed");
    expect(noConfirm).toContainEqual(expect.objectContaining({ field: "confirmed", code: "confirmation_required" }));
  });

  it("5: tipo de experiencia y guía en un establecimiento siguen en 422 not_allowed", async () => {
    const base = { name: "Establecimiento Ficticio X", municipalityId: world.municipalityOne };
    for (const extra of [{ experienceTypeId: typeA }, { guidesInfo: "x" }]) {
      const errors = await expect422(() => api.create(A6, { kind: "establishment", content: { ...base, ...extra }, confirmed: true }), "crear");
      expect(errors[0].code).toBe("not_allowed");
    }
  });
});

describe("criterio 6: duplicados", () => {
  it("el mismo nombre en el mismo municipio es 409; en otro municipio, 201", async () => {
    await created();
    for (const kind of ["route_experience", "establishment"]) {
      const res = await api.create(P2P, { kind, content: minimal(), confirmed: true });
      expect([res.status, (await body(res)).code], kind).toEqual([409, "duplicate"]);
    }
    expect((await api.create(P2P, route({ name: ROUTE, municipalityId: world.municipalityTwo }))).status).toBe(201);
  });
});

describe("criterios 7, 8, 11 y 13: envío a revisión", () => {
  it("7: envía la ficha completa y conserva tipo y guía", async () => {
    const { id } = await created(full());
    const res = await api.submit(A6, id, SUBMIT_BODY);
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json.displayStatus).toBe("pending");
    expect(json.working.content.experienceType.id).toBe(typeA);
    expect(json.working.content.guidesInfo).toBe(GUIDE);
    const events = await rows("select from_status, to_status, actor_role from app.listing_status_events where listing_id = $1 and to_status = 'pending'", [id]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ from_status: "draft", to_status: "pending", actor_role: "provider" });
  });

  it("8: sin declaración o sin confirmación, 422 y la ficha sigue en borrador", async () => {
    const { id } = await created(full());
    const cases: [unknown, string][] = [
      [{ confirmed: true }, "declaration_required"],
      [{ confirmed: true, thirdPartyAuthorizationDeclared: false }, "declaration_required"],
      [{ thirdPartyAuthorizationDeclared: true }, "confirmation_required"],
    ];
    for (const [raw, code] of cases) {
      const errors = await expect422(() => api.submit(A6, id, raw), JSON.stringify(raw));
      expect(errors.map((e) => e.code)).toEqual([code]);
    }
    expect((await body(await api.get(A6, id))).displayStatus).toBe("draft");
    expect((await rows("select 1 from app.listing_status_events where to_status = 'pending'")).length).toBe(0);
  });

  it("11: sin tipo de experiencia, 422 con experienceTypeId required junto a los demás faltantes", async () => {
    const { id } = await created(full(ROUTE, { experienceTypeId: undefined }));
    const errors = await expect422(() => api.submit(A6, id, SUBMIT_BODY), "sin tipo");
    expect(errors).toEqual([expect.objectContaining({ field: "experienceTypeId", code: "required" })]);
    const other = await created(minimal("Ruta sin datos ficticia"));
    const all = await expect422(() => api.submit(A6, other.id, SUBMIT_BODY), "sin nada");
    expect(all.map((e) => e.field)).toEqual(["categoryId", "description", "schedule", "contact", "mapsUrl", "experienceTypeId"]);
    expect((await body(await api.get(A6, id))).displayStatus).toBe("draft");
  });

  it("13: un establecimiento completo sin tipo se envía sin error (D-040)", async () => {
    const res = await api.create(A6, { kind: "establishment", content: { ...full("Establecimiento Sin Tipo", { experienceTypeId: undefined, guidesInfo: undefined }) }, confirmed: true });
    expect(res.status).toBe(201);
    expect((await api.submit(A6, (await body(res)).id, SUBMIT_BODY)).status).toBe(200);
  });
});

describe("criterios 14, 15 y 25: el guía no tiene usuario ni rol y es dato personal", () => {
  it("14 y 25: no se crean cuentas ni roles y el dato no sale a auditoría, registros ni avisos", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    const before = await snapshotAll(owner);
    const accounts = await count("accounts");
    const grants = await count("role_grants");
    const { id } = await created(full());
    await api.save(A6, id, draft(full()));
    expect((await api.submit(A6, id, SUBMIT_BODY)).status).toBe(200);
    expect(await count("accounts")).toBe(accounts);
    expect(await count("role_grants")).toBe(grants);
    const allowed = ["listings", "listing_versions", "businesses", "listing_status_events", "audit_events", "processed_updates", "rate_limit_counters", "bot_sessions"];
    expect(changedTables(before, await snapshotAll(owner)).filter((table) => !allowed.includes(table))).toEqual([]);
    for (const table of ["audit_events", "notification_outbox", "listing_status_events"]) {
      expect((await rows(`select count(*)::int as n from app.${table} t where row_to_json(t)::text like '%Ana Prueba%' or row_to_json(t)::text like '%3000000000%'`))[0].n, table).toBe(0);
    }
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain("Ana Prueba");
  });

  it("15: escribir un número de Telegram en la guía no concede acceso", async () => {
    await created(full(ROUTE, { guidesInfo: "Guía 900099999" }));
    expect((await api.list(900099999)).status).toBe(403);
    expect((await api.reviews(900099999)).status).toBe(403);
  });
});

describe("criterios 16 a 18, 20 y 24: pendiente, aprobación y rechazo", () => {
  it("16, 17, 18 y 24: pendiente invisible, el prestador no decide, el administrador aprueba", async () => {
    const { id } = await created(full());
    await api.submit(A6, id, SUBMIT_BODY);
    expect((await body(await api.published(VISITOR))).items.map((i: any) => i.id)).not.toContain(id);
    expect((await publicDetail(id)).status).toBe(404);
    expect((await body(await api.get(A6, id))).displayStatus).toBe("pending");
    const pendings = await body(await api.reviews(ADMIN));
    expect(JSON.stringify(pendings)).toContain(id);
    const versionId = (await body(await api.get(A6, id))).working.id;
    const review = await body(await api.review(ADMIN, versionId));
    expect(JSON.stringify(review)).toContain("Sabores de Caldas");
    expect(JSON.stringify(review)).toContain(GUIDE);

    const before = await snapshotAll(owner);
    for (const op of [api.approve(A6, versionId), api.reject(A6, versionId)]) expect((await op).status).toBe(403);
    expect(changedTables(before, await snapshotAll(owner)).filter((t) => t !== "rate_limit_counters")).toEqual([]);

    expect((await api.approve(ADMIN, versionId)).status).toBe(200);
    const row = (await rows("select status, decided_by from app.listing_versions where id = $1", [versionId]))[0];
    expect(row.status).toBe("published");
    const detail = await body(await publicDetail(id));
    expect(detail).toMatchObject({ kind: "route_experience", guidesInfo: GUIDE });
    expect(detail.experienceType.name).toBe("Sabores de Caldas");
  });

  it("18: sin guía el detalle publicado trae el campo nulo", async () => {
    const { id } = await created(full(ROUTE, { guidesInfo: undefined }));
    const versionId = (await body(await api.submit(A6, id, SUBMIT_BODY))).working.id;
    await api.approve(ADMIN, versionId);
    const detail = await body(await publicDetail(id));
    expect(detail.guidesInfo).toBeNull();
  });

  it("20: rechazada con motivo, se corrige con otro tipo y el administrador ve el cambio", async () => {
    const { id } = await created(full());
    const first = (await body(await api.submit(A6, id, SUBMIT_BODY))).working.id;
    expect((await api.reject(ADMIN, first)).status).toBe(200);
    const read = await body(await api.get(A6, id));
    expect(read.displayStatus).toBe("rejected");
    expect(read.lastRejection.reason).toBeTruthy();
    expect((await body(await api.published(VISITOR))).items).toHaveLength(0);
    expect((await api.save(A6, id, draft(full(ROUTE, { experienceTypeId: typeB, guidesInfo: "Otro guía ficticio" })))).status).toBe(200);
    const second = (await body(await api.submit(A6, id, SUBMIT_BODY))).working.id;
    const review = JSON.stringify(await body(await api.review(ADMIN, second)));
    expect(review).toContain("Ruta de aventura ficticia");
    expect(review).toContain("Otro guía ficticio");
  });
});

describe("criterios 21 a 23: acceso y separación", () => {
  it("21: sin sesión o con firma inválida, 401 sin consultar la base", async () => {
    const failing = failingDb();
    const deps = { config: () => testConfig(), db: () => failing.db, now: () => new Date() };
    const url = "http://localhost/api/v1/managed-listings";
    const headers: Record<string, string>[] = [{}, tma(signInitData({ userId: A6, token: "9:otro" }))];
    for (const h of headers) {
      const init = (method: string, payload: unknown) => ({ method, headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(payload) });
      const ctx = { params: Promise.resolve({ listingId: UNKNOWN_ID }) };
      const results = [
        await createListingHandler(deps)(new Request(url, init("POST", route(full())))),
        await saveListingDraftHandler(deps)(new Request(`${url}/${UNKNOWN_ID}/draft`, init("PUT", draft(full()))), ctx),
        await submitListingForReviewHandler(deps)(new Request(`${url}/${UNKNOWN_ID}/submission`, init("POST", SUBMIT_BODY)), ctx),
      ];
      expect(results.map((r) => r.status)).toEqual([401, 401, 401]);
    }
    expect(failing.queries).toEqual([]);
  });

  it("22: código exacto por persona al crear una ruta", async () => {
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1 and role = 'provider'", [P2P]);
    const persons: [string, number, number, string][] = [
      ["visitante", VISITOR, 403, "forbidden"],
      ["prestador revocado", P2P, 403, "forbidden"],
      ["administrador", ADMIN, 403, "forbidden"],
      ["aviso anterior (prestador)", A6B, 403, "consent_required"],
      ["aviso anterior (sin rol)", PERSON_IDS.A3, 403, "consent_required"],
    ];
    const before = await snapshotAll(owner);
    const table: string[] = [];
    for (const [name, user, status, code] of persons) {
      const res = await api.create(user, route(full(`Ruta de ${name}`)));
      const json = await body(res);
      table.push(`${name}\t${res.status}\t${json.code}`);
      expect([res.status, json.code], name).toEqual([status, code]);
      expect(res.headers.get("content-type"), name).toContain("application/problem+json");
    }
    console.info(table.join("\n"));
    expect(changedTables(before, await snapshotAll(owner)).filter((t) => t !== "rate_limit_counters")).toEqual([]);
  });

  it("23: otro prestador recibe 403 en leer, guardar y enviar, sin ver nada de la ruta", async () => {
    const { id } = await created(full());
    await api.create(P2P, route(minimal("Ruta de P2 ficticia")));
    const before = await snapshotAll(owner);
    const attempts = [await api.get(P2P, id), await api.save(P2P, id, draft(full("Otro nombre ficticio"))), await api.submit(P2P, id, SUBMIT_BODY)];
    for (const res of attempts) {
      expect(res.status).toBe(403);
      const text = await res.text();
      for (const secret of [ROUTE, "Sabores", "Ana Prueba"]) expect(text).not.toContain(secret);
    }
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    const listed = JSON.stringify(await body(await api.list(P2P)));
    for (const secret of [ROUTE, "Sabores", "Ana Prueba"]) expect(listed).not.toContain(secret);
  });
});

describe("criterio 28: clave foránea del tipo", () => {
  it("un tipo inexistente falla por clave foránea y el guardado responde 422 sin cambiar el tipo", async () => {
    const { id } = await created(full());
    await expect(owner.query("update app.listing_versions set experience_type_id = $1 where listing_id = $2", [UNKNOWN_ID, id])).rejects.toMatchObject({ code: "23503" });
    await expect422(() => api.save(A6, id, draft(full(ROUTE, { experienceTypeId: UNKNOWN_ID }))), "tipo inexistente");
    expect((await body(await api.get(A6, id))).working.content.experienceType.id).toBe(typeA);
  });
});
