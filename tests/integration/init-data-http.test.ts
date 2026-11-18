/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebhookHandler } from "@/bot/webhook";
import type { Deps } from "@/server/http/deps";
import { getCurrentPrivacyNoticeHandler } from "@/server/http/handlers";
import { GET as healthGet } from "@/app/api/health/route";
import { createAccount } from "../factories/accounts";
import { createRegistration, grantAdminRole, makeProvider } from "../factories/review";
import { testConfig, TEST_PRINCIPAL_ADMIN_ID } from "../helpers/config";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { validateSchema } from "../helpers/openapi";
import { buildRequest, PROTECTED_OPERATIONS, responseSchemaName, routeContext, type PositiveRole, type ProtectedOperation } from "../helpers/protected-operations";
import { BOT_TOKEN, signInitData, tma } from "../helpers/telegram";

// F009: matriz por operación de los rechazos 401 por initData y de la apertura normal (contrato F009, criterios 1 a 22).
const CONSENTED = 900000802;
const NO_ACCOUNT = 900000803;
const ADMIN = 900000804;
const ACCOUNT_HOLDER = 900000805;
const EXTRA_USER = 900000806;
const PROVIDER = 900000808;
const FORGED_ID = 900000807;
const UNAUTHENTICATED_DETAIL = "No pudimos verificar tu identidad de Telegram. Abre de nuevo la Mini App.";

let owner: Pool;
const real = appDb();
const realDeps: Deps = { config: () => testConfig(), db: () => real, now: () => new Date() };
const failing = failingDb();
const failingDeps: Deps = { config: () => testConfig(), db: () => failing.db, now: () => new Date() };

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await real.destroy();
  vi.restoreAllMocks();
});
beforeEach(async () => {
  failing.queries.length = 0;
  await resetDb(owner);
  await createAccount(owner, CONSENTED);
  await createAccount(owner, ADMIN);
  await grantAdminRole(owner, ADMIN);
  await createAccount(owner, ACCOUNT_HOLDER);
  await createAccount(owner, TEST_PRINCIPAL_ADMIN_ID);
  await createAccount(owner, EXTRA_USER);
  await makeProvider(owner, PROVIDER, "9000008080");
});

const nowSeconds = () => Math.floor(Date.now() / 1000);
const call = (deps: Deps, op: ProtectedOperation, headers: Record<string, string>) => op.handler(deps)(buildRequest(op, headers), routeContext());
const problemOf = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const WRITE_TABLES = ["accounts", "consent_events", "provider_registrations", "role_grants", "audit_events", "bot_sessions"] as const;
const counts = async () => Object.fromEntries(await Promise.all(WRITE_TABLES.map(async (t) => [t, Number((await rows(`select count(*) from app.${t}`))[0].count)])));

// Cada causa de rechazo del criterio 1, 5, 6 y 14 como cabeceras.
const validInit = () => signInitData({ userId: ADMIN });
const REJECTIONS: Record<string, () => Record<string, string>> = {
  "sin cabecera Authorization": () => ({}),
  "firma de otro token (5)": () => tma(signInitData({ userId: ADMIN, token: "9:otro" })),
  "user.id cambiado al del administrador (6)": () => tma(signInitData({ userId: CONSENTED, tamperUserId: Number(TEST_PRINCIPAL_ADMIN_ID) })),
  "initData vencido, más de 24 h (14)": () => tma(signInitData({ userId: ADMIN, authDate: nowSeconds() - 86401 - 60 })),
};
const MALFORMED: Record<string, () => Record<string, string>> = {
  "tma sin valor": () => ({ Authorization: "tma" }),
  "tma con espacios": () => ({ Authorization: "tma   " }),
  "Bearer con initData válido": () => ({ Authorization: `Bearer ${validInit()}` }),
  "TMA en mayúsculas con initData válido (P6)": () => ({ Authorization: `TMA ${validInit()}` }),
  "initData sin esquema": () => ({ Authorization: validInit() }),
};

async function expect401(res: Response, label: string) {
  expect(res.status, label).toBe(401);
  expect(res.headers.get("content-type"), label).toContain("application/problem+json");
  const body = await problemOf(res);
  expect(body.code, label).toBe("unauthenticated");
  expect(validateSchema("Problem", body), label).toEqual([]);
  return body;
}

describe("F009 criterios 1, 2, 5, 6 y 14: las 33 operaciones rechazan con 401 sin consultar la base", () => {
  for (const [cause, headers] of Object.entries({ ...REJECTIONS, ...MALFORMED })) {
    describe(cause, () => {
      for (const op of PROTECTED_OPERATIONS) {
        it(`${op.operationId}`, async () => {
          await expect401(await call(failingDeps, op, headers()), `${op.operationId} / ${cause}`);
          expect(failing.queries, `${op.operationId} consultó la base`).toHaveLength(0);
        });
      }
    });
  }
});

describe("F009 criterio 4: el 401 va antes que cualquier validación y no escribe filas", () => {
  const cases: [string, ProtectedOperation["operationId"], unknown][] = [
    ["acceptPrivacyNotice con cuerpo inválido", "acceptPrivacyNotice", { accepted: "no" }],
    ["createProviderRegistration de una persona sin cuenta", "createProviderRegistration", { basura: true }],
    ["authorizeAdministrator con cuerpo inválido", "authorizeAdministrator", "{no-json"],
  ];
  for (const [name, operationId, body] of cases) {
    it(name, async () => {
      const op = PROTECTED_OPERATIONS.find((o) => o.operationId === operationId)!;
      const before = await counts();
      const res = await op.handler(realDeps)(buildRequest(op, {}, body), routeContext());
      await expect401(res, name);
      const noAccount = await op.handler(realDeps)(buildRequest(op, tma(signInitData({ userId: NO_ACCOUNT, token: "9:otro" })), body), routeContext());
      await expect401(noAccount, name);
      expect(await counts()).toEqual(before);
    });
  }
});

describe("F009 criterio 6: una initData con el ID de un administrador no cambia nada del administrador", () => {
  const snapshot = async () => ({
    account: await rows("select * from app.accounts where telegram_user_id = $1", [ADMIN]),
    grants: await rows("select * from app.role_grants order by id"),
    audit: await rows("select count(*) from app.audit_events"),
  });
  for (const operationId of ["listRoleGrants", "authorizeAdministrator", "revokeRole", "approveProviderRegistration"]) {
    it(operationId, async () => {
      const op = PROTECTED_OPERATIONS.find((o) => o.operationId === operationId)!;
      const before = await snapshot();
      const res = await op.handler(realDeps)(buildRequest(op, REJECTIONS["user.id cambiado al del administrador (6)"](), { telegramUserId: String(FORGED_ID), confirmed: true }), routeContext());
      await expect401(res, operationId);
      expect(await snapshot()).toEqual(before);
    });
  }
  it("con tamperUserId del ID del administrador la firma deja de valer en una operación real", async () => {
    const op = PROTECTED_OPERATIONS.find((o) => o.operationId === "listRoleGrants")!;
    expect((await call(realDeps, op, tma(signInitData({ userId: CONSENTED, tamperUserId: ADMIN })))).status).toBe(401);
    expect((await call(realDeps, op, tma(signInitData({ userId: ADMIN })))).status).toBe(200);
  });
});

describe("F009 criterio 11: campos extra firmados no otorgan ningún rol", () => {
  const extra = { role: "admin", is_admin: "true", start_param: "admin" };
  it("una persona sin permiso recibe 403 forbidden en una operación de administrador y su rol no cambia", async () => {
    const create = PROTECTED_OPERATIONS.find((o) => o.operationId === "createMunicipality")!;
    const headers = tma(signInitData({ userId: EXTRA_USER, extra }));
    const res = await create.handler(realDeps)(buildRequest(create, headers, { name: "Prueba", confirmed: true }), routeContext());
    expect(res.status).toBe(403);
    expect((await problemOf(res)).code).toBe("forbidden");
    const me = PROTECTED_OPERATIONS.find((o) => o.operationId === "getMe")!;
    const body = await problemOf(await call(realDeps, me, headers));
    expect(body.roles).toEqual([]);
    expect(body.telegramUserId).toBe(String(EXTRA_USER));
    expect(await rows("select * from app.role_grants where telegram_user_id = $1", [EXTRA_USER])).toHaveLength(0);
  });
});

describe("F009 criterio 14: el rechazo por vigencia no es por la cuenta", () => {
  it("la misma cuenta: vencido 401, vigente 200", async () => {
    const me = PROTECTED_OPERATIONS.find((o) => o.operationId === "getMe")!;
    await expect401(await call(realDeps, me, tma(signInitData({ userId: CONSENTED, authDate: nowSeconds() - 86401 - 60 }))), "vencido");
    expect((await call(realDeps, me, tma(signInitData({ userId: CONSENTED })))).status).toBe(200);
  });
});

const ROLE_USER: Record<PositiveRole, number> = { none: NO_ACCOUNT, account: ACCOUNT_HOLDER, consented: CONSENTED, admin: ADMIN, provider: PROVIDER };

describe("F009 criterio 15: apertura normal, ninguna operación protegida responde 401 con una persona del rol adecuado", () => {
  const table: string[] = [];
  afterAll(() => {
    process.stdout.write(`\nF009 criterio 15 (operación | rol | código)\n${table.join("\n")}\n`);
  });
  for (const op of PROTECTED_OPERATIONS) {
    it(op.operationId, async () => {
      // El prestador sin registro recibe 404; con un registro propio, getMyProviderRegistration responde 200.
      if (op.operationId === "getMyProviderRegistration") await createRegistration(owner, (await rows("select id from app.accounts where telegram_user_id = $1", [CONSENTED]))[0].id);
      const headers = tma(signInitData({ userId: ROLE_USER[op.role] }));
      const res = await op.handler(realDeps)(buildRequest(op, headers, op.hasBody ? (op.body ?? {}) : undefined), routeContext());
      table.push(`${op.operationId} | ${op.role === "none" ? "sin cuenta" : op.role === "account" ? "titular de cuenta" : op.role === "consented" ? "usuario con aviso" : op.role === "provider" ? "prestador" : "administrador"} | ${res.status}`);
      expect(res.status, op.operationId).not.toBe(401);
      expect(op.opening ? [op.opening] : [200, 201, 422], op.operationId).toContain(res.status);
      const schema = res.status === 422 || res.status === 403 ? { name: "Problem", array: false } : responseSchemaName(op.operationId, res.status);
      expect(schema, `${op.operationId} sin esquema de respuesta ${res.status}`).not.toBeNull();
      const body = await res.json();
      if (schema!.array) expect(Array.isArray(body), op.operationId).toBe(true);
      for (const item of schema!.array ? (body as unknown[]) : [body]) expect(validateSchema(schema!.name, item), op.operationId).toEqual([]);
    });
  }
});

describe("F009 criterio 16: la initData no se consume ni se guarda", () => {
  it("la misma initData sirve dos veces y getMe no crea filas", async () => {
    const me = PROTECTED_OPERATIONS.find((o) => o.operationId === "getMe")!;
    const before = await counts();
    const headers = tma(signInitData({ userId: NO_ACCOUNT }));
    expect((await call(realDeps, me, headers)).status).toBe(200);
    expect((await call(realDeps, me, headers)).status).toBe(200);
    expect(await counts()).toEqual(before);
  });
});

describe("F009 criterios 19 y 20: las excepciones públicas no piden ni interpretan initData", () => {
  const notice = getCurrentPrivacyNoticeHandler(realDeps);
  it("el aviso vigente y /api/health responden 200 sin cabecera", async () => {
    expect((await notice()).status).toBe(200);
    expect((await healthGet()).status).toBe(200);
  });
  it("el webhook responde 401 con otro secreto y no usa initData", async () => {
    const handler = createWebhookHandler({ secret: () => "test-webhook-secret", bot: async () => { throw new Error("no debe usarse"); } });
    const res = await handler(new Request("http://localhost/api/v1/telegram/webhook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "otro", ...tma(validInit()) }, body: "{}" }));
    expect(res.status).toBe(401);
  });
  it("una cabecera Authorization inválida no cambia la respuesta de la ruta pública", async () => {
    const publicNotice = notice as unknown as (request: Request) => Promise<Response>;
    const url = "http://localhost/api/v1/privacy-notices/current";
    const plain = await publicNotice(new Request(url));
    const plainText = await plain.text();
    for (const headers of [{ Authorization: "tma basura" }, tma(signInitData({ userId: ADMIN, token: "9:otro" })), { Authorization: `Bearer ${validInit()}` }]) {
      const res = await publicNotice(new Request(url, { headers }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(plainText);
    }
    expect((await (healthGet as unknown as (r: Request) => Response)(new Request("http://localhost/api/health", { headers: { Authorization: "tma basura" } }))).status).toBe(200);
  });
});

describe("F009 criterio 21: el 401 no revela la causa ni filtra datos", () => {
  it("el cuerpo es el mismo para toda causa y no contiene initData, hash, token ni textos de excepción", async () => {
    const op = PROTECTED_OPERATIONS.find((o) => o.operationId === "getMe")!;
    const bodies: string[] = [];
    for (const [cause, headers] of Object.entries({ ...REJECTIONS, ...MALFORMED })) {
      const h = headers();
      const res = await call(failingDeps, op, h);
      const text = await res.text();
      bodies.push(text);
      const parsed = JSON.parse(text);
      expect(parsed.detail, cause).toBe(UNAUTHENTICATED_DETAIL);
      const raw = h.Authorization?.split(/\s+/).pop() ?? "";
      if (raw) {
        expect(text, cause).not.toContain(raw);
        expect(text, cause).not.toContain(new URLSearchParams(raw).get("hash") ?? "no-hash");
      }
      for (const secret of [BOT_TOKEN, failing.errorText, "Error:", "at "]) expect(text, cause).not.toContain(secret);
    }
    expect(new Set(bodies).size).toBe(1);
  });
});

describe("F009 criterio 22: el rechazo no deja registros ni filas", () => {
  it("con IP y User-Agent de prueba, ni consola ni base contienen initData, hash, ID, IP ni token", async () => {
    const logs: string[] = [];
    for (const level of ["log", "warn", "error", "info", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")));
    }
    const forged = signInitData({ userId: FORGED_ID, tamperUserId: ADMIN });
    const hash = new URLSearchParams(forged).get("hash")!;
    const before = await counts();
    const extraHeaders = { "X-Forwarded-For": "203.0.113.7", "X-Real-IP": "203.0.113.7", "User-Agent": "prueba-f009" };
    for (const op of PROTECTED_OPERATIONS) {
      const res = await op.handler(realDeps)(buildRequest(op, { ...extraHeaders, ...tma(forged) }), routeContext());
      expect(res.status, op.operationId).toBe(401);
    }
    vi.restoreAllMocks();
    const noise = logs.join("\n");
    for (const secret of [forged, hash, String(FORGED_ID), String(ADMIN), "203.0.113.7", "prueba-f009", BOT_TOKEN]) {
      expect(noise).not.toContain(secret);
    }
    expect(await counts()).toEqual(before);
    for (const table of ["rate_limit_counters", "processed_updates", "notification_outbox"]) {
      expect(Number((await rows(`select count(*) from app.${table}`))[0].count), table).toBe(0);
    }
  });
});
