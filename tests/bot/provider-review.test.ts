import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { createAccount, createOldVersionAccount, PERSON_PRINCIPAL } from "../factories/accounts";
import {
  ADMIN_1,
  CREATED_AT,
  CREATED_AT_BOGOTA,
  grantAdminRole,
  makeProvider,
  namedAccount,
  NAMES,
  NUMBER_1,
  NUMBER_2,
  NUMBER_3,
  pendingFor,
  USER_APPROVE,
  USER_NO_ROLE,
  USER_OLD_NOTICE,
  USER_PENDING,
  USER_REJECT,
} from "../factories/review";
import { buttonsOf, createTestBot, noRoleMenu, type ApiCall, ADMIN_MENU_BUTTONS, adminMenu, providerMenu } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// `after` de next/server se sustituye por un recolector: la prueba espera el envío sin esperas arbitrarias.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));
const flushAfter = async () => {
  while (afterTasks.length > 0) await afterTasks.shift()!();
};

let owner: Pool;
const t = createTestBot();
const logs: string[] = [];
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const press = (id: number, data: string) => callbackUpdate(data, { fromId: id });
const start = (id: number) => textUpdate("/start", { fromId: id });
const tables = async () => ({
  pending: await count("provider_registrations"),
  grants: await count("role_grants"),
  audit: await count("audit_events"),
  outbox: await count("notification_outbox"),
  decided: (await rows("select count(*)::int n from app.provider_registrations where status <> 'pending'"))[0].n,
});
const callbacksOf = (call: ApiCall) =>
  ((call.payload.reply_markup as { inline_keyboard?: { text: string; callback_data?: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const dataOf = (call: ApiCall, text: string) => callbacksOf(call).find((b) => b.text === text)!.callback_data!;
const toChat = (userId: number) => t.messages().filter((m) => String(m.payload.chat_id) === String(userId));

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
  afterTasks.length = 0;
  logs.length = 0;
});
afterEach(async () => {
  for (const table of ["provider_registrations", "role_grants", "audit_events", "notification_outbox"]) {
    await owner.query(`drop trigger if exists test_fail on app.${table}`);
  }
});

async function admin() {
  await namedAccount(owner, ADMIN_1);
  await grantAdminRole(owner, ADMIN_1);
}

// Pulsa "Registros pendientes" y devuelve los mensajes de detalle.
async function openList() {
  t.clear();
  await t.send(press(ADMIN_1, "adm:list"));
  return t.messages();
}

describe("B06 y B02 mínimos (criterios 1, 15 y 22)", () => {
  it("el administrador con permiso y el principal ven 'Registros pendientes' y 'Autorizar administrador'", async () => {
    await admin();
    await createAccount(owner, PERSON_PRINCIPAL);
    for (const id of [ADMIN_1, PERSON_PRINCIPAL]) {
      t.clear();
      await t.send(start(id));
      expect(t.texts()).toEqual([adminMenu]);
      expect(buttonsOf(t.messages()[0].payload)).toEqual([...ADMIN_MENU_BUTTONS.slice(0, 4), "Revocar rol", es.selfRevoke.button]);
      expect(callbacksOf(t.messages()[0])[0].callback_data).toBe("adm:list");
    }
  });

  it("el prestador recibe menu.welcome y menu.providerAvailable, sin botón de registro ni provider.pending", async () => {
    await makeProvider(owner, USER_APPROVE);
    await t.send(start(USER_APPROVE));
    expect(t.texts()).toEqual(providerMenu);
    expect(es.menu.providerAvailable).toBe("Ya tienes el rol de prestador. Las opciones de prestador estarán disponibles pronto.");
    expect(t.messages().flatMap((m) => buttonsOf(m.payload))).toEqual([es.menu.myListings, es.selfRevoke.button]);
    expect(t.texts()).not.toContain(es.provider.pending);
  });

  // F005, D-115: tras un rechazo el botón de registro se habilita también en el bot; con el registro aprobado sigue sin verse.
  it("una cuenta con registro rechazado y sin rol ve el botón de registrarse (D-115)", async () => {
    await pendingFor(owner, USER_REJECT, { status: "rejected", number: NUMBER_2, type: "PA" });
    await t.send(start(USER_REJECT));
    expect(t.texts()).toEqual([noRoleMenu]);
    expect(t.messages().flatMap((m) => buttonsOf(m.payload))).toEqual([es.menu.registerButton, es.selfRevoke.button]);
  });

  it("una cuenta con registro aprobado no ve el botón de registrarse", async () => {
    await pendingFor(owner, USER_REJECT, { status: "approved", number: NUMBER_2, type: "PA" });
    await t.send(start(USER_REJECT));
    expect(t.messages().flatMap((m) => buttonsOf(m.payload))).toEqual([es.selfRevoke.button]);
  });
});

describe("lista de pendientes (criterios 2, 3, 33d y 41)", () => {
  it("un mensaje por pendiente, del más antiguo al más reciente, con los datos exactos y botones de 64 bytes o menos", async () => {
    await admin();
    const a = await pendingFor(owner, USER_APPROVE, { type: "CC", number: NUMBER_1, createdAt: CREATED_AT });
    const b = await pendingFor(owner, USER_REJECT, { type: "PA", number: NUMBER_2, createdAt: new Date("2026-11-16T05:00:00Z") });
    await pendingFor(owner, USER_NO_ROLE, { type: "CE", number: NUMBER_3, status: "approved" });
    const messages = await openList();
    expect(messages.map((m) => m.payload.text)).toEqual([
      `Registro de prestador pendiente\nID de Telegram: ${USER_APPROVE}\nNombre de Telegram: ${NAMES[USER_APPROVE]}\nDocumento: cédula de ciudadanía\nNúmero de identidad: ${NUMBER_1}\nFecha de registro: ${CREATED_AT_BOGOTA}`,
      `Registro de prestador pendiente\nID de Telegram: ${USER_REJECT}\nNombre de Telegram: ${NAMES[USER_REJECT]}\nDocumento: pasaporte\nNúmero de identidad: ${NUMBER_2}\nFecha de registro: 16/11/2026 00:00`,
    ]);
    expect(messages[0].payload.text).toBe(es.admin.registrationDetail({ telegramUserId: String(USER_APPROVE), displayName: NAMES[USER_APPROVE], typeName: "cédula de ciudadanía", number: NUMBER_1, createdAt: CREATED_AT_BOGOTA }));
    for (const [message, id] of [[messages[0], a.registrationId], [messages[1], b.registrationId]] as const) {
      expect(buttonsOf(message.payload)).toEqual(["Autorizar", "Rechazar"]);
      for (const button of callbacksOf(message)) {
        expect(Buffer.byteLength(button.callback_data!)).toBeLessThanOrEqual(64);
        expect(button.callback_data).toContain(id);
        // Solo la acción y el id: ni nombre, ni tipo, ni número.
        for (const value of [NUMBER_1, NUMBER_2, NAMES[USER_APPROVE], "CC", "PA", String(USER_APPROVE)]) expect(button.callback_data).not.toContain(value);
      }
    }
  });

  it("sin pendientes responde exactamente con admin.noPending y sin botones", async () => {
    await admin();
    const messages = await openList();
    expect(messages.map((m) => m.payload.text)).toEqual([es.admin.noPending]);
    expect(es.admin.noPending).toBe("No hay registros de prestadores pendientes.");
    expect(buttonsOf(messages[0].payload)).toEqual([]);
  });

  it("con 12 pendientes envía 10, luego admin.morePending; tras decidirlos, los 2 restantes; con 10 exactos no avisa", async () => {
    await admin();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const { registrationId } = await pendingFor(owner, 900000100 + i, { number: `D${i}`, createdAt: new Date(CREATED_AT.getTime() + i * 60000) });
      ids.push(registrationId);
    }
    let messages = await openList();
    expect(messages).toHaveLength(11);
    expect(messages[10].payload.text).toBe(es.admin.morePending);
    expect(messages.slice(0, 10).map((m) => dataOf(m, "Autorizar"))).toEqual(ids.slice(0, 10).map((id) => `adm:a:${id}`));
    for (const id of ids.slice(0, 10)) await owner.query("update app.provider_registrations set status = 'rejected' where id = $1", [id]);
    messages = await openList();
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.payload.text).includes(es.admin.morePending)).toBe(false);

    await resetDb(owner);
    await admin();
    for (let i = 0; i < 10; i++) await pendingFor(owner, 900000100 + i, { number: `E${i}` });
    messages = await openList();
    expect(messages).toHaveLength(10);
    expect(messages.map((m) => m.payload.text)).not.toContain(es.admin.morePending);
  });
});

describe("acceso (criterios 7 y 33c)", () => {
  it("quien no es administrador no recibe ningún dato de registros", async () => {
    await pendingFor(owner, USER_PENDING, { number: NUMBER_3 });
    const pending = await pendingFor(owner, USER_REJECT, { type: "PA", number: NUMBER_2 });
    await namedAccount(owner, USER_NO_ROLE);
    await makeProvider(owner, USER_APPROVE);
    const callbacks = ["adm:list", `adm:a:${pending.registrationId}`, `adm:ca:${pending.registrationId}`, "adm:basura"];
    for (const id of [USER_NO_ROLE, USER_PENDING, USER_APPROVE]) {
      for (const data of callbacks) {
        t.clear();
        await t.send(press(id, data));
        expect(t.texts(), `${id} ${data}`).toEqual([es.admin.forbidden]);
      }
    }
    expect(es.admin.forbidden).toBe("No tienes permiso para hacer esta acción.");
    expect((await rows("select status from app.provider_registrations where id = $1", [pending.registrationId]))[0].status).toBe("pending");
    expect(await count("audit_events")).toBe(0);
  });

  it("sin aviso vigente recibe los tres mensajes del aviso y nada de los registros", async () => {
    await createOldVersionAccount(owner, USER_OLD_NOTICE);
    await pendingFor(owner, USER_REJECT, { type: "PA", number: NUMBER_2 });
    await t.send(press(USER_OLD_NOTICE, "adm:list"));
    expect(t.messages()).toHaveLength(3);
    expect(JSON.stringify(t.calls)).not.toContain(NUMBER_2);
  });

  it("un callback antiguo de quien perdió el permiso admin recibe admin.forbidden", async () => {
    await admin();
    const { registrationId } = await pendingFor(owner, USER_REJECT, { type: "PA", number: NUMBER_2 });
    await openList();
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1", [ADMIN_1]);
    t.clear();
    await t.send(press(ADMIN_1, `adm:a:${registrationId}`));
    expect(t.texts()).toEqual([es.admin.forbidden]);
  });
});

describe("confirmar y cancelar (criterios 8, 9 y 10)", () => {
  it.each([["a", "confirmApprove"], ["r", "confirmReject"]] as const)("'%s' pide confirmación sin cambiar nada; 'Cancelar' deja el registro pendiente sin avisar al usuario", async (action, key) => {
    await admin();
    const { registrationId } = await pendingFor(owner, USER_APPROVE, { number: NUMBER_1 });
    const before = await tables();
    t.clear();
    await t.send(press(ADMIN_1, `adm:${action}:${registrationId}`));
    const [ask] = t.messages();
    expect(ask.payload.text).toBe(es.admin[key]);
    expect(buttonsOf(ask.payload)).toEqual(["Confirmar", "Cancelar"]);
    for (const button of callbacksOf(ask)) {
      expect(Buffer.byteLength(button.callback_data!)).toBeLessThanOrEqual(64);
      expect(button.callback_data).toContain(registrationId);
    }
    expect(await tables()).toEqual(before);

    t.clear();
    await t.send(press(ADMIN_1, dataOf(ask, "Cancelar")));
    expect(t.texts()).toEqual([es.admin.cancelled]);
    expect(es.admin.cancelled).toBe("No se hizo ningún cambio. El registro sigue pendiente.");
    expect(await tables()).toEqual(before);
    expect(toChat(USER_APPROVE)).toEqual([]);
    const reg = (await rows("select status, decided_at, decided_by_account_id from app.provider_registrations"))[0];
    expect(reg).toEqual({ status: "pending", decided_at: null, decided_by_account_id: null });
    expect((await openList()).map((m) => dataOf(m, "Autorizar"))).toEqual([`adm:a:${registrationId}`]);
  });
});

describe("autorizar y rechazar (criterios 12, 14, 18, 20, 29, 40)", () => {
  it("'Confirmar' tras 'Autorizar' aprueba, responde al administrador y avisa a la persona sin tipo ni número", async () => {
    await admin();
    await pendingFor(owner, USER_APPROVE, { number: NUMBER_1 });
    const [list] = await openList();
    t.clear();
    await t.send(press(ADMIN_1, dataOf(list, "Autorizar")));
    const confirm = dataOf(t.messages()[0], "Confirmar");
    t.clear();
    await t.send(press(ADMIN_1, confirm));
    expect(t.texts()).toEqual([es.admin.approved]);
    expect(es.admin.approved).toBe("Registro autorizado. La persona recibirá un aviso.");
    expect(t.texts()[0]).not.toContain(NUMBER_1);
    expect(toChat(USER_APPROVE)).toEqual([]);
    expect((await rows("select status from app.notification_outbox"))[0].status).toBe("pending");
    await flushAfter();
    const toUser = toChat(USER_APPROVE);
    expect(toUser.map((m) => m.payload.text)).toEqual([es.provider.approved]);
    expect(es.provider.approved).toBe("Tu registro como prestador fue autorizado. Escribe /start para continuar.");
    for (const value of [NUMBER_1, "cédula", "CC"]) expect(String(toUser[0].payload.text)).not.toContain(value);
    expect(await rows("select status, template from app.notification_outbox")).toEqual([{ status: "sent", template: "provider_registration.approved" }]);
    expect(await rows("select role from app.role_grants where telegram_user_id = $1", [USER_APPROVE])).toEqual([{ role: "provider" }]);
    // El usuario ya ve el menú de prestador.
    t.clear();
    await t.send(start(USER_APPROVE));
    expect(t.texts()).toEqual(providerMenu);
  });

  it("'Confirmar' tras 'Rechazar' rechaza, sin permiso, y avisa sin motivo, tipo ni número", async () => {
    await admin();
    await pendingFor(owner, USER_REJECT, { type: "PA", number: NUMBER_2 });
    const [list] = await openList();
    t.clear();
    await t.send(press(ADMIN_1, dataOf(list, "Rechazar")));
    const confirm = dataOf(t.messages()[0], "Confirmar");
    t.clear();
    await t.send(press(ADMIN_1, confirm));
    expect(t.texts()).toEqual([es.admin.rejected]);
    expect(es.admin.rejected).toBe("Registro rechazado. La persona recibirá un aviso.");
    await flushAfter();
    expect(toChat(USER_REJECT).map((m) => m.payload.text)).toEqual([es.provider.rejected]);
    expect(es.provider.rejected).toBe("Tu registro como prestador no fue autorizado. Si crees que es un error, comunícate con el administrador.");
    expect(await rows("select role from app.role_grants where telegram_user_id = $1", [USER_REJECT])).toEqual([]);
    expect((await rows("select rejection_reason, status from app.provider_registrations"))[0]).toEqual({ rejection_reason: null, status: "rejected" });
    expect((await rows("select action from app.audit_events"))[0].action).toBe("provider_registration.rejected");
    expect((await rows("select status from app.notification_outbox"))[0].status).toBe("sent");
  });

  it("con dos pendientes, decidir uno no toca el otro", async () => {
    await admin();
    const a = await pendingFor(owner, USER_APPROVE, { type: "CC", number: NUMBER_1, createdAt: CREATED_AT });
    const b = await pendingFor(owner, USER_REJECT, { type: "PA", number: NUMBER_2, createdAt: new Date("2026-11-16T05:00:00Z") });
    const [first, second] = await openList();
    t.clear();
    await t.send(press(ADMIN_1, dataOf(second, "Autorizar")));
    const confirmSecond = dataOf(t.messages()[0], "Confirmar");
    expect(confirmSecond).toContain(b.registrationId);
    await t.send(press(ADMIN_1, confirmSecond));
    const status = async (id: string) => (await rows("select status from app.provider_registrations where id = $1", [id]))[0].status;
    expect(await status(b.registrationId)).toBe("approved");
    expect(await status(a.registrationId)).toBe("pending");
    expect(await rows("select telegram_user_id from app.role_grants where role = 'provider'")).toEqual([{ telegram_user_id: String(USER_REJECT) }]);
    t.clear();
    await t.send(press(ADMIN_1, dataOf(first, "Rechazar")));
    await t.send(press(ADMIN_1, dataOf(t.messages()[0], "Confirmar")));
    expect(await status(a.registrationId)).toBe("rejected");
    expect(await status(b.registrationId)).toBe("approved");
  });

  it("'Confirmar' sobre un registro ya decidido responde admin.alreadyDecided y no avisa dos veces", async () => {
    await admin();
    const { registrationId } = await pendingFor(owner, USER_APPROVE, { number: NUMBER_1 });
    await t.send(press(ADMIN_1, `adm:ca:${registrationId}`));
    await flushAfter();
    t.clear();
    const before = await tables();
    await t.send(press(ADMIN_1, `adm:ca:${registrationId}`));
    await t.send(press(ADMIN_1, `adm:cr:${registrationId}`));
    await t.send(press(ADMIN_1, `adm:a:${registrationId}`));
    await flushAfter();
    expect(t.texts()).toEqual([es.admin.alreadyDecided, es.admin.alreadyDecided, es.admin.alreadyDecided]);
    expect(es.admin.alreadyDecided).toBe("Este registro ya fue decidido o no está disponible.");
    expect(await tables()).toEqual(before);
    expect(toChat(USER_APPROVE)).toEqual([]);
  });

  it("callbacks forjados: UUID inexistente responde alreadyDecided; mal formado, truncado o acción desconocida, admin.error; nada cambia ni se registra el id", async () => {
    await admin();
    await pendingFor(owner, USER_APPROVE, { number: NUMBER_1 });
    const unknown = "00000000-0000-4000-8000-000000000000";
    const before = await tables();
    for (const action of ["a", "r", "ca", "cr"]) {
      t.clear();
      await t.send(press(ADMIN_1, `adm:${action}:${unknown}`));
      expect(t.texts()).toEqual([es.admin.alreadyDecided]);
    }
    for (const data of ["adm:a:no-es-uuid", "adm:ca:00000000-0000", "adm:zz:" + unknown, "adm:", "adm:ca:", "adm:list:extra"]) {
      t.clear();
      await t.send(press(ADMIN_1, data));
      expect(t.texts(), data).toEqual([es.admin.error]);
    }
    expect(es.admin.error).toBe("No pude completar la acción. Inténtalo de nuevo más tarde.");
    expect(await tables()).toEqual(before);
    expect(logs.join("\n")).not.toContain(unknown);
  });

  it("un fallo en la base responde admin.error y no deja nada, sin filtrar el detalle", async () => {
    await admin();
    const { registrationId } = await pendingFor(owner, USER_APPROVE, { number: NUMBER_1 });
    await owner.query("create or replace function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo-inyectado-secreto'; end $$");
    await owner.query("create trigger test_fail before insert on app.audit_events for each row execute function app.test_fail()");
    const before = await tables();
    t.clear();
    await t.send(press(ADMIN_1, `adm:ca:${registrationId}`));
    expect(t.texts()).toEqual([es.admin.error]);
    expect(await tables()).toEqual(before);
    expect(logs.join("\n")).not.toContain("fallo-inyectado-secreto");
  });
});

describe("registros técnicos (criterio 35)", () => {
  it("todo el flujo no deja en el log número, tipo, nombre, texto de mensajes ni callback_data", async () => {
    await admin();
    await pendingFor(owner, USER_APPROVE, { number: NUMBER_1 });
    const [list] = await openList();
    await t.send(press(ADMIN_1, dataOf(list, "Autorizar")));
    await t.send(press(ADMIN_1, dataOf(t.messages().at(-1)!, "Confirmar")));
    await t.send(press(ADMIN_1, "adm:ca:malformado"));
    await flushAfter();
    const text = logs.join("\n");
    for (const value of [NUMBER_1, "cédula de ciudadanía", NAMES[USER_APPROVE], "adm:", es.admin.approved, es.provider.approved]) {
      expect(text).not.toContain(value);
    }
  });
});
