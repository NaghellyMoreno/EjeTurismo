import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeAdministratorHandler, createProviderRegistrationHandler, getMeHandler } from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import type { components } from "@/shared/api/schema";
import { createAccount, createOldVersionAccount, PERSON_PRINCIPAL } from "../factories/accounts";
import { createRegistration, grantAdminRole, makeProvider, namedAccount, pendingFor } from "../factories/review";
import { testConfig } from "../helpers/config";
import { appDb, countsF002, ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { registration } from "../helpers/http";
import { validateSchema } from "../helpers/openapi";
import { signInitData, tma } from "../helpers/telegram";

// F005: getMe como fuente única del menú (criterios 12 a 15, 18, 20 a 22 y 30).
const PROVIDER = 900000061;
const ADMIN = 900000062;
const NO_ROLE = 900000063;
const PENDING = 900000064;
const REJECTED = 900000065;
const OLD_NOTICE = 900000067;
const NO_ACCOUNT = 900000068;
const OTHER = 900000069;

let owner: Pool;
const db = appDb();
const deps: Deps = { config: () => testConfig(), db: () => db, now: () => new Date() };
const me = getMeHandler(deps);
const create = createProviderRegistrationHandler(deps);
const authorize = authorizeAdministratorHandler(deps);
const auth = (id: number) => tma(signInitData({ userId: id }));
const getMe = async (id: number | null, headers?: Record<string, string>) =>
  me(new Request("http://localhost/api/v1/me", { headers: headers ?? (id === null ? {} : auth(id)) }));
const meOf = async (id: number) => (await getMe(id)).json() as Promise<components["schemas"]["Me"]>;
const post = (id: number | null, body: unknown) =>
  new Request("http://localhost/api/v1/provider-registrations", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(id === null ? {} : auth(id)) },
    body: JSON.stringify(body),
  });
const count = async (table: string) => Number((await owner.query(`select count(*) from app.${table}`)).rows[0].count);

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await db.destroy();
});
beforeEach(() => resetDb(owner));
afterEach(() => vi.restoreAllMocks());

describe("criterio 21: getMe por rol, validado contra el esquema Me", () => {
  it("5 cuentas", async () => {
    await makeProvider(owner, PROVIDER);
    await createAccount(owner, ADMIN);
    await grantAdminRole(owner, ADMIN);
    await createAccount(owner, PERSON_PRINCIPAL);
    await createAccount(owner, NO_ROLE);
    await pendingFor(owner, PENDING);
    const pick = async (id: number) => {
      const body = await meOf(id);
      expect(validateSchema("Me", body)).toEqual([]);
      return { roles: body.roles, isPrincipalAdmin: body.isPrincipalAdmin, status: body.providerRegistrationStatus, can: body.canRegisterAsProvider };
    };
    expect(await pick(PROVIDER)).toEqual({ roles: ["provider"], isPrincipalAdmin: false, status: "approved", can: false });
    expect(await pick(ADMIN)).toEqual({ roles: ["admin"], isPrincipalAdmin: false, status: "none", can: false });
    expect(await pick(PERSON_PRINCIPAL)).toEqual({ roles: ["admin"], isPrincipalAdmin: true, status: "none", can: false });
    expect(await pick(NO_ROLE)).toEqual({ roles: [], isPrincipalAdmin: false, status: "none", can: true });
    expect(await pick(PENDING)).toEqual({ roles: [], isPrincipalAdmin: false, status: "pending", can: false });
  });
});

describe("criterio 5: el rol se lee en cada llamada", () => {
  it("con el permiso provider revocado getMe responde roles vacío", async () => {
    await makeProvider(owner, PROVIDER);
    expect((await meOf(PROVIDER)).roles).toEqual(["provider"]);
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1", [PROVIDER]);
    expect((await meOf(PROVIDER)).roles).toEqual([]);
  });
});

describe("criterios 12 a 14: el administrador no crea registro por HTTP", () => {
  const valid = registration("CC", "1020304050");

  it("12: permiso y principal responden 403 sin filas nuevas; sin initData, 401", async () => {
    await createAccount(owner, ADMIN);
    await grantAdminRole(owner, ADMIN);
    await createAccount(owner, PERSON_PRINCIPAL);
    const before = await countsF002(owner);
    for (const id of [ADMIN, PERSON_PRINCIPAL]) {
      const res = await create(post(id, valid));
      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect((await res.json()).code).toBe("admin_cannot_register_as_provider");
    }
    expect((await create(post(null, valid))).status).toBe(401);
    expect(await countsF002(owner)).toEqual(before);
  });

  it.each([{ confirmed: true }, { identityDocumentType: "TI", identityNumber: "1", confirmed: true }])("13: cuerpo inválido %j responde 403 y no 422", async (body) => {
    await createAccount(owner, ADMIN);
    await grantAdminRole(owner, ADMIN);
    const res = await create(post(ADMIN, body));
    expect(res.status).toBe(403);
    expect(await count("provider_registrations")).toBe(0);
  });

  it("14: una cuenta con registro rechazado que luego es administradora tampoco registra", async () => {
    await pendingFor(owner, REJECTED, { status: "rejected" });
    await grantAdminRole(owner, REJECTED);
    const before = await countsF002(owner);
    expect((await create(post(REJECTED, valid))).status).toBe(403);
    expect(await countsF002(owner)).toEqual(before);
  });
});

describe("criterio 15: una cuenta con registro pendiente no llega a ser administradora", () => {
  it("authorizeAdministrator responde 409 role_conflict y getMe sigue como pendiente", async () => {
    await createAccount(owner, ADMIN);
    await grantAdminRole(owner, ADMIN);
    await pendingFor(owner, PENDING);
    const res = await authorize(
      new Request("http://localhost/api/v1/role-grants", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth(ADMIN) },
        body: JSON.stringify({ telegramUserId: String(PENDING), confirmed: true }),
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("role_conflict");
    const body = await meOf(PENDING);
    expect(body.roles).toEqual([]);
    expect(body.providerRegistrationStatus).toBe("pending");
  });
});

describe("criterios 17 y 18: pendiente y rechazado", () => {
  it("17: pendiente no puede registrarse", async () => {
    await pendingFor(owner, PENDING);
    expect(await meOf(PENDING)).toMatchObject({ roles: [], providerRegistrationStatus: "pending", canRegisterAsProvider: false });
  });

  it("18: rechazado puede registrarse de nuevo y el registro nuevo responde 201", async () => {
    const { accountId } = await pendingFor(owner, REJECTED, { status: "rejected" });
    expect(await meOf(REJECTED)).toMatchObject({ roles: [], providerRegistrationStatus: "rejected", canRegisterAsProvider: true });
    const res = await create(post(REJECTED, registration("CE", "5544332211")));
    expect(res.status).toBe(201);
    expect(await count("provider_registrations")).toBe(2);
    expect(await meOf(REJECTED)).toMatchObject({ providerRegistrationStatus: "pending", canRegisterAsProvider: false });
    expect(accountId).toBeTruthy();
  });
});

describe("criterio 20: sin aviso vigente", () => {
  it("getMe responde consent.required, sin roles ni registro, sin crear filas", async () => {
    await createOldVersionAccount(owner, OLD_NOTICE);
    await createRegistration(owner, (await owner.query("select id from app.accounts")).rows[0].id, { status: "approved" });
    const before = await countsF002(owner);
    for (const id of [NO_ACCOUNT, OLD_NOTICE]) {
      const res = await getMe(id);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(validateSchema("Me", body)).toEqual([]);
      expect(body.consent.required).toBe(true);
      expect(body).toMatchObject({ roles: [], providerRegistrationStatus: "none", canRegisterAsProvider: false });
    }
    expect(await countsF002(owner)).toEqual(before);
  });
});

describe("criterio 22: identidad solo del initData", () => {
  it("sin initData 401; con initData de otra cuenta, solo sus datos", async () => {
    await makeProvider(owner, PROVIDER);
    await namedAccount(owner, OTHER);
    expect((await getMe(null)).status).toBe(401);
    const res = await me(new Request(`http://localhost/api/v1/me?roles=provider&telegramUserId=${PROVIDER}`, { headers: auth(OTHER) }));
    const body = await res.json();
    expect(body.telegramUserId).toBe(String(OTHER));
    expect(body.roles).toEqual([]);
  });
});

describe("criterio 30: errores de la base", () => {
  it("getMe responde 500 genérico application/problem+json", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fake = failingDb("fallo-interno-secreto role_grants");
    const res = await getMeHandler({ ...deps, db: () => fake.db })(new Request("http://localhost/api/v1/me", { headers: auth(PROVIDER) }));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await res.text()).not.toContain("fallo-interno-secreto");
  });
});
