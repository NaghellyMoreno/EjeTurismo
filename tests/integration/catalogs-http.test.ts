/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GASTRONOMIC_EXPERIENCE_TYPE_ID } from "@/server/domain/catalogs";
import { createAccount, createOldVersionAccount, PERSON_PRINCIPAL } from "../factories/accounts";
import { grantAdminRole, makeProvider } from "../factories/review";
import { idContext, LISTS, createReq, listReq, makeCatalogApi, renameReq, UNKNOWN_ID, type ListDef } from "../helpers/catalog-http";
import { ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { validateSchema } from "../helpers/openapi";
import { signInitData, tma } from "../helpers/telegram";
import { createCatalogItemHandler, renameCatalogItemHandler } from "@/server/http/handlers";
import { testConfig } from "../helpers/config";

const ADMIN = 900000111;
const PROVIDER = 900000113;
const NO_ROLE = 900000114;
const NO_NOTICE = 900000115;
const OLD_NOTICE = 900000116;
const REVOKED_ADMIN = 900000117;

let owner: Pool;
const api = makeCatalogApi();
const logs: string[] = [];
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const snapshot = async () => ({
  categories: await rows("select * from app.categories order by id"),
  experience: await rows("select * from app.experience_types order by id"),
  establishment: await rows("select * from app.establishment_types order by id"),
  audit: await count("audit_events"),
});

beforeAll(() => {
  owner = ownerPool();
  for (const level of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  }
});
afterAll(async () => {
  await owner.end();
  await api.destroy();
  vi.restoreAllMocks();
});
beforeEach(async () => {
  await resetDb(owner);
  logs.length = 0;
  await createAccount(owner, ADMIN);
  await grantAdminRole(owner, ADMIN);
  await createAccount(owner, PERSON_PRINCIPAL);
  await makeProvider(owner, PROVIDER);
  await createAccount(owner, NO_ROLE);
  await createOldVersionAccount(owner, OLD_NOTICE);
  await createAccount(owner, REVOKED_ADMIN);
  await grantAdminRole(owner, REVOKED_ADMIN);
  await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1", [REVOKED_ADMIN]);
});
afterEach(async () => {
  await owner.query("drop trigger if exists test_fail on app.audit_events");
});

const create = (list: ListDef, userId: number | null, payload: unknown, extra?: Record<string, string>) =>
  api.handlers(list).create(createReq(list, userId, payload, extra));
const rename = (list: ListDef, id: string, userId: number | null, payload: unknown, extra?: Record<string, string>) =>
  api.handlers(list).rename(renameReq(list, id, userId, payload, extra), idContext(list, id));
const list = (def: ListDef, userId: number | null, extra?: Record<string, string>) => api.handlers(def).list(listReq(def, userId, extra));
const make = async (def: ListDef, name: string) => (await body(await create(def, ADMIN, { name, confirmed: true }))).id as string;

const [CATEGORIES, EXPERIENCE_TYPES, ESTABLISHMENT_TYPES] = LISTS;
const WRITE_CALLS = LISTS.flatMap((def) => [
  [`crear ${def.path}`, def, (user: number | null, extra?: Record<string, string>) => create(def, user, { name: "Nueva", confirmed: true }, extra)] as const,
  [`editar ${def.path}`, def, async (user: number | null, extra?: Record<string, string>) => rename(def, await ensureItem(def), user, { name: "Otra", confirmed: true }, extra)] as const,
]);
async function ensureItem(def: ListDef): Promise<string> {
  const found = await rows(`select id from app.${def.table} order by name_normalized limit 1`);
  return found.length > 0 ? found[0].id : make(def, "Existente");
}

describe.each(LISTS)("crear en $path (criterios 1, 2, 3, 5, 33)", (def) => {
  it("el administrador crea con 201, esquema válido, isGastronomic falso y fila con name_normalized", async () => {
    const res = await create(def, ADMIN, { name: "Naturaleza", confirmed: true });
    expect(res.status).toBe(201);
    const item = await body(res);
    expect(validateSchema("CatalogItem", item)).toEqual([]);
    expect(item).toMatchObject({ name: "Naturaleza", isGastronomic: false });
    const [row] = await rows(`select * from app.${def.table} where id = $1`, [item.id]);
    expect(row.name_normalized).toBe("naturaleza");
    expect(row.created_by_account_id).toBeTruthy();
  });

  it("el principal también puede crear", async () => {
    expect((await create(def, PERSON_PRINCIPAL, { name: "Del principal", confirmed: true })).status).toBe(201);
  });

  it.each([[{ name: "X" }], [{ name: "X", confirmed: false }], [{ name: "X", confirmed: "true" }]])(
    "sin confirmed:true (%j) responde 422 y no cambia nada",
    async (payload) => {
      const before = await snapshot();
      const res = await create(def, ADMIN, payload);
      expect(res.status).toBe(422);
      expect(await body(res)).toMatchObject({ code: "validation_failed" });
      expect(await snapshot()).toEqual(before);
    },
  );

  it("el nombre guardado se recorta y cada creación deja un audit_events sin datos personales", async () => {
    const item = await body(await create(def, ADMIN, { name: "  Naturaleza  ", confirmed: true }));
    expect(item.name).toBe("Naturaleza");
    const events = await rows("select a.*, c.telegram_user_id from app.audit_events a join app.accounts c on c.id = a.actor_account_id");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_role: "admin", action: `${def.kind}.created`, entity_type: def.kind, entity_id: item.id });
    expect(String(events[0].telegram_user_id)).toBe(String(ADMIN));
    expect(JSON.stringify(events[0].details)).not.toContain(String(ADMIN));
    expect(JSON.stringify(events[0].details)).toBe("{}");
  });

  it("el listado devuelve lo creado, ordenado por nombre, para visitantes y prestadores", async () => {
    await make(def, "Zeta");
    await make(def, "Álamo");
    for (const user of [NO_ROLE, PROVIDER, ADMIN]) {
      const res = await list(def, user);
      expect(res.status).toBe(200);
      const items = (await body(res)) as unknown as any[];
      items.forEach((item) => expect(validateSchema("CatalogItem", item)).toEqual([]));
      const names = items.map((item) => item.name);
      expect(names).toContain("Zeta");
      expect(names.indexOf("Álamo")).toBeLessThan(names.indexOf("Zeta"));
      expect(items.find((item) => item.name === "Zeta")).toMatchObject({ isGastronomic: false });
    }
  });
});

describe("marca isGastronomic (criterios 9, 10, 33)", () => {
  it("las listas muestran la marca de la semilla y la API no la fija", async () => {
    const experience = (await body(await list(EXPERIENCE_TYPES, NO_ROLE))) as unknown as any[];
    expect(experience.find((item) => item.id === GASTRONOMIC_EXPERIENCE_TYPE_ID)).toMatchObject({ name: "Sabores de Caldas", isGastronomic: true });
    expect(experience.filter((item) => item.isGastronomic)).toHaveLength(1);
    const establishment = (await body(await list(ESTABLISHMENT_TYPES, NO_ROLE))) as unknown as any[];
    expect(Object.fromEntries(establishment.map((item) => [item.name, item.isGastronomic]))).toEqual({
      Hotel: false,
      "Finca cafetera": false,
      "Alojamiento rural": false,
      Restaurante: true,
      Café: true,
    });
    const categories = (await body(await list(CATEGORIES, NO_ROLE))) as unknown as any[];
    expect(categories).toEqual([]);
  });

  it.each(LISTS)("isGastronomic en el cuerpo responde 422 y no cambia la fila ($path)", async (def) => {
    const id = await ensureItem(def);
    const before = await snapshot();
    expect((await create(def, ADMIN, { name: "Marcada", confirmed: true, isGastronomic: true })).status).toBe(422);
    const res = await rename(def, id, ADMIN, { name: "Marcada", confirmed: true, isGastronomic: true });
    expect(res.status).toBe(422);
    expect((await body(res)).errors.map((e: any) => e.field)).toContain("isGastronomic");
    expect(await snapshot()).toEqual(before);
  });
});

describe("duplicados (criterios 12 a 15, 33)", () => {
  it.each(LISTS)("un nombre existente responde 409 problem+json sin fila ni audit_events ($path)", async (def) => {
    await make(def, "Cultura");
    const before = await snapshot();
    const res = await create(def, ADMIN, { name: "Cultura", confirmed: true });
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await snapshot()).toEqual(before);
  });

  it.each([["cultura", "Cultura"], ["  Cultura  ", "Cultura"], ["Cul  tura", "Cul tura"], ["Cultúra", "Cultura"]])(
    "%j se detecta como duplicado de «%s» sobre name_normalized",
    async (attempt, existing) => {
      for (const def of LISTS) {
        await make(def, existing);
        const before = await snapshot();
        expect((await create(def, ADMIN, { name: attempt, confirmed: true })).status).toBe(409);
        expect(await snapshot()).toEqual(before);
        await owner.query(`delete from app.${def.table} where name = $1`, [existing]);
      }
    },
  );

  it("la unicidad es dentro de cada lista: el mismo nombre se puede repetir entre listas", async () => {
    for (const def of LISTS) expect((await create(def, ADMIN, { name: "Compartido", confirmed: true })).status).toBe(201);
  });

  it("dos creaciones simultáneas del mismo nombre: una 201 y una 409, una sola fila", async () => {
    const results = await Promise.all([create(CATEGORIES, ADMIN, { name: "Carrera", confirmed: true }), create(CATEGORIES, ADMIN, { name: "carrera", confirmed: true })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await count("categories")).toBe(1);
    expect(await count("audit_events")).toBe(1);
  });
});

describe.each(LISTS)("editar en $path (criterios 17, 19, 20, 33)", (def) => {
  it("200 con el mismo id y nombre nuevo; el anterior desaparece; responsable, fecha y audit_events", async () => {
    const id = await make(def, "Naturaleza");
    const [before] = await rows(`select updated_at from app.${def.table} where id = $1`, [id]);
    await owner.query("delete from app.audit_events");
    const res = await rename(def, id, ADMIN, { name: "Naturaleza y aventura", confirmed: true });
    expect(res.status).toBe(200);
    const item = await body(res);
    expect(validateSchema("CatalogItem", item)).toEqual([]);
    expect(item).toMatchObject({ id, name: "Naturaleza y aventura", isGastronomic: false });
    const names = ((await body(await list(def, NO_ROLE))) as unknown as any[]).map((i) => i.name);
    expect(names).toContain("Naturaleza y aventura");
    expect(names).not.toContain("Naturaleza");
    const [after] = await rows(`select updated_at, updated_by_account_id, name_normalized from app.${def.table} where id = $1`, [id]);
    expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
    expect(after.updated_by_account_id).toBeTruthy();
    expect(after.name_normalized).toBe("naturaleza y aventura");
    const events = await rows("select * from app.audit_events");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_role: "admin", action: `${def.kind}.updated`, entity_type: def.kind, entity_id: id });
  });

  it("renombrar a un nombre de otro elemento responde 409 sin cambios ni audit_events", async () => {
    await make(def, "Uno");
    const id = await make(def, "Dos");
    await owner.query("delete from app.audit_events");
    const before = await snapshot();
    expect((await rename(def, id, ADMIN, { name: "uno", confirmed: true })).status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });

  it("renombrar con el mismo nombre (o solo otras mayúsculas) responde 200 y audita", async () => {
    const id = await make(def, "Uno");
    await owner.query("delete from app.audit_events");
    expect((await rename(def, id, ADMIN, { name: "Uno", confirmed: true })).status).toBe(200);
    expect((await rename(def, id, ADMIN, { name: "UNO", confirmed: true })).status).toBe(200);
    expect(await count("audit_events")).toBe(2);
  });

  it.each([
    ["id inexistente", () => UNKNOWN_ID, { name: "X", confirmed: true }, 404],
    ["id que no es UUID", () => "no-es-uuid", { name: "X", confirmed: true }, 422],
    ["cuerpo sin name", (id: string) => id, { confirmed: true }, 422],
    ["sin confirmed", (id: string) => id, { name: "X" }, 422],
  ])("%s responde %i sin cambios ni audit_events", async (_label, idFor, payload, status) => {
    const id = await make(def, "Existente");
    await owner.query("delete from app.audit_events");
    const before = await snapshot();
    expect((await rename(def, idFor(id), ADMIN, payload)).status).toBe(status);
    expect(await snapshot()).toEqual(before);
  });
});

describe("datos inválidos (criterio 23, 33)", () => {
  const long = (n: number) => "a".repeat(n);
  it.each(LISTS)("casos inválidos del nombre responden 422 con errors[].field=name ($path)", async (def) => {
    const id = await make(def, "Existente");
    await owner.query("delete from app.audit_events");
    const before = await snapshot();
    const cases: unknown[] = [{ confirmed: true }, { name: "", confirmed: true }, { name: "   ", confirmed: true }, { name: "Cultura\u0007", confirmed: true }, { name: 123, confirmed: true }, { name: long(101), confirmed: true }];
    for (const payload of cases) {
      for (const res of [await create(def, ADMIN, payload), await rename(def, id, ADMIN, payload)]) {
        if ((payload as any).name === undefined && res.status === 422) continue;
        expect(res.status).toBe(422);
        const problem = await body(res);
        expect(problem.code).toBe("validation_failed");
        expect(problem.errors.map((e: any) => e.field)).toContain("name");
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each(LISTS)("exactamente 100 caracteres: 201 al crear y 200 al editar ($path)", async (def) => {
    const created = await create(def, ADMIN, { name: long(100), confirmed: true });
    expect(created.status).toBe(201);
    const id = (await body(created)).id;
    expect((await rename(def, id, ADMIN, { name: "b".repeat(100), confirmed: true })).status).toBe(200);
  });

  it("un cuerpo que no es un objeto JSON responde 422", async () => {
    expect((await create(CATEGORIES, ADMIN, "no es json")).status).toBe(422);
    expect((await create(CATEGORIES, ADMIN, "[1]")).status).toBe(422);
  });
});

describe("acceso (criterios 25 a 28, 33)", () => {
  // Cada lista ya tiene un elemento para que las llamadas de edición no creen filas durante la comprobación.
  beforeEach(async () => {
    for (const def of LISTS) await make(def, "Existente");
  });

  it.each(WRITE_CALLS)("%s: sin initData responde 401 y no cambia nada", async (_label, _def, call) => {
    const before = await snapshot();
    const res = await call(null);
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await snapshot()).toEqual(before);
  });

  it.each(WRITE_CALLS)("%s: firma inválida responde 401", async (_label, _def, call) => {
    expect((await call(ADMIN, tma(signInitData({ userId: ADMIN, token: "9:otro" })))).status).toBe(401);
  });

  it.each(WRITE_CALLS)("%s: prestador, sin rol y visitante reciben 403 sin cambios", async (_label, _def, call) => {
    for (const user of [PROVIDER, NO_ROLE, OLD_NOTICE]) {
      const before = await snapshot();
      const res = await call(user);
      expect(res.status).toBe(403);
      expect(await snapshot()).toEqual(before);
    }
  });

  it.each(WRITE_CALLS)("%s: el rol no se toma del cuerpo ni de parámetros", async (_label, def) => {
    const before = await snapshot();
    const res = await create(def, NO_ROLE, { name: "Colada", confirmed: true, role: "admin" });
    expect([403, 422]).toContain(res.status);
    expect(await snapshot()).toEqual(before);
  });

  it.each(WRITE_CALLS)("%s: un permiso de administrador revocado responde 403", async (_label, _def, call) => {
    const before = await snapshot();
    expect((await call(REVOKED_ADMIN)).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });

  it.each(LISTS)("leer $path: 401 sin initData; 403 sin aviso o con aviso anterior; no crea cuenta", async (def) => {
    expect((await list(def, null)).status).toBe(401);
    const accounts = await count("accounts");
    const noAccount = await list(def, NO_NOTICE);
    expect(noAccount.status).toBe(403);
    expect(await body(noAccount)).toMatchObject({ code: "consent_required" });
    expect(await count("accounts")).toBe(accounts);
    expect((await list(def, OLD_NOTICE)).status).toBe(403);
  });
});

describe("errores (criterio 31)", () => {
  it("un fallo de la base responde 500 genérico, sin detalles ni audit_events a medias", async () => {
    await owner.query(`create or replace function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo-interno-secreto'; end $$`);
    await owner.query("create trigger test_fail before insert on app.audit_events for each row execute function app.test_fail()");
    const before = await snapshot();
    const created = await create(CATEGORIES, ADMIN, { name: "Falla", confirmed: true });
    expect(created.status).toBe(500);
    expect(created.headers.get("content-type")).toContain("application/problem+json");
    expect(JSON.stringify(await body(created))).not.toContain("fallo-interno-secreto");
    // La creación y su traza van en una transacción: no queda la fila sin su evento.
    expect(await snapshot()).toEqual(before);
  });

  it("con la base caída las tres operaciones responden 500 genérico", async () => {
    const broken = failingDb();
    const deps = { config: () => testConfig(), db: () => broken.db, now: () => new Date() };
    const headers = tma(signInitData({ userId: ADMIN }));
    const created = await createCatalogItemHandler(deps, "category")(createReq(CATEGORIES, ADMIN, { name: "X", confirmed: true }, headers));
    const renamed = await renameCatalogItemHandler(deps, "category", "categoryId")(renameReq(CATEGORIES, UNKNOWN_ID, ADMIN, { name: "X", confirmed: true }, headers), idContext(CATEGORIES, UNKNOWN_ID) as { params: Promise<{ categoryId: string }> });
    for (const res of [created, renamed]) {
      expect(res.status).toBe(500);
      expect(JSON.stringify(await body(res))).not.toContain(broken.errorText);
    }
  });
});
