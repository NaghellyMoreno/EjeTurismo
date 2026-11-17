import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverNotifications } from "@/server/notifications";
import { approveProviderRegistration, rejectProviderRegistration } from "@/server/services";
import { grantAdminRole, namedAccount, ADMIN_1, ADMIN_2, NUMBER_1, NUMBER_2, pendingFor, USER_APPROVE, USER_REJECT } from "../factories/review";
import { testConfig } from "../helpers/config";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { decisionRequest, makeReviewApi, route, telegramError } from "../helpers/review-http";

let owner: Pool;
let app: Pool;
const api = makeReviewApi();
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);

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
  api.state.mode = "ok";
  api.sent.length = 0;
});
afterEach(async () => {
  for (const table of ["provider_registrations", "role_grants", "audit_events", "notification_outbox"]) {
    await owner.query(`drop trigger if exists test_fail on app.${table}`);
  }
});

async function seed() {
  await namedAccount(owner, ADMIN_1);
  await grantAdminRole(owner, ADMIN_1);
  await namedAccount(owner, ADMIN_2);
  await grantAdminRole(owner, ADMIN_2);
  const a = await pendingFor(owner, USER_APPROVE, { number: NUMBER_1 });
  const b = await pendingFor(owner, USER_REJECT, { type: "PA", number: NUMBER_2 });
  return { first: a.registrationId, second: b.registrationId };
}

async function failOn(table: string, event: "insert" | "update") {
  await owner.query("create or replace function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo-inyectado-secreto'; end $$");
  await owner.query(`create trigger test_fail before ${event} on app.${table} for each row execute function app.test_fail()`);
}

const none = async () => ({
  pendingOnly: (await rows("select count(*)::int as n from app.provider_registrations where status <> 'pending'"))[0].n,
  provider: (await rows("select count(*)::int as n from app.role_grants where role = 'provider'"))[0].n,
  audit: await count("audit_events"),
  outbox: await count("notification_outbox"),
});

describe("envío del aviso (criterio 16)", () => {
  it("un error 500 de Telegram deja la fila pendiente con un intento y un reintento programado; la decisión sigue hecha", async () => {
    const { first } = await seed();
    const { notificationIds } = await approveProviderRegistration(api.db, testConfig(), { telegramUserId: String(ADMIN_1), displayName: null }, first, { confirmed: true });
    api.state.mode = "error500";
    const before = Date.now();
    await deliverNotifications(notificationIds, { db: () => api.db, now: () => new Date(), send: api.deps.send! });
    const row = (await rows("select * from app.notification_outbox"))[0];
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(before);
    expect((await rows("select status from app.provider_registrations where id = $1", [first]))[0].status).toBe("approved");
    expect(await count("audit_events")).toBe(1);
  });

  it("un 403 de Telegram deja la fila failed, con un intento y sin reintento", async () => {
    const { second } = await seed();
    const { notificationIds } = await rejectProviderRegistration(api.db, testConfig(), { telegramUserId: String(ADMIN_1), displayName: null }, second, { confirmed: true });
    api.state.mode = "error403";
    await deliverNotifications(notificationIds, { db: () => api.db, now: () => new Date(), send: api.deps.send! });
    expect((await rows("select status, attempts, next_attempt_at from app.notification_outbox"))[0]).toEqual({ status: "failed", attempts: 1, next_attempt_at: null });
  });

  it("la ruta HTTP responde 200 aunque Telegram falle", async () => {
    const { first } = await seed();
    api.state.mode = "error500";
    const res = await api.approve(decisionRequest("approval", first, ADMIN_1, { confirmed: true }), route(first));
    expect(res.status).toBe(200);
    expect(telegramError(500).error_code).toBe(500);
  });

  it("no reenvía una fila ya enviada", async () => {
    const { first } = await seed();
    const { notificationIds } = await approveProviderRegistration(api.db, testConfig(), { telegramUserId: String(ADMIN_1), displayName: null }, first, { confirmed: true });
    const deps = { db: () => api.db, now: () => new Date(), send: api.deps.send! };
    await deliverNotifications(notificationIds, deps);
    await deliverNotifications(notificationIds, deps);
    expect(api.sent).toHaveLength(1);
  });
});

describe("transacción atómica (criterio 17)", () => {
  const approveCases: [string, "insert" | "update"][] = [
    ["provider_registrations", "update"],
    ["role_grants", "insert"],
    ["audit_events", "insert"],
    ["notification_outbox", "insert"],
  ];
  it.each(approveCases)("aprobar con fallo en %s: 500 genérico y no queda nada", async (table, event) => {
    const { first } = await seed();
    await failOn(table, event);
    const res = await api.approve(decisionRequest("approval", first, ADMIN_1, { confirmed: true }), route(first));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const text = await res.text();
    for (const leak of ["fallo-inyectado-secreto", "provider_registrations", "role_grants", "audit_events", "notification_outbox", "column"]) {
      expect(text).not.toContain(leak);
    }
    expect(await none()).toEqual({ pendingOnly: 0, provider: 0, audit: 0, outbox: 0 });
  });

  const rejectCases: [string, "insert" | "update"][] = [
    ["provider_registrations", "update"],
    ["audit_events", "insert"],
    ["notification_outbox", "insert"],
  ];
  it.each(rejectCases)("rechazar con fallo en %s: 500 genérico y no queda nada", async (table, event) => {
    const { second } = await seed();
    await failOn(table, event);
    const res = await api.reject(decisionRequest("rejection", second, ADMIN_1, { confirmed: true }), route(second));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("fallo-inyectado-secreto");
    expect(await none()).toEqual({ pendingOnly: 0, provider: 0, audit: 0, outbox: 0 });
  });
});

describe("concurrencia (criterio 30)", () => {
  const actor = (id: number) => ({ telegramUserId: String(id), displayName: null });

  it("dos administradores que aprueban a la vez: un solo 200, un 409, un permiso, una traza y un aviso", async () => {
    const { first } = await seed();
    const other = appDb();
    try {
      const results = await Promise.allSettled([
        approveProviderRegistration(api.db, testConfig(), actor(ADMIN_1), first, { confirmed: true }),
        approveProviderRegistration(other, testConfig(), actor(ADMIN_2), first, { confirmed: true }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(failed.reason).toMatchObject({ status: 409, code: "invalid_state_transition" });
      expect(await rows("select * from app.role_grants where role = 'provider'")).toHaveLength(1);
      expect(await rows("select * from app.audit_events")).toHaveLength(1);
      expect(await count("notification_outbox")).toBe(1);
    } finally {
      await other.destroy();
    }
  });

  it("una aprobación y un rechazo simultáneos dejan un resultado consistente con el único 200", async () => {
    const { first } = await seed();
    const other = appDb();
    try {
      const results = await Promise.allSettled([
        approveProviderRegistration(api.db, testConfig(), actor(ADMIN_1), first, { confirmed: true }),
        rejectProviderRegistration(other, testConfig(), actor(ADMIN_2), first, { confirmed: true }),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ registration: { status: string } }>[];
      expect(ok).toHaveLength(1);
      const status = ok[0].value.registration.status;
      expect((await rows("select status from app.provider_registrations where id = $1", [first]))[0].status).toBe(status);
      expect(await rows("select * from app.role_grants where role = 'provider'")).toHaveLength(status === "approved" ? 1 : 0);
      expect(await count("audit_events")).toBe(1);
      expect(await count("notification_outbox")).toBe(1);
    } finally {
      await other.destroy();
    }
  });
});

describe("permisos de columna con el rol eje_app (criterios 24 y 32)", () => {
  it("no puede cambiar tipo, número, hash, cuenta ni fecha de creación; sí el estado", async () => {
    const { first } = await seed();
    const forbidden = [
      "identity_document_type = 'CE'",
      "identity_number_encrypted = '\\x00'",
      "identity_number_hash = '\\x00'",
      "account_id = gen_random_uuid()",
      "created_at = now()",
    ];
    for (const assignment of forbidden) {
      await expect(app.query(`update app.provider_registrations set ${assignment} where id = $1`, [first]), assignment).rejects.toThrow(/permission denied/);
    }
    await expect(app.query("update app.provider_registrations set status = 'rejected', decided_at = now() where id = $1", [first])).resolves.toBeTruthy();
  });

  it("un permiso provider sin registro aprobado falla; DELETE de registros y permisos falla", async () => {
    const { first } = await seed();
    await expect(
      app.query("insert into app.role_grants (telegram_user_id, role, provider_registration_id) values ($1, 'provider', $2)", [USER_APPROVE, first]),
    ).rejects.toThrow(/provider_grant_requires_approved_registration/);
    await expect(app.query("delete from app.provider_registrations where id = $1", [first])).rejects.toThrow(/permission denied/);
    // F034 (migración f034_self_revocation, D-133): eje_app ya puede borrar permisos al revocar la autorización; la prueba de DELETE está en self-revocation-db.
    await expect(app.query("delete from app.role_grants where telegram_user_id = -1")).resolves.toBeTruthy();
  });

  it("audit_events no se puede actualizar ni borrar", async () => {
    const { first } = await seed();
    await approveProviderRegistration(api.db, testConfig(), { telegramUserId: String(ADMIN_1), displayName: null }, first, { confirmed: true });
    await expect(app.query("update app.audit_events set action = 'x'")).rejects.toThrow(/permission denied/);
    await expect(app.query("delete from app.audit_events")).rejects.toThrow(/permission denied/);
  });

  it("la traza y el aviso no tienen datos personales en `details` ni en `payload` (criterio 24)", async () => {
    const { first } = await seed();
    await approveProviderRegistration(api.db, testConfig(), { telegramUserId: String(ADMIN_1), displayName: null }, first, { confirmed: true });
    const serialized = JSON.stringify(await rows("select row_to_json(t) as r from app.audit_events t"));
    for (const value of [NUMBER_1, "CC", String(USER_APPROVE)]) expect(serialized).not.toContain(`"${value}"`);
    expect((await rows("select details, payload from app.audit_events, app.notification_outbox"))[0]).toEqual({ details: {}, payload: {} });
  });
});
