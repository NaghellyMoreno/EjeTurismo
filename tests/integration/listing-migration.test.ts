import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerPool, resetDb } from "../helpers/db";
import { seedListing, seedWorld } from "../helpers/listing-http";

// F013, criterio 32: reutiliza las tablas de F012 con una migración solo aditiva.
let owner: Pool;
beforeAll(async () => {
  owner = ownerPool();
  await resetDb(owner);
});
afterAll(() => owner.end());

const MIGRATIONS = resolve(process.cwd(), "supabase/migrations");

describe("criterio 32: migración aditiva", () => {
  it("la migración de F012 no se modificó", () => {
    expect(() => execFileSync("git", ["diff", "--quiet", "HEAD", "--", "supabase/migrations/20261117120000_f012_attractions.sql"])).not.toThrow();
  });

  it("la migración de F013 solo contiene create, alter y grant (nada de drop, delete ni truncate)", () => {
    const file = readdirSync(MIGRATIONS).find((name) => name.includes("f013"))!;
    const statements = readFileSync(resolve(MIGRATIONS, file), "utf8")
      .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n")
      .split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) expect(statement, statement).toMatch(/^(create|alter|grant)\b/i);
    expect(statements.join(";")).not.toMatch(/\b(drop|delete|truncate)\b/i);
  });

  it("las restricciones de F012 existen por nombre y eje_app no tiene DELETE", async () => {
    const { rows } = await owner.query(
      `select conname from pg_constraint where connamespace = 'app'::regnamespace and conrelid in ('app.listings'::regclass, 'app.listing_versions'::regclass)`,
    );
    const names = rows.map((r) => r.conname);
    for (const name of [
      "listing_versions_duplicate_name_excl", "listing_versions_required_fields_check",
      "listings_business_id_key", "listings_attraction_without_business_check",
    ]) expect(names, name).toContain(name);
    const idx = (await owner.query("select indexname from pg_indexes where schemaname = 'app' and tablename = 'listing_versions'")).rows.map((r) => r.indexname);
    expect(idx).toContain("listing_versions_one_open_key");
    const grants = (await owner.query("select privilege_type from information_schema.role_table_grants where grantee = 'eje_app' and table_schema = 'app' and table_name in ('businesses','listings','listing_versions')")).rows.map((r) => r.privilege_type);
    expect(grants).not.toContain("DELETE");
  });

  it("pasar un borrador a pending sin contacto viola el CHECK de campos obligatorios", async () => {
    await resetDb(owner);
    const world = await seedWorld(owner);
    const draft = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Borrador sin contacto" });
    await expect(owner.query("update app.listing_versions set status = 'pending' where id = $1", [draft.versionId])).rejects.toMatchObject({ constraint: "listing_versions_required_fields_check" });
  });
});
