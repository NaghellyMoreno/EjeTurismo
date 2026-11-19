/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/actor";
import type { Deps } from "@/server/http/deps";
import { authenticate, getMeHandler, withProviderGuard } from "@/server/http/handlers";
import { fromError, json } from "@/server/http/problem";
import { assertAdmin } from "@/server/services/provider-review";
import { testConfig, TEST_PRINCIPAL_ADMIN_ID } from "../helpers/config";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { validateSchema } from "../helpers/openapi";
import { responseSchemaName } from "../helpers/protected-operations";
import {
  ADMIN_OPERATION_IDS,
  ADMIN_TEST,
  changedTables,
  contextFor,
  NEW_ADMIN_ID,
  operationOf,
  PENDING_OTHER,
  PENDING_OWNER,
  PERSON_IDS,
  PERSON_KEYS,
  PROVIDER_CONTROL,
  ROLE_CASES,
  ROUTED_OPERATION_IDS,
  ROLE_DENIAL_OPERATIONS,
  roleCaseOf,
  roleContext,
  roleRequest,
  SECRET_IDENTITY_NUMBER,
  SECRET_MUNICIPALITY_NAME,
  SECRET_REGISTRATION_NAME,
  seedRoleDenial,
  snapshotAll,
  type PersonKey,
  type RoleCase,
  type RoleFixtures,
} from "../helpers/role-denial";
import { BOT_TOKEN, signInitData, tma } from "../helpers/telegram";

// F007: sin identidad válida, un visitante o un registro pendiente no ejecutan acciones de rol (contrato F007, criterios 1 a 17).
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let fx: RoleFixtures;
const real = appDb();
const sent: string[] = [];
const deps: Deps = { config: () => testConfig(), db: () => real, now: () => new Date(), send: async (chatId) => void sent.push(chatId) };
const failing = failingDb();
const failingDeps: Deps = { config: () => testConfig(), db: () => failing.db, now: () => new Date() };

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await real.destroy();
});
beforeEach(async () => {
  failing.queries.length = 0;
  sent.length = 0;
  afterTasks.length = 0;
  await resetDb(owner);
  fx = await seedRoleDenial(owner);
});

const initFor = (userId: number) => tma(signInitData({ userId }));
const SIGN_FAILURES: Record<string, () => Record<string, string>> = {
  "sin cabecera Authorization": () => ({}),
  "firma de otro token": () => tma(signInitData({ userId: ADMIN_TEST, token: "9:otro" })),
  "user.id cambiado por el del administrador principal": () => tma(signInitData({ userId: ADMIN_TEST, tamperUserId: TEST_PRINCIPAL_ADMIN_ID })),
};

const run = (rc: RoleCase, headers: Record<string, string>, variant: "valid" | "empty" = "valid", d: Deps = deps) =>
  operationOf(rc.operationId).handler(d)(roleRequest(fx, rc, headers, variant), contextFor(fx, rc, variant));
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rowCount = async (sql: string, params: unknown[] = []) => Number((await owner.query(sql, params)).rows[0].count);

const hasRoute = ROLE_DENIAL_OPERATIONS.filter((e) => e.hasRoute);
const executed = new Set<string>();

describe("paso 1: sin identidad válida (criterios 1 a 3)", () => {
  it("1 y 2: 27 operaciones x 3 variantes dan 401 unauthenticated y no cambian ninguna tabla (81 casos)", async () => {
    expect(hasRoute.map((e) => e.operationId).sort()).toEqual([...ROUTED_OPERATION_IDS].sort());
    let cases = 0;
    for (const entry of hasRoute) {
      const rc = roleCaseOf(entry.operationId);
      for (const [variant, headers] of Object.entries(SIGN_FAILURES)) {
        const before = await snapshotAll(owner);
        const res = await run(rc, headers());
        const label = `${entry.operationId} / ${variant}`;
        expect(res.status, label).toBe(401);
        expect(res.headers.get("content-type"), label).toContain("application/problem+json");
        expect((await body(res)).code, label).toBe("unauthenticated");
        expect(changedTables(before, await snapshotAll(owner)), `${label}: tablas que cambiaron`).toEqual([]);
        cases++;
      }
    }
    expect(cases).toBe(81);
  });

  it("3: aprobar o rechazar sin cabecera da 401; el registro sigue pending y no hay filas nuevas", async () => {
    const approve = roleCaseOf("approveProviderRegistration");
    const reject = { ...roleCaseOf("rejectProviderRegistration"), resource: "registrationId" as const };
    const before = await snapshotAll(owner);
    expect((await run(approve, {})).status).toBe(401);
    expect((await run(reject, {})).status).toBe(401);
    expect(await rowCount("select count(*) from app.provider_registrations where id = $1 and status = 'pending'", [fx.ids.registrationId])).toBe(1);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    for (const t of ["role_grants", "audit_events", "notification_outbox"]) expect(before[t].count).toBe((await snapshotAll(owner))[t].count);
    expect(sent).toEqual([]);
  });
});

describe("paso 2: visitante y registro pendiente (criterios 4 a 10)", () => {
  it("4 a 6 y 8: 28 casos x A1 a A5, con cuerpo válido y vacío; mismo código, sin cambios y sin filtrar datos (280 casos)", async () => {
    const table: Array<{ operacion: string; persona: string; esperado: string; obtenido: string }> = [];
    const secrets = [
      SECRET_REGISTRATION_NAME, SECRET_MUNICIPALITY_NAME, SECRET_IDENTITY_NUMBER,
      String(ADMIN_TEST), String(PENDING_OWNER), String(PENDING_OTHER), String(TEST_PRINCIPAL_ADMIN_ID), NEW_ADMIN_ID, "Establecimiento Ficticio Uno",
    ];
    for (const rc of ROLE_CASES) {
      const entry = hasRoute.find((e) => e.operationId === rc.operationId)!;
      for (const person of PERSON_KEYS) {
        const expected = entry.deniedPersons[person];
        const headers = initFor(PERSON_IDS[person]);
        const results: Record<string, string> = {};
        for (const variant of ["valid", "empty"] as const) {
          const before = await snapshotAll(owner);
          const res = await run(rc, headers, variant);
          const text = await res.text();
          const label = `${entry.operationId}${rc.kind ? ` (${rc.kind})` : ""} / ${person} / ${variant}`;
          const json = JSON.parse(text) as Record<string, any>;
          expect({ status: res.status, code: json.code }, label).toEqual(expected);
          expect(res.headers.get("content-type"), label).toContain("application/problem+json");
          expect(changedTables(before, await snapshotAll(owner)), `${label}: tablas que cambiaron`).toEqual([]);
          for (const secret of secrets) expect(text, `${label}: filtra ${secret}`).not.toContain(secret);
          results[variant] = `${res.status} ${json.code}`;
        }
        expect(results.empty, `${entry.operationId} / ${person}: vacío igual que válido`).toBe(results.valid);
        table.push({ operacion: `${entry.operationId}${rc.kind ? ` (${rc.kind})` : ""}`, persona: person, esperado: `${expected.status} ${expected.code}`, obtenido: results.valid });
        executed.add(`${entry.operationId}:${person}`);
      }
    }
    console.table(table);
    expect(table).toHaveLength(140);
    expect(table.filter((r) => r.esperado !== r.obtenido)).toEqual([]);
  });

  it("la matriz ejecutó cada operación con ruta contra A1 a A5 (criterio 15, tercera afirmación)", () => {
    const expected = hasRoute.flatMap((e) => PERSON_KEYS.map((p) => `${e.operationId}:${p}`));
    expect([...executed].sort()).toEqual(expected.sort());
  });

  it("7: pasos nombrados con A2 y A4", async () => {
    const a2 = initFor(PERSON_IDS.A2);
    const create = roleCaseOf("createMunicipality");
    expect((await run(create, a2)).status).toBe(403);
    expect(await rowCount("select count(*) from app.municipalities where name = $1", [create.body!.name])).toBe(0);
    const authorize = roleCaseOf("authorizeAdministrator");
    expect((await run(authorize, a2)).status).toBe(403);
    expect(await rowCount("select count(*) from app.role_grants where telegram_user_id = $1 and role = 'admin'", [NEW_ADMIN_ID])).toBe(0);
    const own = { ...roleCaseOf("approveProviderRegistration"), resource: "registrationId" as const };
    const res = await operationOf(own.operationId).handler(deps)(
      roleRequest({ ...fx, ids: { ...fx.ids, registrationId: fx.a4RegistrationId } }, own, initFor(PERSON_IDS.A4)),
      roleContext(fx.a4RegistrationId),
    );
    expect(res.status).toBe(403);
    expect(await rowCount("select count(*) from app.provider_registrations where id = $1 and status = 'pending'", [fx.a4RegistrationId])).toBe(1);
  });

  it("9: el rol no sale de initData ni del cuerpo (A2 con role=admin e is_admin=true)", async () => {
    const headers = tma(signInitData({ userId: PERSON_IDS.A2, extra: { role: "admin", is_admin: "true" } }));
    for (const id of ["createMunicipality", "authorizeAdministrator"]) {
      const rc = roleCaseOf(id);
      const forged: RoleCase = { ...rc, body: { ...rc.body, role: "admin", telegramUserId: String(TEST_PRINCIPAL_ADMIN_ID) } };
      const before = await snapshotAll(owner);
      const res = await run(forged, headers);
      expect(res.status, id).toBe(403);
      expect((await body(res)).code, id).toBe("forbidden");
      expect(changedTables(before, await snapshotAll(owner)), id).toEqual([]);
    }
  });

  it("10: control positivo (administrador de prueba o prestador A6 según el caso), 28 filas con el código exacto de la tabla", async () => {
    const table: Array<{ orden: number; operacion: string; esperado: number; obtenido: number }> = [];
    for (const [i, rc] of ROLE_CASES.entries()) {
      const res = await run(rc, initFor(rc.positiveActor ?? ADMIN_TEST));
      table.push({ orden: i + 1, operacion: `${rc.operationId}${rc.kind ? ` (${rc.kind})` : ""}`, esperado: rc.positive, obtenido: res.status });
    }
    console.table(table);
    expect(table).toHaveLength(28);
    expect(table.filter((r) => r.esperado !== r.obtenido)).toEqual([]);
  });
});

describe("paso 3: registro pendiente (criterios 11 y 12)", () => {
  const getMe = async (userId: number) => {
    const res = await getMeHandler(deps)(new Request("http://localhost/api/v1/me", { headers: initFor(userId) }));
    return { status: res.status, json: await body(res) };
  };

  it("11: A4 no obtiene permisos por tener un registro pendiente, antes ni después de los 280 casos", async () => {
    const schema = responseSchemaName("getMe", 200)!.name;
    const before = await getMe(PERSON_IDS.A4);
    expect(before.status).toBe(200);
    expect(validateSchema(schema, before.json)).toEqual([]);
    expect(before.json.roles).toEqual([]);
    expect(before.json.providerRegistrationStatus).toBe("pending");
    for (const entry of hasRoute) {
      const rc = roleCaseOf(entry.operationId);
      for (const variant of ["valid", "empty"] as const) await run(rc, initFor(PERSON_IDS.A4), variant);
    }
    const after = await getMe(PERSON_IDS.A4);
    expect(validateSchema(schema, after.json)).toEqual([]);
    expect(after.json.roles).toEqual([]);
    expect(after.json.providerRegistrationStatus).toBe("pending");
    expect(await rowCount("select count(*) from app.role_grants where telegram_user_id = $1", [PERSON_IDS.A4])).toBe(0);
  });

  it("12: tras aprobar a A4 es prestador, pero sigue sin acceso a las 14 operaciones de administrador", async () => {
    const approve = roleCaseOf("approveProviderRegistration");
    const decision = await operationOf(approve.operationId).handler(deps)(
      roleRequest({ ...fx, ids: { ...fx.ids, registrationId: fx.a4RegistrationId } }, approve, initFor(ADMIN_TEST)),
      roleContext(fx.a4RegistrationId),
    );
    expect(decision.status).toBe(200);
    const me = await getMe(PERSON_IDS.A4);
    expect(me.json.roles).toEqual(["provider"]);
    expect(me.json.providerRegistrationStatus).toBe("approved");
    // Las operaciones de prestador (F013) sí le corresponden; aquí solo las de administrador y el atractivo.
    for (const entry of hasRoute.filter((e) => ADMIN_OPERATION_IDS.includes(e.operationId) || e.operationId === "createListing")) {
      const rc = roleCaseOf(entry.operationId);
      const res = await run(rc, initFor(PERSON_IDS.A4));
      expect({ status: res.status, code: (await body(res)).code }, entry.operationId).toEqual({ status: 403, code: "forbidden" });
    }
  });
});

describe("rutas que aún no existen: rutas de muestra definidas solo en tests/ (criterios 13 y 14)", () => {
  let calls = 0;
  beforeEach(() => void (calls = 0));
  const writeRow = async () => {
    calls++;
    await owner.query("insert into app.categories (name, name_normalized) values ($1, $1)", [`fila de muestra ${calls}`]);
    return json({ ok: true });
  };
  const providerSample = (d: Deps) => withProviderGuard(d, async () => writeRow());
  // Representa "aprobar una ficha" (approveListingVersion): protegida por assertAdmin.
  const adminSample = (d: Deps) => async (request: Request) => {
    try {
      const actor = authenticate(request, d);
      if (actor instanceof Response) return actor;
      await assertAdmin(d.db(), d.config(), actor as Actor);
      return await writeRow();
    } catch (error) {
      const known = fromError(error);
      if (known) return known;
      throw error;
    }
  };
  const samples = { prestador: providerSample, administrador: adminSample };
  const req = (headers: Record<string, string>) => new Request("http://localhost/muestra", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" });

  for (const [name, make] of Object.entries(samples)) {
    it(`13: ruta de muestra de ${name}: A1 a A5 reciben el 403 esperado, el handler no corre y nada cambia`, async () => {
      for (const person of PERSON_KEYS as PersonKey[]) {
        const before = await snapshotAll(owner);
        const res = await make(deps)(req(initFor(PERSON_IDS[person])));
        expect({ status: res.status, code: (await body(res)).code }, `${name} / ${person}`).toEqual(ROLE_DENIAL_OPERATIONS[0].deniedPersons[person]);
        expect(changedTables(before, await snapshotAll(owner)), `${name} / ${person}`).toEqual([]);
      }
      expect(calls).toBe(0);
    });

    it(`13: ruta de muestra de ${name}: sin cabecera, firma alterada y vencido dan 401 sin consultar la base`, async () => {
      const expired = tma(signInitData({ userId: ADMIN_TEST, authDate: Math.floor(Date.now() / 1000) - 10 * 24 * 3600 }));
      for (const headers of [{}, tma(signInitData({ userId: ADMIN_TEST, token: "9:otro" })), expired, tma(signInitData({ userId: ADMIN_TEST, token: BOT_TOKEN, tamperUserId: 1 }))]) {
        const res = await make(failingDeps)(req(headers));
        expect(res.status).toBe(401);
        expect((await body(res)).code).toBe("unauthenticated");
      }
      expect(failing.queries).toHaveLength(0);
      expect(calls).toBe(0);
    });
  }

  it("14: control positivo, el prestador activo y el administrador de prueba llegan al handler una vez cada uno", async () => {
    const p = await providerSample(deps)(req(initFor(PROVIDER_CONTROL)));
    expect(p.status).toBe(200);
    expect(calls).toBe(1);
    const a = await adminSample(deps)(req(initFor(ADMIN_TEST)));
    expect(a.status).toBe(200);
    expect(calls).toBe(2);
    expect(await rowCount("select count(*) from app.categories where name like 'fila de muestra%'")).toBe(2);
  });
});

describe("complemento del criterio 5: con rol, un ID inexistente sí llega al 404", () => {
  it("el administrador de prueba obtiene 404; por eso el 403 de A1 a A5 con ID inexistente no revela si el recurso existe", async () => {
    const rc: RoleCase = { ...roleCaseOf("updateMunicipality"), resource: undefined };
    const res = await run(rc, initFor(ADMIN_TEST), "valid");
    expect(res.status).toBe(404);
  });
});
