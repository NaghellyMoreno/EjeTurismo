import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ownerPool, resetDb } from "../helpers/db";
import { revokeProvider, seedInfoWorld, P1, V, type InfoWorld } from "../helpers/information-request";

// F030, criterios 20 (inserción directa), 24 y 28: la tabla, sus restricciones, su disparador y sus permisos.
let owner: Pool;
let world: InfoWorld;
let app: Pool;
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
  world = await seedInfoWorld(owner);
});

const insert = (pool: Pool, over: Partial<Record<string, unknown>> = {}) => {
  const v = {
    listing_id: world.l1.listingId, business_id: world.l1.businessId, visitor_account_id: world.accounts[V], requester_name: "Ana de Prueba",
    interest_date: "2999-01-01", party_size: 3, message: "Consulta de prueba", ...over,
  };
  return pool.query(
    "insert into app.information_requests (listing_id, business_id, visitor_account_id, requester_name, interest_date, party_size, message) values ($1,$2,$3,$4,$5,$6,$7) returning id, status",
    [v.listing_id, v.business_id, v.visitor_account_id, v.requester_name, v.interest_date, v.party_size, v.message],
  );
};

describe("criterio 24: tabla y restricciones", () => {
  it("api/openapi.yaml no cambia respecto del commit de partida cdda8ac", () => {
    expect(() => execFileSync("git", ["diff", "--exit-code", "cdda8ac", "--", "api/openapi.yaml"], { stdio: "pipe" })).not.toThrow();
  });

  it("columnas y tipos de docs/03-arquitectura.md", async () => {
    const { rows } = await owner.query("select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'app' and table_name = 'information_requests'");
    const types = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
    expect(types).toMatchObject({
      id: "uuid", listing_id: "uuid", business_id: "uuid", visitor_account_id: "uuid", requester_name: "text", interest_date: "date",
      party_size: "integer", message: "text", status: "text", created_at: "timestamp with time zone", updated_at: "timestamp with time zone",
    });
    expect(rows.every((r) => r.is_nullable === "NO")).toBe(true);
  });

  it("la solicitud nace en new y el estado solo admite new, attended y closed", async () => {
    expect((await insert(owner)).rows[0].status).toBe("new");
    const check = (await owner.query("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'information_requests_status_check'")).rows[0].def as string;
    for (const status of ["new", "attended", "closed"]) expect(check).toContain(status);
  });

  it("party_size = 0 falla por el CHECK", async () => {
    await expect(insert(owner, { party_size: 0 })).rejects.toMatchObject({ code: "23514", constraint: "information_requests_party_size_check" });
    await expect(insert(owner, { party_size: -1 })).rejects.toMatchObject({ code: "23514" });
  });

  it("nombre y mensaje vacíos o de más de 4096 caracteres fallan", async () => {
    for (const over of [{ requester_name: "  " }, { message: "" }, { requester_name: "x".repeat(4097) }, { message: "x".repeat(4097) }]) {
      await expect(insert(owner, over)).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("el disparador rechaza una ficha sin versión publicada", async () => {
    const draft = (await owner.query("select l.id as listing_id, l.business_id from app.listings l where l.id = $1", [world.l3.listingId])).rows[0];
    await expect(insert(owner, { listing_id: draft.listing_id, business_id: draft.business_id })).rejects.toMatchObject({ message: "listing_not_published" });
  });

  it("el disparador rechaza un atractivo, un negocio que no es el de la ficha y un prestador sin rol activo", async () => {
    await expect(insert(owner, { listing_id: world.a1.listingId, business_id: world.l1.businessId })).rejects.toMatchObject({ message: "listing_not_accepting_requests" });
    await expect(insert(owner, { business_id: world.l2.businessId })).rejects.toMatchObject({ message: "listing_not_accepting_requests" });
    await expect(insert(owner, { listing_id: world.l2.listingId, business_id: world.l2.businessId })).rejects.toMatchObject({ message: "listing_not_accepting_requests" });
    await revokeProvider(owner, P1);
    await expect(insert(owner)).rejects.toMatchObject({ message: "listing_not_accepting_requests" });
  });

  it("el disparador rechaza una fecha pasada en America/Bogota y acepta hoy", async () => {
    const created = "2026-11-22T04:30:00Z"; // 23:30 del 21 de noviembre en Bogotá
    const direct = (date: string) =>
      owner.query(
        "insert into app.information_requests (listing_id, business_id, visitor_account_id, requester_name, interest_date, party_size, message, created_at) values ($1,$2,$3,'Ana',$4,1,'m',$5)",
        [world.l1.listingId, world.l1.businessId, world.accounts[V], date, created],
      );
    await expect(direct("2026-11-20")).rejects.toMatchObject({ message: "interest_date_in_past" });
    await expect(direct("2026-11-21")).resolves.toBeDefined();
  });

  it("la FK de visitor_account_id es ON DELETE CASCADE: borrar la cuenta borra sus solicitudes", async () => {
    const def = (await owner.query("select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'app.information_requests'::regclass and contype = 'f' and pg_get_constraintdef(oid) like '%visitor_account_id%'")).rows[0].def as string;
    expect(def).toMatch(/REFERENCES app\.accounts\(id\) ON DELETE CASCADE/);
    await insert(owner);
    await owner.query("delete from app.accounts where id = $1", [world.accounts[V]]);
    expect(Number((await owner.query("select count(*) from app.information_requests")).rows[0].count)).toBe(0);
  });
});

describe("criterio 28: permisos y migración aditiva", () => {
  // F032 (D-192): eje_app suma solo `update (status, updated_at)`, sin delete ni truncate ni otras columnas.
  it("eje_app solo tiene select e insert sobre la tabla, y update solo de status y updated_at (F032)", async () => {
    const grants = (await owner.query("select privilege_type from information_schema.role_table_grants where table_schema = 'app' and table_name = 'information_requests' and grantee = 'eje_app'")).rows.map((r) => r.privilege_type).sort();
    expect(grants).toEqual(["INSERT", "SELECT"]);
    const columns = (await owner.query("select column_name from information_schema.column_privileges where table_schema = 'app' and table_name = 'information_requests' and grantee = 'eje_app' and privilege_type = 'UPDATE' order by column_name")).rows.map((r) => r.column_name);
    expect(columns).toEqual(["status", "updated_at"]);
    expect((await owner.query("select count(*) from information_schema.column_privileges where table_schema = 'app' and table_name = 'information_requests' and grantee = 'eje_app' and privilege_type = 'DELETE'")).rows[0].count).toBe("0");
    await expect(app.query("update app.information_requests set message = 'x'")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("delete from app.information_requests")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("truncate app.information_requests")).rejects.toMatchObject({ code: "42501" });
  });

  it("ningún otro rol de la plataforma tiene permisos sobre la tabla", async () => {
    const { rows } = await owner.query("select grantee from information_schema.role_table_grants where table_schema = 'app' and table_name = 'information_requests' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')");
    expect(rows).toEqual([]);
  });

  it("la migración solo crea objetos nuevos: sin alter, drop, delete ni truncate sobre lo existente", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261121100000_f030_information_requests.sql"), "utf8")
      .split("\n").filter((line) => !line.trim().startsWith("--")).join("\n")
      .replace(/on delete cascade/gi, ""); // la FK de la cuenta es parte del contrato (criterio 24)
    expect(sql).not.toMatch(/\b(drop|delete|truncate)\b/i);
    // `alter table` solo sobre la tabla nueva (para activar RLS).
    for (const match of sql.matchAll(/\balter\s+table\s+([\w.]+)/gi)) expect(match[1]).toBe("app.information_requests");
    for (const match of sql.matchAll(/\bcreate\s+(?:unique\s+)?(table|index|function|trigger|policy)\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi)) {
      if (match[1] === "policy") continue;
      expect(`${match[1]} ${match[2]}`).toMatch(/information_requests/);
    }
  });
});
