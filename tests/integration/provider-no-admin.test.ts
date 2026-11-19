/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/actor";
import type { Deps } from "@/server/http/deps";
import { authenticate, getMeHandler } from "@/server/http/handlers";
import { fromError, json } from "@/server/http/problem";
import { assertAdmin } from "@/server/services/provider-review";
import { testConfig } from "../helpers/config";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { validateSchema } from "../helpers/openapi";
import { adminOnlyOperations, PROVIDER_A6, PROVIDER_A6B, A6_IDENTITY_NUMBER, seedA6b } from "../helpers/provider-denial";
import { responseSchemaName } from "../helpers/protected-operations";
import {
  ADMIN_OTHER,
  ADMIN_TEST,
  changedTables,
  contextFor,
  NEW_ADMIN_ID,
  operationOf,
  PENDING_OWNER,
  ADMIN_OPERATION_IDS,
  HISTORY_OPERATION_ID,
  REVIEW_OPERATION_IDS,
  ROLE_CASES,
  roleCaseOf,
  roleRequest,
  SECRET_IDENTITY_NUMBER,
  SECRET_MUNICIPALITY_NAME,
  SECRET_REGISTRATION_NAME,
  seedRoleDenial,
  snapshotAll,
  type RoleCase,
  type RoleFixtures,
} from "../helpers/role-denial";
import { signInitData, tma } from "../helpers/telegram";

// F008: un prestador autorizado no ejecuta acciones de administrador (contrato F008, criterios 1 a 12).
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let fx: RoleFixtures;
const real = appDb();
const sent: string[] = [];
const deps: Deps = { config: () => testConfig(), db: () => real, now: () => new Date(), send: async (chatId) => void sent.push(chatId) };

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await real.destroy();
});
beforeEach(async () => {
  sent.length = 0;
  afterTasks.length = 0;
  await resetDb(owner);
  fx = await seedRoleDenial(owner);
  await seedA6b(owner);
});

const initFor = (userId: number, extra?: Record<string, string>) => tma(signInitData({ userId, extra }));
const run = (rc: RoleCase, headers: Record<string, string>, variant: "valid" | "empty" = "valid") =>
  operationOf(rc.operationId).handler(deps)(roleRequest(fx, rc, headers, variant), contextFor(fx, rc, variant));
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const count = async (sql: string, params: unknown[] = []) => Number((await owner.query(sql, params)).rows[0].count);
const one = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows[0];
const expectForbidden = async (res: Response, label: string) => {
  expect(res.status, label).toBe(403);
  expect(res.headers.get("content-type"), label).toContain("application/problem+json");
  expect((await body(res)).code, label).toBe("forbidden");
};

const adminOnly = adminOnlyOperations();
const executed = new Set<string>();

describe("paso 1: autorizar un ID como administrador (criterios 1 y 2)", () => {
  it("1: A6 autoriza otro ID, a sí mismo y con cuerpo vacío: 403 forbidden, sin permisos nuevos y getMe igual", async () => {
    const authorize = roleCaseOf("authorizeAdministrator");
    const a6 = initFor(PROVIDER_A6);
    const before = await snapshotAll(owner);
    const bodies: Array<Record<string, unknown>> = [
      { telegramUserId: NEW_ADMIN_ID, confirmed: true },
      { telegramUserId: String(PROVIDER_A6), confirmed: true },
      {},
    ];
    for (const b of bodies) {
      const res = await run({ ...authorize, body: b }, a6, b.confirmed ? "valid" : "empty");
      await expectForbidden(res, JSON.stringify(b));
    }
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect(await count("select count(*) from app.role_grants where role = 'admin' and telegram_user_id in ($1, $2)", [PROVIDER_A6, NEW_ADMIN_ID])).toBe(0);
    const me = await getMeHandler(deps)(new Request("http://localhost/api/v1/me", { headers: a6 }));
    const json = await body(me);
    expect(json.roles).toEqual(["provider"]);
    expect(validateSchema(responseSchemaName("getMe", 200)!.name, json)).toEqual([]);
  });

  it("2: el rol no sale de initData ni del cuerpo (role=admin e is_admin=true)", async () => {
    const headers = initFor(PROVIDER_A6, { role: "admin", is_admin: "true" });
    for (const id of ["authorizeAdministrator", "createMunicipality"]) {
      const rc = roleCaseOf(id);
      const forged: RoleCase = { ...rc, body: { role: "admin", telegramUserId: "900000099", name: "Municipio Intruso", confirmed: true } };
      const before = await snapshotAll(owner);
      await expectForbidden(await run(forged, headers), id);
      expect(changedTables(before, await snapshotAll(owner)), id).toEqual([]);
    }
  });
});

describe("paso 2: crear municipio y categoría (criterio 3)", () => {
  it("3: las 4 creaciones y los 4 renombrados dan 403 y no cambian los nombres", async () => {
    const a6 = initFor(PROVIDER_A6);
    const creates = ["createMunicipality", "createCategory", "createExperienceType", "createEstablishmentType"];
    const updates = ["updateMunicipality", "updateCategory", "updateExperienceType", "updateEstablishmentType"];
    for (const id of [...creates, ...updates]) await expectForbidden(await run(roleCaseOf(id), a6), id);
    for (const [table, name] of [
      ["municipalities", "Municipio Control Uno"], ["categories", "Categoria Control Uno"],
      ["experience_types", "Experiencia Control Uno"], ["establishment_types", "Establecimiento Control Uno"],
    ]) expect(await count(`select count(*) from app.${table} where name = $1`, [name]), name).toBe(0);
    for (const [table, name] of [
      ["municipalities", SECRET_MUNICIPALITY_NAME], ["categories", "Categoria Ficticia"],
      ["experience_types", "Experiencia Ficticia"], ["establishment_types", "Establecimiento Ficticio"],
    ]) expect(await count(`select count(*) from app.${table} where name = $1`, [name]), name).toBe(1);
  });
});

describe("paso 3: aprobar su propia ficha pendiente, a nivel de guardián (criterios 4 a 6; análogos, el literal es de F014)", () => {
  it("4: A6 aprueba y rechaza su propio registro y el de 900007021: 4 x 403, nada cambia", async () => {
    const own = await one("select id, decided_at from app.provider_registrations where account_id = (select id from app.accounts where telegram_user_id = $1)", [PROVIDER_A6]);
    const other = await one("select id, decided_at from app.provider_registrations where account_id = (select id from app.accounts where telegram_user_id = $1)", [PENDING_OWNER]);
    const before = await snapshotAll(owner);
    const a6 = initFor(PROVIDER_A6);
    const approve = roleCaseOf("approveProviderRegistration");
    const reject = roleCaseOf("rejectProviderRegistration");
    for (const [target, name] of [[own.id, "propio"], [other.id, "ajeno"]] as const) {
      for (const rc of [approve, reject]) {
        const request = roleRequest({ ...fx, ids: { ...fx.ids, registrationId: target, secondRegistrationId: target } }, rc, a6);
        const res = await operationOf(rc.operationId).handler(deps)(request, { params: Promise.resolve({ registrationId: target }) });
        await expectForbidden(res, `${rc.operationId} / ${name}`);
      }
    }
    const ownAfter = await one("select status, decided_at from app.provider_registrations where id = $1", [own.id]);
    expect(ownAfter.status).toBe("approved");
    expect(ownAfter.decided_at).toEqual(own.decided_at);
    const otherAfter = await one("select status, decided_at from app.provider_registrations where id = $1", [other.id]);
    expect(otherAfter.status).toBe("pending");
    expect(otherAfter.decided_at).toEqual(other.decided_at);
    const after = await snapshotAll(owner);
    for (const t of ["role_grants", "audit_events", "notification_outbox"]) expect(after[t].count, t).toBe(before[t].count);
    expect(changedTables(before, after)).toEqual([]);
  });

  it("5: A6 revoca su propio permiso provider y el admin de 900007002: 403 y revoked_at sigue nulo", async () => {
    const own = await one("select id, revoked_at from app.role_grants where telegram_user_id = $1 and role = 'provider'", [PROVIDER_A6]);
    const admin = await one("select id, revoked_at from app.role_grants where telegram_user_id = $1 and role = 'admin'", [ADMIN_OTHER]);
    const rc = roleCaseOf("revokeRole");
    for (const grant of [own, admin]) {
      const request = roleRequest({ ...fx, ids: { ...fx.ids, grantId: grant.id } }, rc, initFor(PROVIDER_A6));
      const res = await operationOf(rc.operationId).handler(deps)(request, { params: Promise.resolve({ grantId: grant.id }) });
      await expectForbidden(res, grant.id);
    }
    for (const grant of [own, admin]) {
      const after = await one("select revoked_at from app.role_grants where id = $1", [grant.id]);
      expect(after.revoked_at).toBeNull();
      expect(grant.revoked_at).toBeNull();
    }
  });

  describe("6: ruta de muestra de administrador (representa approveListingVersion; definida solo en tests/)", () => {
    let calls = 0;
    beforeEach(() => void (calls = 0));
    const sample = (d: Deps) => async (request: Request) => {
      try {
        const actor = authenticate(request, d);
        if (actor instanceof Response) return actor;
        await assertAdmin(d.db(), d.config(), actor as Actor);
        calls++; // espía del handler
        await owner.query("update app.provider_registrations set status = 'approved' where id = $1", [fx.ids.registrationId]);
        return json({ ok: true });
      } catch (error) {
        const known = fromError(error);
        if (known) return known;
        throw error;
      }
    };
    const req = (headers: Record<string, string>) => new Request("http://localhost/muestra", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" });

    it("A6 recibe forbidden y A6b consent_required; el handler no corre, el registro sigue pending y nada cambia", async () => {
      for (const [person, code] of [[PROVIDER_A6, "forbidden"], [PROVIDER_A6B, "consent_required"]] as const) {
        const before = await snapshotAll(owner);
        const res = await sample(deps)(req(initFor(person)));
        expect({ status: res.status, code: (await body(res)).code }, String(person)).toEqual({ status: 403, code });
        expect(changedTables(before, await snapshotAll(owner)), String(person)).toEqual([]);
      }
      expect(calls).toBe(0);
      expect(await count("select count(*) from app.provider_registrations where id = $1 and status = 'pending'", [fx.ids.registrationId])).toBe(1);
    });

    it("control positivo: el administrador de prueba llega al handler una vez y el registro pasa a approved", async () => {
      const res = await sample(deps)(req(initFor(ADMIN_TEST)));
      expect(res.status).toBe(200);
      expect(calls).toBe(1);
      expect(await count("select count(*) from app.provider_registrations where id = $1 and status = 'approved'", [fx.ids.registrationId])).toBe(1);
    });
  });
});

describe("matriz de las 19 operaciones (14 de F003 a F011, las 4 de revisión de F014 y la de historial de F029; criterios 7 a 10)", () => {
  it("7 a 9: A6 con cuerpo válido y vacío da 403 forbidden, sin cambios y sin filtrar datos (38 casos)", async () => {
    const table: Array<{ operacion: string; variante: string; obtenido: string }> = [];
    const secrets = [
      SECRET_REGISTRATION_NAME, SECRET_MUNICIPALITY_NAME, SECRET_IDENTITY_NUMBER, A6_IDENTITY_NUMBER,
      String(PENDING_OWNER), String(ADMIN_OTHER),
    ];
    const a6 = initFor(PROVIDER_A6);
    for (const entry of adminOnly) {
      const rc = roleCaseOf(entry.operationId);
      for (const variant of ["valid", "empty"] as const) {
        const before = await snapshotAll(owner);
        const res = await run(rc, a6, variant);
        const text = await res.text();
        const label = `${entry.operationId} / ${variant}`;
        const parsed = JSON.parse(text) as Record<string, any>;
        expect(res.headers.get("content-type"), label).toContain("application/problem+json");
        expect(changedTables(before, await snapshotAll(owner)), `${label}: tablas que cambiaron`).toEqual([]);
        for (const secret of secrets) expect(text, `${label}: filtra ${secret}`).not.toContain(secret);
        table.push({ operacion: entry.operationId, variante: variant, obtenido: `${res.status} ${parsed.code}` });
        executed.add(entry.operationId);
      }
    }
    console.table(table);
    expect(table).toHaveLength(38);
    expect(table.filter((r) => r.obtenido !== "403 forbidden")).toEqual([]);
  });

  it("10: A6b (aviso anterior) da 403 consent_required en las 19 operaciones x 2 variantes y no cambia nada", async () => {
    const table: Array<{ operacion: string; variante: string; obtenido: string }> = [];
    const a6b = initFor(PROVIDER_A6B);
    for (const entry of adminOnly) {
      const rc = roleCaseOf(entry.operationId);
      for (const variant of ["valid", "empty"] as const) {
        const before = await snapshotAll(owner);
        const res = await run(rc, a6b, variant);
        table.push({ operacion: entry.operationId, variante: variant, obtenido: `${res.status} ${(await body(res)).code}` });
        expect(changedTables(before, await snapshotAll(owner)), `${entry.operationId} / ${variant}`).toEqual([]);
      }
    }
    console.table(table);
    expect(table).toHaveLength(38);
    expect(table.filter((r) => r.obtenido !== "403 consent_required")).toEqual([]);
  });

  it("11: control positivo, A6 es un prestador sano que sí lee lo suyo y los catálogos", async () => {
    const a6 = initFor(PROVIDER_A6);
    const me = await getMeHandler(deps)(new Request("http://localhost/api/v1/me", { headers: a6 }));
    const meJson = await body(me);
    expect(me.status).toBe(200);
    expect(meJson.roles).toEqual(["provider"]);
    expect(meJson.providerRegistrationStatus).toBe("approved");
    expect(validateSchema(responseSchemaName("getMe", 200)!.name, meJson)).toEqual([]);
    for (const operationId of ["getMyProviderRegistration", "listMunicipalities", "listCategories", "listExperienceTypes", "listEstablishmentTypes"]) {
      expect((await fetchHandler(operationId, a6)).status, operationId).toBe(200);
    }
  });

  it("12: la matriz ejecutó exactamente las 19 operaciones de solo administrador, con caso en ROLE_CASES", () => {
    const derived = adminOnly.map((e) => e.operationId).sort();
    expect(derived).toHaveLength(19);
    expect(derived, "operaciones de solo administrador vs ADMIN_OPERATION_IDS, las 4 de F014 y la de F029").toEqual([...ADMIN_OPERATION_IDS, ...REVIEW_OPERATION_IDS, HISTORY_OPERATION_ID].sort());
    // F012, F013 y F014: ROLE_CASES suma `createListing` (dos casos), las 4 operaciones de fichas gestionadas y las 4 de revisión y la de historial (25 elementos).
    const expected = [...derived, "createListing", "createListing", "listManagedListings", "getManagedListing", "saveListingDraft", "submitListingForReview"];
    expect(ROLE_CASES.map((c) => c.operationId).sort(), "ROLE_CASES").toEqual(expected.sort());
    const missing = derived.filter((id) => !executed.has(id));
    const extra = [...executed].filter((id) => !derived.includes(id));
    expect(missing, `operaciones que la matriz no ejecutó: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `operaciones que la matriz ejecutó de más: ${extra.join(", ")}`).toEqual([]);
  });
});

async function fetchHandler(operationId: string, headers: Record<string, string>): Promise<Response> {
  const op = operationOf(operationId);
  return op.handler(deps)(new Request(`http://localhost${op.path}`, { method: op.method, headers }), { params: Promise.resolve({}) });
}
