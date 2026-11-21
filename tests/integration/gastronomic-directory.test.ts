/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveListingVersionHandler, getPublishedListingHandler, listPublishedListingsHandler, rejectListingVersionHandler } from "@/server/http/handlers";
import { ownerPool, resetDb } from "../helpers/db";
import { createReq, idContext, LISTS, makeCatalogApi, renameReq } from "../helpers/catalog-http";
import { failingDb } from "../helpers/failing-db";
import { testConfig } from "../helpers/config";
import { A6, A6B, ADMIN, CONTACT, createBody, draftBody, MAPS_URL, P2P, SUBMIT_BODY, UNKNOWN_ID, VISITOR, seedWorld, type World } from "../helpers/listing-http";
import { makeReviewListingApi } from "../helpers/review-listing";
import { changedTables, PERSON_IDS, snapshotAll } from "../helpers/role-denial";
import { signInitData, tma } from "../helpers/telegram";

// F017, criterios 3 a 5, 7 a 9, 14, 15, 17, 18a, 19, 20, 21a y 22 a 25a: directorio gastronómico por HTTP, con base real.
const IDENTITY = "9000070310";
const SABORES_ID = "5a0b0e50-0000-4000-8000-000000000001";
let owner: Pool;
let world: World;
const api = makeReviewListingApi();
const catalog = makeCatalogApi(api.db);
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const typeId = async (name: string) => (await rows("select id from app.establishment_types where name = $1", [name]))[0].id as string;
const ids = (json: Record<string, any>) => (json.items as Array<{ name: string }>).map((item) => item.name);
const gastro = async (query = "", user = VISITOR) => body(await api.published(user, `gastronomic=true${query ? `&${query}` : ""}`));
const publicDetail = (id: string) =>
  getPublishedListingHandler(api.deps)(new Request(`http://localhost/api/v1/public/listings/${id}`, { headers: tma(signInitData({ userId: VISITOR })) }), { params: Promise.resolve({ listingId: id }) });

const establishment = async (name: string, type: string | null, extra: Record<string, unknown> = {}) =>
  createBody(world, { name, establishmentTypeId: type === null ? undefined : await typeId(type), ...extra });
const routeBody = (name: string, experienceTypeId: string | undefined, extra: Record<string, unknown> = {}) => ({
  kind: "route_experience",
  content: { name, municipalityId: world.municipalityOne, categoryId: world.categoryOne, description: "Descripción ficticia.", schedule: "Sábados de 8:00 a 12:00", contact: CONTACT, mapsUrl: MAPS_URL, experienceTypeId, ...extra },
  confirmed: true,
});
async function submitted(payload: unknown, user = A6) {
  const created = await api.create(user, payload);
  expect(created.status).toBe(201);
  const { id } = await body(created);
  const sub = await api.submit(user, id, SUBMIT_BODY);
  expect(sub.status).toBe(200);
  return { id, versionId: (await body(sub)).working.id as string };
}
async function publish(payload: unknown, user = A6) {
  const made = await submitted(payload, user);
  expect((await api.approve(ADMIN, made.versionId)).status).toBe(200);
  return made;
}
const eventsCount = async () => Number((await rows("select count(*) from app.listing_status_events"))[0].count);
const noChanges = async (before: Awaited<ReturnType<typeof snapshotAll>>) => expect(changedTables(before, await snapshotAll(owner)).filter((t) => t !== "rate_limit_counters")).toEqual([]);

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld(owner);
});

describe("criterios 3 y 4: crear y enviar restaurante o café", () => {
  it("3: crea restaurante y café en borrador con su tipo y los envía a revisión", async () => {
    for (const [name, type] of [["Restaurante Prueba", "Restaurante"], ["Café Prueba", "Café"]]) {
      const created = await api.create(A6, await establishment(name, type));
      expect(created.status).toBe(201);
      const json = await body(created);
      expect(json.displayStatus).toBe("draft");
      const read = await body(await api.get(A6, json.id));
      expect(read.working.content.establishmentType).toEqual({ id: await typeId(type), name: type });
      const sub = await api.submit(A6, json.id, SUBMIT_BODY);
      expect(sub.status).toBe(200);
      expect((await body(sub)).displayStatus).toBe("pending");
      const events = await rows("select actor_role, to_status from app.listing_status_events where listing_id = $1 and to_status = 'pending'", [json.id]);
      expect(events).toEqual([{ actor_role: "provider", to_status: "pending" }]);
    }
  });

  it("4: sin declaración o sin confirmación, 422 y la ficha sigue en borrador sin eventos nuevos", async () => {
    const { id } = await body(await api.create(A6, await establishment("Restaurante Prueba", "Restaurante")));
    const before = await snapshotAll(owner);
    const events = await eventsCount();
    for (const [raw, code] of [[{ confirmed: true }, "declaration_required"], [{ thirdPartyAuthorizationDeclared: true }, "confirmation_required"]] as const) {
      const res = await api.submit(A6, id, raw);
      expect(res.status).toBe(422);
      const json = await body(res);
      expect((json.errors as Array<{ code: string }>).map((e) => e.code)).toEqual([code]);
    }
    expect((await body(await api.get(A6, id))).displayStatus).toBe("draft");
    expect(await eventsCount()).toBe(events);
    await noChanges(before);
  });
});

describe("criterio 5: pendiente, fuera del directorio", () => {
  it("el visitante no la ve en el directorio y el detalle responde 404", async () => {
    const { id } = await submitted(await establishment("Restaurante Prueba", "Restaurante"));
    expect(ids(await gastro())).toEqual([]);
    expect((await publicDetail(id)).status).toBe(404);
  });
});

describe("criterios 7, 8 y 8a: aprobación", () => {
  it("7: el administrador aprueba con confirmación; sin ella, 422 y sigue pendiente", async () => {
    const { versionId } = await submitted(await establishment("Restaurante Prueba", "Restaurante"));
    const before = await snapshotAll(owner);
    const res = await api.approve(ADMIN, versionId, {});
    expect(res.status).toBe(422);
    expect(((await body(res)).errors as Array<{ code: string }>).map((e) => e.code)).toEqual(["confirmation_required"]);
    expect((await rows("select status from app.listing_versions where id = $1", [versionId]))[0].status).toBe("pending");
    await noChanges(before);
    expect((await api.approve(ADMIN, versionId)).status).toBe(200);
    const row = (await rows("select v.status, a.telegram_user_id from app.listing_versions v join app.accounts a on a.id = v.decided_by where v.id = $1", [versionId]))[0];
    expect(row.status).toBe("published");
    expect(Number(row.telegram_user_id)).toBe(ADMIN);
  });

  it("8: el prestador dueño no aprueba ni rechaza su ficha (403 forbidden)", async () => {
    const { versionId } = await submitted(await establishment("Restaurante Prueba", "Restaurante"));
    const before = await snapshotAll(owner);
    const events = await eventsCount();
    for (const res of [await api.approve(A6, versionId), await api.reject(A6, versionId)]) {
      expect(res.status).toBe(403);
      expect((await body(res)).code).toBe("forbidden");
    }
    expect((await rows("select status from app.listing_versions where id = $1", [versionId]))[0].status).toBe("pending");
    expect(await eventsCount()).toBe(events);
    await noChanges(before);
  });

  it("8a: sin sesión o con firma inválida 401 (sin consultar la base); visitante sin rol 403", async () => {
    const { versionId } = await submitted(await establishment("Restaurante Prueba", "Restaurante"));
    const before = await snapshotAll(owner);
    const events = await eventsCount();
    const failing = failingDb();
    const deps = { config: () => testConfig(), db: () => failing.db, now: () => new Date() };
    const ctx = { params: Promise.resolve({ versionId }) };
    const url = (kind: string) => `http://localhost/api/v1/reviews/${versionId}/${kind}`;
    const init = (headers: Record<string, string>, payload: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
    for (const headers of [{}, tma(signInitData({ userId: ADMIN, token: "9:otro" }))]) {
      expect((await approveListingVersionHandler(deps)(new Request(url("approval"), init(headers, { confirmed: true })), ctx)).status).toBe(401);
      expect((await rejectListingVersionHandler(deps)(new Request(url("rejection"), init(headers, { confirmed: true, reason: "x" })), ctx)).status).toBe(401);
    }
    expect(failing.queries).toEqual([]);
    for (const res of [await api.approve(VISITOR, versionId), await api.reject(VISITOR, versionId)]) {
      expect(res.status).toBe(403);
      expect((await body(res)).code).toBe("forbidden");
    }
    expect((await rows("select status from app.listing_versions where id = $1", [versionId]))[0].status).toBe("pending");
    expect(await eventsCount()).toBe(events);
    await noChanges(before);
  });
});

describe("criterios 9, 14, 15 y 17: restaurante, café y Sabores de Caldas", () => {
  it("9, 14 y 15: el directorio de M1 incluye cada ficha una vez y respeta kind", async () => {
    await publish(await establishment("Restaurante Prueba", "Restaurante"));
    await publish(await establishment("Café Prueba", "Café"));
    const sabores = await publish(routeBody("Sabores de prueba", SABORES_ID));
    const detail = await body(await publicDetail(sabores.id));
    expect(detail.experienceType.name).toBe("Sabores de Caldas");

    const all = await gastro(`municipalityId=${world.municipalityOne}`);
    expect(ids(all).sort()).toEqual(["Café Prueba", "Restaurante Prueba", "Sabores de prueba"]);
    for (const item of all.items) {
      expect(item.municipality).toMatchObject({ id: world.municipalityOne });
      expect(["establishment", "route_experience"]).toContain(item.kind);
    }
    const text = JSON.stringify(all);
    for (const secret of [IDENTITY, String(A6), "provider", "telegram"]) expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    expect(ids(await gastro(`municipalityId=${world.municipalityOne}&kind=establishment`)).sort()).toEqual(["Café Prueba", "Restaurante Prueba"]);
    expect(ids(await gastro(`municipalityId=${world.municipalityOne}&kind=route_experience`))).toEqual(["Sabores de prueba"]);
    expect(await gastro(`municipalityId=${world.municipalityTwo}`)).toMatchObject({ items: [], total: 0 });
  });

  it("17: la experiencia sin experienceTypeId se rechaza al enviar con 422 required", async () => {
    const { id } = await body(await api.create(A6, routeBody("Ruta sin tipo", undefined)));
    const res = await api.submit(A6, id, SUBMIT_BODY);
    expect(res.status).toBe(422);
    expect((await body(res)).errors).toContainEqual(expect.objectContaining({ field: "experienceTypeId", code: "required" }));
  });
});

describe("criterios 18a y 19: lo que no entra y la línea base", () => {
  const NAMES = ["Restaurante Prueba", "Café Prueba", "Hotel Prueba", "Finca Prueba", "Alojamiento Prueba", "Local sin tipo Prueba", "Sabores de prueba", "Ruta de aventura prueba"];
  const seedAll = async () => {
    const made: Record<string, string> = {};
    const adventure = (await rows("insert into app.experience_types (name, name_normalized) values ('Ruta de aventura ficticia', 'ruta de aventura ficticia') returning id"))[0].id as string;
    for (const [name, type] of [["Restaurante Prueba", "Restaurante"], ["Café Prueba", "Café"], ["Hotel Prueba", "Hotel"], ["Finca Prueba", "Finca cafetera"], ["Alojamiento Prueba", "Alojamiento rural"], ["Local sin tipo Prueba", null]] as const)
      made[name] = (await publish(await establishment(name, type))).id;
    made["Sabores de prueba"] = (await publish(routeBody("Sabores de prueba", SABORES_ID))).id;
    made["Ruta de aventura prueba"] = (await publish(routeBody("Ruta de aventura prueba", adventure))).id;
    return made;
  };

  it("18a: las no gastronómicas se publican y se ven en la lista general, pero no en el directorio", async () => {
    const made = await seedAll();
    for (const id of Object.values(made)) expect((await publicDetail(id)).status).toBe(200);
    expect(ids(await gastro()).sort()).toEqual(["Café Prueba", "Restaurante Prueba", "Sabores de prueba"]);
    expect(ids(await body(await api.published(VISITOR))).sort()).toEqual([...NAMES].sort());
  });

  it("19: sin el parámetro y con gastronomic=false la lista es la misma, y solo true y false son válidos", async () => {
    await seedAll();
    const query = `municipalityId=${world.municipalityOne}`;
    const without = ids(await body(await api.published(VISITOR, query)));
    const falseList = ids(await body(await api.published(VISITOR, `${query}&gastronomic=false`)));
    expect([...without].sort()).toEqual([...NAMES].sort());
    expect(falseList).toEqual(without);
    for (const value of ["yes", "1", "TRUE", ""]) {
      const res = await api.published(VISITOR, `gastronomic=${value}`);
      expect(res.status, value).toBe(422);
      expect((await body(res)).errors).toContainEqual(expect.objectContaining({ field: "gastronomic", code: "invalid" }));
    }
  });
});

describe("criterio 20: catálogos", () => {
  const create = (list: (typeof LISTS)[number], name: string) => catalog.handlers(list).create(createReq(list, ADMIN, { name, confirmed: true }));

  it("20a: un tipo de establecimiento nuevo no es gastronómico y su ficha no entra al directorio", async () => {
    const list = LISTS[2];
    const res = await create(list, "Tipo Nuevo Ficticio");
    expect(res.status).toBe(201);
    const created = await body(res);
    expect(created.isGastronomic).toBe(false);
    await publish(createBody(world, { name: "Ficha Tipo Nuevo", establishmentTypeId: created.id }));
    expect(ids(await gastro())).toEqual([]);
  });

  it("20b: un tipo de experiencia nuevo no es gastronómico y su ficha no entra al directorio", async () => {
    const list = LISTS[1];
    const created = await body(await create(list, "Tipo Experiencia Nuevo"));
    expect(created.isGastronomic).toBe(false);
    await publish(routeBody("Ficha Experiencia Nueva", created.id));
    expect(ids(await gastro())).toEqual([]);
  });

  it("20c: renombrar Sabores de Caldas conserva la marca y la ficha sigue en el directorio", async () => {
    await publish(routeBody("Sabores de prueba", SABORES_ID));
    const list = LISTS[1];
    const res = await catalog.handlers(list).rename(renameReq(list, SABORES_ID, ADMIN, { name: "Sabores renombrado", confirmed: true }), idContext(list, SABORES_ID));
    expect(res.status).toBe(200);
    const types = (await body(await catalog.handlers(list).list(new Request("http://localhost/api/v1/experience-types", { headers: tma(signInitData({ userId: ADMIN })) })))) as any;
    const found = (types.items ?? types).find((t: any) => t.id === SABORES_ID);
    expect(found).toMatchObject({ name: "Sabores renombrado", isGastronomic: true });
    expect(ids(await gastro())).toEqual(["Sabores de prueba"]);
  });
});

describe("criterios 21a y 22: acceso", () => {
  it("21a: sin sesión o con firma inválida 401 sin consultar la base; sin aviso vigente 403 consent_required", async () => {
    const failing = failingDb();
    const handler = listPublishedListingsHandler({ config: () => testConfig(), db: () => failing.db, now: () => new Date() });
    for (const headers of [{}, tma(signInitData({ userId: VISITOR, token: "9:otro" }))]) {
      expect((await handler(new Request("http://localhost/api/v1/public/listings?gastronomic=true", { headers }))).status).toBe(401);
    }
    expect(failing.queries).toEqual([]);
    const res = await api.published(PERSON_IDS.A3, "gastronomic=true");
    expect([res.status, (await body(res)).code]).toEqual([403, "consent_required"]);
  });

  it("22: crear y enviar fichas gastronómicas con el rol y estado correctos", async () => {
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1 and role = 'provider'", [P2P]);
    const payload = await establishment("Restaurante De Otro", "Restaurante");
    const own = await body(await api.create(A6, await establishment("Restaurante Propio", "Restaurante")));
    const before = await snapshotAll(owner);
    for (const [name, user, code] of [["visitante", VISITOR, "forbidden"], ["prestador revocado", P2P, "forbidden"], ["administrador", ADMIN, "forbidden"], ["aviso anterior", A6B, "consent_required"]] as const) {
      const created = await api.create(user, payload);
      expect([created.status, (await body(created)).code], `crear ${name}`).toEqual([403, code]);
      const sent = await api.submit(user, own.id, SUBMIT_BODY);
      expect([sent.status, (await body(sent)).code], `enviar ${name}`).toEqual([403, code]);
    }
    await noChanges(before);
  });
});

describe("criterio 23: separación entre prestadores", () => {
  it("P2 no lee, edita ni envía el restaurante de P1 ni lo ve en su lista", async () => {
    const { id } = await body(await api.create(A6, await establishment("Restaurante Prueba", "Restaurante")));
    await api.create(P2P, await establishment("Restaurante De P2", "Restaurante"));
    const before = await snapshotAll(owner);
    const attempts = [await api.get(P2P, id), await api.save(P2P, id, draftBody(world, { name: "Otro nombre" })), await api.submit(P2P, id, SUBMIT_BODY)];
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect((await body(res)).code).toBe("forbidden");
    }
    await noChanges(before);
    expect(JSON.stringify(await body(await api.list(P2P)))).not.toContain("Restaurante Prueba");
  });
});

describe("criterio 24a: edición de una ficha publicada", () => {
  it("el directorio conserva la versión publicada y quita la ficha al aprobar el cambio de tipo", async () => {
    const { id } = await publish(await establishment("Restaurante Prueba", "Restaurante"));
    expect((await api.save(A6, id, draftBody(world, { name: "Restaurante Nuevo Nombre", establishmentTypeId: await typeId("Hotel") }))).status).toBe(200);
    const versionId = (await body(await api.submit(A6, id, SUBMIT_BODY))).working.id as string;
    expect(ids(await gastro())).toEqual(["Restaurante Prueba"]);
    expect((await body(await publicDetail(id))).establishmentType.name).toBe("Restaurante");
    expect((await api.approve(ADMIN, versionId)).status).toBe(200);
    expect(ids(await gastro())).toEqual([]);
    expect(ids(await body(await api.published(VISITOR)))).toEqual(["Restaurante Nuevo Nombre"]);
  });
});

describe("criterio 25a: sin datos personales", () => {
  it("la lista y el detalle no traen identidad, ID de Telegram ni datos del prestador", async () => {
    const { id } = await publish(await establishment("Restaurante Prueba", "Restaurante"));
    const texts = [JSON.stringify(await gastro()), JSON.stringify(await body(await publicDetail(id)))];
    const account = (await rows("select * from app.accounts where telegram_user_id = $1", [A6]))[0];
    const names = Object.values(account).filter((value): value is string => typeof value === "string" && value.length > 3 && !/^[0-9a-f-]{36}$/.test(value));
    for (const text of texts) {
      for (const secret of [IDENTITY, String(A6), UNKNOWN_ID, ...names]) expect(text).not.toContain(secret);
    }
  });
});
