import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF_REVOKE_ASK, SELF_REVOKE_CANCEL, SELF_REVOKE_CONFIRM } from "@/bot/self-revoke";
import { es } from "@/bot/texts/es";
import { createAccount, createOldVersionAccount } from "../factories/accounts";
import { snapshot } from "../factories/revocation";
import { makeProvider } from "../factories/review";
import { buttonsOf, createTestBot, type ApiCall } from "../helpers/bot";
import { NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { adminCallbacks } from "../helpers/provider-denial";
import { seedRoleDenial } from "../helpers/role-denial";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F035: efectos de revocar en el bot para prestador y administrador (contrato F035, criterios 1 a 5, 15 a 18, 23, 24, 26, 28, 32, 35, 36 y 43).
const ALL = ["accounts", "bot_sessions", "rate_limit_counters", "provider_registrations", "role_grants", "consent_events", "audit_events", "notification_outbox"];
const PROV = 900000351;
const ADM_X = 900000354;
const ADM_Y = 900000355;
const BOTH = 900000357;
const OLD = 900000358;
const PRINCIPAL = 900000099;
const NUMBER = "7700035101";
const WELCOME = `${es.menu.welcome}\n\n${es.selfRevoke.note}`;
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
const addAdmin = async (id: number) => {
  await createAccount(owner, id, `Administrador Ficticio ${id}`);
  await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [id]);
};
const addProvider = (id: number) => makeProvider(owner, id, NUMBER);
const accountId = async (id: number) => (await rows("select id from app.accounts where telegram_user_id = $1", [id]))[0]?.id as string | undefined;
const noTrace = async (id: number) => {
  for (const table of ["role_grants", "notification_outbox"]) {
    const column = table === "role_grants" ? "telegram_user_id" : "recipient_telegram_user_id";
    expect(await rows(`select 1 from app.${table} where ${column} = $1`, [id]), table).toEqual([]);
  }
  expect(await accountId(id)).toBeUndefined();
};
const expectNotice = () => {
  expect(t.texts()).toHaveLength(3);
  expect(buttonsOf(t.messages()[2].payload)).toEqual([es.notice.accept, es.notice.decline]);
  expect(buttonsOf(t.messages()[0].payload)).toEqual([]);
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
  await owner.query("drop trigger if exists test_fail_f035_bot on app.consent_events");
  await owner.query("drop function if exists app.test_fail_f035_bot()");
});

describe("prestador (criterios 1 a 5 y 35)", () => {
  it("1: /start muestra menu.welcome con la frase y el botón; providerAvailable aparte y sin cambios", async () => {
    await addProvider(PROV);
    await t.send(start(PROV));
    expect(t.texts()).toEqual([WELCOME, es.menu.providerAvailable]);
    expect(keyboardOf(t.messages()[0])).toEqual([{ text: "Revocar mi autorización", callback_data: SELF_REVOKE_ASK }]);
    expect(t.messages()[1].payload.reply_markup).toBeUndefined();
  });

  it("2 y 3: pedir muestra confirmProvider con dos botones sin cambios; cancelar reenvía el menú y conserva el permiso", async () => {
    await addProvider(PROV);
    const before = await state();
    await t.send(press(PROV, SELF_REVOKE_ASK));
    expect(t.texts()).toEqual([es.selfRevoke.confirmProvider]);
    expect(es.selfRevoke.confirmProvider).toContain("número de identidad");
    expect(es.selfRevoke.confirmProvider).toContain("rol de prestador");
    expect(keyboardOf(t.messages()[0])).toEqual([
      { text: es.selfRevoke.confirmButton, callback_data: SELF_REVOKE_CONFIRM },
      { text: es.selfRevoke.cancelButton, callback_data: SELF_REVOKE_CANCEL },
    ]);
    expect(await state()).toEqual(before);
    t.clear();
    await t.send(press(PROV, SELF_REVOKE_CANCEL));
    expect(t.texts()).toEqual([es.selfRevoke.cancelled, WELCOME, es.menu.providerAvailable]);
    expect(buttonsOf(t.messages()[1].payload)).toEqual([es.selfRevoke.button]);
    expect(await state()).toEqual(before);
  });

  it("4 y 5: confirmar borra todo; el siguiente /start y los botones antiguos reciben el aviso y no ejecutan nada", async () => {
    await addProvider(PROV);
    await owner.query("insert into app.notification_outbox (recipient_telegram_user_id, template) values ($1, 'registration_approved')", [PROV]);
    await t.send(press(PROV, SELF_REVOKE_ASK));
    t.clear();
    await t.send(press(PROV, SELF_REVOKE_CONFIRM));
    expect(t.texts()).toEqual([es.selfRevoke.revoked]);
    await noTrace(PROV);
    for (const table of ["provider_registrations", "bot_sessions", "rate_limit_counters"]) expect(await count(table), table).toBe(0);
    expect(await rows("select channel from app.consent_events where event = 'revoked'")).toEqual([{ channel: "bot" }]);
    const before = await state();
    for (const update of [start(PROV), press(PROV, SELF_REVOKE_CONFIRM), press(PROV, SELF_REVOKE_ASK), press(PROV, "provider:register")]) {
      t.clear();
      await t.send(update);
      expectNotice();
    }
    expect(await state()).toEqual(before);
  });

  it("14: tras revocar y aceptar de nuevo, la cuenta nueva ve el botón de registrarse y ningún rol", async () => {
    await addProvider(PROV);
    await t.send(press(PROV, SELF_REVOKE_CONFIRM));
    t.clear();
    await t.send(press(PROV, ACCEPT));
    expect(t.texts()).toEqual([WELCOME]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.menu.registerButton, es.selfRevoke.button]);
    expect(await count("role_grants")).toBe(0);
  });

  it("35: si la base falla responde selfRevoke.error sin texto técnico y deja la cuenta intacta", async () => {
    await addProvider(PROV);
    await owner.query("create function app.test_fail_f035_bot() returns trigger language plpgsql as $$ begin if new.event = 'revoked' then raise exception 'fallo-inyectado-secreto'; end if; return new; end $$");
    await owner.query("create trigger test_fail_f035_bot before insert on app.consent_events for each row execute function app.test_fail_f035_bot()");
    const before = await state();
    await t.send(press(PROV, SELF_REVOKE_CONFIRM));
    expect(t.texts()).toEqual([es.selfRevoke.error]);
    expect(t.texts().join("")).not.toContain("fallo-inyectado-secreto");
    expect(await state()).toEqual(before);
  });
});

describe("administrador que no es principal ni único (criterios 15 a 18)", () => {
  it("15 y 16: el menú conserva sus botones y agrega revocar; pedir muestra confirmAdmin; cancelar reenvía el menú", async () => {
    await addAdmin(ADM_X);
    await addAdmin(ADM_Y);
    await t.send(start(ADM_X));
    expect(t.texts()).toEqual([WELCOME]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.admin.pendingButton, es.admin.authorizeButton, es.revoke.button, es.selfRevoke.button]);
    const before = await state();
    t.clear();
    await t.send(press(ADM_X, SELF_REVOKE_ASK));
    expect(t.texts()).toEqual([es.selfRevoke.confirmAdmin]);
    expect(es.selfRevoke.confirmAdmin).toContain("rol de administrador");
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.selfRevoke.confirmButton, es.selfRevoke.cancelButton]);
    expect(await state()).toEqual(before);
    t.clear();
    await t.send(press(ADM_X, SELF_REVOKE_CANCEL));
    expect(t.texts()).toEqual([es.selfRevoke.cancelled, WELCOME]);
    expect(buttonsOf(t.messages()[1].payload)).toContain(es.admin.pendingButton);
    expect(await state()).toEqual(before);
  });

  it("17, 18 y 21: confirmar borra, los demás administradores no cambian, los botones adm: antiguos reciben el aviso y la cuenta nueva no es administrador", async () => {
    const fx = await seedRoleDenial(owner);
    const X = 900007001;
    const otherBefore = await rows("select * from app.role_grants where telegram_user_id <> $1 order by id", [X]);
    await t.send(press(X, SELF_REVOKE_CONFIRM));
    expect(t.texts()).toEqual([es.selfRevoke.revoked]);
    await noTrace(X);
    expect(await rows("select * from app.role_grants where telegram_user_id <> $1 order by id", [X])).toEqual(otherBefore);
    expect(await rows("select channel from app.consent_events where event = 'revoked'")).toEqual([{ channel: "bot" }]);
    const before = await state();
    const callbacks = adminCallbacks(fx);
    expect(callbacks).toHaveLength(14);
    for (const data of callbacks) {
      t.clear();
      await t.send(press(X, data));
      expectNotice();
    }
    expect(await state()).toEqual(before);
    t.clear();
    await t.send(press(X, ACCEPT));
    expect(t.texts()).toEqual([WELCOME]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.menu.registerButton, es.selfRevoke.button]);
  });

  it("32: con el aviso anterior recibe el aviso antes de cualquier botón, también con srv:yes", async () => {
    await addAdmin(ADM_Y);
    await createOldVersionAccount(owner, OLD);
    await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [OLD]);
    const before = await state();
    for (const data of [SELF_REVOKE_CONFIRM, SELF_REVOKE_ASK]) {
      t.clear();
      await t.send(press(OLD, data));
      expectNotice();
    }
    expect(await state()).toEqual(before);
  });
});

describe("principal y único administrador (criterios 23, 24, 26 y 28)", () => {
  it.each([[true], [false]])("23 y 24: el principal (con fila: %s) ve el botón y recibe principalProtected sin confirmar", async (withRow) => {
    await createAccount(owner, PRINCIPAL, "Principal Ficticio");
    await addAdmin(ADM_X);
    if (withRow) await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values ($1, 'admin', true)", [PRINCIPAL]);
    await t.send(start(PRINCIPAL));
    expect(buttonsOf(t.messages()[0].payload)).toContain(es.selfRevoke.button);
    // D-101: la fila del principal se crea en su primera actualización; se toma la instantánea después.
    const before = await state();
    for (const data of [SELF_REVOKE_ASK, SELF_REVOKE_CONFIRM]) {
      t.clear();
      await t.send(press(PRINCIPAL, data));
      expect(t.texts()).toEqual([es.selfRevoke.principalProtected]);
      expect(es.selfRevoke.principalProtected).toContain("administrador principal");
      expect(t.messages()[0].payload.reply_markup).toBeUndefined();
    }
    expect(await state()).toEqual(before);
    expect(await rows("select 1 from app.consent_events where event = 'revoked'")).toEqual([]);
  });

  it("26: el único administrador recibe lastAdminProtected con ask y con srv:yes antiguo, sin cambios", async () => {
    await addAdmin(ADM_X);
    const before = await state();
    for (const data of [SELF_REVOKE_ASK, SELF_REVOKE_CONFIRM]) {
      t.clear();
      await t.send(press(ADM_X, data));
      expect(t.texts()).toEqual([es.selfRevoke.lastAdminProtected]);
      expect(t.messages()[0].payload.reply_markup).toBeUndefined();
    }
    expect(await state()).toEqual(before);
  });

  it("28: el principal que también es único administrador recibe principalProtected", async () => {
    await createAccount(owner, PRINCIPAL);
    await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values ($1, 'admin', true)", [PRINCIPAL]);
    await t.send(press(PRINCIPAL, SELF_REVOKE_ASK));
    expect(t.texts()).toEqual([es.selfRevoke.principalProtected]);
  });
});

describe("cuenta con dos roles (criterio 43)", () => {
  async function both(id: number) {
    await addProvider(id);
    await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [id]);
  }

  it("43a: se envía exactamente confirmProviderAdmin y al confirmar se borra todo", async () => {
    await addAdmin(ADM_Y);
    await both(BOTH);
    await t.send(press(BOTH, SELF_REVOKE_ASK));
    expect(t.texts()).toEqual([es.selfRevoke.confirmProviderAdmin]);
    expect(es.selfRevoke.confirmProviderAdmin).toContain("número de identidad");
    expect(es.selfRevoke.confirmProviderAdmin).toContain("registro como prestador");
    expect(es.selfRevoke.confirmProviderAdmin).toContain("dos roles");
    t.clear();
    await t.send(press(BOTH, SELF_REVOKE_CONFIRM));
    expect(t.texts()).toEqual([es.selfRevoke.revoked]);
    await noTrace(BOTH);
    expect(await count("provider_registrations")).toBe(0);
  });

  it("43b: único administrador con rol de prestador recibe lastAdminProtected sin confirmación", async () => {
    await both(BOTH);
    const before = await state();
    await t.send(press(BOTH, SELF_REVOKE_ASK));
    expect(t.texts()).toEqual([es.selfRevoke.lastAdminProtected]);
    expect(await state()).toEqual(before);
  });
});

describe("recorrido sin códigos ni datos (criterio 36)", () => {
  it("ningún mensaje pide o menciona un código ni muestra el número, el ID o el nombre", async () => {
    await addAdmin(ADM_Y);
    await addProvider(PROV);
    for (const id of [PROV, ADM_Y]) {
      await t.send(start(id));
      await t.send(press(id, SELF_REVOKE_ASK));
      await t.send(press(id, SELF_REVOKE_CANCEL));
    }
    await t.send(press(PROV, SELF_REVOKE_ASK));
    await t.send(press(PROV, SELF_REVOKE_CONFIRM));
    await t.send(press(PROV, ACCEPT));
    const everything = t.messages().map((m) => `${m.payload.text} ${buttonsOf(m.payload).join(" ")}`).join("\n").toLowerCase();
    expect(t.messages().length).toBeGreaterThan(8);
    for (const word of ["código", "codigo", "otp", NUMBER, String(PROV), "persona prueba", "administrador ficticio"]) expect(everything).not.toContain(word);
  });
});
