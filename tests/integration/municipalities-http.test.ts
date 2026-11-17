/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { createAccount, createOldVersionAccount, PERSON_PRINCIPAL } from "../factories/accounts";
import { admin, revokedAdmin } from "../factories/admin-auth";
import { makeProvider } from "../factories/review";
import { testConfig } from "../helpers/config";
import { appDb, ownerPool, resetDb, restoreMunicipalitySeed, SEED_MUNICIPALITIES } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { validateSchema } from "../helpers/openapi";
import { signInitData, tma } from "../helpers/telegram";
import {
  createMunicipalityHandler,
  listMunicipalitiesHandler,
  updateMunicipalityHandler,
} from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";

// F010: criterios 1 a 4, 7 a 13, 15 a 20b, 22 a 27, 29, 32 (API y base).
const ADMIN_1 = 900000071;
const ADMIN_2 = 900000072;
const PROVIDER = 900000073;
const NO_ROLE = 900000074;
const NO_NOTICE = 900000075;
const OLD_NOTICE = 900000076;
const REVOKED = 900000077;

const TEST = { name: "Municipio de Prueba", department: "Caldas", generalInfo: "Texto de prueba" };
const SEED_NAMES = ["Filadelfia", "Manizales", "Supía"];
const UNKNOWN_ID = "11111111-1111-4111-8111-111111111111";

let owner: Pool;
const db = appDb();
const deps: Deps = { config: () => testConfig(), db: () => db, now: () => new Date() };
const list = listMunicipalitiesHandler(deps);
const create = createMunicipalityHandler(deps);
const update = updateMunicipalityHandler(deps);

const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const state = async () => ({ municipalities: await rows("select * from app.municipalities order by id"), audit: await count("audit_events"), accounts: await count("accounts") });

const headers = (userId?: number) => ({ "Content-Type": "application/json", ...(userId === undefined ? {} : tma(signInitData({ userId }))) });
const listReq = (userId?: number) => new Request("http://localhost/api/v1/municipalities", { headers: headers(userId) });
const createReq = (userId: number | undefined, body: unknown) =>
  new Request("http://localhost/api/v1/municipalities", { method: "POST", headers: headers(userId), body: JSON.stringify(body) });
const patchReq = (userId: number | undefined, id: string, body: unknown) =>
  update(new Request(`http://localhost/api/v1/municipalities/${id}`, { method: "PATCH", headers: headers(userId), body: JSON.stringify(body) }), {
    params: Promise.resolve({ municipalityId: id }),
  });
const json = async (res: Response) => (await res.json()) as any;

const post = (body: unknown, userId = ADMIN_1) => create(createReq(userId, { confirmed: true, ...(body as object) }));
const patch = (id: string, body: unknown, userId = ADMIN_1) => patchReq(userId, id, { confirmed: true, ...(body as object) });
const names = async (userId = ADMIN_1) => (await json(await list(listReq(userId)))).map((m: any) => m.name);

async function createTest(): Promise<any> {
  const res = await post(TEST);
  expect(res.status).toBe(201);
  return json(res);
}

beforeAll(() => {
  owner = ownerPool();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(async () => {
  await db.destroy();
  await owner.end();
});
beforeEach(async () => {
  await resetDb(owner);
  await admin(owner, ADMIN_1);
  await admin(owner, ADMIN_2);
  await createAccount(owner, PERSON_PRINCIPAL);
  await makeProvider(owner, PROVIDER);
  await createAccount(owner, NO_ROLE);
  await createOldVersionAccount(owner, OLD_NOTICE);
  await revokedAdmin(owner, REVOKED);
});
afterEach(async () => {
  await owner.query("drop trigger if exists test_fail on app.audit_events");
  await owner.query("drop trigger if exists test_fail on app.municipalities");
  await owner.query("drop function if exists app.test_fail()");
  await owner.query("alter table if exists app.municipalities_renamed rename to municipalities");
});

describe("semilla (1)", () => {
  it("lista exactamente los tres municipios de Caldas con UUID fijo y zona nula", async () => {
    const res = await list(listReq(ADMIN_1));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.map((m: any) => m.name)).toEqual(SEED_NAMES);
    for (const m of body) expect(m).toMatchObject({ department: "Caldas", zone: null });
    expect(body.map((m: any) => m.id).sort()).toEqual(SEED_MUNICIPALITIES.map((m) => m.id).sort());
  });

  it("cargar reference.sql dos veces no duplica ni cambia los UUID", async () => {
    const sql = readFileSync("supabase/seed/reference.sql", "utf8");
    const before = await rows("select id, name from app.municipalities order by id");
    await owner.query(sql);
    await owner.query(sql);
    expect(await rows("select id, name from app.municipalities order by id")).toEqual(before);
    expect(before).toHaveLength(3);
  });

  it("los responsables de la semilla son nulos (22)", async () => {
    expect(await rows("select 1 from app.municipalities where created_by is not null or updated_by is not null")).toHaveLength(0);
  });
});

describe("crear (2, 3, 4)", () => {
  it("201 con el esquema Municipality, zona nula y fila creada", async () => {
    const res = await post(TEST);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(validateSchema("Municipality", body)).toEqual([]);
    expect(body).toMatchObject({ ...TEST, zone: null });
    expect(await rows("select 1 from app.municipalities where id = $1", [body.id])).toHaveLength(1);
  });

  it.each<[string, Record<string, unknown>]>([
    ["sin confirmed", { confirmed: undefined }],
    ["confirmed false", { confirmed: false }],
    ["propiedad no definida", { extra: 1 }],
    ["role en el cuerpo", { role: "admin" }],
    ["isAdmin en el cuerpo", { isAdmin: true }],
    ["generalInfo null", { generalInfo: null }],
    ["zone null", { zone: null }],
  ])("422 sin crear nada: %s", async (_name, extra) => {
    const before = await state();
    const res = await create(createReq(ADMIN_1, { ...TEST, confirmed: true, ...extra }));
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect((await json(res)).code).toBe("validation_failed");
    expect(await state()).toEqual(before);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["name vacío", { name: "" }, "name"],
    ["name de solo espacios", { name: "   " }, "name"],
    ["sin name", { name: undefined }, "name"],
    ["sin department", { department: undefined }, "department"],
  ])("422 con errors[]: %s", async (_name, extra, field) => {
    const before = await state();
    const res = await post({ ...TEST, ...extra });
    expect(res.status).toBe(422);
    expect((await json(res)).errors.map((e: any) => e.field)).toContain(field);
    expect(await state()).toEqual(before);
  });

  it.each(["name", "department", "generalInfo", "zone"])("límites de %s: 4096 se acepta y 4097 se rechaza", async (field) => {
    const ok = await post({ ...TEST, name: "Municipio A", [field]: field === "name" ? "N".repeat(4096) : "x".repeat(4096) });
    expect(ok.status).toBe(201);
    const before = await state();
    const bad = await post({ ...TEST, name: "Municipio B", [field]: "y".repeat(4097) });
    expect(bad.status).toBe(422);
    expect((await json(bad)).errors.map((e: any) => e.field)).toContain(field);
    expect(await state()).toEqual(before);
  });
});

describe("lista y visitante (7, 8, 9)", () => {
  it("orden alfabético con el municipio de prueba (7)", async () => {
    await createTest();
    expect(await names()).toEqual(["Filadelfia", "Manizales", "Municipio de Prueba", "Supía"]);
  });

  it("una cuenta sin rol con aviso ve la lista con exactamente las claves del esquema (8)", async () => {
    await createTest();
    const res = await list(listReq(NO_ROLE));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toHaveLength(4);
    for (const m of body) {
      expect(validateSchema("Municipality", m)).toEqual([]);
      expect(Object.keys(m).sort()).toEqual(["createdAt", "department", "generalInfo", "id", "name", "updatedAt", "zone"]);
    }
    expect(JSON.stringify(body)).not.toMatch(/created_by|updated_by|createdBy|updatedBy|actor_account_id/);
  });

  it("sin initData responde 401 y no crea filas (9a)", async () => {
    const before = await state();
    const res = await list(listReq());
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await state()).toEqual(before);
  });

  it.each([
    ["sin aviso aceptado (9b)", NO_NOTICE],
    ["con aviso anterior (9c)", OLD_NOTICE],
  ])("403 %s", async (_name, userId) => {
    const before = await state();
    const res = await list(listReq(userId));
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await state()).toEqual(before);
  });
});

describe("duplicados (10 a 13)", () => {
  it("el mismo nombre responde 409 duplicate y no deja fila ni evento (10)", async () => {
    await createTest();
    const before = await state();
    const res = await post(TEST);
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe("duplicate");
    expect(await state()).toEqual(before);
  });

  it.each(["Manizales", "  manizales ", "MANIZALES", "Manizáles", "Supia"])("409 con %j (11, 12b)", async (name) => {
    const before = await state();
    const res = await post({ ...TEST, name });
    expect(res.status).toBe(409);
    expect(await state()).toEqual(before);
  });

  it("el duplicado normalizado del municipio de prueba responde 409", async () => {
    await createTest();
    expect((await post({ ...TEST, name: "  municipio de prueba " })).status).toBe(409);
  });

  it("Manizales Centro se acepta (12b)", async () => {
    expect((await post({ ...TEST, name: "Manizales Centro" })).status).toBe(201);
  });

  it("dos creaciones simultáneas: una 201 y una 409, una sola fila (13)", async () => {
    const results = await Promise.all([post({ ...TEST, name: "Nuevo Simultáneo" }, ADMIN_1), post({ ...TEST, name: "Nuevo Simultáneo" }, ADMIN_2)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await rows("select 1 from app.municipalities where name_normalized = 'nuevo simultaneo'")).toHaveLength(1);
  });
});

describe("editar (15 a 20b)", () => {
  it("cambia generalInfo y zone, conserva id, createdAt y name (15, 16)", async () => {
    const created = await createTest();
    await new Promise((r) => setTimeout(r, 15));
    const res = await patch(created.id, { generalInfo: "Nueva información", zone: "Zona de prueba" });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(validateSchema("Municipality", body)).toEqual([]);
    expect(body).toMatchObject({ id: created.id, createdAt: created.createdAt, name: TEST.name, generalInfo: "Nueva información", zone: "Zona de prueba" });
    expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(new Date(created.updatedAt).getTime());
    const listed = (await json(await list(listReq(ADMIN_1)))).find((m: any) => m.id === created.id);
    expect(listed).toMatchObject({ generalInfo: "Nueva información", zone: "Zona de prueba" });
  });

  it("null vacía la zona y la información general (17)", async () => {
    const created = await createTest();
    await patch(created.id, { zone: "Zona de prueba" });
    const body = await json(await patch(created.id, { zone: null, generalInfo: null }));
    expect(body).toMatchObject({ zone: null, generalInfo: null });
    expect((await rows("select general_info, zone from app.municipalities where id = $1", [created.id]))[0]).toEqual({ general_info: null, zone: null });
  });

  it("solo confirmed: 200 sin cambios, sin tocar updated_at ni updated_by ni la auditoría (17)", async () => {
    const created = await createTest();
    const before = await state();
    const res = await patchReq(ADMIN_2, created.id, { confirmed: true });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual(created);
    expect(await state()).toEqual(before);
  });

  it.each<[string, Record<string, unknown>, number]>([
    ["sin confirmed", { confirmed: undefined }, 422],
    ["confirmed false", { confirmed: false }, 422],
    ["department null", { department: null }, 422],
    ["name vacío", { name: "" }, 422],
    ["name de solo espacios", { name: "   " }, 422],
    ["department vacío", { department: "" }, 422],
    ["propiedad no definida", { role: "admin" }, 422],
  ])("422 y la fila no cambia: %s (3, 18)", async (_name, body, status) => {
    const created = await createTest();
    const before = await state();
    const res = await patchReq(ADMIN_1, created.id, { confirmed: true, ...body });
    expect(res.status).toBe(status);
    expect(await state()).toEqual(before);
  });

  it.each(["name", "department", "generalInfo", "zone"])("límites de %s en PATCH (18)", async (field) => {
    const created = await createTest();
    expect((await patch(created.id, { [field]: "x".repeat(4096) })).status).toBe(200);
    const before = await state();
    const bad = await patch(created.id, { [field]: "y".repeat(4097) });
    expect(bad.status).toBe(422);
    expect((await json(bad)).errors.map((e: any) => e.field)).toContain(field);
    expect(await state()).toEqual(before);
  });

  it("cambiar el nombre por el de otro municipio da 409 y no cambia la fila (19)", async () => {
    const created = await createTest();
    for (const name of ["Manizales", "Manizales ", "SUPIA"]) {
      const before = await state();
      const res = await patch(created.id, { name });
      expect(res.status).toBe(409);
      expect((await json(res)).code).toBe("duplicate");
      expect(await state()).toEqual(before);
    }
  });

  it("el mismo nombre del propio municipio y otra capitalización dan 200 (19)", async () => {
    const created = await createTest();
    expect((await patch(created.id, { name: TEST.name })).status).toBe(200);
    const res = await patch(created.id, { name: "MUNICIPIO DE PRUEBA" });
    expect(res.status).toBe(200);
    expect((await json(res)).name).toBe("MUNICIPIO DE PRUEBA");
  });

  it("UUID inexistente da 404 y no cambia filas (20a)", async () => {
    const before = await state();
    const res = await patch(UNKNOWN_ID, { zone: "x" });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await state()).toEqual(before);
  });

  it("un id que no es UUID da 422 validation_failed y las operaciones del contrato admiten 404 y 422 (20b)", async () => {
    const before = await state();
    const res = await patch("no-es-uuid", { zone: "x" });
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe("validation_failed");
    expect(await state()).toEqual(before);
    const spec = parse(readFileSync("api/openapi.yaml", "utf8"));
    const responses = Object.keys(spec.paths["/api/v1/municipalities/{municipalityId}"].patch.responses);
    expect(responses).toEqual(expect.arrayContaining(["404", "422"]));
  });
});

describe("fecha y responsable, auditoría (22 a 25)", () => {
  it("al crear: created_by y updated_by son el administrador y hay evento sin datos personales (22, 23)", async () => {
    const accountId = (await rows("select id from app.accounts where telegram_user_id = $1", [ADMIN_1]))[0].id;
    const t0 = Date.now();
    const created = await createTest();
    const row = (await rows("select * from app.municipalities where id = $1", [created.id]))[0];
    expect(row.created_by).toBe(accountId);
    expect(row.updated_by).toBe(accountId);
    const events = await rows("select * from app.audit_events");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "municipality.created", entity_type: "municipality", entity_id: created.id, actor_account_id: accountId, actor_role: "admin" });
    expect(Math.abs(new Date(events[0].occurred_at).getTime() - t0)).toBeLessThan(5000);
    expect(JSON.stringify(events[0].details)).not.toMatch(/telegram|identity|9000000/i);
  });

  it("al editar con otro administrador: updated_by cambia, created_by no, y el evento lista los campos (24)", async () => {
    const created = await createTest();
    const ids = Object.fromEntries((await rows("select telegram_user_id, id from app.accounts")).map((r) => [String(r.telegram_user_id), r.id]));
    await new Promise((r) => setTimeout(r, 15));
    expect((await patchReq(ADMIN_2, created.id, { confirmed: true, zone: "Zona de prueba", generalInfo: "Otro" })).status).toBe(200);
    const row = (await rows("select * from app.municipalities where id = $1", [created.id]))[0];
    expect(row.created_by).toBe(ids[ADMIN_1]);
    expect(row.updated_by).toBe(ids[ADMIN_2]);
    expect(row.updated_at.getTime()).toBeGreaterThan(row.created_at.getTime());
    const event = (await rows("select * from app.audit_events where action = 'municipality.updated'"))[0];
    expect(event).toMatchObject({ actor_account_id: ids[ADMIN_2], entity_id: created.id });
    expect(event.details).toEqual({ fields: ["generalInfo", "zone"] });
  });

  it("los rechazos no escriben fila ni auditoría (25a)", async () => {
    const created = await createTest();
    const before = await state();
    expect((await post({ ...TEST, name: "Manizales" })).status).toBe(409);
    expect((await post({ ...TEST, name: "" })).status).toBe(422);
    expect((await post(TEST, NO_ROLE)).status).toBe(403);
    expect((await create(createReq(undefined, { ...TEST, confirmed: true }))).status).toBe(401);
    expect((await patch(created.id, { name: "Manizales" })).status).toBe(409);
    expect((await patch(created.id, { zone: "x" }, PROVIDER)).status).toBe(403);
    expect(await state()).toEqual(before);
  });

  it("un fallo de auditoría revierte la creación y la edición (25b)", async () => {
    const created = await createTest();
    await owner.query("create function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo-auditoria-secreto'; end $$");
    await owner.query("create trigger test_fail before insert on app.audit_events for each row execute function app.test_fail()");
    const before = await state();
    const createRes = await post({ ...TEST, name: "Otro Municipio" });
    expect(createRes.status).toBe(500);
    expect(createRes.headers.get("content-type")).toContain("application/problem+json");
    expect(await state()).toEqual(before);
    const updateRes = await patch(created.id, { zone: "Zona nueva" });
    expect(updateRes.status).toBe(500);
    expect(await state()).toEqual(before);
  });
});

describe("control de acceso (26, 27)", () => {
  it("sin initData 401; sin rol, prestador, permiso revocado y sin aviso 403; sin cambios", async () => {
    const created = await createTest();
    const before = await state();
    expect((await create(createReq(undefined, { ...TEST, name: "Z", confirmed: true }))).status).toBe(401);
    expect((await patchReq(undefined, created.id, { confirmed: true, zone: "x" })).status).toBe(401);
    for (const user of [NO_ROLE, PROVIDER, REVOKED, NO_NOTICE, OLD_NOTICE]) {
      const c = await post({ ...TEST, name: "Z" }, user);
      expect(c.status).toBe(403);
      expect(c.headers.get("content-type")).toContain("application/problem+json");
      const u = await patch(created.id, { zone: "x" }, user);
      expect(u.status).toBe(403);
    }
    expect(await state()).toEqual(before);
  });

  it("el principal sin fila is_principal y el administrador autorizado pueden crear y editar", async () => {
    const principal = await post({ ...TEST, name: "Del Principal" }, PERSON_PRINCIPAL);
    expect(principal.status).toBe(201);
    expect((await patch((await json(principal)).id, { zone: "x" }, PERSON_PRINCIPAL)).status).toBe(200);
    const authorized = await post({ ...TEST, name: "Del Autorizado" }, ADMIN_2);
    expect(authorized.status).toBe(201);
    expect((await patch((await json(authorized)).id, { zone: "x" }, ADMIN_2)).status).toBe(200);
  });
});

describe("fallos de base (29)", () => {
  const internal = { title: "Error del sistema", code: "internal_error", detail: "Ocurrió un error. Intenta de nuevo en unos minutos." };

  it("la lista responde 500 genérico con la tabla ausente", async () => {
    await owner.query("alter table app.municipalities rename to municipalities_renamed");
    const res = await list(listReq(ADMIN_1));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await json(res);
    expect(body).toMatchObject(internal);
    expect(JSON.stringify(body)).not.toMatch(/municipalities|relation|sql/i);
  });

  it("crear y editar responden 500 genérico y no dejan filas a medias", async () => {
    const created = await createTest();
    await owner.query("create function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo-interno-secreto'; end $$");
    await owner.query("create trigger test_fail before insert or update on app.municipalities for each row execute function app.test_fail()");
    const before = await state();
    for (const res of [await post({ ...TEST, name: "Otro" }), await patch(created.id, { zone: "x" })]) {
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      const body = await json(res);
      expect(body).toMatchObject(internal);
      expect(JSON.stringify(body)).not.toContain("secreto");
    }
    expect(await state()).toEqual(before);
  });

  it("un cliente de base que falla no filtra detalles técnicos", async () => {
    const { db: broken, errorText } = failingDb();
    const res = await listMunicipalitiesHandler({ ...deps, db: () => broken })(listReq(ADMIN_1));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await json(res))).not.toContain(errorText);
  });
});

describe("restauración de la semilla", () => {
  it("restoreMunicipalitySeed deja 3 filas", async () => {
    await createTest();
    await restoreMunicipalitySeed(owner);
    expect(await count("municipalities")).toBe(3);
  });
});
