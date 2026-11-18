import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "../factories/accounts";
import { ownerPool, resetDb } from "../helpers/db";

// F012, criterios 21 y 27: la base impone las reglas de fichas (ADR 0002), con SQL directo y el catálogo de PostgreSQL.
let owner: Pool;
let app: Pool;
let municipalityOne: string;
let municipalityTwo: string;
let categoryId: string;
let accountId: string;

beforeAll(() => {
  owner = ownerPool();
  app = new Pool({ connectionString: process.env.TEST_APP_URL, max: 2 });
});
afterAll(async () => {
  await owner.end();
  await app.end();
});
beforeEach(async () => {
  await resetDb(owner);
  accountId = await createAccount(owner, 900012501);
  const one = async (sql: string) => (await owner.query(sql)).rows[0].id as string;
  municipalityOne = await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Uno', 'municipio ficticio uno', 'Caldas') returning id");
  municipalityTwo = await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Dos', 'municipio ficticio dos', 'Caldas') returning id");
  categoryId = await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Uno', 'categoria ficticia uno') returning id");
});

const newListing = async () => (await owner.query("insert into app.listings (kind, created_by_account_id) values ('attraction', $1) returning id", [accountId])).rows[0].id as string;

interface VersionOptions {
  number?: number;
  status?: string;
  name?: string;
  normalized?: string;
  municipality?: string;
  schedule?: string | null;
  contact?: string | null;
  mapsUrl?: string | null;
}
const insertVersion = async (db: Pool, listingId: string, o: VersionOptions = {}) =>
  db.query(
    `insert into app.listing_versions (listing_id, version_number, status, name, name_normalized, municipality_id, category_id, description, schedule, contact, maps_url, rejection_reason)
     values ($1, $2, $3, $4, $5, $6, $7, 'Descripción', $8, $9, $10, case when $3 = 'rejected' then 'Motivo ficticio' end)`,
    [
      listingId, o.number ?? 1, o.status ?? "published", o.name ?? "Atractivo Ficticio Uno", o.normalized ?? "atractivo ficticio uno", o.municipality ?? municipalityOne,
      categoryId, o.schedule === undefined ? "Horario" : o.schedule, o.contact === undefined ? "Contacto" : o.contact, o.mapsUrl === undefined ? "https://maps.app.goo.gl/AbC" : o.mapsUrl,
    ],
  );

const constraintOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as { constraint?: string; code?: string }).constraint ?? (error as { code?: string }).code ?? "otro";
  }
};

describe("criterio 21: restricciones de la base", () => {
  for (const status of ["published", "draft", "pending", "rejected"]) {
    it(`una ficha distinta con el mismo nombre y municipio viola la exclusión si la existente está ${status}`, async () => {
      await insertVersion(owner, await newListing(), { status });
      const violated = await constraintOf(insertVersion(owner, await newListing(), { status: "draft" }));
      expect(violated).toBe("listing_versions_duplicate_name_excl");
    });
  }

  it("otro municipio u otro nombre no la violan; una versión superseded no reserva el nombre", async () => {
    await insertVersion(owner, await newListing());
    expect(await constraintOf(insertVersion(owner, await newListing(), { municipality: municipalityTwo }))).toBeNull();
    expect(await constraintOf(insertVersion(owner, await newListing(), { name: "Atractivo Ficticio Dos", normalized: "atractivo ficticio dos" }))).toBeNull();
    const old = await newListing();
    await insertVersion(owner, old, { status: "superseded", name: "Atractivo Ficticio Tres", normalized: "atractivo ficticio tres" });
    expect(await constraintOf(insertVersion(owner, await newListing(), { name: "Atractivo Ficticio Tres", normalized: "atractivo ficticio tres" }))).toBeNull();
  });

  it("dos versiones de la misma ficha con el mismo nombre (publicada y pendiente) no la violan", async () => {
    const listing = await newListing();
    await insertVersion(owner, listing, { status: "published" });
    expect(await constraintOf(insertVersion(owner, listing, { number: 2, status: "pending" }))).toBeNull();
  });

  it("una ficha no puede tener dos versiones publicadas ni dos abiertas", async () => {
    const listing = await newListing();
    await insertVersion(owner, listing, { status: "published" });
    expect(await constraintOf(insertVersion(owner, listing, { number: 2, status: "published" }))).toBe("listing_versions_one_published_key");
    await insertVersion(owner, listing, { number: 3, status: "draft" });
    expect(await constraintOf(insertVersion(owner, listing, { number: 4, status: "pending" }))).toBe("listing_versions_one_open_key");
  });

  it("una versión publicada sin horarios, contacto o enlace viola el CHECK de D-003", async () => {
    for (const missing of [{ schedule: null }, { contact: null }, { mapsUrl: null }, { schedule: "   " }]) {
      expect(await constraintOf(insertVersion(owner, await newListing(), { status: "published", ...missing })), JSON.stringify(missing)).toBe("listing_versions_required_fields_check");
    }
  });

  it("un nombre de 101 caracteres viola el CHECK de D-042", async () => {
    expect(await constraintOf(insertVersion(owner, await newListing(), { name: "a".repeat(101), normalized: "a".repeat(100) }))).toBe("listing_versions_name_check");
  });

  it("un atractivo no puede tener negocio ni una ficha de prestador carecer de él", async () => {
    const business = (await owner.query("insert into app.businesses default values returning id")).rows[0].id;
    expect(await constraintOf(owner.query("insert into app.listings (kind, business_id) values ('attraction', $1)", [business]))).toBe("listings_attraction_without_business_check");
    expect(await constraintOf(owner.query("insert into app.listings (kind) values ('establishment')"))).toBe("listings_attraction_without_business_check");
  });

  it("el tipo de establecimiento no se admite en un atractivo (coherencia tipo y kind)", async () => {
    const type = (await owner.query("insert into app.establishment_types (name, name_normalized) values ('Tipo Ficticio', 'tipo ficticio') returning id")).rows[0].id;
    const listing = await newListing();
    const violated = await constraintOf(
      owner.query(
        `insert into app.listing_versions (listing_id, version_number, status, name, name_normalized, municipality_id, establishment_type_id)
         values ($1, 1, 'draft', 'Borrador Ficticio', 'borrador ficticio', $2, $3)`,
        [listing, municipalityOne, type],
      ),
    );
    expect(violated).toBe("listing_versions_kind_check");
  });
});

describe("criterio 27: la migración", () => {
  it("eje_app no tiene DELETE en las tablas nuevas y listing_status_events solo admite INSERT y SELECT", async () => {
    const { rows } = await owner.query(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'eje_app' and table_schema = 'app' and table_name in ('businesses', 'listings', 'listing_versions', 'listing_status_events')`,
    );
    const grants = (table: string) => rows.filter((r) => r.table_name === table).map((r) => r.privilege_type).sort();
    for (const table of ["businesses", "listings", "listing_versions", "listing_status_events"]) expect(grants(table), table).not.toContain("DELETE");
    expect(grants("listing_status_events")).toEqual(["INSERT", "SELECT"]);
  });

  it("eje_app no puede actualizar ni borrar eventos de estado", async () => {
    const listing = await newListing();
    await insertVersion(owner, listing);
    expect((await owner.query("select count(*) from app.listing_status_events")).rows[0].count).toBe("1");
    expect(await constraintOf(app.query("update app.listing_status_events set reason = 'x'"))).toBe("42501");
    expect(await constraintOf(app.query("delete from app.listing_status_events"))).toBe("42501");
    expect(await constraintOf(app.query("delete from app.listing_versions"))).toBe("42501");
  });

  it("el disparador escribe un evento por cada versión insertada o que cambia de estado", async () => {
    const listing = await newListing();
    await insertVersion(owner, listing, { status: "draft" });
    await owner.query("update app.listing_versions set status = 'pending' where listing_id = $1", [listing]);
    await owner.query("update app.listing_versions set description = 'Otra descripción' where listing_id = $1", [listing]);
    // F014: `published` solo se alcanza desde `pending` y con `decided_by` de un administrador activo (disparador de la migración f014).
    await owner.query("insert into app.role_grants (telegram_user_id, role) values (900012501, 'admin')");
    await owner.query("update app.listing_versions set status = 'published', decided_by = $2 where listing_id = $1", [listing, accountId]);
    const { rows } = await owner.query("select from_status, to_status, actor_account_id, actor_role from app.listing_status_events order by id");
    expect(rows.map((r) => [r.from_status, r.to_status])).toEqual([[null, "draft"], ["draft", "pending"], ["pending", "published"]]);
    expect(rows.every((r) => r.actor_account_id === accountId && r.actor_role === "system")).toBe(true);
  });

  it("las restricciones existen por nombre", async () => {
    const { rows } = await owner.query(
      `select conname from pg_constraint where connamespace = 'app'::regnamespace and conrelid in ('app.listings'::regclass, 'app.listing_versions'::regclass)`,
    );
    const names = rows.map((r) => r.conname);
    for (const name of [
      "listing_versions_duplicate_name_excl", "listing_versions_required_fields_check", "listing_versions_name_check", "listing_versions_lengths_check",
      "listings_attraction_without_business_check",
    ]) expect(names, name).toContain(name);
    const indexes = (await owner.query("select indexname from pg_indexes where schemaname = 'app' and tablename = 'listing_versions'")).rows.map((r) => r.indexname);
    expect(indexes).toEqual(expect.arrayContaining(["listing_versions_one_published_key", "listing_versions_one_open_key"]));
  });
});
