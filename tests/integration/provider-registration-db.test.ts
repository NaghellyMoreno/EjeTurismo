import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount, grantAdmin, grantProvider, PERSON_1, PERSON_2, PERSON_ADMIN } from "../factories/accounts";
import { appDb, ownerPool, resetDb } from "../helpers/db";

// Contrato F002, criterios 9, 20 (permisos), 28 y 35: lo garantiza la base, no solo el servicio.
let owner: Pool;
const db = appDb();
beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await db.destroy();
});
beforeEach(() => resetDb(owner));

const insertRegistration = (executor: Pool, accountId: string, type: string | null, hash: string, status = "pending") =>
  executor.query(
    `insert into app.provider_registrations (account_id, identity_document_type, identity_number_encrypted, identity_number_hash, status)
     values ($1, $2, '\\x01', decode($3, 'hex'), $4)`,
    [accountId, type, hash, status],
  );
const hash = (n: number) => n.toString(16).padStart(8, "0");

// El rol eje_app de la aplicación, con una conexión propia.
async function asApp<T>(run: (query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>) {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.TEST_APP_URL, max: 1 });
  try {
    return await run((sql, params) => pool.query(sql, params));
  } finally {
    await pool.end();
  }
}

describe("tipo de documento (criterio 9)", () => {
  it("un INSERT directo con eje_app y tipo 'TI' falla por enum y con tipo nulo por NOT NULL", async () => {
    const id = await createAccount(owner, PERSON_1);
    await asApp(async (q) => {
      const insert = (type: string | null) =>
        q(
          `insert into app.provider_registrations (account_id, identity_document_type, identity_number_encrypted, identity_number_hash)
           values ($1, $2, '\\x01', '\\x02')`,
          [id, type],
        );
      await expect(insert("TI")).rejects.toThrow(/invalid input value for enum/);
      await expect(insert(null)).rejects.toThrow(/null value in column "identity_document_type"/);
    });
    expect(Number((await owner.query("select count(*) from app.provider_registrations")).rows[0].count)).toBe(0);
  });
});

describe("unicidad en la base (criterios 28 y 31)", () => {
  it("el mismo hash pendiente o aprobado falla por el índice; rejected no lo bloquea", async () => {
    const a = await createAccount(owner, PERSON_1);
    const b = await createAccount(owner, PERSON_2);
    await insertRegistration(owner, a, "CC", hash(1), "pending");
    await expect(insertRegistration(owner, b, "CC", hash(1), "pending")).rejects.toMatchObject({ code: "23505" });
    await expect(insertRegistration(owner, b, "CC", hash(1), "approved")).rejects.toMatchObject({ code: "23505" });
    await insertRegistration(owner, b, "CC", hash(1), "rejected");
    expect(Number((await owner.query("select count(*) from app.provider_registrations")).rows[0].count)).toBe(2);
  });
  it("una cuenta no tiene dos registros pendientes o aprobados, pero sí uno rechazado y otro pendiente", async () => {
    const a = await createAccount(owner, PERSON_1);
    await insertRegistration(owner, a, "CC", hash(1));
    await expect(insertRegistration(owner, a, "PPT", hash(2))).rejects.toMatchObject({ code: "23505" });
    await owner.query("update app.provider_registrations set status = 'rejected'");
    await insertRegistration(owner, a, "PPT", hash(2));
  });
});

describe("administrador y prestador no coexisten (criterio 35; D-038)", () => {
  it("un INSERT directo del registro de una cuenta con permiso admin activo lo rechaza el disparador", async () => {
    const id = await createAccount(owner, PERSON_ADMIN);
    await grantAdmin(owner, PERSON_ADMIN);
    await expect(insertRegistration(owner, id, "CC", hash(1))).rejects.toThrow(/admin_cannot_register_as_provider/);
    await owner.query("update app.role_grants set revoked_at = now()");
    await insertRegistration(owner, id, "CC", hash(1));
  });
  it("un permiso provider sin registro approved falla; con registro pending o rejected también", async () => {
    const id = await createAccount(owner, PERSON_1);
    await insertRegistration(owner, id, "CC", hash(1), "pending");
    const { rows } = await owner.query("select id from app.provider_registrations");
    const grant = (registrationId: string | null) =>
      owner.query("insert into app.role_grants (telegram_user_id, role, provider_registration_id) values ($1, 'provider', $2)", [PERSON_1, registrationId]);
    await expect(grant(rows[0].id)).rejects.toThrow(/provider_grant_requires_approved_registration/);
    await expect(grant(null)).rejects.toThrow();
    await expect(grant(randomUUID())).rejects.toThrow(/provider_grant_requires_approved_registration/);
    await owner.query("update app.provider_registrations set status = 'rejected'");
    await expect(grant(rows[0].id)).rejects.toThrow(/provider_grant_requires_approved_registration/);
    await owner.query("update app.provider_registrations set status = 'approved'");
    await grant(rows[0].id);
  });
  it("un permiso provider para el ID de un administrador activo falla aunque el registro esté aprobado", async () => {
    const id = await createAccount(owner, PERSON_1);
    await insertRegistration(owner, id, "CC", hash(1), "approved");
    const { rows } = await owner.query("select id from app.provider_registrations");
    await grantAdmin(owner, PERSON_1);
    await expect(
      owner.query("insert into app.role_grants (telegram_user_id, role, provider_registration_id) values ($1, 'provider', $2)", [PERSON_1, rows[0].id]),
    ).rejects.toThrow(/admin_cannot_be_provider/);
  });
  it("role_grants exige la restricción de rol y de administrador principal", async () => {
    await expect(owner.query("insert into app.role_grants (telegram_user_id, role) values (1, 'provider')")).rejects.toThrow();
    await expect(owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values (1, 'provider', true)")).rejects.toThrow();
    await expect(owner.query("insert into app.role_grants (telegram_user_id, role) values (1, 'otro')")).rejects.toThrow();
  });
  it("grantProvider (fábrica) deja un permiso provider válido", async () => {
    const id = await createAccount(owner, PERSON_1);
    await grantProvider(owner, id, PERSON_1);
    expect(Number((await owner.query("select count(*) from app.role_grants where role = 'provider'")).rows[0].count)).toBe(1);
  });
});

describe("audit_events solo se inserta y se lee (criterio 20; D-076)", () => {
  it("eje_app puede INSERT y SELECT; UPDATE y DELETE fallan", async () => {
    const id = await createAccount(owner, PERSON_1);
    await asApp(async (q) => {
      await q(
        "insert into app.audit_events (actor_account_id, actor_role, action, entity_type, entity_id) values ($1, 'none', 'x', 'y', $2)",
        [id, randomUUID()],
      );
      expect((await q("select count(*)::int as n from app.audit_events")).rows[0].n).toBe(1);
      await expect(q("update app.audit_events set action = 'z'")).rejects.toThrow(/permission denied/);
      await expect(q("delete from app.audit_events")).rejects.toThrow(/permission denied/);
    });
  });
});
