import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { createAccount } from "../factories/accounts";
import {
  account, ADMIN_A, ADMIN_B, admin, NO_ROLE, OLD_NOTICE, PERSON_NO_ACCOUNT, PERSON_WITH_ACCOUNT,
  seedAll, WITH_PENDING, WITH_PROVIDER, WITH_REJECTED,
} from "../factories/admin-auth";
import { TEST_PRINCIPAL_ADMIN_ID } from "../helpers/config";
import { buttonsOf, createTestBot, noRoleMenu, pendingMenu, type ApiCall } from "../helpers/bot";
import { NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

const START = "auth:start";
const CONFIRM = "auth:confirm";
const CANCEL = "auth:cancel";
const PRINCIPAL = TEST_PRINCIPAL_ADMIN_ID;
const TARGET = "900000052";

let clock = new Date("2026-11-16T15:00:00Z");
let owner: Pool;
const t = createTestBot({ now: () => clock });
const logs: string[] = [];
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const tables = async () => ({ grants: await count("role_grants"), audit: await count("audit_events"), outbox: await count("notification_outbox") });
const press = (id: number, data: string) => callbackUpdate(data, { fromId: id });
const typed = (id: number, text: string) => textUpdate(text, { fromId: id });
const start = (id: number) => typed(id, "/start");
const session = async (accountId: string) => (await rows("select data from app.bot_sessions where account_id = $1", [accountId]))[0]?.data;
const idOf = async (telegramUserId: number) => (await rows("select id from app.accounts where telegram_user_id = $1", [telegramUserId]))[0].id as string;
const callbacksOf = (call: ApiCall) =>
  ((call.payload.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const photo = (id: number) => {
  const u = textUpdate("x", { fromId: id });
  const message: Record<string, unknown> = { ...u.message };
  delete message.text;
  return { ...u, message: { ...message, photo: [{ file_id: "f", file_unique_id: "u", width: 1, height: 1 }] } };
};
const seedSession = (accountId: string, data: unknown) =>
  // `updated_at` con precisión de milisegundos, como lo escribe la aplicación (el bloqueo optimista compara fechas de JS).
  owner.query(
    "insert into app.bot_sessions (account_id, data, updated_at) values ($1, $2, $3) on conflict (account_id) do update set data = $2, updated_at = $3",
    [accountId, JSON.stringify(data), clock],
  );

beforeAll(() => {
  owner = ownerPool();
  for (const level of ["log", "warn", "error", "info"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  t.clear();
  logs.length = 0;
  clock = new Date("2026-11-16T15:00:00Z");
});
afterEach(async () => {
  for (const table of ["role_grants", "audit_events"]) await owner.query(`drop trigger if exists test_fail on app.${table}`);
});

// Lleva a la cuenta hasta la confirmación del ID dado.
async function toConfirm(adminId: number, target: string = TARGET) {
  await t.send(press(adminId, START));
  await t.send(typed(adminId, target));
}

describe("paso 1: el principal entra sin registro (criterios 1, 2, 4 y 5)", () => {
  it("sin cuenta previa: aviso, menú de administrador, sin pedir documento y con una sola fila is_principal", async () => {
    await t.send(start(PRINCIPAL));
    expect(t.messages()).toHaveLength(3);
    t.clear();
    await t.send(press(PRINCIPAL, `consent:accept:${NOTICE_VERSION}`));
    expect(t.texts()).toEqual([es.menu.welcome]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.admin.pendingButton, es.admin.authorizeButton, es.revoke.button]);
    const grant = async () => rows("select * from app.role_grants");
    expect(await grant()).toHaveLength(1);
    expect((await grant())[0]).toMatchObject({ role: "admin", is_principal: true, revoked_at: null, provider_registration_id: null, granted_by_account_id: null });
    await t.send(start(PRINCIPAL));
    await t.send(press(PRINCIPAL, `consent:accept:${NOTICE_VERSION}`));
    expect(await grant()).toHaveLength(1);
    for (const text of t.texts()) {
      for (const forbidden of [es.provider.askType, es.provider.askNumber, ...Object.values(es.provider.typeButtons)]) expect(text).not.toContain(forbidden);
    }
    expect(await count("provider_registrations")).toBe(0);
    expect(await count("bot_sessions")).toBe(0);
  });

  it("un principal con cuenta y sin fila (sembrada así) la obtiene en su siguiente /start", async () => {
    await createAccount(owner, PRINCIPAL);
    expect(await count("role_grants")).toBe(0);
    await t.send(start(PRINCIPAL));
    expect(await rows("select is_principal from app.role_grants")).toEqual([{ is_principal: true }]);
  });

  it("otro ID no obtiene fila ni botón de administrador", async () => {
    await t.send(press(NO_ROLE, `consent:accept:${NOTICE_VERSION}`));
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.menu.registerButton, es.selfRevoke.button]);
    expect(await count("role_grants")).toBe(0);
  });

  it("con la fila is_principal de otro ID activa, el principal actual entra sin error y sin segunda fila", async () => {
    await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values (900000098, 'admin', true)");
    await t.send(press(PRINCIPAL, `consent:accept:${NOTICE_VERSION}`));
    expect(t.texts()).toEqual([es.menu.welcome]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.admin.pendingButton, es.admin.authorizeButton, es.revoke.button]);
    expect(await count("role_grants")).toBe(1);
  });
});

describe("pasos 2 y 3: ID y confirmación (criterios 6 a 12)", () => {
  it.each([[ADMIN_A], [PRINCIPAL]])("la cuenta %s pulsa Autorizar administrador y recibe askId con Cancelar", async (id) => {
    await admin(owner, ADMIN_A);
    await createAccount(owner, PRINCIPAL);
    // El principal obtiene su fila is_principal en su primera actualización (D-101); se mide después de ella.
    await t.send(start(id));
    t.clear();
    const before = await tables();
    await t.send(press(id, START));
    expect(t.texts()).toEqual([es.adminAuth.askId]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.adminAuth.cancelButton]);
    expect(await session(await idOf(id))).toMatchObject({ form: "authorize_admin", step: "id" });
    expect(await tables()).toEqual(before);
  });

  it("un ID válido pide confirmación con botones que no llevan el ID; no cambia nada hasta confirmar", async () => {
    await admin(owner, ADMIN_A);
    const before = await tables();
    await toConfirm(ADMIN_A);
    expect(t.texts()).toEqual([es.adminAuth.askId, es.adminAuth.confirm(TARGET)]);
    const message = t.messages()[1];
    expect(buttonsOf(message.payload)).toEqual([es.adminAuth.confirmButton, es.adminAuth.cancelButton]);
    for (const button of callbacksOf(message)) {
      expect(Buffer.byteLength(button.callback_data!)).toBeLessThanOrEqual(64);
      expect(button.callback_data).not.toContain(TARGET);
    }
    expect(await session(await idOf(ADMIN_A))).toMatchObject({ step: "confirm", draft: { telegramUserId: TARGET } });
    expect(await tables()).toEqual(before);
  });

  it.each([[" 900000052 ", "900000052"], ["9999999999999999", "9999999999999999"]])("acepta %j", async (typedId, expected) => {
    await admin(owner, ADMIN_A);
    await toConfirm(ADMIN_A, typedId);
    expect(t.texts()[1]).toBe(es.adminAuth.confirm(expected));
  });

  it.each([["botón"], ["comando"]])("cancelar con %s en el paso del ID y en el de confirmación", async (kind) => {
    const accountId = await admin(owner, ADMIN_A);
    const cancel = () => (kind === "botón" ? press(ADMIN_A, CANCEL) : typed(ADMIN_A, "/cancelar"));
    const before = await tables();
    for (const confirmStep of [false, true]) {
      t.clear();
      await t.send(press(ADMIN_A, START));
      if (confirmStep) await t.send(typed(ADMIN_A, TARGET));
      t.clear();
      await t.send(cancel());
      expect(t.texts()).toEqual([es.adminAuth.cancelled]);
      expect(await session(accountId)).toEqual({});
      t.clear();
      await t.send(press(ADMIN_A, CONFIRM));
      expect(t.texts()).toEqual([es.adminAuth.noDraft]);
    }
    expect(await tables()).toEqual(before);
  });

  it("una sesión abandonada en confirmación no autoriza nada hasta pulsar Confirmar", async () => {
    const accountId = await admin(owner, ADMIN_A);
    await seedSession(accountId, { form: "authorize_admin", step: "confirm", draft: { telegramUserId: TARGET }, startedAt: clock.toISOString(), expiresAt: new Date(clock.getTime() + 600_000).toISOString() });
    await t.send(typed(ADMIN_A, "hola"));
    expect(await tables()).toMatchObject({ grants: 1, audit: 0 });
    await t.send(press(ADMIN_A, CONFIRM));
    expect(await tables()).toMatchObject({ grants: 2, audit: 1 });
  });

  it.each([[ADMIN_A], [PRINCIPAL]])("Confirmar con %s: authorized, una fila y sesión borrada", async (id) => {
    await admin(owner, ADMIN_A);
    const accountId = await createAccount(owner, PRINCIPAL).catch(() => idOf(PRINCIPAL));
    const actorAccount = id === PRINCIPAL ? accountId : await idOf(ADMIN_A);
    await toConfirm(id);
    t.clear();
    await t.send(press(id, CONFIRM));
    expect(t.texts()).toEqual([es.adminAuth.authorized(TARGET)]);
    const grants = await rows("select * from app.role_grants where telegram_user_id = $1", [TARGET]);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ role: "admin", is_principal: false, provider_registration_id: null, granted_by_account_id: actorAccount, revoked_at: null });
    expect(await count("audit_events")).toBe(1);
    expect(await session(await idOf(id))).toEqual({});
  });

  it.each(["role_grants", "audit_events"])("fallo al insertar en %s: adminAuth.error, nada queda y el borrador se conserva", async (table) => {
    await admin(owner, ADMIN_A);
    await toConfirm(ADMIN_A);
    const before = await tables();
    await owner.query("create or replace function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo-inyectado'; end $$");
    await owner.query(`create trigger test_fail before insert on app.${table} for each row execute function app.test_fail()`);
    t.clear();
    await t.send(press(ADMIN_A, CONFIRM));
    expect(t.texts()).toEqual([es.adminAuth.error]);
    expect(await tables()).toEqual(before);
    expect(logs.join("\n")).not.toContain(TARGET);
  });
});

describe("paso 4: la cuenta autorizada (criterios 17 a 19)", () => {
  it("con el aviso aceptado: menú de administrador sin formulario de documento; la cadena de autorizaciones funciona", async () => {
    await admin(owner, ADMIN_A);
    await account(owner, PERSON_WITH_ACCOUNT);
    await toConfirm(ADMIN_A);
    await t.send(press(ADMIN_A, CONFIRM));
    t.clear();
    await t.send(start(PERSON_WITH_ACCOUNT));
    expect(t.texts()).toEqual([es.menu.welcome]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.admin.pendingButton, es.admin.authorizeButton, es.revoke.button]);
    t.clear();
    await t.send(press(PERSON_WITH_ACCOUNT, "adm:list"));
    expect(t.texts()).toEqual([es.admin.noPending]);
    await toConfirm(PERSON_WITH_ACCOUNT, "900000070");
    await t.send(press(PERSON_WITH_ACCOUNT, CONFIRM));
    expect(t.texts().at(-1)).toBe(es.adminAuth.authorized("900000070"));
    for (const text of t.texts()) expect(text).not.toContain(es.provider.askNumber);
    expect(await count("provider_registrations")).toBe(0);
  });

  it("autorizada antes de aceptar el aviso: ve el aviso y, tras Acepto, el menú de administrador", async () => {
    await admin(owner, ADMIN_A);
    await toConfirm(ADMIN_A, String(PERSON_NO_ACCOUNT));
    await t.send(press(ADMIN_A, CONFIRM));
    t.clear();
    await t.send(start(PERSON_NO_ACCOUNT));
    expect(t.messages()).toHaveLength(3);
    expect(t.texts().join("")).not.toContain(es.menu.welcome);
    t.clear();
    await t.send(press(PERSON_NO_ACCOUNT, `consent:accept:${NOTICE_VERSION}`));
    expect(t.texts()).toEqual([es.menu.welcome]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.admin.pendingButton, es.admin.authorizeButton, es.revoke.button]);
    expect(await count("provider_registrations")).toBe(0);
    expect(await rows("select 1 from app.bot_sessions where account_id = $1", [await idOf(PERSON_NO_ACCOUNT)])).toHaveLength(0);
  });
});

describe("paso 5: duplicados y conflictos (criterios 20, 21 y 23)", () => {
  it.each([["otro administrador", ADMIN_B], ["el mismo que autoriza", ADMIN_A], ["el principal", PRINCIPAL]])("ID de %s: alreadyAdmin y nada cambia", async (_label, target) => {
    await seedAll(owner);
    const accountId = await idOf(ADMIN_A);
    const before = await tables();
    await toConfirm(ADMIN_A, String(target));
    t.clear();
    await t.send(press(ADMIN_A, CONFIRM));
    expect(t.texts()).toEqual([es.adminAuth.alreadyAdmin]);
    expect(await session(accountId)).toEqual({});
    expect(await tables()).toEqual(before);
  });

  it("permiso provider o registro pending: conflict; rejected sí se autoriza", async () => {
    await seedAll(owner);
    const before = await tables();
    for (const target of [WITH_PROVIDER, WITH_PENDING]) {
      await toConfirm(ADMIN_A, String(target));
      t.clear();
      await t.send(press(ADMIN_A, CONFIRM));
      expect(t.texts()).toEqual([es.adminAuth.conflict]);
    }
    expect(await tables()).toEqual(before);
    await toConfirm(ADMIN_A, String(WITH_REJECTED));
    t.clear();
    await t.send(press(ADMIN_A, CONFIRM));
    expect(t.texts()).toEqual([es.adminAuth.authorized(String(WITH_REJECTED))]);
  });
});

describe("paso 6: entradas inválidas (criterios 24 y 25)", () => {
  it.each(["abc", "12a4", "-5", "0", "012", "12.5", "1 2", "١٢٣", "12345678901234567", "   "])("%j repite el paso con idInvalid", async (input) => {
    await admin(owner, ADMIN_A);
    await t.send(press(ADMIN_A, START));
    const before = await tables();
    t.clear();
    await t.send(typed(ADMIN_A, input));
    expect(t.texts()).toEqual([es.adminAuth.idInvalid]);
    expect(t.texts()[0]).not.toContain(input.trim() || "\u0000");
    expect(await session(await idOf(ADMIN_A))).toMatchObject({ step: "id" });
    expect(await tables()).toEqual(before);
  });

  it("una foto en el paso del ID recibe idInvalid", async () => {
    await admin(owner, ADMIN_A);
    await t.send(press(ADMIN_A, START));
    t.clear();
    await t.send(photo(ADMIN_A));
    expect(t.texts()).toEqual([es.adminAuth.idInvalid]);
    expect(await session(await idOf(ADMIN_A))).toMatchObject({ step: "id" });
  });

  it("en la confirmación, texto o archivo reciben useButtons y la sesión no cambia; Confirmar sin sesión: noDraft", async () => {
    const accountId = await admin(owner, ADMIN_A);
    await toConfirm(ADMIN_A);
    const stored = await session(accountId);
    for (const update of [typed(ADMIN_A, "hola"), photo(ADMIN_A)]) {
      t.clear();
      await t.send(update);
      expect(t.texts()).toEqual([es.common.useButtons]);
    }
    expect(await session(accountId)).toEqual(stored);
    await t.send(press(ADMIN_A, CANCEL));
    t.clear();
    await t.send(press(ADMIN_A, CONFIRM));
    expect(t.texts()).toEqual([es.adminAuth.noDraft]);
  });
});

describe("reglas transversales (criterios 28 a 31 y 33)", () => {
  const TEXT_REPLY: [string, number, string[]][] = [
    ["sin rol", NO_ROLE, [noRoleMenu]],
    ["registro pending", WITH_PENDING, [pendingMenu]],
    ["permiso provider", WITH_PROVIDER, [es.menu.welcome, es.menu.providerAvailable]],
  ];

  it.each(TEXT_REPLY)("%s: el botón recibe admin.forbidden y un texto con un ID recibe lo de siempre, sin sesión", async (_label, id, usual) => {
    await seedAll(owner);
    const before = await tables();
    const sessions = await count("bot_sessions");
    await t.send(press(id, START));
    expect(t.texts()).toEqual([es.admin.forbidden]);
    for (const data of [CONFIRM, CANCEL]) {
      t.clear();
      await t.send(press(id, data));
      expect(t.texts()).toEqual([es.admin.forbidden]);
    }
    t.clear();
    await t.send(typed(id, TARGET));
    expect(t.texts()).toEqual(usual);
    expect(await tables()).toEqual(before);
    expect(await count("bot_sessions")).toBe(sessions);
  });

  it("sin aviso vigente (sin cuenta o aviso anterior): los 3 mensajes del aviso", async () => {
    await seedAll(owner);
    for (const id of [OLD_NOTICE, PERSON_NO_ACCOUNT + 100]) {
      t.clear();
      await t.send(press(id, START));
      expect(t.messages()).toHaveLength(3);
      expect(t.texts()).not.toContain(es.adminAuth.askId);
    }
  });

  it("si el permiso se revoca entre Autorizar administrador y Confirmar, Confirmar responde forbidden", async () => {
    await admin(owner, ADMIN_A);
    await toConfirm(ADMIN_A);
    const before = await tables();
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1", [ADMIN_A]);
    t.clear();
    await t.send(press(ADMIN_A, CONFIRM));
    expect(t.texts()).toEqual([es.admin.forbidden]);
    expect(await tables()).toEqual({ ...before });
  });

  it.each(["auth:", "auth:zzz", "auth:confirm:900000052", "auth:conf"])("callback_data %j responde admin.error", async (data) => {
    await admin(owner, ADMIN_A);
    await t.send(press(ADMIN_A, data));
    expect(t.texts()).toEqual([es.admin.error]);
    expect(await count("bot_sessions")).toBe(0);
  });

  it.each(["abc", "0123", 5, null])("sesión forjada con ID %j no autoriza, responde noDraft y se borra", async (forged) => {
    const accountId = await admin(owner, ADMIN_A);
    await seedSession(accountId, { form: "authorize_admin", step: "confirm", draft: { telegramUserId: forged }, expiresAt: new Date(clock.getTime() + 600_000).toISOString() });
    await t.send(press(ADMIN_A, CONFIRM));
    expect(t.texts()).toEqual([es.adminAuth.noDraft]);
    expect(await session(accountId)).toEqual({});
    expect(await tables()).toMatchObject({ grants: 1, audit: 0 });
  });

  it("ningún mensaje ni registro técnico del flujo completo repite el ID autorizado fuera de confirm y authorized; no hay aviso a la persona", async () => {
    await admin(owner, ADMIN_A);
    await account(owner, PERSON_WITH_ACCOUNT);
    await toConfirm(ADMIN_A);
    await t.send(press(ADMIN_A, CONFIRM));
    for (const call of t.messages()) {
      const text = String(call.payload.text);
      if (text !== es.adminAuth.confirm(TARGET) && text !== es.adminAuth.authorized(TARGET)) expect(text).not.toContain(TARGET);
      expect(String(call.payload.chat_id)).toBe(String(ADMIN_A));
      for (const button of callbacksOf(call)) expect(button.callback_data).not.toContain(TARGET);
    }
    expect(logs.join("\n")).not.toContain(TARGET);
    expect(logs.join("\n")).not.toContain(CONFIRM);
    expect((await rows("select details from app.audit_events"))[0].details).toEqual({});
    expect(JSON.stringify(await rows("select * from app.audit_events"))).not.toContain(TARGET);
    expect(await count("notification_outbox")).toBe(0);
    // Sin números ni tipos de documento en ningún mensaje.
    for (const text of t.texts()) for (const value of ["1020304050", "ab123", "cédula", "pasaporte"]) expect(text).not.toContain(value);
  });
});

describe("sesión vencida y formulario en curso (criterios 38 y 39a)", () => {
  it("Confirmar vencida responde noDraft sin filas; con el reloj anterior sí autoriza; un ID con la sesión vencida en el paso del ID inicia de nuevo", async () => {
    const accountId = await admin(owner, ADMIN_A);
    await toConfirm(ADMIN_A);
    const stored = await session(accountId);
    expect(new Date(stored.expiresAt).getTime()).toBe(clock.getTime() + 600_000);
    const expiry = new Date(stored.expiresAt);
    clock = new Date(expiry.getTime() + 1000);
    t.clear();
    await t.send(press(ADMIN_A, CONFIRM));
    expect(t.texts()).toEqual([es.adminAuth.noDraft]);
    expect(await session(accountId)).toEqual({});
    expect(await tables()).toMatchObject({ grants: 1, audit: 0 });

    // Control positivo: antes del vencimiento sí autoriza.
    clock = new Date("2026-11-16T16:00:00Z");
    await toConfirm(ADMIN_A);
    clock = new Date(clock.getTime() + 599_000);
    t.clear();
    await t.send(press(ADMIN_A, CONFIRM));
    expect(t.texts()).toEqual([es.adminAuth.authorized(TARGET)]);

    // Paso del ID vencido: el ID escrito reinicia el formulario.
    clock = new Date("2026-11-16T17:00:00Z");
    await t.send(press(ADMIN_A, START));
    clock = new Date(clock.getTime() + 601_000);
    t.clear();
    await t.send(typed(ADMIN_A, "900000090"));
    expect(t.texts()).toEqual([es.adminAuth.askId]);
    expect(await session(accountId)).toMatchObject({ step: "id", draft: {} });
  });

  it("con otro formulario abierto, Autorizar administrador lo reemplaza sin copiar su borrador", async () => {
    const accountId = await admin(owner, ADMIN_A);
    await seedSession(accountId, { form: "provider_registration", step: "number", draft: { identityDocumentType: "CC" }, expiresAt: null });
    await t.send(press(ADMIN_A, START));
    expect(t.texts()).toEqual([es.adminAuth.askId]);
    const stored = await session(accountId);
    expect(stored).toMatchObject({ form: "authorize_admin", step: "id", draft: {} });
    expect(JSON.stringify(stored)).not.toContain("identityDocumentType");
  });
});

// La prueba de sesiones forjadas arriba usa botones; el botón "Cancelar" de un administrador sin sesión no falla.
it("Cancelar sin sesión responde cancelled sin crear nada", async () => {
  await admin(owner, ADMIN_A);
  await t.send(press(ADMIN_A, CANCEL));
  expect(t.texts()).toEqual([es.adminAuth.cancelled]);
  expect(await tables()).toMatchObject({ grants: 1, audit: 0 });
});
