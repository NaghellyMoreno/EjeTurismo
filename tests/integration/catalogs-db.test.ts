import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GASTRONOMIC_EXPERIENCE_TYPE_ID } from "@/server/domain/catalogs";
import { createAccount } from "../factories/accounts";
import { grantAdminRole } from "../factories/review";
import { idContext, LISTS, makeCatalogApi, renameReq } from "../helpers/catalog-http";
import { ownerPool, resetDb } from "../helpers/db";

const ADMIN = 900000111;
let owner: Pool;
let app: Pool;
const api = makeCatalogApi();
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;

beforeAll(() => {
  owner = ownerPool();
  app = new Pool({ connectionString: process.env.TEST_APP_URL, max: 2 });
});
afterAll(async () => {
  await owner.end();
  await app.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
});

// Corre reference.sql con psql, igual que db:seed (criterios 8 y 21).
function runReferenceSeed() {
  const url = process.env.TEST_OWNER_URL!;
  const bin = process.env.PG_BIN ?? execFileSync("brew", ["--prefix", "postgresql@17"]).toString().trim() + "/bin";
  execFileSync(`${bin}/psql`, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-d", url, "-f", "supabase/seed/reference.sql"], { stdio: "pipe" });
}

describe("semilla de referencia (criterios 8 y 21; ADR 0011)", () => {
  it("carga Sabores de Caldas y los cinco tipos de establecimiento, y correrla dos veces no duplica", async () => {
    runReferenceSeed();
    runReferenceSeed();
    const experience = await rows("select id, name, is_gastronomic from app.experience_types");
    expect(experience).toEqual([{ id: GASTRONOMIC_EXPERIENCE_TYPE_ID, name: "Sabores de Caldas", is_gastronomic: true }]);
    const establishment = await rows("select name, is_gastronomic from app.establishment_types order by name");
    expect(establishment).toEqual([
      { name: "Alojamiento rural", is_gastronomic: false },
      { name: "Café", is_gastronomic: true },
      { name: "Finca cafetera", is_gastronomic: false },
      { name: "Hotel", is_gastronomic: false },
      { name: "Restaurante", is_gastronomic: true },
    ]);
    expect(Number((await rows("select count(*) from app.categories"))[0].count)).toBe(0);
  });

  it("renombrar Sabores de Caldas conserva id y marca, y volver a sembrar no lo deshace ni crea otra fila", async () => {
    await createAccount(owner, ADMIN);
    await grantAdminRole(owner, ADMIN);
    const def = LISTS[1];
    const res = await api.handlers(def).rename(renameReq(def, GASTRONOMIC_EXPERIENCE_TYPE_ID, ADMIN, { name: "Sabores del Eje", confirmed: true }), idContext(def, GASTRONOMIC_EXPERIENCE_TYPE_ID));
    expect(res.status).toBe(200);
    runReferenceSeed();
    const found = await rows("select id, name, is_gastronomic from app.experience_types");
    expect(found).toEqual([{ id: GASTRONOMIC_EXPERIENCE_TYPE_ID, name: "Sabores del Eje", is_gastronomic: true }]);
  });
});

describe.each(["experience_types", "establishment_types"])("privilegios de eje_app sobre %s (criterios 10 y 33)", (table) => {
  it("no puede escribir is_gastronomic (42501) pero sí insertar sin esa columna y cambiar el nombre", async () => {
    await expect(app.query(`insert into app.${table} (name, name_normalized, is_gastronomic) values ('Marcado', 'marcado', true)`)).rejects.toMatchObject({ code: "42501" });
    await expect(app.query(`update app.${table} set is_gastronomic = true`)).rejects.toMatchObject({ code: "42501" });
    await expect(app.query(`insert into app.${table} (name, name_normalized) values ('Sin marca', 'sin marca')`)).resolves.toBeTruthy();
    await expect(app.query(`update app.${table} set name = 'Renombrado', name_normalized = 'renombrado' where name_normalized = 'sin marca'`)).resolves.toBeTruthy();
    expect((await rows(`select is_gastronomic from app.${table} where name = 'Renombrado'`))[0].is_gastronomic).toBe(false);
  });
});

describe.each(["categories", "experience_types", "establishment_types"])("listas cerradas: %s (criterio 11)", (table) => {
  it("eje_app no puede borrar ni truncar", async () => {
    await expect(app.query(`delete from app.${table}`)).rejects.toMatchObject({ code: "42501" });
    await expect(app.query(`truncate app.${table}`)).rejects.toMatchObject({ code: "42501" });
  });

  it("el índice único sobre name_normalized lo hace la base, no solo el servicio", async () => {
    await app.query(`insert into app.${table} (name, name_normalized) values ('Única', 'unica')`);
    await expect(app.query(`insert into app.${table} (name, name_normalized) values ('UNICA', 'unica')`)).rejects.toMatchObject({ code: "23505" });
  });
});

describe("renombrar se refleja por la referencia (criterio 18; D-124)", () => {
  it.each([
    ["categories", 0],
    ["experience_types", 1],
  ])("una tabla de prueba con clave foránea a %s conserva su fila y ve el nombre nuevo", async (table, index) => {
    await createAccount(owner, ADMIN);
    await grantAdminRole(owner, ADMIN);
    const def = LISTS[index]!;
    await owner.query(`insert into app.${table} (name, name_normalized) values ('Naturaleza', 'naturaleza')`);
    const { id } = (await rows(`select id from app.${table} where name = 'Naturaleza'`))[0];
    await owner.query(`create table app.test_ficha (id serial primary key, ref uuid not null references app.${table} (id))`);
    try {
      await owner.query("insert into app.test_ficha (ref) values ($1)", [id]);
      const res = await api.handlers(def).rename(renameReq(def, id, ADMIN, { name: "Naturaleza y aventura", confirmed: true }), idContext(def, id));
      expect(res.status).toBe(200);
      const joined = await rows(`select f.id, t.name from app.test_ficha f join app.${table} t on t.id = f.ref`);
      expect(joined).toHaveLength(1);
      expect(joined[0].name).toBe("Naturaleza y aventura");
    } finally {
      await owner.query("drop table app.test_ficha");
    }
  });
});
