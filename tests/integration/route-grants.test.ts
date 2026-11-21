import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client, type Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ownerPool, resetDb } from "../helpers/db";
import { dropDatabase } from "../helpers/drop-database";
import { A6, makeListingApi, seedWorld, type World } from "../helpers/listing-http";

// F018, criterios 27 (migración), 33 y 34: permisos de `eje_app` sobre listing_versions con dos bases reales.
// B = la base de la ejecución (todas las migraciones). A = base limpia con todas menos la de F018.
const MIGRATION = "20261120100000_f018_route_grants.sql";
const COLUMNS = ["experience_type_id", "guides_info"];
const dir = resolve(process.cwd(), "supabase/migrations");
const withDb = (url: string, db: string, user?: string) => {
  const out = new URL(url);
  out.pathname = `/${db}`;
  if (user) out.username = user;
  return out.toString();
};

let owner: Pool;
let baseA = "";
let aOwner: Client;
let aApp: Client;
let world: World;
const api = makeListingApi();

type GrantRow = string;
const grantRows = async (db: Pool | Client): Promise<GrantRow[]> => {
  const table = await db.query(
    "select grantor, grantee, table_name, privilege_type, is_grantable from information_schema.role_table_grants where table_schema = 'app'",
  );
  const column = await db.query(
    "select grantor, grantee, table_name, column_name, privilege_type, is_grantable from information_schema.role_column_grants where table_schema = 'app'",
  );
  return [...table.rows.map((r) => `T|${Object.values(r).join("|")}`), ...column.rows.map((r) => `C|${Object.values(r).join("|")}`)].sort();
};
const updatable = async (db: Pool | Client) =>
  (await db.query("select column_name from information_schema.role_column_grants where table_schema = 'app' and table_name = 'listing_versions' and grantee = 'eje_app' and privilege_type = 'UPDATE'")).rows.map((r) => r.column_name as string);

beforeAll(async () => {
  owner = ownerPool();
  baseA = `${process.env.TEST_DB_NAME}_a${randomBytes(3).toString("hex")}`;
  const admin = new Client({ connectionString: withDb(process.env.TEST_OWNER_URL!, "postgres") });
  await admin.connect();
  try {
    await admin.query(`create database "${baseA}"`);
  } finally {
    await admin.end();
  }
  aOwner = new Client({ connectionString: withDb(process.env.TEST_OWNER_URL!, baseA) });
  await aOwner.connect();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && f !== MIGRATION).sort()) await aOwner.query(readFileSync(resolve(dir, file), "utf8"));
  aApp = new Client({ connectionString: withDb(process.env.TEST_OWNER_URL!, baseA, "eje_app") });
  await aApp.connect();
});
afterAll(async () => {
  await aApp?.end();
  await aOwner?.end();
  const admin = new Client({ connectionString: withDb(process.env.TEST_OWNER_URL!, "postgres") });
  await admin.connect();
  try {
    await dropDatabase(admin, baseA);
  } finally {
    await admin.end();
  }
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld(owner);
});

describe("criterio 27: contenido de la migración", () => {
  it("sin comentarios, es solo el permiso de las dos columnas", () => {
    const sql = readFileSync(resolve(dir, MIGRATION), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--") && line.trim() !== "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    expect(sql).toBe("grant update (experience_type_id, guides_info) on app.listing_versions to eje_app;");
  });
});

describe("criterio 33: guardar el borrador de una ruta con el rol eje_app", () => {
  it("con todas las migraciones, saveListingDraft guarda tipo y guía; sin la de F018, el UPDATE directo da permiso denegado", async () => {
    const typeId = (await owner.query("select id from app.experience_types where name = 'Sabores de Caldas'")).rows[0].id as string;
    const created = await (await api.create(A6, { kind: "route_experience", content: { name: "Ruta del grant ficticia", municipalityId: world.municipalityOne }, confirmed: true })).json();
    const saved = await api.save(A6, created.id, { content: { name: "Ruta del grant ficticia", municipalityId: world.municipalityOne, experienceTypeId: typeId, guidesInfo: "Guía ficticia: Ana Prueba" }, confirmed: true });
    expect(saved.status).toBe(200);
    const read = await (await api.get(A6, created.id)).json();
    expect(read.working.content.experienceType).toEqual({ id: typeId, name: "Sabores de Caldas" });
    expect(read.working.content.guidesInfo).toBe("Guía ficticia: Ana Prueba");

    const sqlState = async (client: Client | Pool, column: string) => {
      try {
        await client.query(`update app.listing_versions set ${column} = ${column} where false`);
        return "ok";
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    for (const column of COLUMNS) expect(await sqlState(aApp, column), `base A, ${column}`).toBe("42501");
    const appB = new Client({ connectionString: process.env.TEST_APP_URL });
    await appB.connect();
    try {
      for (const column of COLUMNS) expect(await sqlState(appB, column), `base B, ${column}`).toBe("ok");
    } finally {
      await appB.end();
    }
  });
});

describe("criterio 34: el permiso no se extiende", () => {
  it("(a) y (b) la diferencia entre B y A es exactamente las dos columnas con UPDATE de eje_app", async () => {
    const [a, b] = [await grantRows(aOwner), await grantRows(owner)];
    expect(a.length).toBeGreaterThan(0);
    expect(a.filter((row) => !b.includes(row)), "nada se pierde de A a B").toEqual([]);
    const added = b.filter((row) => !a.includes(row));
    expect(added.map((row) => row.split("|")).map(([kind, , grantee, table, column, privilege]) => [kind, grantee, table, column, privilege]).sort()).toEqual(
      COLUMNS.map((column) => ["C", "eje_app", "listing_versions", column, "UPDATE"]).sort(),
    );
    const [colsA, colsB] = [await updatable(aOwner), await updatable(owner)];
    expect(colsB.filter((c) => !colsA.includes(c)).sort()).toEqual(COLUMNS);
    expect(colsA.filter((c) => !colsB.includes(c))).toEqual([]);
  });

  it("(c) en B, UPDATE verdadero para las dos columnas y falso para id, listing_id, version_number y created_at", async () => {
    const has = async (column: string) => (await owner.query("select has_column_privilege('eje_app', 'app.listing_versions', $1, 'UPDATE') as ok", [column])).rows[0].ok as boolean;
    for (const column of COLUMNS) expect(await has(column), column).toBe(true);
    for (const column of ["id", "listing_id", "version_number", "created_at"]) expect(await has(column), column).toBe(false);
    const appB = new Client({ connectionString: process.env.TEST_APP_URL });
    await appB.connect();
    try {
      await expect(appB.query("update app.listing_versions set created_at = created_at where false")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await appB.end();
    }
  });
});
