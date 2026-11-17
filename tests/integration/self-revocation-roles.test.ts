import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";
import type { Deps } from "@/server/http/deps";
import { revokeRoleHandler } from "@/server/http/handlers";
import { withProviderGuard } from "@/server/http/handlers";
import { json } from "@/server/http/problem";
import { createProviderRegistration } from "@/server/services";
import { createAccount, createOldVersionAccount } from "../factories/accounts";
import { grantId, snapshot } from "../factories/revocation";
import { makeProvider } from "../factories/review";
import { testConfig } from "../helpers/config";
import { NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { validateSchema } from "../helpers/openapi";
import { PROTECTED_OPERATIONS, routeContext, buildRequest } from "../helpers/protected-operations";
import { ADMIN_OPERATION_IDS, changedTables, snapshotAll } from "../helpers/role-denial";
import { makeSelfRevokeApi } from "../helpers/self-revoke-http";
import { signInitData, tma } from "../helpers/telegram";

// F035: efectos de revocar para prestador y administrador (contrato F035, criterios 4 a 14, 17 a 22, 25 a 32, 34, 35, 41 y 43).
const NUMBER = "7700035101";
const PROV = 900000351;
const PROV_2 = 900000352;
const VISITOR = 900000353;
const ADM_X = 900000354;
const ADM_Y = 900000355;
const BOTH = 900000357;
const OLD = 900000358;
const PRINCIPAL = 900000099;
const ALL = ["accounts", "bot_sessions", "rate_limit_counters", "provider_registrations", "role_grants", "consent_events", "audit_events", "notification_outbox"];

let owner: Pool;
const api = makeSelfRevokeApi();
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const problemOf = async (res: Response) => (await res.json()) as { code: string; detail?: string };
const accountOf = async (id: number) => (await rows("select id from app.accounts where telegram_user_id = $1", [id]))[0]?.id as string | undefined;
const all = () => snapshot(owner, ALL);
const addAdmin = async (id: number) => {
  await createAccount(owner, id, `Administrador Ficticio ${id}`);
  await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [id]);
};
const addProvider = (id: number, number = NUMBER) => makeProvider(owner, id, number);
const revokedEvents = () => rows("select channel, notice_version, occurred_at from app.consent_events where event = 'revoked'");

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.db.destroy();
});
beforeEach(() => resetDb(owner));
afterEach(async () => {
  for (const table of ["consent_events", "accounts", "notification_outbox"]) await owner.query(`drop trigger if exists test_fail_f035 on app.${table}`);
  await owner.query("drop function if exists app.test_fail_f035()");
});

async function failOn(table: string, op: string, row: string, when: string) {
  await owner.query(`create function app.test_fail_f035() returns trigger language plpgsql as $$ begin if ${when} then raise exception 'fallo-inyectado'; end if; return ${row}; end $$`);
  await owner.query(`create trigger test_fail_f035 before ${op} on app.${table} for each row execute function app.test_fail_f035()`);
}

describe("prestador: pierde el rol y se borra su número (criterios 4, 6 a 14)", () => {
  it("4, 8, 13: 200 con RevocationResult válido, sin datos personales; cuenta y permisos desaparecen; una fila revoked más", async () => {
    const accountId = await addProvider(PROV);
    await owner.query("insert into app.bot_sessions (account_id, data) values ($1, '{}')", [accountId]);
    await owner.query("insert into app.consent_events (event, channel, notice_version) values ('accepted', 'bot', $1)", [NOTICE_VERSION]);
    const accepted = await rows("select * from app.consent_events order by id");
    const res = await api.revoke(PROV);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(validateSchema("RevocationResult", JSON.parse(text))).toEqual([]);
    expect(JSON.parse(text).message).toBe(es.selfRevoke.revoked);
    for (const secret of [NUMBER, String(PROV), "CC"]) expect(text).not.toContain(secret);
    for (const table of ["accounts", "bot_sessions", "provider_registrations", "role_grants"]) expect(await count(table), table).toBe(0);
    const events = await rows("select * from app.consent_events order by id");
    expect(events).toHaveLength(accepted.length + 1);
    expect(events.slice(0, accepted.length)).toEqual(accepted);
    expect(events.at(-1)).toMatchObject({ event: "revoked", channel: "mini_app", notice_version: NOTICE_VERSION });
    expect(Math.abs(new Date(events.at(-1).occurred_at).getTime() - Date.now())).toBeLessThan(5000);
    const columns = (await rows("select column_name from information_schema.columns where table_schema = 'app' and table_name = 'consent_events'")).map((r) => r.column_name);
    expect(columns.sort()).toEqual(["channel", "event", "id", "notice_version", "occurred_at"]);
    expect(JSON.stringify(events)).not.toContain(NUMBER);
  });

  it("7: el número, su valor cifrado y su sello no quedan en ninguna columna del esquema app", async () => {
    await addProvider(PROV);
    const reg = (await rows("select identity_number_encrypted as e, identity_number_hash as h from app.provider_registrations"))[0];
    // El número no es subcadena de ningún otro valor sembrado.
    const seeded = JSON.stringify(await Promise.all(["accounts", "role_grants", "consent_events"].map((t) => rows(`select * from app.${t}`))));
    expect(seeded).not.toContain(NUMBER);
    expect((await api.revoke(PROV)).status).toBe(200);
    const columns = await rows(
      `select table_name, column_name from information_schema.columns where table_schema = 'app'
         and (data_type in ('text', 'bytea', 'jsonb', 'character varying'))`,
    );
    expect(columns.length).toBeGreaterThan(10);
    const needles = [Buffer.from(NUMBER), reg.e as Buffer, reg.h as Buffer];
    for (const { table_name: table, column_name: column } of columns) {
      for (const needle of needles) {
        const found = await rows(`select count(*)::int as n from app."${table}" where position($1::bytea in convert_to(${`"${column}"`}::text, 'UTF8')) > 0 or ${`"${column}"`}::text like $2`, [
          needle,
          `%${needle.toString("hex")}%`,
        ]);
        expect(found[0].n, `${table}.${column}`).toBe(0);
      }
    }
  });

  it("9: no queda ninguna fila con su ID de Telegram, incluida notification_outbox; las de otros no cambian", async () => {
    await addProvider(PROV);
    await addProvider(PROV_2, "7700035102");
    await owner.query("insert into app.notification_outbox (recipient_telegram_user_id, template) values ($1, 'registration_approved'), ($1, 'registration_approved'), ($2, 'registration_approved')", [PROV, PROV_2]);
    const otherBefore = await rows("select * from app.notification_outbox where recipient_telegram_user_id = $1", [PROV_2]);
    expect((await api.revoke(PROV)).status).toBe(200);
    const columns = await rows(
      "select table_name, column_name from information_schema.columns where table_schema = 'app' and column_name in ('telegram_user_id', 'recipient_telegram_user_id')",
    );
    for (const { table_name: table, column_name: column } of columns) {
      expect(await rows(`select 1 from app."${table}" where ${column} = $1`, [PROV]), table).toEqual([]);
    }
    expect(await rows("select * from app.notification_outbox where recipient_telegram_user_id = $1", [PROV_2])).toEqual(otherBefore);
  });

  it("10: no escribe audit_events ni notification_outbox; las filas anteriores quedan con actor NULL", async () => {
    await addAdmin(ADM_X);
    const accountId = await addProvider(PROV);
    const regId = (await rows("select id from app.provider_registrations"))[0].id;
    await owner.query(
      "insert into app.audit_events (actor_account_id, actor_role, action, entity_type, entity_id, details) values ($1, 'provider', 'provider_registration.created', 'provider_registration', $2, '{}'), ($3, 'admin', 'provider_registration.approved', 'provider_registration', $2, '{}')",
      [accountId, regId, await accountOf(ADM_X)],
    );
    const before = await rows("select id, action, entity_id, actor_account_id from app.audit_events order by id");
    expect((await api.revoke(PROV)).status).toBe(200);
    const after = await rows("select id, action, entity_id, actor_account_id from app.audit_events order by id");
    expect(after).toHaveLength(before.length);
    expect(after.map((r) => r.action)).toEqual(before.map((r) => r.action));
    expect(after[0].actor_account_id).toBeNull();
    expect(after[1].actor_account_id).toBe(before[1].actor_account_id);
    expect(JSON.stringify(await rows("select details from app.audit_events"))).not.toContain(NUMBER);
    expect(await count("notification_outbox")).toBe(0);
  });

  it.each([
    ["consent_events", "insert", "new", "new.event = 'revoked'"],
    ["notification_outbox", "delete", "old", "true"],
    ["accounts", "delete", "old", "true"],
  ])("11 y 35: con un fallo al escribir en %s no cambia nada y se puede reintentar", async (table, op, row, when) => {
    await addProvider(PROV);
    await owner.query("insert into app.notification_outbox (recipient_telegram_user_id, template) values ($1, 'registration_approved')", [PROV]);
    await failOn(table, op, row, when);
    const before = await all();
    const res = await api.revoke(PROV);
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const text = await res.text();
    expect(text).not.toContain("fallo-inyectado");
    expect(JSON.parse(text).code).toBe("internal_error");
    expect(await all()).toEqual(before);
    await owner.query(`drop trigger test_fail_f035 on app.${table}`);
    expect((await api.revoke(PROV)).status).toBe(200);
  });

  it("12: los datos de otra cuenta no cambian", async () => {
    await addProvider(PROV);
    await addProvider(PROV_2, "7700035102");
    await createAccount(owner, VISITOR);
    const tables = ["accounts", "provider_registrations", "role_grants", "bot_sessions", "notification_outbox"];
    const others = async () => ({
      accounts: await rows("select * from app.accounts where telegram_user_id in ($1, $2)", [PROV_2, VISITOR]),
      grants: await rows("select * from app.role_grants where telegram_user_id = $1", [PROV_2]),
      regs: await rows("select * from app.provider_registrations where account_id = $1", [await accountOf(PROV_2)]),
    });
    const before = await others();
    expect(tables.length).toBeGreaterThan(0);
    expect((await api.revoke(PROV)).status).toBe(200);
    expect(await others()).toEqual(before);
  });

  it("6: tras revocar, la matriz de rutas protegidas responde 403 y la ruta de muestra de prestador también; antes respondía 200", async () => {
    await addProvider(PROV);
    const deps: Deps = { config: () => testConfig(), db: () => api.db, now: () => new Date() };
    let calls = 0;
    const sample = withProviderGuard(deps, async () => {
      calls += 1;
      return json({ ok: true });
    });
    const headers = tma(signInitData({ userId: PROV }));
    const call = () => sample(new Request("http://localhost/muestra", { headers }));
    expect((await call()).status).toBe(200);
    expect((await api.revoke(PROV)).status).toBe(200);
    const before = await snapshotAll(owner);
    const table: string[] = [];
    for (const op of PROTECTED_OPERATIONS.filter((o) => o.role !== "none")) {
      const res = await op.handler(deps)(buildRequest(op, headers, op.body), routeContext());
      const code = ((await res.json()) as { code: string }).code;
      table.push(`${op.operationId}: ${res.status} ${code}`);
      const expected = op.role === "account" ? "forbidden" : "consent_required";
      expect([res.status, code], op.operationId).toEqual([403, expected]);
    }
    console.info(table.join("\n"));
    const sampleRes = await call();
    expect([sampleRes.status, ((await sampleRes.json()) as { code: string }).code]).toEqual([403, "consent_required"]);
    expect(calls).toBe(1);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });

  it("14: tras revocar y aceptar de nuevo, la cuenta nueva no tiene rol y puede registrarse con el mismo documento", async () => {
    await addProvider(PROV);
    expect((await api.revoke(PROV)).status).toBe(200);
    await createAccount(owner, PROV, "Persona Nueva");
    expect(await count("role_grants")).toBe(0);
    const actor = { telegramUserId: String(PROV), displayName: null };
    const created = await createProviderRegistration(api.db, testConfig(), actor, { confirmed: true, identityDocumentType: "CC", identityNumber: NUMBER });
    expect(created.status).toBe("pending");
  });
});

describe("administrador que no es principal ni único (criterios 17 a 22)", () => {
  it("17, 18 y 20: revoca por HTTP; borra cuenta y permisos; los otros administradores no cambian; ya no opera", async () => {
    await addAdmin(ADM_X);
    await addAdmin(ADM_Y);
    const others = async () => ({
      a: await rows("select * from app.accounts where telegram_user_id = $1", [ADM_Y]),
      g: await rows("select * from app.role_grants where telegram_user_id = $1", [ADM_Y]),
    });
    const before = await others();
    const res = await api.revoke(ADM_X);
    expect(res.status).toBe(200);
    expect(validateSchema("RevocationResult", await res.json())).toEqual([]);
    for (const table of ["accounts", "role_grants"]) expect(await rows(`select 1 from app.${table} where telegram_user_id = $1`, [ADM_X])).toEqual([]);
    expect(await others()).toEqual(before);
    expect((await revokedEvents())).toMatchObject([{ channel: "mini_app", notice_version: NOTICE_VERSION }]);
    // Las 14 operaciones de administrador responden 403 consent_required y no cambian nada.
    const deps: Deps = { config: () => testConfig(), db: () => api.db, now: () => new Date() };
    const headers = tma(signInitData({ userId: ADM_X }));
    const snap = await snapshotAll(owner);
    const ops = PROTECTED_OPERATIONS.filter((o) => ADMIN_OPERATION_IDS.includes(o.operationId));
    expect(ops).toHaveLength(14);
    for (const op of ops) {
      const res2 = await op.handler(deps)(buildRequest(op, headers, op.body), routeContext());
      expect([res2.status, ((await res2.json()) as { code: string }).code], op.operationId).toEqual([403, "consent_required"]);
    }
    expect(changedTables(snap, await snapshotAll(owner))).toEqual([]);
  });

  it("19: el rastro que apunta a su cuenta queda en NULL y las filas siguen; el autorizado conserva su permiso", async () => {
    await addAdmin(ADM_X);
    await addAdmin(ADM_Y);
    const x = (await accountOf(ADM_X))!;
    await owner.query("update app.role_grants set granted_by_account_id = $1 where telegram_user_id = $2", [x, ADM_Y]);
    await owner.query("insert into app.role_grants (telegram_user_id, role, revoked_at, revoked_by_account_id) values ($2, 'admin', now(), $1)", [x, 900000360]);
    const municipality = (await rows("insert into app.municipalities (name, name_normalized, department, created_by, updated_by) values ('Municipio Ficticio Tres', 'municipio ficticio tres', 'Caldas', $1, $1) returning id", [x]))[0].id;
    const category = (await rows("insert into app.categories (name, name_normalized, created_by_account_id, updated_by_account_id) values ('Categoria Tres', 'categoria tres', $1, $1) returning id", [x]))[0].id;
    const registrant = await addProvider(PROV);
    const regId = (await rows("select id from app.provider_registrations where account_id = $1", [registrant]))[0].id;
    await owner.query("update app.provider_registrations set decided_by_account_id = $1 where id = $2", [x, regId]);
    await owner.query("insert into app.audit_events (actor_account_id, actor_role, action, entity_type, entity_id, details) values ($1, 'admin', 'x', 'y', $2, '{}')", [x, regId]);
    expect((await api.revoke(ADM_X)).status).toBe(200);
    expect((await rows("select granted_by_account_id from app.role_grants where telegram_user_id = $1", [ADM_Y]))[0].granted_by_account_id).toBeNull();
    expect(await rows("select revoked_by_account_id from app.role_grants where telegram_user_id = $1", [900000360])).toEqual([{ revoked_by_account_id: null }]);
    expect(await rows("select created_by, updated_by from app.municipalities where id = $1", [municipality])).toEqual([{ created_by: null, updated_by: null }]);
    expect(await rows("select created_by_account_id, updated_by_account_id from app.categories where id = $1", [category])).toEqual([{ created_by_account_id: null, updated_by_account_id: null }]);
    expect((await rows("select decided_by_account_id from app.provider_registrations where id = $1", [regId]))[0].decided_by_account_id).toBeNull();
    expect(await rows("select actor_account_id from app.audit_events")).toEqual([{ actor_account_id: null }]);
    expect(await rows("select 1 from app.role_grants where telegram_user_id = $1 and role = 'admin' and revoked_at is null", [ADM_Y])).toHaveLength(1);
  });

  it("22: con fallo al escribir consent_events o borrar accounts, conserva cuenta y permiso", async () => {
    await addAdmin(ADM_X);
    await addAdmin(ADM_Y);
    for (const [table, op, row, when] of [["consent_events", "insert", "new", "new.event = 'revoked'"], ["accounts", "delete", "old", "true"]]) {
      await failOn(table, op, row, when);
      const before = await all();
      expect((await api.revoke(ADM_X)).status).toBe(500);
      expect(await all()).toEqual(before);
      expect(await revokedEvents()).toEqual([]);
      await owner.query(`drop trigger test_fail_f035 on app.${table}`);
      await owner.query("drop function app.test_fail_f035()");
    }
  });

  it("32: una cuenta con la versión anterior del aviso puede revocar por HTTP con los mismos efectos", async () => {
    await addAdmin(ADM_Y);
    await createOldVersionAccount(owner, OLD);
    await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [OLD]);
    expect((await api.revoke(OLD)).status).toBe(200);
    expect(await accountOf(OLD)).toBeUndefined();
    expect(await rows("select 1 from app.role_grants where telegram_user_id = $1", [OLD])).toEqual([]);
  });
});

describe("administrador principal y único (criterios 25 a 30)", () => {
  it.each([[true], [false]])("25: el principal (con fila: %s) recibe 409 principal_admin_protected y nada cambia", async (withRow) => {
    await createAccount(owner, PRINCIPAL, "Principal Ficticio");
    await addAdmin(ADM_X);
    if (withRow) await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values ($1, 'admin', true)", [PRINCIPAL]);
    const before = await all();
    const res = await api.revoke(PRINCIPAL);
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await problemOf(res)).toMatchObject({ code: "principal_admin_protected", detail: es.selfRevoke.principalProtected });
    expect(await all()).toEqual(before);
  });

  it("27: el único administrador recibe 409 last_admin_protected y nada cambia", async () => {
    await addAdmin(ADM_X);
    const before = await all();
    const res = await api.revoke(ADM_X);
    expect(res.status).toBe(409);
    expect(await problemOf(res)).toMatchObject({ code: "last_admin_protected", detail: es.selfRevoke.lastAdminProtected });
    expect(await all()).toEqual(before);
  });

  it("26 (P2): con el principal sin fila, el único administrador con fila no puede revocar", async () => {
    await createAccount(owner, PRINCIPAL);
    await addAdmin(ADM_X);
    expect((await problemOf(await api.revoke(ADM_X))).code).toBe("last_admin_protected");
  });

  it("28: el principal que es también el único administrador recibe principal_admin_protected", async () => {
    await createAccount(owner, PRINCIPAL);
    await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values ($1, 'admin', true)", [PRINCIPAL]);
    expect((await problemOf(await api.revoke(PRINCIPAL))).code).toBe("principal_admin_protected");
  });

  it("29: dos administradores únicos activos que revocan a la vez: un 200 y un 409 last_admin_protected", async () => {
    for (let i = 0; i < 10; i++) {
      await resetDb(owner);
      await addAdmin(ADM_X);
      await addAdmin(ADM_Y);
      const order = i % 2 === 0 ? [ADM_X, ADM_Y] : [ADM_Y, ADM_X];
      const results = await Promise.all(order.map((id) => api.revoke(id)));
      const codes = await Promise.all(results.map(async (r) => (r.status === 200 ? "200" : `${r.status} ${(await problemOf(r)).code}`)));
      expect(codes.sort()).toEqual(["200", "409 last_admin_protected"]);
      expect(await rows("select 1 from app.role_grants where role = 'admin' and revoked_at is null")).toHaveLength(1);
    }
  });

  it("30: la revocación propia de A a la vez que B le quita el rol: pares (200, 404) o (200, 200), un solo administrador y ningún 500", async () => {
    const deps: Deps = { config: () => testConfig(), db: () => api.db, now: () => new Date() };
    const revokeRole = revokeRoleHandler(deps);
    for (let i = 0; i < 20; i++) {
      await resetDb(owner);
      await addAdmin(ADM_X);
      await addAdmin(ADM_Y);
      const grantOfA = await grantId(owner, ADM_X, "admin");
      const own = () => api.revoke(ADM_X);
      const byB = () =>
        revokeRole(
          new Request("http://localhost/x", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...tma(signInitData({ userId: ADM_Y })) },
            body: JSON.stringify({ confirmed: true }),
          }),
          { params: Promise.resolve({ grantId: grantOfA }) },
        );
      const [a, b] = i % 2 === 0 ? [await Promise.all([own(), byB()])][0] : (await Promise.all([byB(), own()])).reverse();
      const pair = `${a.status} ${b.status === 404 ? (await problemOf(b)).code : b.status}`;
      expect(["200 not_found", "200 200"], pair).toContain(pair);
      expect(await rows("select telegram_user_id from app.role_grants where role = 'admin' and revoked_at is null")).toEqual([{ telegram_user_id: String(ADM_Y) }]);
    }
  });
});

describe("cuenta con dos roles (criterio 43)", () => {
  async function both(id: number) {
    await addProvider(id);
    await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [id]);
  }

  it("43a: sin ser principal ni único: 200 y se borran cuenta, ambos permisos y registro", async () => {
    await addAdmin(ADM_Y);
    await both(BOTH);
    expect((await api.revoke(BOTH)).status).toBe(200);
    expect(await accountOf(BOTH)).toBeUndefined();
    expect(await rows("select 1 from app.role_grants where telegram_user_id = $1", [BOTH])).toEqual([]);
    expect(await count("provider_registrations")).toBe(0);
    expect(await rows("select 1 from app.role_grants where telegram_user_id = $1", [ADM_Y])).toHaveLength(1);
  });

  it("43b: único administrador: 409 last_admin_protected y conserva ambos roles", async () => {
    await both(BOTH);
    const before = await all();
    expect((await problemOf(await api.revoke(BOTH))).code).toBe("last_admin_protected");
    expect(await all()).toEqual(before);
  });

  it("43c: principal: 409 principal_admin_protected sin cambios", async () => {
    await addAdmin(ADM_X);
    await addProvider(PRINCIPAL, "7700035109");
    await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values ($1, 'admin', true)", [PRINCIPAL]);
    const before = await all();
    expect((await problemOf(await api.revoke(PRINCIPAL))).code).toBe("principal_admin_protected");
    expect(await all()).toEqual(before);
  });
});

describe("errores y permisos de base de datos (criterios 31, 34 y 41)", () => {
  it("31: sin initData o con firma inválida 401; sin cuenta 403 forbidden; confirmed ausente o campos extra 422", async () => {
    await addProvider(PROV);
    const before = await all();
    expect((await api.revoke(null)).status).toBe(401);
    expect((await api.revoke(PROV, { confirmed: true }, tma(signInitData({ userId: PROV, token: "9:otro" })))).status).toBe(401);
    expect((await api.revoke(PROV, { confirmed: true }, tma(signInitData({ userId: PROV, authDate: Math.floor(Date.now() / 1000) - 7 * 86400 })))).status).toBe(401);
    const noAccount = await api.revoke(VISITOR);
    expect([noAccount.status, (await problemOf(noAccount)).code]).toEqual([403, "forbidden"]);
    for (const body of [{}, { confirmed: false }, { confirmed: true, extra: 1 }]) expect((await api.revoke(PROV, body)).status).toBe(422);
    expect(await all()).toEqual(before);
  });

  it("34: ninguna cuenta recibe has_active_role", async () => {
    await addAdmin(ADM_X);
    await addAdmin(ADM_Y);
    await addProvider(PROV);
    for (const id of [PROV, ADM_X, ADM_Y, PRINCIPAL]) {
      const res = await api.revoke(id);
      if (res.status !== 200) expect(["principal_admin_protected", "last_admin_protected", "forbidden"]).toContain((await problemOf(res)).code);
    }
  });

  it("35: si la base falla, 500 genérico sin texto técnico", async () => {
    const failing = failingDb();
    const res = await makeSelfRevokeApi(failing.db).revoke(PROV);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(failing.errorText);
  });

  it("41: eje_app puede borrar en notification_outbox, accounts y role_grants; consent_events y audit_events siguen sin UPDATE ni DELETE", async () => {
    const app = new Pool({ connectionString: process.env.TEST_APP_URL });
    try {
      await owner.query("insert into app.notification_outbox (recipient_telegram_user_id, template) values (1, 't')");
      await createAccount(owner, VISITOR);
      await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [VISITOR]);
      await owner.query("insert into app.consent_events (event, channel, notice_version) values ('accepted', 'bot', $1)", [NOTICE_VERSION]);
      await owner.query("insert into app.audit_events (actor_role, action, entity_type, entity_id) values ('admin', 'x', 'y', gen_random_uuid())");
      for (const sql of ["delete from app.notification_outbox", "delete from app.role_grants", "delete from app.accounts"]) {
        expect((await app.query(sql)).rowCount, sql).toBeGreaterThan(0);
      }
      for (const [table, column] of [["consent_events", "event"], ["audit_events", "action"]]) {
        await expect(app.query(`delete from app.${table}`)).rejects.toThrow(/permission denied/);
        await expect(app.query(`update app.${table} set ${column} = ${column}`)).rejects.toThrow(/permission denied/);
        await expect(app.query(`select count(*) from app.${table}`)).resolves.toBeDefined();
      }
      await expect(app.query("insert into app.notification_outbox (recipient_telegram_user_id, template) values (2, 't')")).resolves.toBeDefined();
    } finally {
      await app.end();
    }
  });
});
