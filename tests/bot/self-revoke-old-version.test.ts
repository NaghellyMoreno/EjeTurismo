import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseSelfRevokeCallback, SELF_REVOKE_ASK, SELF_REVOKE_CANCEL, SELF_REVOKE_CONFIRM } from "@/bot/self-revoke";
import { es } from "@/bot/texts/es";
import { TELEGRAM_MESSAGE_LIMIT } from "@/lib/notice";
import { admin, ADMIN_A, ADMIN_B, OLD_NOTICE, oldNoticePerson, person, PRINCIPAL, principal } from "../factories/revocation";
import { createAccount } from "../factories/accounts";
import { buttonsOf, createTestBot, noRoleMenu } from "../helpers/bot";
import { NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { snapshotAll } from "../helpers/role-denial";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F036, B01 (criterios 15, 33 a 36): cuenta con una versión anterior del aviso en el bot (D-133, P6, P9).
const NO_ACCOUNT = 900000371;
const ACCEPTED_BY_MINI_APP = 900000372;
const OLD_ADMIN = 900000373;
const OLD_ADMIN_OTHER = 900000374;

let owner: Pool;
const t = createTestBot();
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const press = (id: number, data: string) => callbackUpdate(data, { fromId: id });
const start = (id: number) => textUpdate("/start", { fromId: id });
const accountId = async (id: number) => (await rows("select id from app.accounts where telegram_user_id = $1", [id]))[0]?.id as string | undefined;
const keyboardOf = (index: number) =>
  ((t.messages()[index].payload.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).map((row) => row.map((b) => b.text));
// Estado del bot sin `processed_updates` (el aviso a una cuenta con versión anterior no escribe ahí, pero la instantánea lo excluye).
const state = async () => {
  const snap = await snapshotAll(owner);
  delete snap.processed_updates;
  return snap;
};

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  t.clear();
});

describe("33 y 34: composición del aviso (P6)", () => {
  it("33: la cuenta con versión anterior ve el aviso en 3 mensajes, la frase al final del tercero y el botón en otra fila", async () => {
    await oldNoticePerson(owner, OLD_NOTICE);
    await t.send(start(OLD_NOTICE));
    expect(t.messages()).toHaveLength(3);
    const third = String(t.messages()[2].payload.text);
    expect(third.endsWith(`\n\n${es.selfRevoke.note}`)).toBe(true);
    expect(third.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(keyboardOf(0)).toEqual([]);
    expect(keyboardOf(1)).toEqual([]);
    expect(keyboardOf(2)).toEqual([[es.notice.accept, es.notice.decline], [es.selfRevoke.button]]);
    expect(String(t.messages()[0].payload.text)).not.toContain(es.selfRevoke.note);
    expect(String(t.messages()[1].payload.text)).not.toContain(es.selfRevoke.note);
  });

  it("34: la persona sin cuenta ve el aviso sin el botón ni la frase", async () => {
    await t.send(start(NO_ACCOUNT));
    expect(t.messages()).toHaveLength(3);
    expect(t.texts().join("\n")).not.toContain(es.selfRevoke.note);
    expect(keyboardOf(2)).toEqual([[es.notice.accept, es.notice.decline]]);
    expect(keyboardOf(0).concat(keyboardOf(1))).toEqual([]);
    const withButton = t.messages().flatMap((m) => buttonsOf(m.payload));
    expect(withButton).not.toContain(es.selfRevoke.button);
  });
});

describe("35: revocar desde el aviso", () => {
  it("la cuenta común recibe la confirmación común y no cambia nada", async () => {
    await oldNoticePerson(owner, OLD_NOTICE);
    const before = await state();
    await t.send(press(OLD_NOTICE, SELF_REVOKE_ASK));
    expect(t.texts()).toEqual([es.selfRevoke.confirm]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.selfRevoke.confirmButton, es.selfRevoke.cancelButton]);
    expect(await state()).toEqual(before);
  });

  it("Cancelar responde selfRevoke.cancelled, reenvía el aviso (no el menú) y no cambia nada (P9)", async () => {
    await oldNoticePerson(owner, OLD_NOTICE);
    const before = await state();
    await t.send(press(OLD_NOTICE, SELF_REVOKE_CANCEL));
    expect(t.texts()[0]).toBe(es.selfRevoke.cancelled);
    expect(t.messages()).toHaveLength(4);
    expect(t.texts()[3].endsWith(es.selfRevoke.note)).toBe(true);
    expect(t.texts().join("")).not.toContain(es.menu.welcome);
    expect(await state()).toEqual(before);
  });

  it("Sí, revocar borra la cuenta, deja la prueba revoked con canal bot y el siguiente /start muestra el aviso sin el botón", async () => {
    await oldNoticePerson(owner, OLD_NOTICE);
    await t.send(press(OLD_NOTICE, SELF_REVOKE_CONFIRM));
    expect(t.texts()).toEqual([es.selfRevoke.revoked]);
    expect(await accountId(OLD_NOTICE)).toBeUndefined();
    expect(await rows("select channel, notice_version from app.consent_events where event = 'revoked'")).toEqual([
      { channel: "bot", notice_version: "2026-10-v1" },
    ]);
    t.clear();
    await t.send(start(OLD_NOTICE));
    expect(t.messages()).toHaveLength(3);
    expect(keyboardOf(2)).toEqual([[es.notice.accept, es.notice.decline]]);
    expect(t.texts()[2]).not.toContain(es.selfRevoke.note);
  });

  it("una confirmación repetida (la cuenta ya no existe) recibe el aviso sin el botón", async () => {
    await oldNoticePerson(owner, OLD_NOTICE);
    await t.send(press(OLD_NOTICE, SELF_REVOKE_CONFIRM));
    t.clear();
    await t.send(press(OLD_NOTICE, SELF_REVOKE_CONFIRM));
    expect(t.messages()).toHaveLength(3);
    expect(keyboardOf(2)).toEqual([[es.notice.accept, es.notice.decline]]);
  });

  it("el administrador principal (con y sin fila) y el único administrador reciben el motivo en lugar de la confirmación", async () => {
    for (const withRow of [true, false]) {
      await resetDb(owner);
      await owner.query("insert into app.privacy_notice_versions (version, body_markdown, declaration_text, is_current) values ('2026-10-v1', 'b', 'd', false) on conflict do nothing");
      await principal(owner, withRow);
      await owner.query("update app.accounts set consent_notice_version = '2026-10-v1' where telegram_user_id = $1", [PRINCIPAL]);
      await admin(owner, ADMIN_B);
      const before = await state();
      t.clear();
      await t.send(press(PRINCIPAL, SELF_REVOKE_ASK));
      expect(t.texts()).toEqual([es.selfRevoke.principalProtected]);
      expect(t.messages().flatMap((m) => buttonsOf(m.payload))).toEqual([]);
      t.clear();
      await t.send(press(PRINCIPAL, SELF_REVOKE_CONFIRM));
      expect(t.texts()).toEqual([es.selfRevoke.principalProtected]);
      expect(await state()).toEqual(before);
    }
    await resetDb(owner);
    await owner.query("insert into app.privacy_notice_versions (version, body_markdown, declaration_text, is_current) values ('2026-10-v1', 'b', 'd', false) on conflict do nothing");
    await person(owner, OLD_ADMIN);
    await owner.query("insert into app.role_grants (telegram_user_id, role) values ($1, 'admin')", [OLD_ADMIN]);
    await owner.query("update app.accounts set consent_notice_version = '2026-10-v1' where telegram_user_id = $1", [OLD_ADMIN]);
    const before = await state();
    t.clear();
    await t.send(press(OLD_ADMIN, SELF_REVOKE_ASK));
    expect(t.texts()).toEqual([es.selfRevoke.lastAdminProtected]);
    expect(t.messages().flatMap((m) => buttonsOf(m.payload))).toEqual([]);
    expect(await state()).toEqual(before);
  });

  it("un administrador común con versión anterior recibe la confirmación común", async () => {
    await admin(owner, OLD_ADMIN_OTHER);
    await admin(owner, ADMIN_A);
    await owner.query("insert into app.privacy_notice_versions (version, body_markdown, declaration_text, is_current) values ('2026-10-v1', 'b', 'd', false) on conflict do nothing");
    await owner.query("update app.accounts set consent_notice_version = '2026-10-v1' where telegram_user_id = $1", [OLD_ADMIN_OTHER]);
    await t.send(press(OLD_ADMIN_OTHER, SELF_REVOKE_ASK));
    expect(t.texts()).toEqual([es.selfRevoke.confirm]);
  });
});

describe("36: el analizador no cambia y lo demás recibe el aviso (D-039)", () => {
  it("el analizador solo reconoce srv:ask, srv:yes y srv:no", () => {
    expect([SELF_REVOKE_ASK, SELF_REVOKE_CONFIRM, SELF_REVOKE_CANCEL].map(parseSelfRevokeCallback)).toEqual(["ask", "confirm", "cancel"]);
    for (const data of ["srv:", "srv:zzz", "srv:yes:1", `srv:${"x".repeat(80)}`, "SRV:ask"]) expect(parseSelfRevokeCallback(data)).toBeNull();
  });

  it("cualquier otro botón o mensaje de la cuenta con versión anterior recibe el aviso y no ejecuta nada", async () => {
    await oldNoticePerson(owner, OLD_NOTICE);
    const before = await state();
    for (const update of [
      textUpdate("hola", { fromId: OLD_NOTICE }),
      press(OLD_NOTICE, "srv:zzz"),
      press(OLD_NOTICE, "acc:vs:1"),
      press(OLD_NOTICE, "adm:vp:1"),
      press(OLD_NOTICE, "provider:register"),
    ]) {
      t.clear();
      await t.send(update);
      expect(t.messages()).toHaveLength(3);
      expect(keyboardOf(2)).toEqual([[es.notice.accept, es.notice.decline], [es.selfRevoke.button]]);
    }
    expect(await state()).toEqual(before);
  });
});

describe("15: el bot reconoce lo aceptado en la Mini App", () => {
  it("la cuenta creada con el canal mini_app recibe el menú y no el aviso", async () => {
    await createAccount(owner, ACCEPTED_BY_MINI_APP);
    await owner.query("update app.accounts set consent_channel = 'mini_app' where telegram_user_id = $1", [ACCEPTED_BY_MINI_APP]);
    const events = await rows("select count(*)::int as n from app.consent_events");
    await t.send(start(ACCEPTED_BY_MINI_APP));
    expect(t.texts()).toEqual([noRoleMenu]);
    expect(t.messages().flatMap((m) => buttonsOf(m.payload))).not.toContain(es.notice.accept);
    expect(t.messages().flatMap((m) => buttonsOf(m.payload))).not.toContain(es.notice.decline);
    expect(await rows("select count(*)::int as n from app.consent_events")).toEqual(events);
    expect(NOTICE_VERSION).toBe("2026-11-v3");
  });
});
