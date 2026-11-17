import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF_REVOKE_ASK, SELF_REVOKE_CANCEL, SELF_REVOKE_CONFIRM } from "@/bot/self-revoke";
import { es } from "@/bot/texts/es";
import {
  ADMIN_A, admin, NO_ROLE, OLD_NOTICE, oldNoticePerson, PENDING, pendingPerson, person, PRINCIPAL, principal, PROVIDER_A, provider,
  revokedAdmin, REVOKED_ADMIN, snapshot,
} from "../factories/revocation";
import { createRegistration } from "../factories/review";
import { buttonsOf, createTestBot, noRoleMenu, pendingMenu, type ApiCall } from "../helpers/bot";
import { NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F034: opción "Revocar mi autorización" en el bot (criterios 1 a 11, 20 a 26, 32 a 34).
const ALL = ["accounts", "bot_sessions", "rate_limit_counters", "provider_registrations", "role_grants", "consent_events", "audit_events", "notification_outbox"];
const NO_ACCOUNT = 900000098;
const REGISTER = "provider:register";
const ACCEPT = `consent:accept:${NOTICE_VERSION}`;

let owner: Pool;
const t = createTestBot();
const logs: string[] = [];
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const press = (id: number, data: string) => callbackUpdate(data, { fromId: id });
const start = (id: number) => textUpdate("/start", { fromId: id });
const state = () => snapshot(owner, ALL);
const keyboardOf = (call: ApiCall) =>
  ((call.payload.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const allButtons = () => t.messages().flatMap((m) => buttonsOf(m.payload));
const revokedEvents = () => rows("select channel, notice_version from app.consent_events where event = 'revoked'");
const accountId = async (id: number) => (await rows("select id from app.accounts where telegram_user_id = $1", [id]))[0]?.id as string | undefined;
const withSession = async (id: number) =>
  void (await owner.query("insert into app.bot_sessions (account_id, data) values ($1, '{\"form\":\"provider_registration\",\"step\":\"type\"}')", [await accountId(id)]));
// Cuenta con registro aprobado y el permiso de prestador ya revocado (F006): sin rol activo.
async function approvedWithoutRole(id: number) {
  await provider(owner, id);
  await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1", [id]);
}
const NOTICE_BUTTONS = [es.notice.accept, es.notice.decline];
const expectNotice = () => {
  expect(t.messages()).toHaveLength(3);
  expect(buttonsOf(t.messages()[0].payload)).toEqual([]);
  expect(buttonsOf(t.messages()[1].payload)).toEqual([]);
  expect(buttonsOf(t.messages()[2].payload)).toEqual(NOTICE_BUTTONS);
};

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
});
afterEach(async () => {
  await owner.query("drop trigger if exists test_fail_f034_bot on app.consent_events");
  await owner.query("drop function if exists app.test_fail_f034_bot()");
});

describe("paso 1 y 2: la opción y la frase en el inicio (criterios 1 a 5)", () => {
  it("1 y 5: la cuenta sin rol ve el botón con el texto exacto y la frase en el mismo mensaje", async () => {
    await person(owner, NO_ROLE);
    await t.send(start(NO_ROLE));
    expect(t.texts()).toEqual([noRoleMenu]);
    expect(t.texts()[0].endsWith(`\n\n${es.selfRevoke.note}`)).toBe(true);
    expect(keyboardOf(t.messages()[0])).toEqual([
      { text: es.menu.registerButton, callback_data: REGISTER },
      { text: "Revocar mi autorización", callback_data: SELF_REVOKE_ASK },
    ]);
  });

  it("2: con registro pendiente, aprobado sin permiso activo o rechazado también ve el botón; registrarse va antes", async () => {
    await pendingPerson(owner, PENDING);
    await t.send(start(PENDING));
    expect(t.texts()).toEqual([pendingMenu]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.selfRevoke.button]);

    t.clear();
    await approvedWithoutRole(PROVIDER_A);
    await t.send(start(PROVIDER_A));
    expect(t.texts()).toEqual([noRoleMenu]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.selfRevoke.button]);

    t.clear();
    await createRegistration(owner, await person(owner, NO_ROLE), { status: "rejected" });
    await t.send(start(NO_ROLE));
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.menu.registerButton, es.selfRevoke.button]);

    t.clear();
    await revokedAdmin(owner, REVOKED_ADMIN);
    await t.send(start(REVOKED_ADMIN));
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.menu.registerButton, es.selfRevoke.button]);
  });

  it.each([
    ["administrador", async (): Promise<void> => void (await admin(owner, ADMIN_A)), ADMIN_A],
    ["principal con fila", async (): Promise<void> => principal(owner, true), PRINCIPAL],
    ["principal sin fila", async (): Promise<void> => principal(owner, false), PRINCIPAL],
    ["prestador", async (): Promise<void> => void (await provider(owner, PROVIDER_A)), PROVIDER_A],
  ] as const)("3 y 5: %s no recibe el botón ni la frase", async (_label, seed, id) => {
    await seed();
    await t.send(start(id));
    expect(allButtons()).not.toContain(es.selfRevoke.button);
    expect(t.texts().join("\n")).not.toContain(es.selfRevoke.note);
  });
});

describe("paso 3 y 4: pedir confirmación y cancelar (criterios 7 a 10)", () => {
  it("7: pulsar la opción pide confirmar con dos botones y no cambia nada", async () => {
    await pendingPerson(owner, PENDING);
    await withSession(PENDING);
    const before = await state();
    await t.send(press(PENDING, SELF_REVOKE_ASK));
    expect(t.texts()).toEqual([es.selfRevoke.confirm]);
    expect(keyboardOf(t.messages()[0])).toEqual([
      { text: "Sí, revocar", callback_data: SELF_REVOKE_CONFIRM },
      { text: "Cancelar", callback_data: SELF_REVOKE_CANCEL },
    ]);
    expect(await state()).toEqual(before);
  });

  it("9 y 10: cancelar responde cancelled, vuelve al menú, no cambia nada y el siguiente /start muestra el menú", async () => {
    await pendingPerson(owner, PENDING);
    await withSession(PENDING);
    const before = await state();
    const accepted = (await rows("select consent_notice_version, consent_accepted_at from app.accounts"))[0];
    await t.send(press(PENDING, SELF_REVOKE_ASK));
    t.clear();
    await t.send(press(PENDING, SELF_REVOKE_CANCEL));
    expect(t.texts()).toEqual([es.selfRevoke.cancelled, pendingMenu]);
    expect(buttonsOf(t.messages()[1].payload)).toEqual([es.selfRevoke.button]);
    expect(await state()).toEqual(before);
    expect((await rows("select consent_notice_version, consent_accepted_at from app.accounts"))[0]).toEqual(accepted);
    t.clear();
    await t.send(start(PENDING));
    expect(t.texts()).toEqual([pendingMenu]);
    expect(await revokedEvents()).toEqual([]);
  });
});

describe("paso 5: confirmar (criterio 11)", () => {
  it("11: Sí, revocar responde revoked, borra la cuenta y guarda una prueba con canal bot", async () => {
    await pendingPerson(owner, PENDING);
    await t.send(press(PENDING, SELF_REVOKE_ASK));
    t.clear();
    await t.send(press(PENDING, SELF_REVOKE_CONFIRM));
    expect(t.texts()).toEqual([es.selfRevoke.revoked]);
    expect(await accountId(PENDING)).toBeUndefined();
    expect(await revokedEvents()).toEqual([{ channel: "bot", notice_version: NOTICE_VERSION }]);
    expect(await count("provider_registrations")).toBe(0);
  });
});

describe("pasos 7 y 8: volver a usar el bot (criterios 20 a 25)", () => {
  async function revokeNow(id: number) {
    await t.send(press(id, SELF_REVOKE_ASK));
    await t.send(press(id, SELF_REVOKE_CONFIRM));
    t.clear();
  }

  it("20: /start envía el aviso en tres mensajes, con los botones solo en el último, sin menú", async () => {
    await person(owner, NO_ROLE);
    await revokeNow(NO_ROLE);
    await t.send(start(NO_ROLE));
    expectNotice();
    expect(t.texts().join("\n")).not.toContain(es.menu.welcome);
  });

  it("21: cualquier mensaje o botón antiguo recibe el aviso y no ejecuta nada", async () => {
    await person(owner, NO_ROLE);
    await revokeNow(NO_ROLE);
    const before = await state();
    for (const update of [press(NO_ROLE, SELF_REVOKE_CONFIRM), press(NO_ROLE, SELF_REVOKE_ASK), press(NO_ROLE, REGISTER), textUpdate("hola", { fromId: NO_ROLE })]) {
      t.clear();
      await t.send(update);
      expectNotice();
    }
    expect(await state()).toEqual(before);
    expect(await accountId(NO_ROLE)).toBeUndefined();
    expect(await revokedEvents()).toHaveLength(1);
  });

  it("22: una segunda pulsación (en secuencia o simultánea) revoca una sola vez, muestra el aviso y no el error", async () => {
    await person(owner, NO_ROLE);
    await t.send(press(NO_ROLE, SELF_REVOKE_CONFIRM));
    t.clear();
    await t.send(press(NO_ROLE, SELF_REVOKE_CONFIRM));
    expectNotice();
    expect(await revokedEvents()).toHaveLength(1);

    await resetDb(owner);
    t.clear();
    await person(owner, NO_ROLE);
    await Promise.all([t.send(press(NO_ROLE, SELF_REVOKE_CONFIRM)), t.send(press(NO_ROLE, SELF_REVOKE_CONFIRM))]);
    expect(await revokedEvents()).toHaveLength(1);
    expect(t.texts().filter((x) => x === es.selfRevoke.revoked)).toHaveLength(1);
    expect(t.texts()).not.toContain(es.selfRevoke.error);
    expect(t.messages().filter((m) => buttonsOf(m.payload).join() === NOTICE_BUTTONS.join())).toHaveLength(1);
  });

  it("23: Acepto crea una cuenta nueva, sin datos anteriores, y el /start siguiente muestra el menú de visitante", async () => {
    await pendingPerson(owner, PENDING);
    await withSession(PENDING);
    const oldId = await accountId(PENDING);
    await revokeNow(PENDING);
    await t.send(press(PENDING, ACCEPT));
    expect(t.texts()).toEqual([noRoleMenu]);
    const newId = await accountId(PENDING);
    expect(newId).toBeDefined();
    expect(newId).not.toBe(oldId);
    expect((await rows("select consent_notice_version from app.accounts"))[0].consent_notice_version).toBe(NOTICE_VERSION);
    expect(await rows("select event from app.consent_events order by id")).toEqual([{ event: "revoked" }, { event: "accepted" }]);
    expect(await count("provider_registrations")).toBe(0);
    expect(await count("bot_sessions")).toBe(0);
    expect(await count("role_grants")).toBe(0);
    t.clear();
    await t.send(start(PENDING));
    expect(t.texts()).toEqual([noRoleMenu]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.menu.registerButton, es.selfRevoke.button]);
  });

  it("24: el ciclo se puede repetir y deja dos eventos revoked", async () => {
    await person(owner, NO_ROLE);
    for (let round = 0; round < 2; round++) {
      await revokeNow(NO_ROLE);
      await t.send(press(NO_ROLE, ACCEPT));
      t.clear();
    }
    await t.send(press(NO_ROLE, SELF_REVOKE_ASK));
    await t.send(press(NO_ROLE, SELF_REVOKE_CONFIRM));
    expect(t.texts().at(-1)).toBe(es.selfRevoke.revoked);
    expect(await revokedEvents()).toHaveLength(2 + 1);
  });

  it("25: No acepto después de revocar no guarda nada", async () => {
    await person(owner, NO_ROLE);
    await revokeNow(NO_ROLE);
    const before = await state();
    await t.send(press(NO_ROLE, "consent:decline"));
    expect(t.texts()).toEqual([es.decline.text]);
    expect(await accountId(NO_ROLE)).toBeUndefined();
    expect(await state()).toEqual(before);
  });
});

describe("paso 9: nunca un código (criterio 26)", () => {
  it("ningún mensaje del recorrido pide, envía o menciona un código", async () => {
    await pendingPerson(owner, PENDING);
    await t.send(start(PENDING));
    await t.send(press(PENDING, SELF_REVOKE_ASK));
    await t.send(press(PENDING, SELF_REVOKE_CANCEL));
    await t.send(press(PENDING, SELF_REVOKE_ASK));
    await t.send(press(PENDING, SELF_REVOKE_CONFIRM));
    await t.send(start(PENDING));
    await t.send(press(PENDING, ACCEPT));
    // El aviso de privacidad aprobado (F001) dice "No necesitas ningún código"; se revisa todo lo demás que envía el bot.
    const messages = t.messages();
    const inNotice = new Set(messages.flatMap((m, i) => (buttonsOf(m.payload).join() === NOTICE_BUTTONS.join() ? [i - 2, i - 1, i] : [])));
    const own = messages.filter((_, i) => !inNotice.has(i));
    expect(own.length).toBeGreaterThan(5);
    const everything = own.map((m) => `${m.payload.text} ${buttonsOf(m.payload).join(" ")}`).join("\n").toLowerCase();
    for (const word of ["código", "codigo", "otp"]) expect(everything).not.toContain(word);
  });
});

describe("control de acceso y errores (criterios 32 a 34)", () => {
  it.each([
    ["prestador", async (): Promise<void> => void (await provider(owner, PROVIDER_A)), PROVIDER_A],
    ["administrador", async (): Promise<void> => void (await admin(owner, ADMIN_A)), ADMIN_A],
    ["principal", async (): Promise<void> => principal(owner, false), PRINCIPAL],
  ] as const)("32: el botón antiguo de %s con rol activo responde blocked y no ejecuta nada", async (_label, seed, id) => {
    await seed();
    const before = await state();
    for (const data of [SELF_REVOKE_CONFIRM, SELF_REVOKE_ASK, SELF_REVOKE_CANCEL]) {
      t.clear();
      await t.send(press(id, data));
      expect(t.texts()).toEqual([es.selfRevoke.blocked]);
    }
    expect(await accountId(id)).toBeDefined();
    expect(await revokedEvents()).toEqual([]);
    // D-101: la fila del principal se crea en su primera actualización; no es un efecto de revocar.
    const kept = ALL.filter((table) => id !== PRINCIPAL || table !== "role_grants");
    expect(await snapshot(owner, kept)).toEqual(Object.fromEntries(kept.map((table) => [table, before[table]])));
  });

  it("32: con el aviso desactualizado o sin cuenta recibe el aviso", async () => {
    await oldNoticePerson(owner, OLD_NOTICE);
    for (const id of [OLD_NOTICE, NO_ACCOUNT]) {
      t.clear();
      await t.send(press(id, SELF_REVOKE_CONFIRM));
      expectNotice();
    }
    expect(await accountId(OLD_NOTICE)).toBeDefined();
    expect(await revokedEvents()).toEqual([]);
  });

  it("33: un callback_data mal formado se ignora sin mensaje y sin cambios; de quien no tiene cuenta recibe el aviso", async () => {
    await pendingPerson(owner, PENDING);
    const before = await state();
    for (const data of ["srv:zzz", "srv:yes:1", "srv:", `srv:${"x".repeat(80)}`]) {
      t.clear();
      await t.send(press(PENDING, data));
      expect(t.messages()).toEqual([]);
    }
    expect(await state()).toEqual(before);
    t.clear();
    await t.send(press(NO_ACCOUNT, "srv:zzz"));
    expectNotice();
  });

  it("34: si falla la base responde selfRevoke.error sin texto técnico, deja la cuenta intacta y permite reintentar", async () => {
    await pendingPerson(owner, PENDING);
    await owner.query(
      "create function app.test_fail_f034_bot() returns trigger language plpgsql as $$ begin if new.event = 'revoked' then raise exception 'fallo-inyectado-secreto'; end if; return new; end $$",
    );
    await owner.query("create trigger test_fail_f034_bot before insert on app.consent_events for each row execute function app.test_fail_f034_bot()");
    const before = await state();
    await t.send(press(PENDING, SELF_REVOKE_CONFIRM));
    expect(t.texts()).toEqual([es.selfRevoke.error]);
    expect(t.texts().join("")).not.toContain("fallo-inyectado-secreto");
    expect(await state()).toEqual(before);
    await owner.query("drop trigger test_fail_f034_bot on app.consent_events");
    t.clear();
    await t.send(press(PENDING, SELF_REVOKE_CONFIRM));
    expect(t.texts()).toEqual([es.selfRevoke.revoked]);
    expect(await accountId(PENDING)).toBeUndefined();
  });
});
