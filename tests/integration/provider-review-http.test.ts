/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createOldVersionAccount, PERSON_PRINCIPAL } from "../factories/accounts";
import {
  ADMIN_1,
  ADMIN_2,
  grantAdminRole,
  makeProvider,
  namedAccount,
  NAMES,
  NUMBER_1,
  NUMBER_2,
  NUMBER_3,
  pendingFor,
  REASON,
  USER_APPROVE,
  USER_NO_ACCOUNT,
  USER_NO_ROLE,
  USER_OLD_NOTICE,
  USER_PENDING,
  USER_PROVIDER,
  USER_REJECT,
} from "../factories/review";
import { TEST_IDENTITY_ENCRYPTION_KEY } from "../helpers/config";
import { ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { ISO_UTC } from "../helpers/http";
import { validateSchema } from "../helpers/openapi";
import { decisionRequest, listRequest, makeReviewApi, route, UNKNOWN_ID } from "../helpers/review-http";
import { signInitData, tma } from "../helpers/telegram";
import { decryptIdentityNumber } from "@/server/domain/identity";
import { approveProviderRegistrationHandler, listProviderRegistrationsHandler } from "@/server/http/handlers";

// `after` de next/server se sustituye por un recolector de promesas (contrato F003, criterio 16).
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));
const flushAfter = async () => {
  while (afterTasks.length > 0) await afterTasks.shift()!();
};

let owner: Pool;
const api = makeReviewApi();
const logs: string[] = [];
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const snapshot = async () => ({
  registrations: await rows("select id, status, decided_at, decided_by_account_id, rejection_reason from app.provider_registrations order by id"),
  grants: await count("role_grants"),
  audit: await count("audit_events"),
  outbox: await count("notification_outbox"),
});
const body = async (res: Response) => (await res.json()) as Record<string, any>;

beforeAll(() => {
  owner = ownerPool();
  for (const level of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  api.sent.length = 0;
  api.state.mode = "ok";
  afterTasks.length = 0;
  logs.length = 0;
});
afterEach(async () => {
  await owner.query("drop trigger if exists test_fail on app.provider_registrations");
});

// Administrador con permiso, y dos usuarios con registro pendiente.
async function seedTwo() {
  await namedAccount(owner, ADMIN_1);
  await grantAdminRole(owner, ADMIN_1);
  const first = await pendingFor(owner, USER_APPROVE, { type: "CC", number: NUMBER_1, createdAt: new Date("2026-11-16T03:30:00Z") });
  const second = await pendingFor(owner, USER_REJECT, { type: "PA", number: NUMBER_2, createdAt: new Date("2026-11-16T04:30:00Z") });
  return { first: first.registrationId, second: second.registrationId };
}

describe("listProviderRegistrations (criterios 4, 5 y 6)", () => {
  it("devuelve el contrato con el número descifrado, por estado y del más antiguo al más reciente", async () => {
    const { first, second } = await seedTwo();
    const done = await pendingFor(owner, USER_NO_ROLE, { type: "CE", number: NUMBER_3, status: "approved", createdAt: new Date("2026-11-15T10:00:00Z") });
    const all = await api.list(listRequest(ADMIN_1));
    expect(all.status).toBe(200);
    const page = await body(all);
    expect(validateSchema("AdminProviderRegistrationPage", page)).toEqual([]);
    expect(page.items.map((i: any) => i.id)).toEqual([done.registrationId, first, second]);
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    const item = page.items[1];
    expect(item).toMatchObject({
      telegramUserId: String(USER_APPROVE),
      telegramDisplayName: NAMES[USER_APPROVE],
      identityDocumentType: "CC",
      identityNumber: NUMBER_1,
      status: "pending",
      decidedAt: null,
    });
    expect(item.createdAt).toMatch(ISO_UTC);
    // El número se descifra con la clave de prueba, igual que el valor sembrado.
    const cipher = (await rows("select account_id, identity_number_encrypted from app.provider_registrations where id = $1", [first]))[0];
    expect(decryptIdentityNumber(Buffer.from(TEST_IDENTITY_ENCRYPTION_KEY, "base64"), cipher.account_id, cipher.identity_number_encrypted)).toBe(NUMBER_1);

    const pending = await body(await api.list(listRequest(ADMIN_1, "?status=pending")));
    expect(pending.items.map((i: any) => i.id)).toEqual([first, second]);
    const approved = await body(await api.list(listRequest(ADMIN_1, "?status=approved")));
    expect(approved.items.map((i: any) => i.id)).toEqual([done.registrationId]);

    const one = await body(await api.list(listRequest(ADMIN_1, "?pageSize=1")));
    expect(one).toMatchObject({ page: 1, pageSize: 1, total: 3 });
    expect(one.items).toHaveLength(1);
    const next = await body(await api.list(listRequest(ADMIN_1, "?pageSize=1&page=2")));
    expect(next.items[0].id).toBe(first);
  });

  it.each(["?page=0", "?pageSize=0", "?pageSize=51", "?status=foo", "?page=a"])("%s responde 422 validation_failed", async (query) => {
    await seedTwo();
    const res = await api.list(listRequest(ADMIN_1, query));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "validation_failed" });
  });

  it("no incluye hash ni campos cifrados, y el log no trae número, tipo ni respuesta", async () => {
    await seedTwo();
    const res = await api.list(listRequest(ADMIN_1));
    const text = await res.text();
    for (const key of ["identity_number_hash", "identity_number_encrypted", "hash", "encrypted"]) expect(text).not.toContain(key);
    for (const value of [NUMBER_1, NUMBER_2, '"CC"', '"PA"']) expect(logs.join("\n")).not.toContain(value);
  });

  it("sin Authorization o con firma inválida: 401 sin consultar la base", async () => {
    const fake = failingDb();
    const route401 = listProviderRegistrationsHandler({ ...api.deps, db: () => fake.db });
    for (const headers of [{}, tma(signInitData({ userId: ADMIN_1, tamperUserId: ADMIN_2 })), tma(signInitData({ userId: ADMIN_1, token: "9:otro" }))]) {
      const res = await route401(new Request("http://localhost/api/v1/provider-registrations", { headers }));
      expect(res.status).toBe(401);
    }
    expect(fake.queries).toEqual([]);
  });

  it("acceso: sin cuenta o aviso anterior 403 consent_required; sin rol, pendiente y prestador 403 forbidden; el principal 200", async () => {
    await namedAccount(owner, USER_NO_ROLE);
    await pendingFor(owner, USER_PENDING, { number: NUMBER_3 });
    await makeProvider(owner, USER_PROVIDER);
    await createOldVersionAccount(owner, USER_OLD_NOTICE);
    await createAccount(owner, PERSON_PRINCIPAL);
    const expectations: [number, number, string?][] = [
      [USER_NO_ACCOUNT, 403, "consent_required"],
      [USER_OLD_NOTICE, 403, "consent_required"],
      [USER_NO_ROLE, 403, "forbidden"],
      [USER_PENDING, 403, "forbidden"],
      [USER_PROVIDER, 403, "forbidden"],
      [PERSON_PRINCIPAL, 200],
    ];
    for (const [id, status, code] of expectations) {
      const res = await api.list(listRequest(id));
      expect(res.status, String(id)).toBe(status);
      if (code) expect(await res.json()).toMatchObject({ code });
    }
  });
});

describe("decisión: confirmación y validación (criterio 11)", () => {
  it.each(["approval", "rejection"] as const)("%s sin confirmed, con false u otro tipo, con campo extra o id inválido: 422 y nada cambia", async (kind) => {
    const { first } = await seedTwo();
    const before = await snapshot();
    const handler = kind === "approval" ? api.approve : api.reject;
    const invalid = [{}, { confirmed: false }, { confirmed: "true" }, { confirmed: 1 }, { confirmed: true, extra: 1 }, "no-json"];
    for (const payload of invalid) {
      const res = await handler(decisionRequest(kind, first, ADMIN_1, payload), route(first));
      expect(res.status, JSON.stringify(payload)).toBe(422);
      expect(await res.json()).toMatchObject({ code: "validation_failed" });
    }
    const badId = await handler(decisionRequest(kind, "no-es-uuid", ADMIN_1, { confirmed: true }), route("no-es-uuid"));
    expect(badId.status).toBe(422);
    expect(await snapshot()).toEqual(before);
  });
});

describe("aprobar (criterios 12, 13, 14, 23, 24 y 25)", () => {
  it("aprueba, crea el permiso, la traza y el aviso, y lo envía después de responder", async () => {
    const { first } = await seedTwo();
    const adminAccount = (await rows("select id from app.accounts where telegram_user_id = $1", [ADMIN_1]))[0].id;
    const before = new Date();
    const res = await api.approve(decisionRequest("approval", first, ADMIN_1, { confirmed: true }), route(first));
    const after = new Date();
    expect(res.status).toBe(200);
    const view = await body(res);
    expect(validateSchema("AdminProviderRegistration", view)).toEqual([]);
    expect(view).toMatchObject({ id: first, status: "approved", decidedBy: { role: "admin", displayName: NAMES[ADMIN_1] } });
    expect(view.decidedAt).toMatch(ISO_UTC);
    expect(new Date(view.decidedAt).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(new Date(view.decidedAt).getTime()).toBeLessThanOrEqual(after.getTime() + 1000);

    const reg = (await rows("select * from app.provider_registrations where id = $1", [first]))[0];
    expect(reg).toMatchObject({ status: "approved", decided_by_account_id: adminAccount });
    expect(reg.decided_at).toBeInstanceOf(Date);
    const grants = await rows("select * from app.role_grants where role = 'provider'");
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      telegram_user_id: String(USER_APPROVE),
      provider_registration_id: first,
      granted_by_account_id: adminAccount,
      revoked_at: null,
    });
    expect(grants[0].granted_at).toBeInstanceOf(Date);

    const audit = await rows("select * from app.audit_events where action = 'provider_registration.approved'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entity_type: "provider_registration", entity_id: first, actor_account_id: adminAccount, actor_role: "admin" });
    expect(await count("audit_events")).toBe(1);
    // La traza y el aviso no llevan datos personales (criterios 14 y 24).
    const sensitive = [NUMBER_1, "CC", NAMES[USER_APPROVE], String(USER_APPROVE), String(ADMIN_1), REASON];
    const text = JSON.stringify([audit[0].details, ...(await rows("select payload, template from app.notification_outbox"))]);
    for (const value of sensitive) expect(text).not.toContain(value);

    // El aviso existe antes del envío y pasa a `sent` cuando after() corre.
    let outbox = await rows("select * from app.notification_outbox");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ template: "provider_registration.approved", recipient_telegram_user_id: String(USER_APPROVE), status: "pending" });
    expect(api.sent).toEqual([]);
    await flushAfter();
    outbox = await rows("select * from app.notification_outbox");
    expect(outbox[0]).toMatchObject({ status: "sent", attempts: 1 });
    expect(api.sent).toEqual([{ chatId: String(USER_APPROVE), text: "Tu registro como prestador fue autorizado. Escribe /start para continuar." }]);

    // Con el permiso, el usuario es prestador en getMe-equivalente: el guardián lo deja pasar (se prueba en provider-guard) y su rol está activo.
    const roles = await rows("select role from app.role_grants where telegram_user_id = $1 and revoked_at is null", [USER_APPROVE]);
    expect(roles).toEqual([{ role: "provider" }]);
  });

  it("el administrador principal sin fila en role_grants aprueba y queda como responsable", async () => {
    const principal = await createAccount(owner, PERSON_PRINCIPAL, "Principal Prueba");
    const { registrationId } = await pendingFor(owner, USER_APPROVE);
    const res = await api.approve(decisionRequest("approval", registrationId, PERSON_PRINCIPAL, { confirmed: true }), route(registrationId));
    expect(res.status).toBe(200);
    const grant = (await rows("select * from app.role_grants where role = 'provider'"))[0];
    expect(grant.granted_by_account_id).toBe(principal);
  });

  it("la lista muestra fecha, responsable y resultado de cada decisión (criterio 25)", async () => {
    const { first, second } = await seedTwo();
    await api.approve(decisionRequest("approval", first, ADMIN_1, { confirmed: true }), route(first));
    await api.reject(decisionRequest("rejection", second, ADMIN_1, { confirmed: true }), route(second));
    const approved = (await body(await api.list(listRequest(ADMIN_1, "?status=approved")))).items[0];
    const rejected = (await body(await api.list(listRequest(ADMIN_1, "?status=rejected")))).items[0];
    for (const item of [approved, rejected]) {
      expect(item.decidedAt).toMatch(ISO_UTC);
      expect(item.decidedBy).toEqual({ displayName: NAMES[ADMIN_1], role: "admin" });
    }
  });
});

describe("rechazar (criterios 18, 19, 20, 21, 23 y 24)", () => {
  it("rechaza sin motivo: no crea permiso, avisa y el usuario sigue sin rol", async () => {
    const { second } = await seedTwo();
    const res = await api.reject(decisionRequest("rejection", second, ADMIN_1, { confirmed: true }), route(second));
    expect(res.status).toBe(200);
    const view = await body(res);
    expect(validateSchema("AdminProviderRegistration", view)).toEqual([]);
    expect(view).toMatchObject({ status: "rejected", rejectionReason: null, decidedBy: { role: "admin" } });
    expect(await count("role_grants")).toBe(1); // solo el permiso admin de la fábrica
    expect(await rows("select * from app.role_grants where role = 'provider'")).toEqual([]);
    const audit = await rows("select * from app.audit_events");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "provider_registration.rejected", entity_id: second, actor_role: "admin" });
    await flushAfter();
    expect(api.sent).toEqual([
      { chatId: String(USER_REJECT), text: "Tu registro como prestador no fue autorizado. Si crees que es un error, comunícate con el administrador." },
    ]);
    expect((await rows("select template, status from app.notification_outbox"))[0]).toEqual({ template: "provider_registration.rejected", status: "sent" });
    const text = JSON.stringify([audit[0].details, await rows("select payload from app.notification_outbox"), api.sent]);
    for (const value of [NUMBER_2, "PA", NAMES[USER_REJECT]]) expect(text).not.toContain(value);
  });

  it("el motivo se guarda pero no sale en el mensaje, el aviso ni la traza; vacío o solo espacios queda nulo; 4097 caracteres: 422", async () => {
    const { first, second } = await seedTwo();
    const with4096 = "a".repeat(4096);
    const long = await api.reject(decisionRequest("rejection", first, ADMIN_1, { confirmed: true, reason: "a".repeat(4097) }), route(first));
    expect(long.status).toBe(422);
    expect(await long.json()).toMatchObject({ errors: [{ field: "reason", code: "too_long" }] });
    expect((await rows("select status from app.provider_registrations where id = $1", [first]))[0].status).toBe("pending");

    const ok = await api.reject(decisionRequest("rejection", first, ADMIN_1, { confirmed: true, reason: REASON }), route(first));
    expect((await body(ok)).rejectionReason).toBe(REASON);
    expect((await rows("select rejection_reason from app.provider_registrations where id = $1", [first]))[0].rejection_reason).toBe(REASON);
    await flushAfter();
    const everywhere = JSON.stringify([api.sent, await rows("select payload from app.notification_outbox"), await rows("select details from app.audit_events")]);
    expect(everywhere).not.toContain(REASON);

    for (const reason of ["", "   "]) {
      await owner.query("update app.provider_registrations set status = 'pending', rejection_reason = null where id = $1", [second]);
      const res = await api.reject(decisionRequest("rejection", second, ADMIN_1, { confirmed: true, reason }), route(second));
      expect(res.status).toBe(200);
      expect((await body(res)).rejectionReason).toBeNull();
      expect((await rows("select rejection_reason from app.provider_registrations where id = $1", [second]))[0].rejection_reason).toBeNull();
    }
    await owner.query("update app.provider_registrations set status = 'pending', rejection_reason = null where id = $1", [second]);
    const exact = await api.reject(decisionRequest("rejection", second, ADMIN_1, { confirmed: true, reason: with4096 }), route(second));
    expect(exact.status).toBe(200);
  });

  it("getMe-equivalente: sin permiso provider y el rechazo no crea ninguna fila de role_grants para la cuenta", async () => {
    const { second } = await seedTwo();
    await api.reject(decisionRequest("rejection", second, ADMIN_1, { confirmed: true }), route(second));
    expect(await rows("select * from app.role_grants where telegram_user_id = $1", [USER_REJECT])).toEqual([]);
  });
});

describe("reglas transversales (criterios 26 a 31, 42)", () => {
  it.each(["approval", "rejection"] as const)("%s: acceso por cuenta y nada cambia", async (kind) => {
    const { first } = await seedTwo();
    await namedAccount(owner, USER_NO_ROLE);
    const own = await pendingFor(owner, USER_PENDING, { number: NUMBER_3 });
    await makeProvider(owner, USER_PROVIDER);
    await createOldVersionAccount(owner, USER_OLD_NOTICE);
    const handler = kind === "approval" ? api.approve : api.reject;
    const before = await snapshot();
    const cases: [number, number, string][] = [
      [USER_NO_ACCOUNT, 403, "consent_required"],
      [USER_OLD_NOTICE, 403, "consent_required"],
      [USER_NO_ROLE, 403, "forbidden"],
      [USER_PENDING, 403, "forbidden"],
      [USER_PROVIDER, 403, "forbidden"],
    ];
    for (const [id, status, code] of cases) {
      const res = await handler(decisionRequest(kind, first, id, { confirmed: true }), route(first));
      expect(res.status, String(id)).toBe(status);
      expect(await res.json()).toMatchObject({ code });
    }
    // La dueña del propio registro tampoco puede decidirlo.
    const own403 = await handler(decisionRequest(kind, own.registrationId, USER_PENDING, { confirmed: true }), route(own.registrationId));
    expect(own403.status).toBe(403);
    expect(await snapshot()).toEqual({ ...before, registrations: before.registrations });
    expect(await count("notification_outbox")).toBe(0);

    const fake = failingDb();
    const unauth = kind === "approval" ? approveProviderRegistrationHandler({ ...api.deps, db: () => fake.db }) : null;
    if (unauth) {
      const res = await unauth(decisionRequest(kind, first, ADMIN_1, { confirmed: true }, {}), route(first));
      expect(res.status).toBe(401);
      expect(fake.queries).toEqual([]);
    }
    const noHeader = await handler(decisionRequest(kind, first, ADMIN_1, { confirmed: true }, {}), route(first));
    expect(noHeader.status).toBe(401);
    const tampered = await handler(decisionRequest(kind, first, ADMIN_1, { confirmed: true }, tma(signInitData({ userId: ADMIN_1, tamperUserId: ADMIN_2 }))), route(first));
    expect(tampered.status).toBe(401);
  });

  it("orden: 401, 403, 422, 404, 409 invalid_state_transition y 409 role_conflict", async () => {
    const { first } = await seedTwo();
    await namedAccount(owner, USER_NO_ROLE);
    // 401 antes que 403 y 422.
    expect((await api.approve(decisionRequest("approval", "x", USER_NO_ROLE, {}, {}), route("x"))).status).toBe(401);
    // 403 consent_required antes que 403 forbidden: cuenta con aviso anterior que además no es admin.
    await createOldVersionAccount(owner, USER_OLD_NOTICE);
    const consent = await api.approve(decisionRequest("approval", "x", USER_OLD_NOTICE, {}), route("x"));
    expect(await consent.json()).toMatchObject({ code: "consent_required" });
    // 403 antes que 422.
    expect((await api.approve(decisionRequest("approval", "x", USER_NO_ROLE, {}), route("x"))).status).toBe(403);
    // 422 antes que 404: id inexistente con confirmed ausente.
    expect((await api.approve(decisionRequest("approval", UNKNOWN_ID, ADMIN_1, {}), route(UNKNOWN_ID))).status).toBe(422);
    // 404 antes que 409.
    expect((await api.approve(decisionRequest("approval", UNKNOWN_ID, ADMIN_1, { confirmed: true }), route(UNKNOWN_ID))).status).toBe(404);
    // invalid_state_transition antes que role_conflict: decidido, y luego su cuenta recibe el permiso admin.
    await api.reject(decisionRequest("rejection", first, ADMIN_1, { confirmed: true }), route(first));
    await grantAdminRole(owner, USER_APPROVE);
    const res = await api.approve(decisionRequest("approval", first, ADMIN_1, { confirmed: true }), route(first));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "invalid_state_transition" });
  });

  it("id UUID inexistente: 404 problem+json en ambas operaciones y sin crear nada", async () => {
    await seedTwo();
    const before = await snapshot();
    for (const [kind, handler] of [["approval", api.approve], ["rejection", api.reject]] as const) {
      const res = await handler(decisionRequest(kind, UNKNOWN_ID, ADMIN_1, { confirmed: true }), route(UNKNOWN_ID));
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
    }
    expect(await snapshot()).toEqual(before);
  });

  it("decidir dos veces: 409 invalid_state_transition y nada cambia ni se duplica", async () => {
    const { first, second } = await seedTwo();
    await api.approve(decisionRequest("approval", first, ADMIN_1, { confirmed: true }), route(first));
    await api.reject(decisionRequest("rejection", second, ADMIN_1, { confirmed: true }), route(second));
    const before = await snapshot();
    for (const id of [first, second]) {
      for (const [kind, handler] of [["approval", api.approve], ["rejection", api.reject]] as const) {
        const res = await handler(decisionRequest(kind, id, ADMIN_1, { confirmed: true }), route(id));
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: "invalid_state_transition" });
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  it("D-038: si la cuenta obtuvo el permiso admin, aprobar da 409 role_conflict y nada cambia; rechazar da 200", async () => {
    const { first, second } = await seedTwo();
    await grantAdminRole(owner, USER_APPROVE);
    await grantAdminRole(owner, USER_REJECT);
    const before = await snapshot();
    const res = await api.approve(decisionRequest("approval", first, ADMIN_1, { confirmed: true }), route(first));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "role_conflict" });
    expect(await snapshot()).toEqual(before);
    // La base no permite el cruce aunque el servicio falle (disparador de F002), con el rol eje_app.
    await expect(
      api.db
        .insertInto("role_grants")
        .values({ telegram_user_id: USER_APPROVE, role: "provider", provider_registration_id: first, is_principal: false, granted_by_account_id: null, revoked_at: null, revoked_by_account_id: null })
        .execute(),
    ).rejects.toThrow();
    // Rechazar no crea permisos, por lo que no hay conflicto (D-097).
    const rejected = await api.reject(decisionRequest("rejection", second, ADMIN_1, { confirmed: true }), route(second));
    expect(rejected.status).toBe(200);
    expect(await rows("select * from app.role_grants where role = 'provider'")).toEqual([]);
  });
});

describe("secreto de los datos personales (criterios 34 y 35)", () => {
  it("el número y el tipo no aparecen en logs, avisos ni respuestas de error", async () => {
    const { first } = await seedTwo();
    const responses: string[] = [];
    for (const res of [
      await api.approve(decisionRequest("approval", first, ADMIN_1, { confirmed: true }), route(first)),
      await api.approve(decisionRequest("approval", first, ADMIN_1, { confirmed: true }), route(first)),
      await api.reject(decisionRequest("rejection", first, USER_NO_ROLE, { confirmed: true, reason: REASON }), route(first)),
    ]) {
      responses.push(await res.text());
    }
    // Solo la respuesta de la decisión del administrador lleva el número.
    expect(responses[0]).toContain(NUMBER_1);
    expect(responses[1]).not.toContain(NUMBER_1);
    expect(responses[2]).not.toContain(NUMBER_1);
    await flushAfter();
    const text = [...logs, ...api.sent.map((m) => m.text)].join("\n");
    for (const value of [NUMBER_1, REASON, "CC"]) expect(text).not.toContain(value);
  });
});
