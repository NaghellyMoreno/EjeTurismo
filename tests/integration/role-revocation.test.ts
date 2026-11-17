import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeAdministratorHandler,
  createProviderRegistrationHandler,
  getMeHandler,
  listRoleGrantsHandler,
  revokeRoleHandler,
} from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { assertProvider, revokeRole } from "@/server/services";
import type { components } from "@/shared/api/schema";
import {
  ADMIN_A, ADMIN_B, ADMIN_NO_ACCOUNT, admin, grantId, IDENTITY_NUMBER, NO_ROLE, nameOf, OLD_NOTICE, oldNoticePerson, PENDING,
  pendingPerson, person, PRINCIPAL, principal, PROVIDER_A, PROVIDER_B, provider, REVOKED_ADMIN, revokedAdmin, snapshot, UNKNOWN_GRANT,
} from "../factories/revocation";
import { testConfig } from "../helpers/config";
import { appDb, NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { validateSchema } from "../helpers/openapi";
import { makeReviewApi, decisionRequest, listRequest, route } from "../helpers/review-http";
import { signInitData, tma } from "../helpers/telegram";

type Me = components["schemas"]["Me"];

let owner: Pool;
let app: Pool;
const db = appDb();
// Reloj real: el initData firmado de prueba usa la hora actual. Las fechas se comparan con tolerancia de 5 segundos (criterio 12).
const deps: Deps = { config: () => testConfig(), db: () => db, now: () => new Date() };
const nearNow = (value: Date | string) => Math.abs(new Date(value).getTime() - Date.now()) <= 5000;
const revoke = revokeRoleHandler(deps);
const list = listRoleGrantsHandler(deps);
const me = getMeHandler(deps);
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const auth = (id: number) => tma(signInitData({ userId: id }));
const actorOf = (id: number) => ({ telegramUserId: String(id), displayName: null });

const revokeReq = (id: string, userId: number | null, body: unknown = { confirmed: true }, headers?: Record<string, string>) =>
  new Request(`http://localhost/api/v1/role-grants/${id}/revocation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? (userId === null ? {} : auth(userId))) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const doRevoke = (id: string, userId: number | null, body?: unknown, headers?: Record<string, string>, handler = revoke) =>
  handler(revokeReq(id, userId, body, headers), { params: Promise.resolve({ grantId: id }) });
const doList = (userId: number | null, query = "", headers?: Record<string, string>) =>
  list(new Request(`http://localhost/api/v1/role-grants${query}`, { headers: headers ?? (userId === null ? {} : auth(userId)) }));
const meOf = async (id: number) => (await me(new Request("http://localhost/api/v1/me", { headers: auth(id) }))).json() as Promise<Me>;

beforeAll(() => {
  owner = ownerPool();
  app = new Pool({ connectionString: process.env.TEST_APP_URL, max: 2 });
});
afterAll(async () => {
  await owner.end();
  await app.end();
  await db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
});
afterEach(async () => {
  for (const table of ["role_grants", "audit_events", "notification_outbox"]) await owner.query(`drop trigger if exists test_fail on app.${table}`);
});

async function failOn(table: string, event: "insert" | "update") {
  await owner.query("create or replace function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo-inyectado-secreto'; end $$");
  await owner.query(`create trigger test_fail before ${event} on app.${table} for each row execute function app.test_fail()`);
}

// Dos administradores, un prestador y las demás cuentas del contrato.
async function seed() {
  await admin(owner, ADMIN_A);
  await admin(owner, ADMIN_B);
  await provider(owner, PROVIDER_A);
  await provider(owner, PROVIDER_B);
  await person(owner, NO_ROLE);
  await pendingPerson(owner, PENDING);
  await oldNoticePerson(owner, OLD_NOTICE);
}

const problemOf = async (res: Response) => {
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  return (await res.json()) as { status: number; code: string; detail: string };
};

describe("revocar a un prestador (criterios 12 a 16)", () => {
  it("13 y 14: 200 con el RoleGrant, traza única sin datos personales y quién, cuándo y a quién", async () => {
    await seed();
    const id = await grantId(owner, PROVIDER_A, "provider");
    const res = await doRevoke(id, ADMIN_A);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validateSchema("RoleGrant", body)).toEqual([]);
    expect(body).toMatchObject({ id, role: "provider", revokedBy: { role: "admin", displayName: nameOf(ADMIN_A) } });
    expect(nearNow(body.revokedAt)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(IDENTITY_NUMBER);
    expect(JSON.stringify(body)).not.toMatch(/identity|document/i);

    const audit = await rows("select * from app.audit_events");
    expect(audit).toHaveLength(1);
    const adminAccount = (await rows("select id from app.accounts where telegram_user_id = $1", [ADMIN_A]))[0].id;
    expect(audit[0]).toMatchObject({
      action: "role_grant.revoked", entity_type: "role_grant", entity_id: id, actor_account_id: adminAccount, actor_role: "admin", details: { role: "provider" },
    });
    const grant = (await rows("select * from app.role_grants where id = $1", [id]))[0];
    expect(nearNow(grant.revoked_at)).toBe(true);
    expect(audit[0].occurred_at.toISOString()).toBe(grant.revoked_at.toISOString());
    expect(grant.revoked_by_account_id).toBe(adminAccount);
    expect(String(grant.telegram_user_id)).toBe(String(PROVIDER_A));
  });

  it("15: no cambia nada más (registro, cuenta, sesiones, consentimientos, número cifrado) ni avisa (40)", async () => {
    await seed();
    const tables = ["provider_registrations", "accounts", "bot_sessions", "consent_events", "notification_outbox"];
    const before = await snapshot(owner, tables);
    expect((await doRevoke(await grantId(owner, PROVIDER_A, "provider"), ADMIN_A)).status).toBe(200);
    expect(await snapshot(owner, tables)).toEqual(before);
    expect((await rows("select status from app.provider_registrations r join app.accounts a on a.id = r.account_id where a.telegram_user_id = $1", [PROVIDER_A]))[0].status).toBe("approved");
  });

  it("16: con un fallo al escribir la traza el permiso sigue activo y no queda traza", async () => {
    await seed();
    const id = await grantId(owner, PROVIDER_A, "provider");
    await failOn("audit_events", "insert");
    const res = await doRevoke(id, ADMIN_A);
    expect(res.status).toBe(500);
    expect(await rows("select * from app.audit_events")).toHaveLength(0);
    expect((await rows("select revoked_at from app.role_grants where id = $1", [id]))[0].revoked_at).toBeNull();
  });

  it("39: un fallo de la base responde 500 genérico y sin datos técnicos", async () => {
    const failing = failingDb();
    const handler = revokeRoleHandler({ ...deps, db: () => failing.db });
    const res = await doRevoke(UNKNOWN_GRANT, ADMIN_A, undefined, undefined, handler);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain(failing.errorText);
    expect(text).not.toMatch(/role_grants|audit_events|select /);
    const listRes = await listRoleGrantsHandler({ ...deps, db: () => failing.db })(new Request("http://localhost/api/v1/role-grants", { headers: auth(ADMIN_A) }));
    expect(listRes.status).toBe(500);
  });
});

describe("el prestador revocado pierde el acceso de inmediato (criterios 17 a 19)", () => {
  it("17: getMe responde roles vacíos tras la revocación, sin reiniciar nada", async () => {
    await seed();
    expect((await meOf(PROVIDER_A)).roles).toEqual(["provider"]);
    await doRevoke(await grantId(owner, PROVIDER_A, "provider"), ADMIN_A);
    const after = await meOf(PROVIDER_A);
    expect(after.roles).toEqual([]);
    expect(after.providerRegistrationStatus).toBe("approved");
  });

  it("18: assertProvider acepta al prestador activo y rechaza con 403 al revocado, al sin rol y al administrador", async () => {
    await seed();
    await expect(assertProvider(db, actorOf(PROVIDER_B))).resolves.toBeTruthy();
    await doRevoke(await grantId(owner, PROVIDER_A, "provider"), ADMIN_A);
    for (const id of [PROVIDER_A, NO_ROLE, ADMIN_B]) {
      await expect(assertProvider(db, actorOf(id)), String(id)).rejects.toMatchObject({ status: 403, code: "forbidden" });
    }
  });

  it("19: el permiso se lee en cada llamada, sin caché", async () => {
    await seed();
    await expect(assertProvider(db, actorOf(PROVIDER_A))).resolves.toBeTruthy();
    await doRevoke(await grantId(owner, PROVIDER_A, "provider"), ADMIN_A);
    await expect(assertProvider(db, actorOf(PROVIDER_A))).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("revocar a un administrador (criterios 21 a 25)", () => {
  it("21 y 22: queda sin rol y getMe lo refleja; traza con el rol admin", async () => {
    await seed();
    const id = await grantId(owner, ADMIN_B, "admin");
    expect((await doRevoke(id, ADMIN_A)).status).toBe(200);
    expect((await rows("select details from app.audit_events"))[0].details).toEqual({ role: "admin" });
    const after = await meOf(ADMIN_B);
    expect(after.roles).toEqual([]);
    expect(after.isPrincipalAdmin).toBe(false);
  });

  it("23: el administrador revocado recibe 403 en las seis operaciones", async () => {
    await seed();
    await doRevoke(await grantId(owner, ADMIN_B, "admin"), ADMIN_A);
    const review = makeReviewApi();
    try {
      const target = await grantId(owner, PROVIDER_A, "provider");
      const authorize = authorizeAdministratorHandler(deps);
      const responses = [
        await review.list(listRequest(ADMIN_B)),
        await review.approve(decisionRequest("approval", UNKNOWN_GRANT, ADMIN_B, { confirmed: true }), route(UNKNOWN_GRANT)),
        await review.reject(decisionRequest("rejection", UNKNOWN_GRANT, ADMIN_B, { confirmed: true }), route(UNKNOWN_GRANT)),
        await authorize(
          new Request("http://localhost/api/v1/role-grants", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...auth(ADMIN_B) },
            body: JSON.stringify({ telegramUserId: "900000078", confirmed: true }),
          }),
        ),
        await doList(ADMIN_B),
        await doRevoke(target, ADMIN_B),
      ];
      for (const res of responses) expect(res.status).toBe(403);
      expect((await rows("select * from app.role_grants where revoked_at is not null")).length).toBe(1);
    } finally {
      await review.destroy();
    }
  });

  it("25: un administrador puede revocarse a sí mismo si hay otro y no es el principal; no puede repetirlo", async () => {
    await seed();
    const id = await grantId(owner, ADMIN_B, "admin");
    const res = await doRevoke(id, ADMIN_B);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revokedBy.displayName).toBe(body.displayName);
    expect((await doRevoke(id, ADMIN_B)).status).toBe(403);
  });
});

describe("reglas protegidas (criterios 26 a 31)", () => {
  it.each([[true], [false]])("26: revocar al principal responde 409 principal_admin_protected (fila is_principal: %s) y nada cambia", async (withRow) => {
    await admin(owner, ADMIN_A);
    if (withRow) await principal(owner, true);
    else {
      await person(owner, PRINCIPAL);
      await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [PRINCIPAL]);
    }
    const id = await grantId(owner, PRINCIPAL, "admin");
    const before = await snapshot(owner);
    const res = await doRevoke(id, ADMIN_A);
    expect(res.status).toBe(409);
    const body = await problemOf(res);
    expect(body.code).toBe("principal_admin_protected");
    expect(body.detail).toContain("administrador principal");
    expect(await snapshot(owner)).toEqual(before);
  });

  it("28: el principal que intenta revocarse a sí mismo recibe lo mismo", async () => {
    await principal(owner, true);
    await admin(owner, ADMIN_A);
    const before = await snapshot(owner);
    const body = await problemOf(await doRevoke(await grantId(owner, PRINCIPAL, "admin"), PRINCIPAL));
    expect(body.code).toBe("principal_admin_protected");
    expect(await snapshot(owner)).toEqual(before);
  });

  it("29 y 30: el único administrador que no es el principal responde 409 last_admin_protected, incluso a sí mismo y con otro revocado", async () => {
    await admin(owner, ADMIN_A);
    await revokedAdmin(owner, REVOKED_ADMIN);
    await person(owner, PRINCIPAL);
    const id = await grantId(owner, ADMIN_A, "admin");
    const before = await snapshot(owner);
    const res = await doRevoke(id, ADMIN_A);
    expect(res.status).toBe(409);
    const body = await problemOf(res);
    expect(body.code).toBe("last_admin_protected");
    expect(body.detail).toContain("sin administradores");
    expect(await snapshot(owner)).toEqual(before);
    // El principal (por su ID) sigue entrando como administrador y recibe lo mismo.
    expect((await problemOf(await doRevoke(id, PRINCIPAL))).code).toBe("last_admin_protected");
  });

  describe("31: orden de las comprobaciones", () => {
    const unchanged = async (run: () => Promise<Response>) => {
      const before = await snapshot(owner);
      const res = await run();
      expect(await snapshot(owner)).toEqual(before);
      return res;
    };

    it("(a) sin initData da 401", async () => {
      await seed();
      const id = await grantId(owner, PROVIDER_A, "provider");
      expect((await unchanged(() => doRevoke(id, null))).status).toBe(401);
    });

    it("(b) administrador con aviso anterior da 403 consent_required", async () => {
      await seed();
      const id = await grantId(owner, PROVIDER_A, "provider");
      await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [OLD_NOTICE]);
      const res = await unchanged(() => doRevoke(id, OLD_NOTICE));
      expect(res.status).toBe(403);
      expect((await problemOf(res)).code).toBe("consent_required");
    });

    it("(c) prestador activo da 403 forbidden, también con cuerpo inválido", async () => {
      await seed();
      const id = await grantId(owner, PROVIDER_B, "provider");
      for (const body of [{ confirmed: true }, { confirmed: "x", otro: 1 }, "no-json"]) {
        const res = await unchanged(() => doRevoke(id, PROVIDER_A, body));
        expect(res.status).toBe(403);
        expect((await problemOf(res)).code).toBe("forbidden");
      }
    });

    it("(d) y (e) confirmed ausente da 422, con grantId existente o inexistente", async () => {
      await seed();
      const id = await grantId(owner, PROVIDER_A, "provider");
      for (const target of [id, UNKNOWN_GRANT]) expect((await unchanged(() => doRevoke(target, ADMIN_A, {}))).status).toBe(422);
    });

    it("(f) y (g) permiso inexistente o ya revocado da 404", async () => {
      await seed();
      await revokedAdmin(owner, REVOKED_ADMIN);
      expect((await unchanged(() => doRevoke(UNKNOWN_GRANT, ADMIN_A))).status).toBe(404);
      expect((await unchanged(async () => doRevoke(await grantId(owner, REVOKED_ADMIN, "admin", false), ADMIN_A))).status).toBe(404);
    });

    it("(h) dos administradores activos, objetivo el principal: principal_admin_protected", async () => {
      await admin(owner, ADMIN_A);
      await principal(owner, true);
      const res = await unchanged(async () => doRevoke(await grantId(owner, PRINCIPAL, "admin"), ADMIN_A));
      expect((await problemOf(res)).code).toBe("principal_admin_protected");
    });

    it("(i) el principal como único administrador activo, objetivo él mismo: principal_admin_protected y no last_admin_protected", async () => {
      await principal(owner, true);
      const res = await unchanged(async () => doRevoke(await grantId(owner, PRINCIPAL, "admin"), PRINCIPAL));
      expect((await problemOf(res)).code).toBe("principal_admin_protected");
    });

    it("(j) único administrador activo que no es el principal: last_admin_protected", async () => {
      await admin(owner, ADMIN_A);
      await person(owner, PRINCIPAL);
      const res = await unchanged(async () => doRevoke(await grantId(owner, ADMIN_A, "admin"), ADMIN_A));
      expect((await problemOf(res)).code).toBe("last_admin_protected");
    });
  });
});

describe("control de acceso, datos inválidos y errores (criterios 32 a 38)", () => {
  it("32: sin initData, con firma inválida o vencido responde 401 problem+json en ambas operaciones", async () => {
    await seed();
    const id = await grantId(owner, PROVIDER_A, "provider");
    const old = Math.floor(Date.now() / 1000) - 10 * 24 * 3600;
    const variants: (Record<string, string> | undefined)[] = [
      undefined,
      tma(signInitData({ userId: ADMIN_A, token: "999:otro-token" })),
      tma(signInitData({ userId: ADMIN_A, authDate: old })),
    ];
    const before = await snapshot(owner);
    for (const headers of variants) {
      for (const res of [await doList(null, "", headers ?? {}), await doRevoke(id, null, undefined, headers ?? {})]) {
        expect(res.status).toBe(401);
        expect((await problemOf(res)).code).toBe("unauthenticated");
      }
    }
    expect(await snapshot(owner)).toEqual(before);
  });

  it("33: con el aviso anterior responde 403 consent_required en ambas", async () => {
    await seed();
    await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [OLD_NOTICE]);
    for (const res of [await doList(OLD_NOTICE), await doRevoke(await grantId(owner, PROVIDER_A, "provider"), OLD_NOTICE)]) {
      expect(res.status).toBe(403);
      expect((await problemOf(res)).code).toBe("consent_required");
    }
  });

  it("34: prestador, sin rol y registro pendiente reciben 403 forbidden en ambas", async () => {
    await seed();
    const id = await grantId(owner, PROVIDER_B, "provider");
    const before = await snapshot(owner);
    for (const user of [PROVIDER_A, NO_ROLE, PENDING]) {
      for (const res of [await doList(user), await doRevoke(id, user)]) {
        expect(res.status, String(user)).toBe(403);
        expect((await problemOf(res)).code).toBe("forbidden");
      }
    }
    expect(await snapshot(owner)).toEqual(before);
  });

  it("35: confirmed ausente o false, campos extra y grantId que no es UUID responden 422 con el campo", async () => {
    await seed();
    const id = await grantId(owner, PROVIDER_A, "provider");
    const before = await snapshot(owner);
    const cases: [string, unknown, string][] = [
      [id, {}, "confirmed"],
      [id, { confirmed: false }, "confirmed"],
      [id, { confirmed: true, extra: 1 }, "extra"],
      [id, "no-json", "body"],
      ["no-es-uuid", { confirmed: true }, "grantId"],
    ];
    for (const [target, body, field] of cases) {
      const res = await doRevoke(target, ADMIN_A, body);
      expect(res.status, field).toBe(422);
      const json = (await res.json()) as { errors: { field: string }[] };
      expect(json.errors.map((e) => e.field)).toContain(field);
    }
    expect(await snapshot(owner)).toEqual(before);
  });

  it("36: inexistente y ya revocado dan el mismo 404 not_found genérico", async () => {
    await seed();
    const id = await grantId(owner, PROVIDER_A, "provider");
    expect((await doRevoke(id, ADMIN_A)).status).toBe(200);
    const before = await snapshot(owner);
    const first = await problemOf(await doRevoke(id, ADMIN_A));
    const second = await problemOf(await doRevoke(UNKNOWN_GRANT, ADMIN_A));
    expect(first).toMatchObject({ status: 404, code: "not_found" });
    expect(second).toEqual(first);
    expect(await snapshot(owner)).toEqual(before);
  });

  describe("37: listRoleGrants", () => {
    it("solo permisos activos, con campos del contrato, sin número ni tipo de documento", async () => {
      await seed();
      await principal(owner, true);
      await revokedAdmin(owner, REVOKED_ADMIN);
      await admin(owner, ADMIN_NO_ACCOUNT, false);
      const res = await doList(ADMIN_A);
      expect(res.status).toBe(200);
      const body = (await res.json()) as components["schemas"]["RoleGrantPage"];
      expect(validateSchema("RoleGrantPage", body)).toEqual([]);
      expect(body).toMatchObject({ page: 1, pageSize: 20, total: 6 });
      expect(body.items.map((i) => i.telegramUserId).sort()).toEqual(
        [ADMIN_A, ADMIN_B, PROVIDER_A, PROVIDER_B, PRINCIPAL, ADMIN_NO_ACCOUNT].map(String).sort(),
      );
      expect(body.items.every((i) => i.revokedAt === null)).toBe(true);
      expect(body.items.find((i) => i.telegramUserId === String(PRINCIPAL))?.isPrincipal).toBe(true);
      expect(body.items.find((i) => i.telegramUserId === String(ADMIN_NO_ACCOUNT))?.displayName).toBeNull();
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/identity|document/i);
    });

    it("filtra por rol y pagina", async () => {
      await seed();
      const byRole = async (role: string) => ((await (await doList(ADMIN_A, `?role=${role}`)).json()) as components["schemas"]["RoleGrantPage"]);
      expect((await byRole("provider")).items.map((i) => i.role)).toEqual(["provider", "provider"]);
      expect((await byRole("admin")).total).toBe(2);
      const page2 = (await (await doList(ADMIN_A, "?page=2&pageSize=3")).json()) as components["schemas"]["RoleGrantPage"];
      expect(page2).toMatchObject({ page: 2, pageSize: 3, total: 4 });
      expect(page2.items).toHaveLength(1);
    });

    it.each(["?role=otro", "?page=0", "?page=x", "?pageSize=0", "?pageSize=51"])("%s responde 422", async (query) => {
      await seed();
      expect((await doList(ADMIN_A, query)).status).toBe(422);
    });
  });

  it("38: dos revocaciones simultáneas del mismo permiso: una 200, una 404 y una sola traza", async () => {
    await seed();
    const id = await grantId(owner, PROVIDER_A, "provider");
    const other = appDb();
    try {
      const results = await Promise.allSettled([
        revokeRole(db, testConfig(), actorOf(ADMIN_A), id, { confirmed: true }),
        revokeRole(other, testConfig(), actorOf(ADMIN_B), id, { confirmed: true }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(failed.reason).toMatchObject({ status: 404, code: "not_found" });
      expect(await rows("select * from app.audit_events")).toHaveLength(1);
    } finally {
      await other.destroy();
    }
  });

  it("38 (extra): dos administradores que se revocan entre sí a la vez no dejan al sistema sin administradores", async () => {
    await admin(owner, ADMIN_A);
    await admin(owner, ADMIN_B);
    const idA = await grantId(owner, ADMIN_A, "admin");
    const idB = await grantId(owner, ADMIN_B, "admin");
    const other = appDb();
    try {
      const results = await Promise.allSettled([
        revokeRole(db, testConfig(), actorOf(ADMIN_A), idB, { confirmed: true }),
        revokeRole(other, testConfig(), actorOf(ADMIN_B), idA, { confirmed: true }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await rows("select count(*)::int as n from app.role_grants where role = 'admin' and revoked_at is null"))[0].n).toBe(1);
    } finally {
      await other.destroy();
    }
  });

  it("40: ningún aviso a la persona afectada (la bandeja no cambia)", async () => {
    await seed();
    await doRevoke(await grantId(owner, PROVIDER_A, "provider"), ADMIN_A);
    expect(await rows("select * from app.notification_outbox")).toHaveLength(0);
  });
});

describe("migración y permisos de base de datos (criterios 46 a 49)", () => {
  it("46: eje_app actualiza solo revoked_at y revoked_by_account_id; no borra", async () => {
    await seed();
    const id = await grantId(owner, PROVIDER_A, "provider");
    const adminAccount = (await rows("select id from app.accounts where telegram_user_id = $1", [ADMIN_A]))[0].id;
    for (const assignment of ["role = 'admin'", "telegram_user_id = 1", "granted_at = now()", "is_principal = true", "granted_by_account_id = null", "provider_registration_id = null", "id = gen_random_uuid()"]) {
      await expect(app.query(`update app.role_grants set ${assignment} where id = $1`, [id]), assignment).rejects.toThrow(/permission denied/);
    }
    await expect(app.query("update app.role_grants set revoked_at = now(), revoked_by_account_id = $2 where id = $1", [id, adminAccount])).resolves.toBeTruthy();
    expect((await rows("select revoked_at from app.role_grants where id = $1", [id]))[0].revoked_at).not.toBeNull();
    await expect(app.query("delete from app.role_grants")).rejects.toThrow(/permission denied/);
  });

  it("47: audit_events no se actualiza ni se borra; sí se inserta y se lee", async () => {
    await seed();
    await doRevoke(await grantId(owner, PROVIDER_A, "provider"), ADMIN_A);
    await expect(app.query("update app.audit_events set action = 'x'")).rejects.toThrow(/permission denied/);
    await expect(app.query("delete from app.audit_events")).rejects.toThrow(/permission denied/);
    expect((await app.query("select * from app.audit_events")).rows).toHaveLength(1);
    await expect(
      app.query("insert into app.audit_events (actor_role, action, entity_type, entity_id) values ('admin', 'x', 'role_grant', gen_random_uuid())"),
    ).resolves.toBeTruthy();
  });

  it("48: la migración f006_role_revocation se aplica sobre una base con datos de F003 y F004 sin cambiar esas filas", async () => {
    const dir = "supabase/migrations";
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const f006 = files.find((f) => f.includes("f006_role_revocation"));
    expect(f006).toBeDefined();
    const before = files.filter((f) => f < (f006 as string));
    const name = `eje_turismo_f006_mig_${randomBytes(4).toString("hex")}`;
    const admin_ = new Pool({ connectionString: process.env.TEST_OWNER_URL!.replace(/\/[^/]+$/, "/postgres"), max: 1 });
    await admin_.query(`create database "${name}"`);
    const pool = new Pool({ connectionString: process.env.TEST_OWNER_URL!.replace(/\/[^/]+$/, `/${name}`), max: 2 });
    try {
      for (const file of before) await pool.query(readFileSync(`${dir}/${file}`, "utf8"));
      // Solo la parte de la semilla anterior a F010: la tabla de municipios llega con una migración posterior a F006.
      await pool.query(readFileSync("supabase/seed/reference.sql", "utf8").split("-- Municipios iniciales")[0]);
      await pool.query("update app.privacy_notice_versions set is_current = (version = $1)", [NOTICE_VERSION]).catch(() => undefined);
      // Datos como los dejan F003 y F004: administradores, prestador aprobado, registro pendiente y trazas.
      await admin(pool, ADMIN_A);
      await admin(pool, ADMIN_B);
      await provider(pool, PROVIDER_A);
      await pendingPerson(pool, PENDING);
      await pool.query("insert into app.audit_events (actor_role, action, entity_type, entity_id) values ('admin', 'role_grant.admin_authorized', 'role_grant', gen_random_uuid())");
      const tables = ["accounts", "provider_registrations", "role_grants", "audit_events", "notification_outbox"];
      const snapshotBefore = await snapshot(pool, tables);
      await pool.query(readFileSync(`${dir}/${f006}`, "utf8"));
      expect(await snapshot(pool, tables)).toEqual(snapshotBefore);
      expect(Object.values(snapshotBefore).some((s) => s.length > 0)).toBe(true);
    } finally {
      await pool.end();
      await admin_.query(`drop database if exists "${name}"`);
      await admin_.end();
    }
  });

  it("49: el disparador de D-038 sigue activo: un administrador no puede ser prestador ni registrarse como tal", async () => {
    await seed();
    const registrationId = (await rows("select r.id from app.provider_registrations r join app.accounts a on a.id = r.account_id where a.telegram_user_id = $1", [PROVIDER_A]))[0].id;
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1", [PROVIDER_A]);
    await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [PROVIDER_A]);
    await expect(
      owner.query("insert into app.role_grants (telegram_user_id, role, provider_registration_id) values ($1, 'provider', $2)", [PROVIDER_A, registrationId]),
    ).rejects.toThrow(/admin_cannot_be_provider/);
    const create = createProviderRegistrationHandler(deps);
    const res = await create(
      new Request("http://localhost/api/v1/provider-registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth(ADMIN_A) },
        body: JSON.stringify({ identityDocumentType: "CC", identityNumber: "1020304050", confirmed: true }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await problemOf(res)).code).toBe("admin_cannot_register_as_provider");
  });
});

