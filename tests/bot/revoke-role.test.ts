import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import {
  ADMIN_A, ADMIN_B, ADMIN_NO_ACCOUNT, admin, grantId, NO_ROLE, nameOf, OLD_NOTICE, oldNoticePerson, PENDING, pendingPerson,
  person, PRINCIPAL, principal, PROVIDER_A, PROVIDER_B, provider, REVOKED_ADMIN, revokedAdmin, snapshot,
} from "../factories/revocation";
import { buttonsOf, createTestBot, noRoleMenu, type ApiCall, ADMIN_MENU_BUTTONS } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

const LIST = "adm:vl";
const select = (id: string) => `adm:vs:${id}`;
const confirm = (id: string) => `adm:vc:${id}`;
const cancel = (id: string) => `adm:vx:${id}`;

let owner: Pool;
const t = createTestBot();
const logs: string[] = [];
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const press = (id: number, data: string) => callbackUpdate(data, { fromId: id });
const start = (id: number) => textUpdate("/start", { fromId: id });
const buttons = (call: ApiCall) =>
  ((call.payload.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const lastButtons = () => buttons(t.messages().at(-1)!);
const tablesState = () => snapshot(owner, ["role_grants", "audit_events", "notification_outbox"]);
const item = (who: string, role: "admin" | "provider", isPrincipal = false) => es.revoke.listItem(who, role, isPrincipal);

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
  await owner.query("drop trigger if exists test_fail on app.audit_events");
  await owner.query("drop trigger if exists test_fail on app.role_grants");
});

describe("paso 1: la opción Revocar rol (criterios 1 a 4)", () => {
  it("1: el administrador ve los botones en orden, con el texto exacto Revocar rol", async () => {
    await admin(owner, ADMIN_A);
    await t.send(start(ADMIN_A));
    expect(buttonsOf(t.messages()[0].payload)).toEqual(ADMIN_MENU_BUTTONS);
    expect(buttonsOf(t.messages()[0].payload)[4]).toBe("Revocar rol");
  });

  it("2: F035: Revocar mi autorización es otro botón, con otro callback, y no se confunde con Revocar rol", async () => {
    await admin(owner, ADMIN_A);
    await t.send(start(ADMIN_A));
    expect(es.selfRevoke.button).not.toBe(es.revoke.button);
    const keyboard = (t.messages()[0].payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.flat();
    expect(keyboard.find((b) => b.text === es.selfRevoke.button)?.callback_data).toBe("srv:ask");
    expect(keyboard.find((b) => b.text === es.revoke.button)?.callback_data).not.toBe("srv:ask");
  });

  it.each([[true], [false]])("3: el principal (con fila is_principal: %s) ve el mismo menú", async (withRow) => {
    await principal(owner, withRow);
    await t.send(start(PRINCIPAL));
    expect(buttonsOf(t.messages()[0].payload)).toEqual(ADMIN_MENU_BUTTONS);
  });

  it("4: prestador, sin rol y registro pendiente no reciben el botón", async () => {
    await provider(owner, PROVIDER_A);
    await person(owner, NO_ROLE);
    await pendingPerson(owner, PENDING);
    for (const id of [PROVIDER_A, NO_ROLE, PENDING]) {
      t.clear();
      await t.send(start(id));
      for (const call of t.messages()) expect(buttonsOf(call.payload)).not.toContain(es.revoke.button);
    }
  });
});

describe("la lista B09 (criterios 5 a 7)", () => {
  it("5 y 6: activos con nombre o ID, rol en español, principal marcado, propia cuenta incluida; sin revocados ni documento", async () => {
    await admin(owner, ADMIN_A);
    await principal(owner, true);
    await provider(owner, PROVIDER_A);
    await admin(owner, ADMIN_NO_ACCOUNT, false);
    await revokedAdmin(owner, REVOKED_ADMIN);
    await t.send(press(ADMIN_A, LIST));
    expect(t.texts()).toEqual([es.revoke.listHeader]);
    const labels = lastButtons().map((b) => b.text);
    expect(labels.sort()).toEqual(
      [
        item(nameOf(ADMIN_A), "admin"),
        item(nameOf(PRINCIPAL), "admin", true),
        item(nameOf(PROVIDER_A), "provider"),
        item(String(ADMIN_NO_ACCOUNT), "admin"),
      ].sort(),
    );
    expect(labels).toContain(`${nameOf(PRINCIPAL)} (${es.revoke.principalMark})`);
    expect(labels.join(" ")).not.toContain(nameOf(REVOKED_ADMIN));
    expect(JSON.stringify(t.calls)).not.toContain("1020304050");
    expect(JSON.stringify(t.calls)).not.toMatch(/Documento|identidad|cédula/i);
    expect(lastButtons().map((b) => b.callback_data)).not.toContain(undefined);
  });

  it("7: con 10 permisos la lista muestra 8 y Ver más; Ver más muestra los 2 restantes sin repetir; con 8 no hay Ver más", async () => {
    await admin(owner, ADMIN_A);
    for (let n = 0; n < 9; n++) await admin(owner, 900000100 + n);
    await t.send(press(ADMIN_A, LIST));
    const first = lastButtons();
    expect(first).toHaveLength(9);
    const more = first.at(-1)!;
    expect(more.text).toBe(es.revoke.more);
    expect(more.callback_data).toBe("adm:vp:2");
    t.clear();
    await t.send(press(ADMIN_A, more.callback_data!));
    const second = lastButtons();
    expect(second).toHaveLength(2);
    expect(second.map((b) => b.text)).not.toContain(es.revoke.more);
    const all = [...first.slice(0, 8), ...second].map((b) => b.callback_data);
    expect(new Set(all).size).toBe(10);
    // Con exactamente 8 permisos activos no aparece Ver más.
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id in (900000100, 900000101)");
    t.clear();
    await t.send(press(ADMIN_A, LIST));
    expect(lastButtons()).toHaveLength(8);
    expect(lastButtons().map((b) => b.text)).not.toContain(es.revoke.more);
  });

  it("8: un prestador, una cuenta sin rol y un administrador revocado reciben admin.forbidden con botones antiguos", async () => {
    await admin(owner, ADMIN_A);
    await provider(owner, PROVIDER_A);
    await person(owner, NO_ROLE);
    await revokedAdmin(owner, REVOKED_ADMIN);
    const target = await grantId(owner, PROVIDER_A, "provider");
    const before = await tablesState();
    for (const user of [PROVIDER_A, NO_ROLE, REVOKED_ADMIN]) {
      for (const data of [LIST, "adm:vp:2", select(target), confirm(target), cancel(target), "adm:vz:mal"]) {
        t.clear();
        await t.send(press(user, data));
        expect(t.texts(), `${user} ${data}`).toEqual([es.admin.forbidden]);
      }
    }
    expect(await tablesState()).toEqual(before);
  });
});

describe("cancelar y confirmar (criterios 9 a 12)", () => {
  async function seed() {
    await admin(owner, ADMIN_A);
    await admin(owner, ADMIN_B);
    await provider(owner, PROVIDER_A);
    await provider(owner, PROVIDER_B);
    return grantId(owner, PROVIDER_A, "provider");
  }

  it("9, 10 y 12: confirmación, Cancelar no cambia nada y Confirmar revoca", async () => {
    const id = await seed();
    const before = await tablesState();
    await t.send(press(ADMIN_A, select(id)));
    expect(t.texts()).toEqual([es.revoke.confirmProvider(nameOf(PROVIDER_A))]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.admin.confirmButton, es.admin.cancelButton]);
    expect(await tablesState()).toEqual(before);

    t.clear();
    await t.send(press(ADMIN_A, cancel(id)));
    expect(t.texts()).toEqual([es.revoke.cancelled]);
    expect(await tablesState()).toEqual(before);
    t.clear();
    await t.send(start(PROVIDER_A));
    expect(t.texts()).toContain(es.menu.providerAvailable);

    t.clear();
    await t.send(press(ADMIN_A, confirm(id)));
    expect(t.texts()).toEqual([es.revoke.revoked(nameOf(PROVIDER_A))]);
    const grant = (await rows("select * from app.role_grants where id = $1", [id]))[0];
    expect(Math.abs(grant.revoked_at.getTime() - Date.now())).toBeLessThanOrEqual(5000);
    const adminId = (await rows("select id from app.accounts where telegram_user_id = $1", [ADMIN_A]))[0].id;
    expect(grant.revoked_by_account_id).toBe(adminId);
    expect(await rows("select * from app.audit_events")).toHaveLength(1);
  });

  it("11: pulsar Confirmar dos veces revoca una sola vez y responde alreadyRevoked", async () => {
    const id = await seed();
    await t.send(press(ADMIN_A, confirm(id)));
    t.clear();
    await t.send(press(ADMIN_A, confirm(id)));
    expect(t.texts()).toEqual([es.revoke.alreadyRevoked]);
    expect(await rows("select * from app.audit_events")).toHaveLength(1);
    t.clear();
    await t.send(press(ADMIN_A, select(id)));
    expect(t.texts()).toEqual([es.revoke.alreadyRevoked]);
  });

  it("17: el prestador revocado recibe solo menu.welcome, sin botones ni opciones de prestador", async () => {
    const id = await seed();
    await t.send(press(ADMIN_A, confirm(id)));
    t.clear();
    await t.send(start(PROVIDER_A));
    expect(t.texts()).toEqual([noRoleMenu]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.selfRevoke.button]);
    expect(t.texts()).not.toContain(es.menu.providerAvailable);
  });
});

describe("revocar a un administrador (criterios 21, 22, 24 y 25)", () => {
  it("21 y 22: el administrador revocado queda con el menú de quien no tiene rol", async () => {
    await admin(owner, ADMIN_A);
    await admin(owner, ADMIN_B);
    const id = await grantId(owner, ADMIN_B, "admin");
    await t.send(press(ADMIN_A, select(id)));
    expect(t.texts()).toEqual([es.revoke.confirmAdmin(nameOf(ADMIN_B))]);
    t.clear();
    await t.send(press(ADMIN_A, confirm(id)));
    expect(t.texts()).toEqual([es.revoke.revoked(nameOf(ADMIN_B))]);
    expect((await rows("select details from app.audit_events"))[0].details).toEqual({ role: "admin" });
    t.clear();
    await t.send(start(ADMIN_B));
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.menu.registerButton, es.selfRevoke.button]);
  });

  it("24: los botones antiguos y el paso siguiente de B08 del administrador revocado responden admin.forbidden", async () => {
    await admin(owner, ADMIN_A);
    await admin(owner, ADMIN_B);
    // ADMIN_B abre B08 (autorizar administrador) y luego pierde el rol.
    await t.send(press(ADMIN_B, "auth:start"));
    await t.send(textUpdate("900000078", { fromId: ADMIN_B }));
    expect(t.texts().at(-1)).toBe(es.adminAuth.confirm("900000078"));
    await t.send(press(ADMIN_A, confirm(await grantId(owner, ADMIN_B, "admin"))));
    t.clear();
    const before = await tablesState();
    for (const data of ["adm:list", "auth:start", LIST, "auth:confirm"]) {
      await t.send(press(ADMIN_B, data));
    }
    expect(t.texts()).toEqual([es.admin.forbidden, es.admin.forbidden, es.admin.forbidden, es.admin.forbidden]);
    expect(await tablesState()).toEqual(before);

    // Con una sesión B08 abierta, un mensaje de texto tampoco crea nada.
    await owner.query("delete from app.bot_sessions");
    const state = { form: "authorize_admin", step: "id", draft: {}, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
    const accountId = (await rows("select id from app.accounts where telegram_user_id = $1", [ADMIN_B]))[0].id;
    await owner.query("insert into app.bot_sessions (account_id, data) values ($1, $2)", [accountId, JSON.stringify(state)]);
    t.clear();
    await t.send(textUpdate("900000078", { fromId: ADMIN_B }));
    expect(t.texts()).toEqual([es.admin.forbidden]);
    expect(await tablesState()).toEqual(before);
    expect(JSON.stringify(t.calls)).not.toContain(nameOf(ADMIN_A));
  });

  it("25: un administrador se revoca a sí mismo si hay otro; después recibe admin.forbidden", async () => {
    await admin(owner, ADMIN_A);
    await admin(owner, ADMIN_B);
    const id = await grantId(owner, ADMIN_B, "admin");
    await t.send(press(ADMIN_B, confirm(id)));
    expect(t.texts()).toEqual([es.revoke.revoked(nameOf(ADMIN_B))]);
    t.clear();
    await t.send(press(ADMIN_B, confirm(id)));
    expect(t.texts()).toEqual([es.admin.forbidden]);
  });
});

describe("reglas protegidas (criterios 27 a 29)", () => {
  it("27 y 28: el principal está protegido, también para sí mismo; nada cambia", async () => {
    await admin(owner, ADMIN_A);
    await principal(owner, true);
    const id = await grantId(owner, PRINCIPAL, "admin");
    const before = await tablesState();
    await t.send(press(ADMIN_A, select(id)));
    t.clear();
    await t.send(press(ADMIN_A, confirm(id)));
    expect(t.texts()).toEqual([es.revoke.principalProtected]);
    expect(t.texts()[0]).toContain("administrador principal");
    t.clear();
    await t.send(press(PRINCIPAL, confirm(id)));
    expect(t.texts()).toEqual([es.revoke.principalProtected]);
    expect(await tablesState()).toEqual(before);
  });

  it("29: el único administrador que no es el principal no se puede revocar, ni a sí mismo", async () => {
    await admin(owner, ADMIN_A);
    await person(owner, PRINCIPAL);
    const before = await tablesState();
    await t.send(press(ADMIN_A, confirm(await grantId(owner, ADMIN_A, "admin"))));
    expect(t.texts()).toEqual([es.revoke.lastAdminProtected]);
    expect(await tablesState()).toEqual(before);
  });
});

describe("errores y textos (criterios 39, 40 y 42)", () => {
  it("39: un fallo de la base responde admin.error sin texto técnico y no deja el permiso a medias", async () => {
    await admin(owner, ADMIN_A);
    await provider(owner, PROVIDER_A);
    const id = await grantId(owner, PROVIDER_A, "provider");
    await owner.query("create or replace function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo-inyectado-secreto'; end $$");
    await owner.query("create trigger test_fail before insert on app.audit_events for each row execute function app.test_fail()");
    await t.send(press(ADMIN_A, confirm(id)));
    expect(t.texts()).toEqual([es.admin.error]);
    expect(JSON.stringify(t.calls)).not.toContain("fallo-inyectado-secreto");
    expect((await rows("select revoked_at from app.role_grants where id = $1", [id]))[0].revoked_at).toBeNull();
    expect(await rows("select * from app.audit_events")).toHaveLength(0);
  });

  it("40: los textos al administrador solo nombran al afectado y no avisan a nadie", async () => {
    await admin(owner, ADMIN_A);
    await admin(owner, ADMIN_B);
    await provider(owner, PROVIDER_A);
    await provider(owner, PROVIDER_B);
    const id = await grantId(owner, PROVIDER_A, "provider");
    await t.send(press(ADMIN_A, LIST));
    await t.send(press(ADMIN_A, select(id)));
    await t.send(press(ADMIN_A, confirm(id)));
    const text = t.texts().join("\n");
    for (const other of [ADMIN_A, ADMIN_B, PROVIDER_B]) expect(text).not.toContain(String(other));
    expect(await rows("select * from app.notification_outbox")).toHaveLength(0);
    expect(t.messages().every((m) => m.payload.chat_id === ADMIN_A)).toBe(true);
  });

  it("42: un callback_data mal formado de un administrador se ignora sin mensaje ni cambios", async () => {
    await admin(owner, ADMIN_A);
    await provider(owner, PROVIDER_A);
    const id = await grantId(owner, PROVIDER_A, "provider");
    const before = await tablesState();
    for (const data of ["adm:vz:" + id, "adm:vs:no-es-uuid", `adm:vc:${id}:x`, "adm:vc:", "adm:vp:0", `adm:vc:${id}${"a".repeat(40)}`]) {
      t.clear();
      await t.send(press(ADMIN_A, data));
      expect(t.messages(), data).toHaveLength(0);
    }
    expect(await tablesState()).toEqual(before);
    expect(logs.join(" ")).not.toContain("error");
  });

  it("42: lo recibido de una cuenta sin rol de administrador, bien o mal formado, se niega antes de interpretarlo", async () => {
    await provider(owner, PROVIDER_A);
    await person(owner, NO_ROLE);
    await oldNoticePerson(owner, OLD_NOTICE);
    const id = await grantId(owner, PROVIDER_A, "provider");
    for (const user of [PROVIDER_A, NO_ROLE]) {
      for (const data of [confirm(id), "adm:vc:no-es-uuid", "adm:vq"]) {
        t.clear();
        await t.send(press(user, data));
        expect(t.texts()).toEqual([es.admin.forbidden]);
      }
    }
    expect((await rows("select revoked_at from app.role_grants where id = $1", [id]))[0].revoked_at).toBeNull();
  });
});
