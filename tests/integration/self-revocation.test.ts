import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";
import { revokeMyAuthorization } from "@/server/services";
import { createAccount, createOldVersionAccount, OLD_NOTICE_VERSION } from "../factories/accounts";
import {
  ADMIN_A, admin, NO_ROLE, nameOf, PENDING, pendingPerson, person, PRINCIPAL, principal, PROVIDER_A, provider,
  revokedAdmin, REVOKED_ADMIN, snapshot,
} from "../factories/revocation";
import { createRegistration } from "../factories/review";
import { testConfig } from "../helpers/config";
import { NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { validateSchema } from "../helpers/openapi";
import { makeSelfRevokeApi } from "../helpers/self-revoke-http";
import { signInitData, tma } from "../helpers/telegram";

// F034: servicio y ruta POST /api/v1/consents/revocations (criterios 12 a 19, 22, 27 a 31 y 34).
let owner: Pool;
const api = makeSelfRevokeApi();
const OTHER = 900000072;
const ALL = ["accounts", "bot_sessions", "rate_limit_counters", "provider_registrations", "role_grants", "consent_events", "audit_events", "notification_outbox"];
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const accountOf = async (id: number) => (await rows("select id from app.accounts where telegram_user_id = $1", [id]))[0]?.id as string | undefined;
const problemOf = async (res: Response) => (await res.json()) as { code: string; detail?: string; status: number };
const all = () => snapshot(owner, ALL);

async function seedExtras(id: number) {
  const accountId = (await accountOf(id))!;
  await owner.query("insert into app.bot_sessions (account_id, data) values ($1, '{\"form\":\"x\"}')", [accountId]);
  await owner.query("insert into app.rate_limit_counters (account_id, action, window_start, count) values ($1, 'provider_registration', now(), 2)", [accountId]);
}

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.db.destroy();
});
beforeEach(() => resetDb(owner));
afterEach(async () => {
  await owner.query("drop trigger if exists test_fail_f034_http on app.consent_events");
  await owner.query("drop trigger if exists test_fail_f034_http on app.accounts");
});

describe("revocar: respuesta y prueba de revocación (criterios 12 y 14)", () => {
  it("12: 200 con RevocationResult válido, sin número, tipo de documento ni ID de Telegram", async () => {
    await pendingPerson(owner, PENDING);
    const res = await api.revoke(PENDING);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(validateSchema("RevocationResult", body)).toEqual([]);
    expect(body.message).toBe(es.selfRevoke.revoked);
    expect(Math.abs(new Date(body.revokedAt).getTime() - Date.now())).toBeLessThanOrEqual(5000);
    for (const secret of ["1020304050", String(PENDING), "CC"]) expect(text).not.toContain(secret);
    expect(await accountOf(PENDING)).toBeUndefined();
  });

  it("14: queda una fila revoked más, la accepted no cambia y consent_events no identifica a la persona", async () => {
    await person(owner, NO_ROLE);
    await owner.query("insert into app.consent_events (event, channel, notice_version) values ('accepted', 'bot', $1)", [NOTICE_VERSION]);
    const before = await rows("select * from app.consent_events order by id");
    const res = await api.revoke(NO_ROLE);
    expect(res.status).toBe(200);
    const after = await rows("select * from app.consent_events order by id");
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
    const added = after.at(-1);
    expect(added).toMatchObject({ event: "revoked", channel: "mini_app", notice_version: NOTICE_VERSION });
    expect(Math.abs(new Date(added.occurred_at).getTime() - Date.now())).toBeLessThanOrEqual(5000);
    const columns = (await rows("select column_name from information_schema.columns where table_schema = 'app' and table_name = 'consent_events' order by ordinal_position")).map((r) => r.column_name);
    expect(columns).toEqual(["id", "event", "channel", "notice_version", "occurred_at"]);
  });

  it("14: el canal es bot cuando lo pide el bot y se guarda la versión aceptada por la cuenta", async () => {
    await createOldVersionAccount(owner, NO_ROLE);
    const actor = { telegramUserId: String(NO_ROLE), displayName: null };
    await revokeMyAuthorization(api.db, testConfig(), actor, { confirmed: true }, "bot", new Date("2026-11-17T15:30:00Z"));
    expect(await rows("select event, channel, notice_version, occurred_at from app.consent_events")).toEqual([
      { event: "revoked", channel: "bot", notice_version: OLD_NOTICE_VERSION, occurred_at: new Date("2026-11-17T15:30:00Z") },
    ]);
  });
});

describe("revocar: atomicidad (criterios 13 y 34)", () => {
  it.each([
    ["consent_events", "insert", "new", "new.event = 'revoked'"],
    ["accounts", "delete", "old", "true"],
  ])("13 y 34: con un fallo al escribir en %s no cambia nada, la ruta responde 500 genérico y se puede reintentar", async (table, op, row, when) => {
    await pendingPerson(owner, PENDING);
    await seedExtras(PENDING);
    await owner.query(
      `create function app.test_fail_f034_http() returns trigger language plpgsql as $$ begin if ${when} then raise exception 'fallo-inyectado-secreto'; end if; return ${row}; end $$`,
    );
    await owner.query(`create trigger test_fail_f034_http before ${op} on app.${table} for each row execute function app.test_fail_f034_http()`);
    const before = await all();
    const res = await api.revoke(PENDING);
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const text = await res.text();
    expect(text).not.toContain("fallo-inyectado-secreto");
    expect(JSON.parse(text).code).toBe("internal_error");
    expect(await all()).toEqual(before);
    await owner.query(`drop trigger test_fail_f034_http on app.${table}`);
    expect((await api.revoke(PENDING)).status).toBe(200);
    await owner.query("drop function app.test_fail_f034_http()");
  });
});

describe("revocar: qué se borra (criterios 16 a 19)", () => {
  it("16: no queda ninguna fila con el ID de Telegram ni con la cuenta en el esquema app", async () => {
    await pendingPerson(owner, PENDING);
    await seedExtras(PENDING);
    const accountId = (await accountOf(PENDING))!;
    expect((await api.revoke(PENDING)).status).toBe(200);
    const columns = await rows(
      "select table_name, column_name from information_schema.columns where table_schema = 'app' and column_name in ('telegram_user_id', 'account_id', 'recipient_telegram_user_id')",
    );
    expect(columns.length).toBeGreaterThan(4);
    for (const { table_name, column_name } of columns) {
      const value = column_name === "account_id" ? accountId : String(PENDING);
      const n = Number((await rows(`select count(*) from app.${table_name} where ${column_name}::text = $1`, [value]))[0].count);
      expect(n, `${table_name}.${column_name}`).toBe(0);
    }
    expect(Number((await rows("select count(*) from app.consent_events where row_to_json(consent_events)::text like $1", [`%${PENDING}%`]))[0].count)).toBe(0);
  });

  it.each([["pending"], ["rejected"]] as const)("17: un registro %s con número cifrado se borra, con su sello", async (status) => {
    const accountId = await person(owner, PENDING);
    await createRegistration(owner, accountId, { status, number: "1020304050" });
    expect((await api.revoke(PENDING)).status).toBe(200);
    expect(await count("provider_registrations")).toBe(0);
    expect(await rows("select * from app.provider_registrations where account_id = $1", [accountId])).toEqual([]);
  });

  it("17: el registro aprobado de un prestador con permiso revocado (F006) y todas las filas de role_grants se borran", async () => {
    await provider(owner, PROVIDER_A);
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1", [PROVIDER_A]);
    await revokedAdmin(owner, REVOKED_ADMIN);
    for (const id of [PROVIDER_A, REVOKED_ADMIN]) expect((await api.revoke(id)).status).toBe(200);
    expect(await count("role_grants")).toBe(0);
    expect(await count("provider_registrations")).toBe(0);
    expect(await count("accounts")).toBe(0);
  });

  it("18: no escribe en audit_events ni en notification_outbox y no envía mensajes", async () => {
    await pendingPerson(owner, PENDING);
    const sent: string[] = [];
    const sender = makeSelfRevokeApi(api.db);
    sender.deps.send = async (chatId, text) => void sent.push(`${chatId}${text}`);
    const before = [await count("audit_events"), await count("notification_outbox")];
    expect((await sender.revoke(PENDING)).status).toBe(200);
    expect([await count("audit_events"), await count("notification_outbox")]).toEqual(before);
    expect(sent).toEqual([]);
    for (const secret of [String(PENDING), nameOf(PENDING), "1020304050"]) expect(es.selfRevoke.revoked).not.toContain(secret);
  });

  it("19: los datos de otra cuenta no cambian", async () => {
    await pendingPerson(owner, PENDING);
    await seedExtras(PENDING);
    await person(owner, OTHER);
    await createRegistration(owner, (await accountOf(OTHER))!, { status: "pending", number: "5544332211" });
    await seedExtras(OTHER);
    await owner.query("insert into app.role_grants (telegram_user_id, role, revoked_at) values ($1, 'admin', now())", [OTHER]);
    const other = (await accountOf(OTHER))!;
    const mine = async () => ({
      accounts: await rows("select * from app.accounts where id = $1", [other]),
      sessions: await rows("select * from app.bot_sessions where account_id = $1", [other]),
      registrations: await rows("select * from app.provider_registrations where account_id = $1", [other]),
      grants: await rows("select * from app.role_grants where telegram_user_id = $1", [OTHER]),
      counters: await rows("select * from app.rate_limit_counters where account_id = $1", [other]),
    });
    const before = await mine();
    expect((await api.revoke(PENDING)).status).toBe(200);
    expect(await mine()).toEqual(before);
    expect(await count("accounts")).toBe(1);
  });
});

describe("revocar: doble confirmación (criterio 22)", () => {
  it("dos solicitudes simultáneas: una responde 200 y la otra 403 forbidden, con una sola fila revoked", async () => {
    for (let round = 0; round < 3; round++) {
      await resetDb(owner);
      await pendingPerson(owner, PENDING);
      const results = await Promise.all([api.revoke(PENDING), api.revoke(PENDING)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
      const denied = results.find((r) => r.status === 403)!;
      expect((await problemOf(denied)).code).toBe("forbidden");
      expect(await rows("select event from app.consent_events where event = 'revoked'")).toHaveLength(1);
    }
  });
});

describe("revocar: acceso y datos inválidos (criterios 27 a 31)", () => {
  it("27: sin initData, con firma inválida o vencido responde 401 problem+json y no cambia nada", async () => {
    await pendingPerson(owner, PENDING);
    const before = await all();
    const expired = tma(signInitData({ userId: PENDING, authDate: Math.floor(Date.now() / 1000) - 7 * 86400 }));
    const tampered = tma(signInitData({ userId: PENDING, tamperUserId: 900000098 }));
    for (const headers of [{}, tampered, expired]) {
      const res = await api.revoke(null, { confirmed: true }, headers);
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect((await problemOf(res)).code).toBe("unauthenticated");
    }
    expect(await all()).toEqual(before);
  });

  it("28: sin cuenta (nunca aceptó o ya revocó) responde 403 forbidden y no cambia nada", async () => {
    await pendingPerson(owner, PENDING);
    const before = await all();
    const res = await api.revoke(NO_ROLE);
    expect(res.status).toBe(403);
    expect((await problemOf(res)).code).toBe("forbidden");
    expect(await all()).toEqual(before);
    expect((await api.revoke(PENDING)).status).toBe(200);
    const again = await api.revoke(PENDING);
    expect(again.status).toBe(403);
    expect((await problemOf(again)).code).toBe("forbidden");
  });

  it("29: una cuenta con la versión anterior del aviso puede revocar", async () => {
    await createOldVersionAccount(owner, NO_ROLE);
    const res = await api.revoke(NO_ROLE);
    expect(res.status).toBe(200);
    expect(await accountOf(NO_ROLE)).toBeUndefined();
    expect(await rows("select notice_version from app.consent_events where event = 'revoked'")).toEqual([{ notice_version: OLD_NOTICE_VERSION }]);
  });

  it.each([
    ["sin confirmed", {}, "confirmed"],
    ["confirmed false", { confirmed: false }, "confirmed"],
    ["campo extra", { confirmed: true, extra: 1 }, "extra"],
    ["cuerpo vacío", "", "body"],
    ["no es un objeto", "[true]", "body"],
  ] as const)("30: %s responde 422 con el campo señalado y no cambia nada", async (_label, body, field) => {
    await pendingPerson(owner, PENDING);
    const before = await all();
    const res = await api.revoke(PENDING, body);
    expect(res.status).toBe(422);
    const problem = (await res.json()) as { code: string; errors: { field: string }[] };
    expect(problem.code).toBe("validation_failed");
    expect(problem.errors.map((e) => e.field)).toContain(field);
    expect(await all()).toEqual(before);
  });

  it.each([
    ["administrador", async (): Promise<void> => void (await admin(owner, ADMIN_A)), ADMIN_A],
    ["principal con fila", async (): Promise<void> => principal(owner, true), PRINCIPAL],
    ["principal sin fila", async (): Promise<void> => principal(owner, false), PRINCIPAL],
    ["prestador", async (): Promise<void> => void (await provider(owner, PROVIDER_A)), PROVIDER_A],
  ] as const)("31: %s recibe 409 has_active_role con el texto de selfRevoke.activeRole y nada cambia", async (_label, seed, id) => {
    await seed();
    const before = await all();
    const res = await api.revoke(id);
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const problem = await problemOf(res);
    expect(problem.code).toBe("has_active_role");
    expect(problem.detail).toBe(es.selfRevoke.activeRole);
    expect(await all()).toEqual(before);
  });
});

describe("revocar: fallo de la base (criterio 34)", () => {
  it("la ruta responde 500 genérico sin el texto del error", async () => {
    const failing = failingDb();
    const res = await makeSelfRevokeApi(failing.db).revoke(NO_ROLE);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain(failing.errorText);
    expect(JSON.parse(text).code).toBe("internal_error");
  });
});

describe("migración y permisos (criterios 39 y 40)", () => {
  let app: Pool;
  beforeAll(() => void (app = new Pool({ connectionString: process.env.TEST_APP_URL, max: 2 })));
  afterAll(() => app.end());

  it("39: eje_app borra en accounts y role_grants; no actualiza ni borra consent_events y audit_events; sigue insertando y leyendo", async () => {
    await createAccount(owner, NO_ROLE);
    await owner.query("insert into app.role_grants (telegram_user_id, role, revoked_at) values ($1, 'admin', now())", [NO_ROLE]);
    await owner.query("insert into app.consent_events (event, channel, notice_version) values ('accepted', 'bot', $1)", [NOTICE_VERSION]);
    await owner.query("insert into app.audit_events (actor_role, action, entity_type, entity_id) values ('admin', 'x', 'y', gen_random_uuid())");
    await expect(app.query("delete from app.role_grants where telegram_user_id = $1", [NO_ROLE])).resolves.toMatchObject({ rowCount: 1 });
    await expect(app.query("delete from app.accounts where telegram_user_id = $1", [NO_ROLE])).resolves.toMatchObject({ rowCount: 1 });
    for (const sql of ["update app.consent_events set channel = 'bot'", "delete from app.consent_events", "update app.audit_events set action = 'z'", "delete from app.audit_events"]) {
      await expect(app.query(sql), sql).rejects.toThrow(/permission denied/);
    }
    await expect(app.query("insert into app.consent_events (event, channel, notice_version) values ('revoked', 'bot', $1)", [NOTICE_VERSION])).resolves.toBeTruthy();
    await expect(app.query("select count(*) from app.consent_events")).resolves.toBeTruthy();
    await expect(app.query("select count(*) from app.audit_events")).resolves.toBeTruthy();
  });
});
