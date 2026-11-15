/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createProviderRegistrationHandler, authorizeAdministratorHandler, getMeHandler, listProviderRegistrationsHandler, acceptPrivacyNoticeHandler } from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { authorizeAdministrator, ensurePrincipalGrant } from "@/server/services";
import { ownerPool, resetDb, NOTICE_VERSION } from "../helpers/db";
import { TEST_PRINCIPAL_ADMIN_ID, testConfig } from "../helpers/config";
import { failingDb } from "../helpers/failing-db";
import { ISO_UTC } from "../helpers/http";
import { validateSchema } from "../helpers/openapi";
import { appDb } from "../helpers/db";
import { signInitData, tma } from "../helpers/telegram";
import { createAccount, PERSON_PRINCIPAL } from "../factories/accounts";
import {
  account, ADMIN_A, ADMIN_B, admin, NAME, NO_ACCOUNT_NO_GRANT, NO_ROLE, OLD_NOTICE, OLD_PRINCIPAL, PERSON_NO_ACCOUNT,
  PERSON_WITH_ACCOUNT, provider, REVOKED_ADMIN, seedAll, WITH_PENDING, WITH_PROVIDER, WITH_REJECTED,
} from "../factories/admin-auth";

let owner: Pool;
let appPool: Pool;
const db = appDb();
const deps: Deps = { config: () => testConfig(), db: () => db, now: () => new Date() };
const authorize = authorizeAdministratorHandler(deps);
const me = getMeHandler(deps);
const logs: string[] = [];
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const snapshot = async () => ({ grants: await count("role_grants"), audit: await count("audit_events") });

const post = (userId: number | null, body: unknown, headers?: Record<string, string>) =>
  new Request("http://localhost/api/v1/role-grants", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? (userId === null ? {} : tma(signInitData({ userId })))) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const ok = (telegramUserId: unknown, confirmed: unknown = true) => ({ telegramUserId, confirmed });
const json = async (res: Response) => (await res.json()) as Record<string, any>;
const meOf = async (userId: number) => json(await me(new Request("http://localhost/api/v1/me", { headers: tma(signInitData({ userId })) })));

beforeAll(() => {
  owner = ownerPool();
  appPool = new Pool({ connectionString: process.env.TEST_APP_URL, max: 2 });
  for (const level of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  await owner.end();
  await appPool.end();
  await db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  logs.length = 0;
});
afterEach(async () => {
  for (const table of ["role_grants", "audit_events"]) await owner.query(`drop trigger if exists test_fail on app.${table}`);
});

describe("autorizar por HTTP (criterios 12, 13, 15)", () => {
  it.each([
    ["ID sin cuenta", PERSON_NO_ACCOUNT, null],
    ["ID con cuenta", PERSON_WITH_ACCOUNT, NAME(PERSON_WITH_ACCOUNT)],
  ])("%s: 201 con RoleGrant válido, una fila y una traza sin el ID", async (_label, target, displayName) => {
    const adminAccount = await admin(owner, ADMIN_A);
    await account(owner, PERSON_WITH_ACCOUNT);
    const before = Date.now();
    const res = await authorize(post(ADMIN_A, ok(String(target))));
    const after = Date.now();
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(validateSchema("RoleGrant", body)).toEqual([]);
    expect(body).toMatchObject({ telegramUserId: String(target), role: "admin", isPrincipal: false, displayName, grantedBy: { role: "admin", displayName: NAME(ADMIN_A) } });
    expect(body.grantedAt).toMatch(ISO_UTC);
    expect(body.revokedAt ?? null).toBeNull();

    const grant = (await rows("select * from app.role_grants where telegram_user_id = $1", [target]))[0];
    expect(grant).toMatchObject({ role: "admin", is_principal: false, provider_registration_id: null, granted_by_account_id: adminAccount, revoked_at: null });
    expect(grant.id).toBe(body.id);
    expect(grant.granted_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(grant.granted_at.getTime()).toBeLessThanOrEqual(after + 1000);

    const audit = await rows("select * from app.audit_events");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "role_grant.admin_authorized", entity_type: "role_grant", entity_id: grant.id, actor_account_id: adminAccount, actor_role: "admin" });
    expect(audit[0].occurred_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(JSON.stringify(audit[0])).not.toContain(String(target));
    expect(JSON.stringify(audit[0].details)).not.toContain(NAME(PERSON_WITH_ACCOUNT));
  });

  it("el principal autoriza sin fila propia en role_grants; queda como responsable", async () => {
    const principal = await createAccount(owner, TEST_PRINCIPAL_ADMIN_ID, "Persona Principal");
    const res = await authorize(post(TEST_PRINCIPAL_ADMIN_ID, ok("900000052")));
    expect(res.status).toBe(201);
    expect((await rows("select granted_by_account_id from app.role_grants where telegram_user_id = 900000052"))[0].granted_by_account_id).toBe(principal);
  });

  it("con eje_app, UPDATE y DELETE sobre audit_events fallan", async () => {
    await admin(owner, ADMIN_A);
    await authorize(post(ADMIN_A, ok("900000053")));
    await expect(appPool.query("update app.audit_events set action = 'x'")).rejects.toThrow();
    await expect(appPool.query("delete from app.audit_events")).rejects.toThrow();
  });
});

describe("validación (criterio 14)", () => {
  it.each([
    ["confirmed ausente", { telegramUserId: "900000052" }],
    ["confirmed false", ok("900000052", false)],
    ["confirmed texto", ok("900000052", "true")],
    ["propiedad no declarada", { ...ok("900000052"), extra: 1 }],
    ["ID ausente", { confirmed: true }],
    ["vacío", ok("")],
    ["abc", ok("abc")],
    ["0", ok("0")],
    ["012", ok("012")],
    ["-5", ok("-5")],
    ["12.5", ok("12.5")],
    ["1 2", ok("1 2")],
    ["17 dígitos", ok("12345678901234567")],
    ["numérico", ok(900000052)],
    ["cuerpo no JSON", "no es json"],
    ["arreglo", []],
  ])("%s responde 422 sin crear nada", async (_label, body) => {
    await admin(owner, ADMIN_A);
    const before = await snapshot();
    const res = await authorize(post(ADMIN_A, body));
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect((await json(res)).code).toBe("validation_failed");
    expect(await snapshot()).toEqual(before);
  });

  it("un ID de 16 dígitos es válido", async () => {
    await admin(owner, ADMIN_A);
    expect((await authorize(post(ADMIN_A, ok("9999999999999999")))).status).toBe(201);
  });
});

describe("acceso (criterios 26 y 27)", () => {
  it("sin Authorization o con firma inválida: 401 sin consultar la base", async () => {
    const fake = failingDb();
    const handler = authorizeAdministratorHandler({ ...deps, db: () => fake.db });
    expect((await handler(post(null, ok("900000052")))).status).toBe(401);
    const bad = tma(signInitData({ userId: ADMIN_A, token: "999:otro-token" }));
    expect((await handler(post(ADMIN_A, ok("900000052"), bad))).status).toBe(401);
    expect(fake.queries).toHaveLength(0);
  });

  it("403 por consentimiento y por rol; el principal sin fila responde 201; nada se crea fuera del 201", async () => {
    await seedAll(owner);
    await createAccount(owner, TEST_PRINCIPAL_ADMIN_ID, "Persona Principal");
    const before = await snapshot();
    const cases: [number, string][] = [
      [NO_ACCOUNT_NO_GRANT, "consent_required"],
      [OLD_NOTICE, "consent_required"],
      [NO_ROLE, "forbidden"],
      [WITH_PENDING, "forbidden"],
      [WITH_PROVIDER, "forbidden"],
      [REVOKED_ADMIN, "forbidden"],
    ];
    for (const [id, code] of cases) {
      const res = await authorize(post(id, ok("900000053")));
      expect(res.status, String(id)).toBe(403);
      expect((await json(res)).code).toBe(code);
    }
    expect(await snapshot()).toEqual(before);
    expect((await authorize(post(TEST_PRINCIPAL_ADMIN_ID, ok("900000053")))).status).toBe(201);
  });

  it("orden de comprobaciones: 401, consent_required, forbidden, 422, duplicate, role_conflict", async () => {
    await seedAll(owner);
    // 401 antes que todo.
    expect((await authorize(post(null, "no json"))).status).toBe(401);
    // consent_required antes que forbidden y 422.
    let res = await authorize(post(OLD_NOTICE, ok("abc", false)));
    expect([res.status, (await json(res)).code]).toEqual([403, "consent_required"]);
    // forbidden antes que 422.
    res = await authorize(post(NO_ROLE, ok("abc", false)));
    expect([res.status, (await json(res)).code]).toEqual([403, "forbidden"]);
    // 422 antes que 409 duplicate (ya es administrador, pero sin confirmar).
    res = await authorize(post(ADMIN_A, { telegramUserId: String(ADMIN_B) }));
    expect(res.status).toBe(422);
    res = await authorize(post(ADMIN_A, { telegramUserId: "abc" }));
    expect(res.status).toBe(422);
    // duplicate antes que role_conflict: ID con permisos admin y provider activos a la vez (dato sembrado inconsistente).
    await owner.query("alter table app.role_grants disable trigger role_grants_check_provider");
    await owner.query("insert into app.role_grants (telegram_user_id, role, provider_registration_id) select $1, 'provider', provider_registration_id from app.role_grants where telegram_user_id = $2 and role = 'provider'", [ADMIN_B, WITH_PROVIDER]);
    await owner.query("alter table app.role_grants enable trigger role_grants_check_provider");
    res = await authorize(post(ADMIN_A, ok(String(ADMIN_B))));
    expect([res.status, (await json(res)).code]).toEqual([409, "duplicate"]);
    res = await authorize(post(ADMIN_A, ok(String(WITH_PROVIDER))));
    expect([res.status, (await json(res)).code]).toEqual([409, "role_conflict"]);
  });
});

describe("duplicados y conflictos (criterios 20 a 23)", () => {
  it("ya es administrador (otro, el mismo que autoriza y el principal con o sin fila): 409 duplicate sin cambios", async () => {
    await seedAll(owner);
    const before = await snapshot();
    for (const target of [ADMIN_B, ADMIN_A, TEST_PRINCIPAL_ADMIN_ID]) {
      const res = await authorize(post(ADMIN_A, ok(String(target))));
      expect(res.status, String(target)).toBe(409);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect((await json(res)).code).toBe("duplicate");
    }
    await ensurePrincipalGrant(db, testConfig(), String(TEST_PRINCIPAL_ADMIN_ID));
    expect((await authorize(post(ADMIN_A, ok(String(TEST_PRINCIPAL_ADMIN_ID))))).status).toBe(409);
    expect(await snapshot()).toEqual({ grants: before.grants + 1, audit: before.audit });
  });

  it("dos administradores que autorizan el mismo ID a la vez: un 201, un 409, una fila y una traza", async () => {
    await seedAll(owner);
    const before = await snapshot();
    const results = await Promise.all([authorize(post(ADMIN_A, ok("900000070"))), authorize(post(ADMIN_B, ok("900000070")))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await snapshot()).toEqual({ grants: before.grants + 1, audit: before.audit + 1 });
  });

  it("un permiso admin revocado no cuenta como duplicado: 201 con una fila nueva", async () => {
    await seedAll(owner);
    const res = await authorize(post(ADMIN_A, ok(String(REVOKED_ADMIN))));
    expect(res.status).toBe(201);
    expect(await rows("select 1 from app.role_grants where telegram_user_id = $1", [REVOKED_ADMIN])).toHaveLength(2);
  });

  it("permiso provider activo o registro pending: 409 role_conflict; rejected sí se autoriza", async () => {
    await seedAll(owner);
    const before = await snapshot();
    for (const target of [WITH_PROVIDER, WITH_PENDING]) {
      const res = await authorize(post(ADMIN_A, ok(String(target))));
      expect([res.status, (await json(res)).code], String(target)).toEqual([409, "role_conflict"]);
    }
    expect(await snapshot()).toEqual(before);
    expect((await authorize(post(ADMIN_A, ok(String(WITH_REJECTED))))).status).toBe(201);
  });
});

describe("fallos (criterio 16)", () => {
  it.each(["role_grants", "audit_events"])("fallo al insertar en %s: 500 genérico y sin filas", async (table) => {
    await seedAll(owner);
    const before = await snapshot();
    await owner.query("create or replace function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo-inyectado-secreto'; end $$");
    await owner.query(`create trigger test_fail before insert on app.${table} for each row execute function app.test_fail()`);
    const res = await authorize(post(ADMIN_A, ok("900000071")));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const text = JSON.stringify(await json(res));
    for (const word of ["fallo-inyectado-secreto", "role_grants", "audit_events", "app."]) expect(text).not.toContain(word);
    expect(await snapshot()).toEqual(before);
    expect(logs.join("\n")).not.toContain("900000071");
  });
});

describe("administrador principal y getMe (criterios 2 a 5, 17 a 19)", () => {
  it("ensurePrincipalGrant crea una sola fila is_principal y es idempotente", async () => {
    const config = testConfig();
    await ensurePrincipalGrant(db, config, String(TEST_PRINCIPAL_ADMIN_ID));
    await ensurePrincipalGrant(db, config, String(TEST_PRINCIPAL_ADMIN_ID));
    const grants = await rows("select * from app.role_grants");
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ role: "admin", is_principal: true, revoked_at: null, provider_registration_id: null, granted_by_account_id: null });
    // Otro ID no obtiene fila.
    await ensurePrincipalGrant(db, config, "900000055");
    expect(await count("role_grants")).toBe(1);
  });

  it("con la fila is_principal de otro ID (principal anterior) no hay error ni segunda fila principal", async () => {
    await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values ($1, 'admin', true)", [OLD_PRINCIPAL]);
    await ensurePrincipalGrant(db, testConfig(), String(TEST_PRINCIPAL_ADMIN_ID));
    expect(await rows("select telegram_user_id from app.role_grants where is_principal")).toHaveLength(1);
    // El guardián sigue reconociendo al nuevo principal por la configuración.
    await createAccount(owner, TEST_PRINCIPAL_ADMIN_ID, "Persona Principal");
    expect((await json(await listProviderRegistrationsHandler(deps)(new Request("http://localhost/x", { headers: tma(signInitData({ userId: TEST_PRINCIPAL_ADMIN_ID })) })))).items).toEqual([]);
  });

  it("aceptar el aviso por HTTP y por el servicio también deja la fila del principal", async () => {
    const res = await acceptPrivacyNoticeHandler(deps)(
      new Request("http://localhost/api/v1/consents", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tma(signInitData({ userId: TEST_PRINCIPAL_ADMIN_ID })) },
        body: JSON.stringify({ noticeVersion: NOTICE_VERSION, accepted: true }),
      }),
    );
    expect(res.status).toBe(201);
    expect((await json(res)).roles).toEqual(["admin"]);
    expect(await count("role_grants")).toBe(1);
  });

  it("getMe: el principal es admin con y sin fila; otra cuenta sin rol no", async () => {
    await createAccount(owner, TEST_PRINCIPAL_ADMIN_ID, "Persona Principal");
    await account(owner, NO_ROLE);
    expect(await count("role_grants")).toBe(0);
    expect(await meOf(TEST_PRINCIPAL_ADMIN_ID)).toMatchObject({ roles: ["admin"], isPrincipalAdmin: true });
    await ensurePrincipalGrant(db, testConfig(), String(TEST_PRINCIPAL_ADMIN_ID));
    expect(await meOf(TEST_PRINCIPAL_ADMIN_ID)).toMatchObject({ roles: ["admin"] });
    expect(await meOf(NO_ROLE)).toMatchObject({ roles: [], isPrincipalAdmin: false });
    await createAccount(owner, PERSON_PRINCIPAL + 1, "Otra");
    expect((await meOf(PERSON_PRINCIPAL + 1)).roles).toEqual([]);
  });

  it("cadena de autorizaciones: la cuenta autorizada es admin, pasa el guardián y no puede registrarse como prestador", async () => {
    await admin(owner, ADMIN_A);
    await account(owner, PERSON_WITH_ACCOUNT);
    expect((await authorize(post(ADMIN_A, ok(String(PERSON_WITH_ACCOUNT))))).status).toBe(201);
    expect(await meOf(PERSON_WITH_ACCOUNT)).toMatchObject({ roles: ["admin"] });
    expect((await authorize(post(PERSON_WITH_ACCOUNT, ok("900000072")))).status).toBe(201);
    const register = await createProviderRegistrationHandler(deps)(
      new Request("http://localhost/api/v1/provider-registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tma(signInitData({ userId: PERSON_WITH_ACCOUNT })) },
        body: JSON.stringify({ identityDocumentType: "CC", identityNumber: "1020304050", confirmed: true }),
      }),
    );
    expect(register.status).toBe(403);
    expect((await json(register)).code).toBe("admin_cannot_register_as_provider");
    expect(await count("provider_registrations")).toBe(0);
  });

  it("autorizada antes de aceptar el aviso (D-037): el permiso no se usa hasta aceptar", async () => {
    await admin(owner, ADMIN_A);
    expect((await authorize(post(ADMIN_A, ok(String(PERSON_NO_ACCOUNT))))).status).toBe(201);
    const denied = await authorize(post(PERSON_NO_ACCOUNT, ok("900000072")));
    expect([denied.status, (await json(denied)).code]).toEqual([403, "consent_required"]);
    expect((await meOf(PERSON_NO_ACCOUNT)).roles).toEqual([]);
    await account(owner, PERSON_NO_ACCOUNT);
    expect((await meOf(PERSON_NO_ACCOUNT)).roles).toEqual(["admin"]);
  });
});

describe("base de datos con eje_app (criterio 32)", () => {
  it("restricciones de role_grants", async () => {
    await seedAll(owner);
    const insert = (id: string, role: string, principal: boolean, registration: string | null = null) =>
      appPool.query("insert into app.role_grants (telegram_user_id, role, is_principal, provider_registration_id) values ($1, $2, $3, $4)", [id, role, principal, registration]);
    await expect(insert("900000080", "admin", false)).resolves.toBeDefined();
    await expect(insert("900000081", "provider", false)).rejects.toThrow();
    await expect(insert("900000082", "admin", true)).resolves.toBeDefined();
    await expect(insert("900000083", "admin", true)).rejects.toThrow();
    await expect(insert("900000084", "provider", true)).rejects.toThrow();
    await expect(insert("900000080", "admin", false)).rejects.toThrow();
  });
});

describe("servicio directo", () => {
  it("rechaza sin administrador y no registra nada con el ID autorizado", async () => {
    await account(owner, NO_ROLE);
    await expect(authorizeAdministrator(db, testConfig(), { telegramUserId: String(NO_ROLE), displayName: "x" }, ok("900000053"))).rejects.toMatchObject({ code: "forbidden" });
    await provider(owner, WITH_PROVIDER);
    expect(await count("role_grants")).toBe(1);
  });
});
