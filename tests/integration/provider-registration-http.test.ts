import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decryptIdentityNumber } from "@/server/domain/identity";
import { getMeHandler } from "@/server/http/handlers";
import { parse } from "yaml";
import {
  createAccount,
  createOldVersionAccount,
  grantAdmin,
  grantProvider,
  PERSON_1,
  PERSON_2,
  PERSON_3,
  PERSON_4,
  PERSON_ADMIN,
  PERSON_NO_ACCOUNT,
  PERSON_OLD_VERSION,
  PERSON_PRINCIPAL,
} from "../factories/accounts";
import { rateLimitsEnv, TEST_IDENTITY_ENCRYPTION_KEY, TEST_IDENTITY_HASH_KEY } from "../helpers/config";
import { countsF002, F002_TABLES, ownerPool, resetDb, rowsMentioningF002 } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { createRequest, ISO_UTC, makeApi, meRequest, registration } from "../helpers/http";
import { validateSchema } from "../helpers/openapi";
import { signInitData, tma } from "../helpers/telegram";
import { createProviderRegistrationHandler } from "@/server/http/handlers";
import { withProviderGuard } from "@/server/http/handlers";

let owner: Pool;
const api = makeApi();
// Todas las respuestas HTTP de este archivo, para el criterio 36 (nunca llevan tipo, número, hash ni texto cifrado).
const bodies: string[] = [];

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(() => resetDb(owner));
afterEach(async () => {
  await owner.query("drop trigger if exists test_fail_insert on app.provider_registrations");
});

async function call(handler: (r: Request) => Promise<Response>, request: Request) {
  const res = await handler(request);
  const text = await res.clone().text();
  bodies.push(text);
  return res;
}
const create = (userId: number, body: unknown, handler = api.create) => call(handler, createRequest(userId, body));
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const code = async (res: Response) => (await res.json()).code as string;

describe("validación del tipo y del número (criterios 7 y 8)", () => {
  it("tipo fuera de la lista: 422 not_in_list y sin fila", async () => {
    await createAccount(owner, PERSON_1);
    for (const type of ["TI", "cc", "", null, 5]) {
      const res = await create(PERSON_1, registration(type, "1020304050"));
      expect(res.status).toBe(422);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      const body = await res.json();
      expect(validateSchema("Problem", body)).toEqual([]);
      expect(body.code).toBe("validation_failed");
      expect(body.errors.map((e: { code: string }) => e.code)).toContain("not_in_list");
    }
    expect(await count("provider_registrations")).toBe(0);
  });

  it("número vacío, solo espacios o ausente: required; control: invalid_format; 4097: too_long; 4096 pasa", async () => {
    await createAccount(owner, PERSON_1);
    const codesOf = async (body: unknown) => {
      const res = await create(PERSON_1, body);
      expect(res.status).toBe(422);
      return (await res.json()).errors.map((e: { code: string }) => e.code);
    };
    expect(await codesOf(registration("CC", ""))).toEqual(["required"]);
    expect(await codesOf(registration("CC", "   "))).toEqual(["required"]);
    expect(await codesOf({ identityDocumentType: "CC", confirmed: true })).toEqual(["required"]);
    expect(await codesOf(registration("CC", "12\u0000"))).toEqual(["invalid_format"]);
    expect(await codesOf(registration("CC", "x".repeat(4097)))).toEqual(["too_long"]);
    expect(await count("provider_registrations")).toBe(0);
    const ok = await create(PERSON_1, registration("CC", "x".repeat(4096)));
    expect(ok.status).toBe(201);
  });

  it("confirmed ausente o false, campos desconocidos y cuerpo que no es un objeto: 422 sin registro (criterio 22)", async () => {
    await createAccount(owner, PERSON_1);
    for (const body of [
      { identityDocumentType: "CC", identityNumber: "1020304050" },
      registration("CC", "1020304050", false),
      { ...registration("CC", "1020304050"), extra: 1 },
      "no es json",
      [],
    ]) {
      const res = await create(PERSON_1, body);
      expect(res.status).toBe(422);
      expect(await code(res)).toBe("validation_failed");
    }
    expect(await count("provider_registrations")).toBe(0);
  });
});

describe("crear el registro (criterios 17, 18, 20, 22)", () => {
  it("201 con OwnProviderRegistration sin tipo ni número, fila pending y una traza", async () => {
    const accountId = await createAccount(owner, PERSON_1);
    const before = new Date(Date.now() - 1000);
    const res = await create(PERSON_1, registration("CC", "1020304050"));
    const after = new Date(Date.now() + 1000);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(validateSchema("OwnProviderRegistration", body)).toEqual([]);
    expect(body).toMatchObject({ status: "pending", decidedAt: null });
    expect(body.createdAt).toMatch(ISO_UTC);
    expect(Object.keys(body).sort()).toEqual(["createdAt", "decidedAt", "id", "status"]);

    const [row] = await rows("select * from app.provider_registrations");
    expect(row).toMatchObject({
      id: body.id,
      account_id: accountId,
      identity_document_type: "CC",
      status: "pending",
      decided_at: null,
      decided_by_account_id: null,
    });
    expect(row.created_at >= before && row.created_at <= after).toBe(true);

    const [audit] = await rows("select * from app.audit_events");
    expect(await count("audit_events")).toBe(1);
    expect(audit).toMatchObject({
      action: "provider_registration.created",
      entity_type: "provider_registration",
      entity_id: row.id,
      actor_account_id: accountId,
      actor_role: "none",
    });
    const details = JSON.stringify(audit.details);
    for (const secret of ["1020304050", "CC", String(PERSON_1)]) expect(details).not.toContain(secret);
    expect(audit.details).toEqual({});
  });

  it("la cuenta queda vinculada a su ID de Telegram", async () => {
    await createAccount(owner, PERSON_1);
    await create(PERSON_1, registration("CC", "1020304050"));
    const [row] = await rows(
      "select a.telegram_user_id from app.provider_registrations r join app.accounts a on a.id = r.account_id",
    );
    expect(row.telegram_user_id).toBe(String(PERSON_1));
  });

  it("el número queda cifrado (sin texto en claro) y el hash es HMAC-SHA256 calculado de forma independiente", async () => {
    const accountId = await createAccount(owner, PERSON_1);
    await create(PERSON_1, registration("CC", "1020304050"));
    const [row] = await rows("select identity_number_encrypted as enc, identity_number_hash as hash from app.provider_registrations");
    expect((row.enc as Buffer).toString("latin1")).not.toContain("1020304050");
    expect((row.enc as Buffer).toString("hex")).not.toContain(Buffer.from("1020304050").toString("hex"));
    const key = Buffer.from(TEST_IDENTITY_ENCRYPTION_KEY, "base64");
    expect(decryptIdentityNumber(key, accountId, row.enc)).toBe("1020304050");
    const expected = createHmac("sha256", Buffer.from(TEST_IDENTITY_HASH_KEY, "base64")).update("CC:1020304050").digest();
    expect((row.hash as Buffer).equals(expected)).toBe(true);
  });

  it("guarda el número tal como se escribió, sin espacios en los extremos y sin cambiar mayúsculas", async () => {
    const accountId = await createAccount(owner, PERSON_3);
    await create(PERSON_3, registration("PA", " ab123 "));
    const [row] = await rows("select identity_number_encrypted as enc from app.provider_registrations");
    expect(decryptIdentityNumber(Buffer.from(TEST_IDENTITY_ENCRYPTION_KEY, "base64"), accountId, row.enc)).toBe("ab123");
  });
});

describe("duplicados (criterios 27, 29, 30, 31)", () => {
  it("segunda cuenta con el mismo tipo y número: 409 duplicate, una sola fila y sin traza", async () => {
    await createAccount(owner, PERSON_1);
    await createAccount(owner, PERSON_2);
    expect((await create(PERSON_1, registration("CC", "1020304050"))).status).toBe(201);
    const res = await create(PERSON_2, registration("CC", "1020304050"));
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await res.json();
    expect(validateSchema("Problem", body)).toEqual([]);
    expect(body.code).toBe("duplicate");
    expect(await count("provider_registrations")).toBe(1);
    expect(await count("audit_events")).toBe(1);
  });

  it("PA 'ab123' y PA ' AB123 ' son el mismo documento; CE con el número de una CC es otro documento", async () => {
    for (const id of [PERSON_1, PERSON_3, PERSON_4]) await createAccount(owner, id);
    expect((await create(PERSON_1, registration("CC", "1020304050"))).status).toBe(201);
    expect((await create(PERSON_3, registration("PA", "ab123"))).status).toBe(201);
    const dup = await create(PERSON_4, registration("PA", " AB123 "));
    expect(dup.status).toBe(409);
    expect(await code(dup)).toBe("duplicate");
    expect((await create(PERSON_4, registration("CE", "1020304050"))).status).toBe(201);
    const stored = await rows("select identity_document_type as t, encode(identity_number_hash, 'hex') as h from app.provider_registrations order by created_at");
    expect(stored.map((r) => r.t)).toEqual(["CC", "PA", "CE"]);
    expect(stored[0].h).not.toBe(stored[2].h);
  });

  it("la misma cuenta con otro documento recibe 409 y no se crea una segunda fila", async () => {
    await createAccount(owner, PERSON_1);
    expect((await create(PERSON_1, registration("CC", "1020304050"))).status).toBe(201);
    const res = await create(PERSON_1, registration("PPT", "9988776655"));
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("duplicate");
    expect(await count("provider_registrations")).toBe(1);
  });

  it("dos confirmaciones simultáneas con el mismo documento dejan una fila pending y un 409 (criterio 28)", async () => {
    await createAccount(owner, PERSON_1);
    await createAccount(owner, PERSON_2);
    const other = makeApi();
    try {
      const [a, b] = await Promise.all([
        call(api.create, createRequest(PERSON_1, registration("CC", "1020304050"))),
        call(other.create, createRequest(PERSON_2, registration("CC", "1020304050"))),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await count("provider_registrations")).toBe(1);
      expect(await count("audit_events")).toBe(1);
    } finally {
      await other.destroy();
    }
  });
});

describe("sin aviso vigente aceptado (criterios 33 y 34)", () => {
  it("un ID sin cuenta y una cuenta con versión anterior reciben 403 consent_required y no se escribe nada", async () => {
    await createOldVersionAccount(owner, PERSON_OLD_VERSION);
    const before = await countsF002(owner);
    for (const id of [PERSON_NO_ACCOUNT, PERSON_OLD_VERSION]) {
      const res = await create(id, registration("CC", "1020304050"));
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("consent_required");
    }
    expect(await countsF002(owner)).toEqual(before);
    expect(await rowsMentioningF002(owner, String(PERSON_NO_ACCOUNT))).toBe(0);
  });

  it("sin Authorization o con firma inválida responde 401 antes que 422, sin consultar la base", async () => {
    const fake = failingDb();
    const deps = { ...api.deps, db: () => fake.db };
    const route = createProviderRegistrationHandler(deps);
    const bad = { identityDocumentType: "TI" };
    const forged = tma(signInitData({ userId: PERSON_1, token: "9:otro" }));
    for (const headers of [{}, forged]) {
      const res = await call(route, createRequest(PERSON_1, bad, headers));
      expect(res.status).toBe(401);
    }
    expect(fake.queries).toEqual([]);
  });
});

describe("administradores (criterios 35 y 45)", () => {
  it("permiso admin activo: 403 admin_cannot_register_as_provider y sin registro", async () => {
    await createAccount(owner, PERSON_ADMIN);
    await grantAdmin(owner, PERSON_ADMIN);
    const res = await create(PERSON_ADMIN, registration("CC", "1020304050"));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("admin_cannot_register_as_provider");
    expect(await count("provider_registrations")).toBe(0);
  });

  it("ID principal con cuenta: 403 admin_cannot_register_as_provider; sin cuenta: consent_required", async () => {
    const without = await create(PERSON_PRINCIPAL, registration("CC", "1020304050"));
    expect(without.status).toBe(403);
    expect(await code(without)).toBe("consent_required");
    await createAccount(owner, PERSON_PRINCIPAL);
    const res = await create(PERSON_PRINCIPAL, registration("CC", "1020304050"));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("admin_cannot_register_as_provider");
    expect(await count("provider_registrations")).toBe(0);
  });

  it("orden de comprobaciones con peticiones que incumplen varias reglas a la vez", async () => {
    const limited = makeApi({ RATE_LIMITS: rateLimitsEnv(1) });
    try {
      const invalid = registration("TI", "");
      const dupBody = registration("CC", "1020304050");
      for (const id of [PERSON_1, PERSON_2, PERSON_ADMIN]) await createAccount(owner, id);
      await grantAdmin(owner, PERSON_ADMIN);
      await createAccount(owner, PERSON_PRINCIPAL);
      // 401 antes que 403 consent_required y que 422.
      expect((await call(limited.create, createRequest(PERSON_NO_ACCOUNT, invalid, {}))).status).toBe(401);
      // 403 consent_required antes que admin y que 422.
      expect(await code(await call(limited.create, createRequest(PERSON_NO_ACCOUNT, invalid)))).toBe("consent_required");
      // 403 admin antes que 422 (permiso y principal).
      expect(await code(await call(limited.create, createRequest(PERSON_ADMIN, invalid)))).toBe("admin_cannot_register_as_provider");
      expect(await code(await call(limited.create, createRequest(PERSON_PRINCIPAL, invalid)))).toBe("admin_cannot_register_as_provider");
      // 422 antes que 429: agota el límite de PERSON_2 con una confirmación válida y luego manda un cuerpo inválido.
      expect((await call(limited.create, createRequest(PERSON_2, dupBody))).status).toBe(201);
      expect((await call(limited.create, createRequest(PERSON_2, invalid))).status).toBe(422);
      // 429 antes que la inserción (que daría 409 por duplicado).
      const limitedAgain = await call(limited.create, createRequest(PERSON_2, registration("PPT", "9988776655")));
      expect(limitedAgain.status).toBe(429);
      expect((await call(limited.create, createRequest(PERSON_1, dupBody))).status).toBe(409);
    } finally {
      await limited.destroy();
    }
  });
});

describe("límite de intentos (criterio 21; D-077, D-082)", () => {
  const counters = () => rows("select account_id, action, count from app.rate_limit_counters order by account_id");

  it("con límite 2: 422, 401, 403 y 429 no suman; éxito, 409 y 500 sí; el intento 3 recibe 429 con Retry-After", async () => {
    const limited = makeApi({ RATE_LIMITS: rateLimitsEnv(2) });
    try {
      const a = await createAccount(owner, PERSON_1);
      const b = await createAccount(owner, PERSON_2);
      await createAccount(owner, PERSON_ADMIN);
      await grantAdmin(owner, PERSON_ADMIN);

      // No suman: 401, 403 (sin cuenta y administrador) y 422.
      await call(limited.create, createRequest(PERSON_1, registration("CC", "1"), {}));
      await call(limited.create, createRequest(PERSON_NO_ACCOUNT, registration("CC", "1")));
      await call(limited.create, createRequest(PERSON_ADMIN, registration("CC", "1")));
      await call(limited.create, createRequest(PERSON_1, registration("TI", "")));
      expect(await counters()).toEqual([]);

      // Intento 1: éxito.
      expect((await call(limited.create, createRequest(PERSON_1, registration("CC", "1020304050")))).status).toBe(201);
      expect(await counters()).toEqual([{ account_id: a, action: "provider_registration", count: 1 }]);
      // Intento 2: 409 (la cuenta ya tiene registro).
      expect((await call(limited.create, createRequest(PERSON_1, registration("PPT", "9988776655")))).status).toBe(409);
      expect((await counters())[0].count).toBe(2);
      // Intento 3: 429, sin registro nuevo y sin sumar.
      const res = await call(limited.create, createRequest(PERSON_1, registration("PA", "zz9")));
      expect(res.status).toBe(429);
      expect(await code(res)).toBe("rate_limited");
      expect(validateSchema("Problem", JSON.parse(bodies[bodies.length - 1]))).toEqual([]);
      const retry = res.headers.get("retry-after")!;
      expect(retry).toMatch(/^\d+$/);
      expect(Number(retry)).toBeGreaterThan(0);
      expect(Number(retry)).toBeLessThanOrEqual(3600);
      expect(await count("provider_registrations")).toBe(1);
      expect((await counters())[0].count).toBe(2);

      // Otra cuenta no se ve afectada y tiene su propio contador; un 500 de la base también suma.
      await owner.query(`create or replace function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo-interno-secreto'; end $$`);
      await owner.query("create trigger test_fail_insert before insert on app.provider_registrations for each row execute function app.test_fail()");
      const failed = await call(limited.create, createRequest(PERSON_2, registration("CC", "5555")));
      expect(failed.status).toBe(500);
      await owner.query("drop trigger test_fail_insert on app.provider_registrations");
      const all = await counters();
      expect(all.find((r) => r.account_id === a)!.count).toBe(2);
      expect(all.find((r) => r.account_id === b)!.count).toBe(1);
      expect((await call(limited.create, createRequest(PERSON_2, registration("CC", "5555")))).status).toBe(201);
    } finally {
      await limited.destroy();
    }
  });

  it("el valor por defecto es 5 por hora (D-077)", async () => {
    await createAccount(owner, PERSON_1);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await create(PERSON_1, registration("CC", "1020304050"))).status);
    expect(statuses).toEqual([201, 409, 409, 409, 409, 429]);
  });

  it("con una ventana nueva el contador vuelve a empezar", async () => {
    let now = new Date("2026-11-15T10:00:00Z");
    const timed = makeApi({ RATE_LIMITS: rateLimitsEnv(1) }, () => now);
    // initData firmado con el reloj falso: su auth_date debe coincidir con `now`.
    const at = (body: unknown) =>
      createRequest(PERSON_1, body, tma(signInitData({ userId: PERSON_1, authDate: Math.floor(now.getTime() / 1000) })));
    try {
      await createAccount(owner, PERSON_1);
      expect((await timed.create(at(registration("CC", "1020304050")))).status).toBe(201);
      const limited = await timed.create(at(registration("PPT", "9")));
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("3600");
      now = new Date("2026-11-15T11:00:01Z");
      expect((await timed.create(at(registration("PPT", "9")))).status).toBe(409);
    } finally {
      await timed.destroy();
    }
  });
});

describe("consultar mi registro (criterios 25 y 26)", () => {
  it("pendiente: 200 con status pending, decidedAt nulo y sin tipo ni número", async () => {
    await createAccount(owner, PERSON_1);
    await create(PERSON_1, registration("CC", "1020304050"));
    const res = await call(api.me, meRequest(PERSON_1));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validateSchema("OwnProviderRegistration", body)).toEqual([]);
    expect(body).toMatchObject({ status: "pending", decidedAt: null });
    expect(Object.keys(body).sort()).toEqual(["createdAt", "decidedAt", "id", "status"]);
  });
  it("sin registro: 404 problem+json; sin Authorization o firma inválida: 401; sin aviso vigente: 403 consent_required", async () => {
    await createAccount(owner, PERSON_1);
    await createOldVersionAccount(owner, PERSON_OLD_VERSION);
    const none = await call(api.me, meRequest(PERSON_1));
    expect(none.status).toBe(404);
    expect(none.headers.get("content-type")).toContain("application/problem+json");
    const problem = await none.json();
    expect(validateSchema("Problem", problem)).toEqual([]);
    expect(problem.code).toBe("not_found");
    expect(problem.detail).not.toMatch(/aviso/i);
    expect((await call(api.me, meRequest(PERSON_1, {}))).status).toBe(401);
    expect((await call(api.me, meRequest(PERSON_1, tma(signInitData({ userId: PERSON_1, token: "9:otro" }))))).status).toBe(401);
    for (const id of [PERSON_OLD_VERSION, PERSON_NO_ACCOUNT]) {
      const res = await call(api.me, meRequest(id));
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("consent_required");
    }
  });
  it("getMe de la cuenta con registro pendiente sigue devolviendo roles vacío", async () => {
    await createAccount(owner, PERSON_1);
    await create(PERSON_1, registration("CC", "1020304050"));
    const res = await call(getMeHandler(api.deps), meRequest(PERSON_1));
    expect((await res.json()).roles).toEqual([]);
  });
});

describe("guardián de rol provider (criterio 24; invariante 1)", () => {
  const route = withProviderGuard(api.deps, async () => Response.json({ ok: true }));
  const probe = (id: number) => call(route, meRequest(id));

  it("403 forbidden con registro pendiente y sin registro; 403 consent_required sin cuenta; pasa con permiso activo", async () => {
    const pending = await createAccount(owner, PERSON_1);
    await createAccount(owner, PERSON_2);
    const approved = await createAccount(owner, PERSON_3);
    await create(PERSON_1, registration("CC", "1020304050"));
    expect(pending).toBeTruthy();

    for (const id of [PERSON_1, PERSON_2]) {
      const res = await probe(id);
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("forbidden");
    }
    const noAccount = await probe(PERSON_NO_ACCOUNT);
    expect(noAccount.status).toBe(403);
    expect(await code(noAccount)).toBe("consent_required");

    await grantProvider(owner, approved, PERSON_3);
    const ok = await probe(PERSON_3);
    expect(ok.status).toBe(200);
    // El rol se lee en cada operación: al revocarlo, la siguiente petición ya no pasa.
    await owner.query("update app.role_grants set revoked_at = now()");
    expect((await probe(PERSON_3)).status).toBe(403);
  });
});

describe("errores sin datos técnicos (criterio 38)", () => {
  it("un error de la base responde 500 genérico sin texto del error, tablas ni columnas", async () => {
    const fake = failingDb("fallo-interno-secreto provider_registrations identity_number_hash");
    const route = createProviderRegistrationHandler({ ...api.deps, db: () => fake.db });
    const res = await call(route, createRequest(PERSON_1, registration("CC", "1020304050")));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await res.json();
    expect(validateSchema("Problem", body)).toEqual([]);
    expect(body.code).toBe("internal_error");
    const text = JSON.stringify(body);
    for (const secret of ["fallo-interno-secreto", "provider_registrations", "identity_number_hash", "1020304050"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("contrato OpenAPI sin cambios (criterio 41)", () => {
  const spec = parse(readFileSync("api/openapi.yaml", "utf8")) as {
    paths: Record<string, Record<string, { responses: Record<string, unknown>; description?: string }>>;
  };
  it("createProviderRegistration declara 403, 409 y 429 con Retry-After; las rutas existen", () => {
    const post = spec.paths["/api/v1/provider-registrations"].post;
    for (const status of ["201", "401", "403", "409", "422", "429", "500"]) expect(post.responses).toHaveProperty(status);
    expect(post.description).toContain("admin_cannot_register_as_provider");
    expect(post.description).toContain("409 `duplicate`");
    expect(JSON.stringify(spec)).toContain("Retry-After");
    expect(spec.paths["/api/v1/provider-registrations/me"].get.responses).toHaveProperty("404");
  });
});

describe("ninguna respuesta lleva datos de identidad (criterio 36)", () => {
  it("ni el tipo, ni el número, ni el hash, ni el texto cifrado", async () => {
    await createAccount(owner, PERSON_1);
    await create(PERSON_1, registration("CC", "1020304050"));
    const [row] = await rows(
      "select encode(identity_number_hash, 'hex') as h, encode(identity_number_encrypted, 'base64') as e from app.provider_registrations",
    );
    await call(api.me, meRequest(PERSON_1));
    const all = bodies.join("\n");
    expect(all.length).toBeGreaterThan(0);
    for (const secret of ["1020304050", "identity_number", row.h, row.e, "9988776655", "ab123", "AB123"]) {
      expect(all).not.toContain(secret);
    }
    expect(F002_TABLES).toHaveLength(7);
  });
});
