import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import {
  createAccount,
  createOldVersionAccount,
  grantAdmin,
  PERSON_1,
  PERSON_2,
  PERSON_3,
  PERSON_4,
  PERSON_ADMIN,
  PERSON_NO_ACCOUNT,
  PERSON_OLD_VERSION,
  PERSON_PRINCIPAL,
} from "../factories/accounts";
import { buttonsOf, createTestBot, noRoleMenu, pendingMenu, ADMIN_MENU_BUTTONS, adminMenu } from "../helpers/bot";
import { rateLimitsEnv, testConfig } from "../helpers/config";
import { countsF002, ownerPool, resetDb, rowsMentioningF002 } from "../helpers/db";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

let owner: Pool;
const t = createTestBot();
beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  t.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const start = (id: number) => textUpdate("/start", { fromId: id });
const typed = (id: number, text: string, extra = {}) => textUpdate(text, { fromId: id, ...extra });
const press = (id: number, data: string, extra = {}) => callbackUpdate(data, { fromId: id, ...extra });
const REGISTER = "provider:register";
const CONFIRM = "provider:confirm";
const CANCEL = "provider:cancel";
const TYPE_NAMES = { CC: "cédula de ciudadanía", CE: "cédula de extranjería", PPT: "Permiso por Protección Temporal", PA: "pasaporte" } as const;

const session = async (accountId: string) => (await owner.query("select data, updated_at from app.bot_sessions where account_id = $1", [accountId])).rows[0];
const sessionText = async () => (await owner.query("select coalesce(string_agg(data::text, ' '), '') as t from app.bot_sessions")).rows[0].t as string;
const count = async (table: string) => Number((await owner.query(`select count(*) from app.${table}`)).rows[0].count);
const accountIdOf = async (telegramId: number) => (await owner.query("select id from app.accounts where telegram_user_id = $1", [telegramId])).rows[0].id as string;

// Recorre los pasos 1 a 3 hasta la pregunta de confirmación.
async function fillForm(id: number, type: string, number: string, via: "button" | "text" = "button") {
  await t.send(press(id, REGISTER));
  await t.send(via === "button" ? press(id, type) : typed(id, type.toLowerCase()));
  await t.send(typed(id, number));
}

describe("paso 1: elegir registrarse (criterios 1 y 3)", () => {
  it("/start de una cuenta sin rol ni registro muestra B02 con el botón y al pulsarlo pide el tipo", async () => {
    await createAccount(owner, PERSON_1);
    await t.send(start(PERSON_1));
    expect(t.texts()).toEqual([noRoleMenu]);
    expect(buttonsOf(t.messages()[0].payload)).toEqual([es.menu.registerButton, es.selfRevoke.button]);
    expect(es.menu.registerButton).toBe("Registrarme como prestador");
    t.clear();
    await t.send(press(PERSON_1, REGISTER));
    expect(t.texts()).toEqual([es.provider.askType]);
    expect(es.provider.askType).toBe("Para registrarte como prestador, elige tu tipo de documento de identidad.");
  });

  it("no hay botón para una cuenta con permiso admin ni para el ID principal con cuenta y aviso aceptado", async () => {
    await createAccount(owner, PERSON_ADMIN);
    await grantAdmin(owner, PERSON_ADMIN);
    await createAccount(owner, PERSON_PRINCIPAL);
    for (const id of [PERSON_ADMIN, PERSON_PRINCIPAL]) {
      t.clear();
      await t.send(start(id));
      expect(t.texts()).toEqual([adminMenu]);
      // D-091, D-102: tres botones en línea ("Registros pendientes", "Autorizar administrador" y "Revocar rol", F006) y sin "Registrarme como prestador".
      expect(buttonsOf(t.messages()[0].payload)).toEqual(ADMIN_MENU_BUTTONS);
      // El callback antiguo tampoco abre el formulario.
      t.clear();
      await t.send(press(id, REGISTER));
      expect(t.texts()).toEqual([adminMenu]);
    }
    expect(await count("bot_sessions")).toBe(0);
  });

  it("el administrador principal que acepta el aviso por el bot recibe B02 sin botón", async () => {
    await t.send(press(PERSON_PRINCIPAL, "consent:accept:2026-11-v3"));
    expect(t.texts()).toEqual([adminMenu]);
    // D-091, D-102: tres botones en línea ("Registros pendientes", "Autorizar administrador" y "Revocar rol", F006) y sin "Registrarme como prestador".
    expect(buttonsOf(t.messages()[0].payload)).toEqual(ADMIN_MENU_BUTTONS);
  });
});

describe("paso 2: tipo de documento (criterios 4, 5 y 6)", () => {
  it("el mensaje del tipo lleva los 4 botones de tipo y una fila final con solo Cancelar; callback_data es solo el código", async () => {
    await createAccount(owner, PERSON_1);
    await t.send(press(PERSON_1, REGISTER));
    const [message] = t.messages();
    expect(buttonsOf(message.payload)).toEqual([
      "CC: cédula de ciudadanía",
      "CE: cédula de extranjería",
      "PPT: Permiso por Protección Temporal",
      "PA: pasaporte",
      es.provider.cancelButton,
    ]);
    const rows = (message.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard;
    expect(rows.flat().map((b) => b.callback_data)).toEqual(["CC", "CE", "PPT", "PA", CANCEL]);
    expect(rows[rows.length - 1]).toHaveLength(1);
  });

  it.each([["cc", "CC"], ["Cc", "CC"], ["ppt", "PPT"], ["pa", "PA"]])("la sigla escrita %s se acepta como %s", async (text, code) => {
    const id = await createAccount(owner, PERSON_1);
    await t.send(press(PERSON_1, REGISTER));
    t.clear();
    await t.send(typed(PERSON_1, text));
    expect(t.texts()).toEqual([es.provider.askNumber]);
    expect((await session(id)).data).toMatchObject({ step: "number", draft: { identityDocumentType: code } });
  });

  it.each(["TI", "cedula", ""])("'%s' en el paso del tipo repite solo el tipo y no cambia el borrador", async (text) => {
    const id = await createAccount(owner, PERSON_1);
    await t.send(press(PERSON_1, REGISTER));
    const before = (await session(id)).data;
    t.clear();
    await t.send(typed(PERSON_1, text));
    expect(t.texts()).toEqual([es.provider.typeInvalid, es.provider.askType]);
    expect(buttonsOf(t.messages()[1].payload)).toHaveLength(5);
    expect((await session(id)).data).toEqual(before);
    expect(JSON.stringify(t.calls)).not.toContain(text || "@@");
  });

  it("pulsar un botón del tipo avanza a pedir el número", async () => {
    const id = await createAccount(owner, PERSON_1);
    await t.send(press(PERSON_1, REGISTER));
    t.clear();
    await t.send(press(PERSON_1, "PPT"));
    expect(t.texts()).toEqual([es.provider.askNumber]);
    expect((await session(id)).data.draft).toEqual({ identityDocumentType: "PPT" });
  });

  it("un botón de tipo sin formulario abierto solo muestra el menú", async () => {
    await createAccount(owner, PERSON_1);
    await t.send(press(PERSON_1, "CC"));
    expect(t.texts()).toEqual([noRoleMenu]);
    expect(await count("bot_sessions")).toBe(0);
  });
});

describe("paso 2 y 3: número (criterio 10)", () => {
  it.each([["vacío", ""], ["solo espacios", "   "], ["con carácter de control", "12\u0000"]])(
    "%s: responde numberInvalid, vuelve a pedir el número, conserva el tipo y no deja sellado",
    async (_name, text) => {
      const id = await createAccount(owner, PERSON_1);
      await t.send(press(PERSON_1, REGISTER));
      await t.send(press(PERSON_1, "CC"));
      t.clear();
      await t.send(typed(PERSON_1, text));
      expect(t.texts()).toEqual([es.provider.numberInvalid, es.provider.askNumber]);
      const data = (await session(id)).data;
      expect(data).toMatchObject({ step: "number", draft: { identityDocumentType: "CC" } });
      expect(JSON.stringify(data)).not.toContain("sealedIdentity");
    },
  );
});

describe("paso 3: confirmación (criterios 11, 12, 13, 15)", () => {
  it("el número válido pide confirmar con dos botones, sin repetir el número y sin crear registro", async () => {
    await createAccount(owner, PERSON_1);
    await fillForm(PERSON_1, "CC", "1020304050");
    const last = t.messages().at(-1)!;
    expect(last.payload.text).toBe(es.provider.confirm(TYPE_NAMES.CC));
    expect(last.payload.text).toContain("cédula de ciudadanía");
    expect(buttonsOf(last.payload)).toEqual(["Confirmar", "Cancelar"]);
    expect(await count("provider_registrations")).toBe(0);
    for (const call of t.calls) expect(JSON.stringify(call.payload)).not.toContain("1020304050");
  });

  it("ninguna llamada de todo el flujo contiene el número ni sus variantes", async () => {
    await createAccount(owner, PERSON_3);
    await fillForm(PERSON_3, "PA", " ab123 ", "text");
    await t.send(press(PERSON_3, CONFIRM));
    await createAccount(owner, PERSON_4);
    await fillForm(PERSON_4, "PA", "AB123");
    await t.send(press(PERSON_4, CONFIRM)); // duplicado
    await createAccount(owner, PERSON_NO_ACCOUNT);
    expect(t.calls.length).toBeGreaterThan(5);
    const all = JSON.stringify(t.calls.map((c) => c.payload));
    for (const variant of ["ab123", "AB123", " ab123 "]) expect(all).not.toContain(variant);
    expect(t.calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);
  });

  it("entre el número y 'Confirmar' la sesión solo guarda el número sellado y el tipo en claro", async () => {
    const id = await createAccount(owner, PERSON_3);
    await t.send(press(PERSON_3, REGISTER));
    await t.send(press(PERSON_3, "PA"));
    await t.send(typed(PERSON_3, " ab123 "));
    const data = (await session(id)).data;
    expect(Object.keys(data.draft).sort()).toEqual(["identityDocumentType", "sealedIdentity"]);
    expect(data.draft.identityDocumentType).toBe("PA");
    const text = await sessionText();
    for (const variant of [" ab123 ", "ab123", "AB123", "ab123".toUpperCase(), "ab123".toLowerCase()]) expect(text).not.toContain(variant);
    expect(await rowsMentioningF002(owner, "ab123")).toBe(0);
    expect(data.expiresAt).toBeTruthy();
  });

  it("el sellado se descifra solo con la cuenta y el formulario como datos asociados", async () => {
    const { openSealedIdentity } = await import("@/server/domain/identity");
    const id = await createAccount(owner, PERSON_3);
    await fillForm(PERSON_3, "PA", " ab123 ");
    const sealed = (await session(id)).data.draft.sealedIdentity as string;
    const key = testConfig().identityEncryptionKey;
    expect(openSealedIdentity(key, id, sealed)).toBe("ab123");
    const other = await createAccount(owner, PERSON_4);
    expect(() => openSealedIdentity(key, other, sealed)).toThrow();
    expect(() => openSealedIdentity(Buffer.alloc(32, 1), id, sealed)).toThrow();
  });

  it("'Cancelar' borra el borrador, avisa que no se guardó nada y vuelve a B02", async () => {
    const id = await createAccount(owner, PERSON_1);
    await fillForm(PERSON_1, "CC", "1020304050");
    t.clear();
    await t.send(press(PERSON_1, CANCEL));
    expect(t.texts()).toEqual([es.provider.cancelled, noRoleMenu]);
    expect(buttonsOf(t.messages()[1].payload)).toEqual([es.menu.registerButton, es.selfRevoke.button]);
    expect((await session(id)).data).toEqual({});
    expect(await sessionText()).not.toContain("sealed");
    expect(await count("provider_registrations")).toBe(0);
  });
});

describe("vencimiento del número (criterio 14)", () => {
  it("con el reloj falso pasado el TTL, 'Confirmar' no crea registro, avisa y vuelve a pedir el número", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    const short = createTestBot({ config: () => testConfig({ BOT_SENSITIVE_DRAFT_TTL_SECONDS: "1" }) });
    try {
      const id = await createAccount(owner, PERSON_1);
      for (const update of [press(PERSON_1, REGISTER), press(PERSON_1, "CC"), typed(PERSON_1, "1020304050")]) await short.send(update);
      expect(JSON.stringify((await session(id)).data)).toContain("sealedIdentity");
      vi.setSystemTime(new Date("2026-11-15T10:00:02Z"));
      short.clear();
      await short.send(press(PERSON_1, CONFIRM));
      expect(short.texts()).toEqual([es.provider.expired, es.provider.askNumber]);
      expect(await count("provider_registrations")).toBe(0);
      const data = (await session(id)).data;
      expect(JSON.stringify(data)).not.toContain("sealedIdentity");
      expect(data).toMatchObject({ step: "number", draft: { identityDocumentType: "CC" } });
    } finally {
      await short.db.destroy();
    }
  });
});

describe("paso 4: confirmar y quedar pendiente (criterios 16, 17, 19, 20, 38)", () => {
  it("'Confirmar' envía exactamente provider.pending, crea el registro y vacía el borrador en la misma transacción", async () => {
    const id = await createAccount(owner, PERSON_1);
    await fillForm(PERSON_1, "CC", "1020304050");
    t.clear();
    await t.send(press(PERSON_1, CONFIRM));
    expect(t.texts()).toEqual([es.provider.pending]);
    expect(es.provider.pending).toBe("Tu registro como prestador queda a la espera de autorización del administrador.");
    expect(t.texts()[0]).not.toMatch(/CC|1020304050/);
    const rows = (await owner.query("select account_id, identity_document_type as type, status from app.provider_registrations")).rows;
    expect(rows).toEqual([{ account_id: id, type: "CC", status: "pending" }]);
    expect((await session(id)).data).toEqual({});
    expect(await count("audit_events")).toBe(1);
  });

  it("fallo inesperado del insert: provider.error, sin registro ni traza y con el sellado intacto para reintentar", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logs = (["log", "info", "warn"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const id = await createAccount(owner, PERSON_1);
    await fillForm(PERSON_1, "CC", "1020304050");
    const before = await session(id);
    await owner.query(`create or replace function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'texto-interno-de-la-base'; end $$`);
    await owner.query("create trigger test_fail_insert before insert on app.provider_registrations for each row execute function app.test_fail()");
    try {
      t.clear();
      await t.send(press(PERSON_1, CONFIRM));
      expect(t.texts()).toEqual([es.provider.error]);
      expect(es.provider.error).toBe("No pude completar el registro. Inténtalo de nuevo más tarde.");
    } finally {
      await owner.query("drop trigger test_fail_insert on app.provider_registrations");
    }
    expect(await count("provider_registrations")).toBe(0);
    expect(await count("audit_events")).toBe(0);
    const after = await session(id);
    expect(after.data).toEqual(before.data);
    expect(after.data.expiresAt).toBe(before.data.expiresAt);
    // Los registros técnicos (criterio 37) no traen el número, el tipo, el sellado ni el texto de la base.
    const logged = [...errors.mock.calls, ...logs.flatMap((s) => s.mock.calls)].flat().join(" ");
    for (const secret of ["1020304050", "sealedIdentity", "texto-interno-de-la-base", String(PERSON_1), "CC"]) expect(logged).not.toContain(secret);
    // Reintentar con el mismo borrador funciona.
    t.clear();
    await t.send(press(PERSON_1, CONFIRM));
    expect(t.texts()).toEqual([es.provider.pending]);
  });
});

describe("paso 5: registro pendiente (criterio 23)", () => {
  it("/start y el callback antiguo responden provider.pending, sin botón, sin formulario ni registro nuevo", async () => {
    const id = await createAccount(owner, PERSON_1);
    await fillForm(PERSON_1, "CC", "1020304050");
    await t.send(press(PERSON_1, CONFIRM));
    for (const update of [start(PERSON_1), press(PERSON_1, REGISTER)]) {
      t.clear();
      await t.send(update);
      expect(t.texts()).toEqual([pendingMenu]);
      expect(buttonsOf(t.messages()[0].payload)).toEqual([es.selfRevoke.button]);
    }
    expect(await count("provider_registrations")).toBe(1);
    expect((await session(id)).data).toEqual({});
  });
});

describe("duplicados (criterios 27, 29, 30)", () => {
  it("la segunda cuenta recibe provider.duplicate, no se crea fila y se borra el sellado", async () => {
    await createAccount(owner, PERSON_1);
    const second = await createAccount(owner, PERSON_2);
    await fillForm(PERSON_1, "CC", "1020304050");
    await t.send(press(PERSON_1, CONFIRM));
    await fillForm(PERSON_2, "CC", "1020304050");
    t.clear();
    await t.send(press(PERSON_2, CONFIRM));
    expect(t.texts()).toEqual([es.provider.duplicate]);
    expect(es.provider.duplicate).toBe("Ese documento ya está registrado. Si crees que es un error, comunícate con el administrador.");
    expect(t.texts()[0]).not.toContain("1020304050");
    expect(await count("provider_registrations")).toBe(1);
    expect(await count("audit_events")).toBe(1);
    expect((await session(second)).data).toEqual({});
    expect(await sessionText()).not.toContain("sealed");
  });

  it("PA 'ab123' y PA ' AB123 ' chocan; CE con el número de una CC se acepta", async () => {
    for (const id of [PERSON_1, PERSON_3, PERSON_4]) await createAccount(owner, id);
    await fillForm(PERSON_1, "CC", "1020304050");
    await t.send(press(PERSON_1, CONFIRM));
    await fillForm(PERSON_3, "PA", "ab123");
    await t.send(press(PERSON_3, CONFIRM));
    await fillForm(PERSON_4, "PA", " AB123 ");
    t.clear();
    await t.send(press(PERSON_4, CONFIRM));
    expect(t.texts()).toEqual([es.provider.duplicate]);
    await fillForm(PERSON_4, "CE", "1020304050");
    t.clear();
    await t.send(press(PERSON_4, CONFIRM));
    expect(t.texts()).toEqual([es.provider.pending]);
    expect(await count("provider_registrations")).toBe(3);
  });
});

describe("límite en el bot (criterio 44)", () => {
  it("la tercera confirmación recibe provider.rateLimited sin registro y sin sumar; otra cuenta no se ve afectada", async () => {
    const limited = createTestBot({ config: () => testConfig({ RATE_LIMITS: rateLimitsEnv(2) }) });
    try {
      await createAccount(owner, PERSON_1);
      const b = await createAccount(owner, PERSON_2);
      await createAccount(owner, PERSON_3);
      const a = await accountIdOf(PERSON_1);
      const run = async (id: number, type: string, number: string) => {
        for (const update of [press(id, REGISTER), press(id, type), typed(id, number)]) await limited.send(update);
        limited.clear();
        await limited.send(press(id, CONFIRM));
        return limited.texts();
      };
      // El documento ya existe en otra cuenta: cada confirmación de PERSON_1 llega a la inserción y da 409.
      expect(await run(PERSON_3, "CC", "1020304050")).toEqual([es.provider.pending]);
      expect(await run(PERSON_1, "CC", "1020304050")).toEqual([es.provider.duplicate]);
      expect(await run(PERSON_1, "CC", "1020304050")).toEqual([es.provider.duplicate]);
      const counter = async (id: string) => (await owner.query("select count from app.rate_limit_counters where account_id = $1", [id])).rows[0]?.count;
      expect(await counter(a)).toBe(2);
      expect(await run(PERSON_1, "CC", "1020304050")).toEqual([es.provider.rateLimited]);
      expect(es.provider.rateLimited).toBe("Hiciste demasiados intentos. Espera un momento y vuelve a intentarlo.");
      expect(await counter(a)).toBe(2);
      expect(await count("provider_registrations")).toBe(1);
      expect(await run(PERSON_2, "PPT", "9988776655")).toEqual([es.provider.pending]);
      expect(await counter(b)).toBe(1);
    } finally {
      await limited.db.destroy();
    }
  });
});

describe("sin aviso vigente aceptado (criterios 2, 32 y 33)", () => {
  it("un ID sin cuenta y una cuenta de versión anterior solo reciben los 3 mensajes del aviso y no se escribe nada", async () => {
    await createOldVersionAccount(owner, PERSON_OLD_VERSION);
    const before = await countsF002(owner);
    for (const id of [PERSON_NO_ACCOUNT, PERSON_OLD_VERSION]) {
      for (const update of [press(id, REGISTER), start(id), typed(id, "cc"), press(id, "CC"), press(id, CONFIRM)]) {
        t.clear();
        await t.send(update);
        expect(t.messages()).toHaveLength(3);
        const all = t.texts().join("\n");
        expect(all).not.toContain(es.provider.askType);
        expect(all).not.toContain(es.provider.askNumber);
        expect(all).toContain("Leí el aviso de privacidad");
      }
    }
    expect(await countsF002(owner)).toEqual(before);
    expect(await rowsMentioningF002(owner, String(PERSON_NO_ACCOUNT))).toBe(0);
  });
});

describe("seguridad del actor (criterio 40; invariante 1)", () => {
  it("un 'Confirmar' de una cuenta sin borrador no crea registro, aunque el chat sea el de otra", async () => {
    const a = await createAccount(owner, PERSON_1);
    await createAccount(owner, PERSON_2);
    await fillForm(PERSON_1, "CC", "1020304050");
    const before = (await session(a)).data;
    t.clear();
    await t.send(press(PERSON_2, CONFIRM, { chatId: PERSON_1 }));
    expect(t.texts()).toEqual([es.provider.noDraft]);
    expect(es.provider.noDraft).toBe("No hay ningún registro por confirmar.");
    expect(t.messages()[0].payload.chat_id).toBe(PERSON_1);
    expect(await count("provider_registrations")).toBe(0);
    expect((await session(a)).data).toEqual(before);
  });

  it("la sesión sale de from.id y no de chat.id: el borrador es de la cuenta que escribe", async () => {
    await createAccount(owner, PERSON_1);
    await createAccount(owner, PERSON_2);
    await t.send(press(PERSON_1, REGISTER, { chatId: 777 }));
    await t.send(press(PERSON_1, "CC", { chatId: 777 }));
    expect(await count("bot_sessions")).toBe(1);
    expect((await session(await accountIdOf(PERSON_1))).data.step).toBe("number");
    expect(await session(await accountIdOf(PERSON_2))).toBeUndefined();
  });
});
