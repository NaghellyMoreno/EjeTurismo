import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { createAccount, createOldVersionAccount, grantProvider, PERSON_1, PERSON_2, PERSON_NO_ACCOUNT, PERSON_OLD_VERSION, PERSON_PRINCIPAL } from "../factories/accounts";
import { buttonsOf, createTestBot, noRoleMenu, pendingMenu } from "../helpers/bot";
import { countsF002, ownerPool, resetDb, rowsMentioningF002 } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// Simulación parcial de bot-session: delega en la implementación real salvo en la llamada marcada (criterio 22).
const fail = vi.hoisted(() => ({ load: 0, save: 0 }));
vi.mock("@/server/services/bot-session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/services/bot-session")>();
  const boom = () => new Error("ECONNREFUSED tabla accounts 900000011");
  return {
    ...real,
    loadBotSession: (...args: Parameters<typeof real.loadBotSession>) => {
      if (fail.load > 0 && --fail.load === 0) throw boom();
      return real.loadBotSession(...args);
    },
    saveBotSession: (...args: Parameters<typeof real.saveBotSession>) => {
      if (fail.save > 0 && --fail.save === 0) throw boom();
      return real.saveBotSession(...args);
    },
  };
});

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
  fail.load = 0;
  fail.save = 0;
});
afterEach(() => vi.restoreAllMocks());

const REGISTER = "provider:register";
const CONFIRM = "provider:confirm";
const CANCEL = "provider:cancel";
const BOT = "eje_turismo_prueba_bot";
const NUMBER = "1020304050";
const typed = (id: number, text: string) => textUpdate(text, { fromId: id });
const press = (id: number, data: string) => callbackUpdate(data, { fromId: id });
const session = async (accountId: string) => (await owner.query("select data, updated_at from app.bot_sessions where account_id = $1", [accountId])).rows[0];
// El chat_id es el destino y siempre es el ID de la persona; la búsqueda aplica al contenido enviado.
const content = (calls: { payload: Record<string, unknown> }[]) => JSON.stringify(calls.map(({ payload }) => ({ ...payload, chat_id: undefined })));
const count = async (table: string) => Number((await owner.query(`select count(*) from app.${table}`)).rows[0].count);

type Step = "type" | "number" | "confirm";
async function toStep(id: number, step: Step) {
  await t.send(press(id, REGISTER));
  if (step !== "type") await t.send(press(id, "CC"));
  if (step === "confirm") await t.send(typed(id, NUMBER));
  t.clear();
}
const STEPS: Step[] = ["type", "number", "confirm"];
const business = async () => ({ pr: await count("provider_registrations"), audit: await count("audit_events") });

// Mensajes que no son texto: sin datos reales.
const base = (id: number) => ({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, date: 0, chat: { id, type: "private" as const }, from: { id, is_bot: false, first_name: "P" } } });
const NON_TEXT = ["photo", "sticker", "document", "contact", "location"].map((kind) => {
  const extra: Record<string, object> = {
    photo: { photo: [{ file_id: "a", file_unique_id: "b", width: 1, height: 1 }] },
    sticker: { sticker: { file_id: "a", file_unique_id: "b", type: "regular", width: 1, height: 1, is_animated: false, is_video: false } },
    document: { document: { file_id: "a", file_unique_id: "b" } },
    contact: { contact: { phone_number: "0", first_name: "X" } },
    location: { location: { latitude: 0, longitude: 0 } },
  };
  return [kind, (id: number) => { const u = base(id); return { ...u, message: { ...u.message, ...extra[kind] } }; }] as const;
});

describe("paso 1: cancelar (criterios 1 a 10, 32)", () => {
  it("criterios 1 y 2: cancelar en la confirmación responde cancelled y B02, sesión vacía y sin filas", async () => {
    const id = await createAccount(owner, PERSON_1);
    await toStep(PERSON_1, "confirm");
    const before = await count("rate_limit_counters");
    await t.send(press(PERSON_1, CANCEL));
    expect(t.texts()).toEqual([es.provider.cancelled, noRoleMenu]);
    expect(buttonsOf(t.messages()[1].payload)).toEqual([es.menu.registerButton, es.selfRevoke.button]);
    expect(await business()).toEqual({ pr: 0, audit: 0 });
    expect((await session(id)).data).toEqual({});
    expect(await count("rate_limit_counters")).toBe(before);
  });

  it.each(STEPS)("criterio 3: el botón cancela en el paso %s", async (step) => {
    const id = await createAccount(owner, PERSON_1);
    await toStep(PERSON_1, step);
    await t.send(press(PERSON_1, CANCEL));
    expect(t.texts()).toEqual([es.provider.cancelled, noRoleMenu]);
    expect((await session(id)).data).toEqual({});
    expect(await business()).toEqual({ pr: 0, audit: 0 });
  });

  it("criterio 4: los pasos del tipo y del número llevan el botón Cancelar", async () => {
    await createAccount(owner, PERSON_1);
    await t.send(press(PERSON_1, REGISTER));
    await t.send(press(PERSON_1, "CC"));
    const [askType, askNumber] = t.messages();
    const rows = (m: typeof askType) => (m.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard;
    expect(rows(askType).at(-1)).toEqual([{ text: es.provider.cancelButton, callback_data: CANCEL }]);
    expect(rows(askType)).toHaveLength(5);
    expect(rows(askNumber)).toEqual([[{ text: es.provider.cancelButton, callback_data: CANCEL }]]);
  });

  it.each(STEPS)("criterio 5a: /cancelar y /cancelar@bot cancelan en el paso %s", async (step) => {
    for (const command of ["/cancelar", `/cancelar@${BOT}`, `/cancelar@${BOT.toUpperCase()}`]) {
      await resetDb(owner);
      const id = await createAccount(owner, PERSON_1);
      await toStep(PERSON_1, step);
      await t.send(typed(PERSON_1, command));
      expect(t.texts()).toEqual([es.provider.cancelled, noRoleMenu]);
      expect((await session(id)).data).toEqual({});
      expect(await business()).toEqual({ pr: 0, audit: 0 });
    }
  });

  it("criterio 5b: /CANCELAR y /cancelar@otro_test_bot no cancelan", async () => {
    for (const command of ["/CANCELAR", "/cancelar@otro_test_bot"]) {
      for (const step of ["type", "confirm"] as const) {
        await resetDb(owner);
        const id = await createAccount(owner, PERSON_1);
        await toStep(PERSON_1, step);
        const before = (await session(id)).data;
        await t.send(typed(PERSON_1, command));
        if (step === "type") expect(t.texts()).toEqual([es.provider.typeInvalid, es.provider.askType]);
        else {
          expect(t.texts()).toEqual([es.common.useButtons, es.provider.confirm("cédula de ciudadanía")]);
          expect(buttonsOf(t.messages()[1].payload)).toEqual([es.provider.confirmButton, es.provider.cancelButton]);
        }
        expect((await session(id)).data).toEqual(before);
        expect(await business()).toEqual({ pr: 0, audit: 0 });
      }
    }
    // En el paso del número el texto se evalúa como número (Inferido, P10).
    await resetDb(owner);
    await createAccount(owner, PERSON_1);
    await toStep(PERSON_1, "number");
    await t.send(typed(PERSON_1, "/CANCELAR"));
    expect(t.texts()).toEqual([es.provider.confirm("cédula de ciudadanía")]);
    expect(await business()).toEqual({ pr: 0, audit: 0 });
  });

  it("criterio 6: tras cancelar se puede registrar desde cero y queda una fila pending", async () => {
    await createAccount(owner, PERSON_1);
    await toStep(PERSON_1, "confirm");
    await t.send(press(PERSON_1, CANCEL));
    t.clear();
    await t.send(press(PERSON_1, REGISTER));
    expect(t.texts()).toEqual([es.provider.askType]);
    await t.send(press(PERSON_1, "CC"));
    await t.send(typed(PERSON_1, NUMBER));
    await t.send(press(PERSON_1, CONFIRM));
    expect(t.texts().at(-1)).toBe(es.provider.pending);
    expect((await owner.query("select status from app.provider_registrations")).rows).toEqual([{ status: "pending" }]);
  });

  it("criterio 7: cancelar con el número sellado no deja el número en sesión ni en llamadas", async () => {
    await createAccount(owner, PERSON_1);
    await t.send(press(PERSON_1, REGISTER));
    await t.send(press(PERSON_1, "PA"));
    await t.send(typed(PERSON_1, " AB123 "));
    await t.send(press(PERSON_1, CANCEL));
    const body = JSON.stringify(t.calls);
    for (const v of ["ab123", " AB123 ", "AB123", "ab123".toUpperCase()]) {
      expect(body).not.toContain(v);
      expect(await rowsMentioningF002(owner, v)).toBe(0);
    }
  });

  it("criterios 8 y 9: sin formulario o cancelando dos veces responde nothingToCancel y B02", async () => {
    const id = await createAccount(owner, PERSON_1);
    for (const update of [() => typed(PERSON_1, "/cancelar"), () => press(PERSON_1, CANCEL)]) {
      t.clear();
      await t.send(update());
      expect(t.texts()).toEqual([es.common.nothingToCancel, noRoleMenu]);
      expect(await session(id)).toBeUndefined();
    }
    await toStep(PERSON_1, "number");
    await t.send(press(PERSON_1, CANCEL));
    t.clear();
    await t.send(press(PERSON_1, CANCEL));
    expect(t.texts()).toEqual([es.common.nothingToCancel, noRoleMenu]);
    expect(await business()).toEqual({ pr: 0, audit: 0 });
  });

  it("criterio 10: sin aviso vigente aceptado se muestran los 3 mensajes del aviso y no se crea nada", async () => {
    await createOldVersionAccount(owner, PERSON_OLD_VERSION);
    const before = await countsF002(owner);
    for (const id of [PERSON_NO_ACCOUNT, PERSON_OLD_VERSION]) {
      for (const update of [typed(id, "/cancelar"), press(id, CANCEL)]) {
        t.clear();
        await t.send(update);
        expect(t.messages()).toHaveLength(3);
      }
    }
    const after = await countsF002(owner);
    expect(after).toEqual({ ...before, bot_sessions: 0 });
    expect(after.accounts).toBe(before.accounts);
  });

  it("criterio 32: una cuenta que no puede registrarse recibe nothingToCancel y su menú", async () => {
    const roleId = await createAccount(owner, PERSON_1);
    await grantProvider(owner, roleId, PERSON_1);
    await createAccount(owner, PERSON_PRINCIPAL);
    const pendingId = await createAccount(owner, PERSON_2);
    await owner.query(
      "insert into app.provider_registrations (account_id, identity_document_type, identity_number_encrypted, identity_number_hash, status) values ($1, 'CC', '\\x00', decode(md5('x'), 'hex'), 'pending')",
      [pendingId],
    );
    const before = await countsF002(owner);
    const cases: [number, string][] = [[PERSON_1, es.menu.welcome], [PERSON_PRINCIPAL, es.menu.welcome], [PERSON_2, pendingMenu]];
    for (const [id, menu] of cases) {
      for (const update of [typed(id, "/cancelar"), press(id, CANCEL)]) {
        t.clear();
        await t.send(update);
        expect(t.texts()[0]).toBe(es.common.nothingToCancel);
        expect(t.texts()[1]).toBe(menu);
        if (id !== PERSON_1) expect(t.texts()).toHaveLength(2);
        if (id === PERSON_PRINCIPAL) expect(buttonsOf(t.messages()[1].payload)).toEqual([es.admin.pendingButton, es.admin.authorizeButton, es.revoke.button]);
      }
    }
    // D-101: la cuenta del principal obtiene su fila `is_principal` en su primera actualización; no cambia nada más.
    expect(await countsF002(owner)).toEqual({ ...before, role_grants: before.role_grants + 1 });
  });

  it("criterio 29: una cuenta no cancela la sesión de otra", async () => {
    const a = await createAccount(owner, PERSON_1);
    await createAccount(owner, PERSON_2);
    await toStep(PERSON_1, "number");
    const before = (await session(a)).data;
    await t.send(typed(PERSON_2, "/cancelar"));
    expect(t.texts()).toEqual([es.common.nothingToCancel, noRoleMenu]);
    expect((await session(a)).data).toEqual(before);
  });
});

describe("paso 2: entrada inválida (criterios 11 a 14)", () => {
  it("criterios 11 a 13: repite solo el paso afectado, tres veces seguidas, y luego avanza", async () => {
    const id = await createAccount(owner, PERSON_1);
    await t.send(press(PERSON_1, REGISTER));
    t.clear();
    await t.send(typed(PERSON_1, "TI"));
    expect(t.texts()).toEqual([es.provider.typeInvalid, es.provider.askType]);
    await t.send(typed(PERSON_1, "pa"));
    expect((await session(id)).data).toMatchObject({ step: "number", draft: { identityDocumentType: "PA" } });
    t.clear();
    for (let i = 0; i < 3; i++) {
      await t.send(typed(PERSON_1, "   "));
      expect((await session(id)).data).toMatchObject({ step: "number", draft: { identityDocumentType: "PA" } });
    }
    expect(t.texts()).toEqual(Array(3).fill([es.provider.numberInvalid, es.provider.askNumber]).flat());
    expect(buttonsOf(t.messages()[1].payload)).toEqual([es.provider.cancelButton]);
  });

  it("criterio 14: las respuestas no repiten lo escrito", async () => {
    await createAccount(owner, PERSON_1);
    await t.send(press(PERSON_1, REGISTER));
    await t.send(typed(PERSON_1, "cedula"));
    await t.send(press(PERSON_1, "CC"));
    await t.send(typed(PERSON_1, "12\u0000"));
    const body = JSON.stringify(t.calls);
    expect(body).not.toContain("cedula");
    expect(body).not.toContain("12");
  });
});

describe("paso 3: texto cuando se espera un botón (criterios 15 a 19)", () => {
  const confirmMessage = es.provider.confirm("cédula de ciudadanía");

  it("criterio 15: texto en la confirmación repite la pregunta sin cambiar la sesión", async () => {
    const id = await createAccount(owner, PERSON_1);
    await toStep(PERSON_1, "confirm");
    const before = await session(id);
    await t.send(typed(PERSON_1, "sí"));
    expect(t.texts()).toEqual([es.common.useButtons, confirmMessage]);
    expect(buttonsOf(t.messages()[1].payload)).toEqual([es.provider.confirmButton, es.provider.cancelButton]);
    expect(await session(id)).toEqual(before);
    expect(await business()).toEqual({ pr: 0, audit: 0 });
  });

  it.each(NON_TEXT)("criterio 16: %s en la confirmación", async (_kind, make) => {
    const id = await createAccount(owner, PERSON_1);
    await toStep(PERSON_1, "confirm");
    const before = await session(id);
    await t.send(make(PERSON_1));
    expect(t.texts()).toEqual([es.common.useButtons, confirmMessage]);
    expect(await session(id)).toEqual(before);
  });

  it.each(NON_TEXT)("criterio 17: %s en el paso del número", async (_kind, make) => {
    const id = await createAccount(owner, PERSON_1);
    await toStep(PERSON_1, "number");
    const before = await session(id);
    await t.send(make(PERSON_1));
    expect(t.texts()).toEqual([es.provider.numberInvalid, es.provider.askNumber]);
    expect(await session(id)).toEqual(before);
  });

  it.each(NON_TEXT)("criterio 18: %s en el paso del tipo", async (_kind, make) => {
    const id = await createAccount(owner, PERSON_1);
    await toStep(PERSON_1, "type");
    const before = await session(id);
    await t.send(make(PERSON_1));
    expect(t.texts()).toEqual([es.provider.typeInvalid, es.provider.askType]);
    expect(await session(id)).toEqual(before);
  });

  it("criterio 19: botones que no corresponden al paso", async () => {
    const cases: [Step, string, string[]][] = [
      ["number", "CC", [es.provider.askNumber]],
      ["confirm", "CC", [es.common.useButtons, confirmMessage]],
      ["type", CONFIRM, [es.provider.askType]],
      ["number", CONFIRM, [es.provider.askNumber]],
    ];
    for (const [step, data, expected] of cases) {
      await resetDb(owner);
      const id = await createAccount(owner, PERSON_1);
      await toStep(PERSON_1, step);
      const before = await session(id);
      await t.send(press(PERSON_1, data));
      expect(t.texts()).toEqual(expected);
      expect(t.calls.filter((c) => c.method === "answerCallbackQuery")).toHaveLength(1);
      expect(await session(id)).toEqual(before);
    }
    await resetDb(owner);
    await createAccount(owner, PERSON_1);
    t.clear();
    await t.send(press(PERSON_1, CONFIRM));
    expect(t.texts()).toEqual([es.provider.noDraft]);
  });
});

describe("paso 4: errores del sistema (criterios 21 a 26, 28)", () => {
  const LEAKS = ["ECONNREFUSED", "accounts", "900000011", "Persona Prueba", "cédula de ciudadanía", "1020304050", "ab123", "AB123"];

  it("criterios 21, 24, 25 y 26: un fallo de la base responde errors.generic sin datos técnicos", async () => {
    await createAccount(owner, PERSON_1);
    const broken = failingDb("ECONNREFUSED tabla accounts 900000011");
    const bad = createTestBot({ db: () => broken.db });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await bad.send(typed(PERSON_1, "/start"));
    expect(bad.texts()).toEqual([es.errors.generic]);
    expect(es.errors.generic).toBe("Ocurrió un error. Intenta de nuevo en unos minutos.");
    const body = content(bad.calls);
    const logs = JSON.stringify([...error.mock.calls, ...log.mock.calls, ...warn.mock.calls]);
    for (const leak of LEAKS) {
      expect(body).not.toContain(leak);
      expect(logs).not.toContain(leak);
    }
    expect(/\bCC\b/.test(body)).toBe(false);
    expect(error.mock.calls).toEqual([['{"level":"error","event":"bot.handler_failed","errorName":"Error"}']]);
    // Si Telegram también falla, no se propaga.
    bad.bot.api.config.use(async () => {
      throw new Error("telegram caído");
    });
    await expect(bad.send(typed(PERSON_1, "/start"))).resolves.toBeUndefined();
    await bad.db.destroy();
  });

  it.each([
    ["tipo: loadBotSession", "type", "load", () => press(PERSON_1, "CC")],
    ["número: saveBotSession", "number", "save", () => typed(PERSON_1, NUMBER)],
    ["confirmación: loadBotSession", "confirm", "load", () => press(PERSON_1, CONFIRM)],
  ] as const)("criterio 22: fallo en %s deja la sesión igual", async (_name, step, which, update) => {
    const id = await createAccount(owner, PERSON_1);
    await toStep(PERSON_1, step);
    const before = await session(id);
    const counts = await countsF002(owner);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fail[which] = 1;
    await t.send(update());
    expect(t.texts()).toEqual([es.errors.generic]);
    expect(await session(id)).toEqual(before);
    expect({ ...(await countsF002(owner)), processed: undefined }).toEqual({ ...counts, processed: undefined });
    const body = content(t.calls);
    for (const leak of ["ECONNREFUSED", "accounts", "900000011", NUMBER]) expect(body).not.toContain(leak);
  });

  it("criterio 23: fallo del insert al confirmar envía provider.error y conserva el número sellado", async () => {
    const id = await createAccount(owner, PERSON_1);
    await toStep(PERSON_1, "confirm");
    const before = (await session(id)).data;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await owner.query(`create or replace function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'texto-interno-de-la-base'; end $$`);
    await owner.query("create trigger test_fail_insert before insert on app.provider_registrations for each row execute function app.test_fail()");
    try {
      await t.send(press(PERSON_1, CONFIRM));
    } finally {
      await owner.query("drop trigger test_fail_insert on app.provider_registrations");
    }
    expect(t.texts()).toEqual([es.provider.error]);
    expect(await business()).toEqual({ pr: 0, audit: 0 });
    expect((await session(id)).data).toEqual(before);
    expect(JSON.stringify(t.calls)).not.toContain("texto-interno");
  });

  it("criterio 28: tras un error el formulario sigue y se puede cancelar", async () => {
    const id = await createAccount(owner, PERSON_1);
    await toStep(PERSON_1, "type");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fail.load = 1;
    await t.send(press(PERSON_1, "CC"));
    t.clear();
    await t.send(press(PERSON_1, "CE"));
    expect(t.texts()).toEqual([es.provider.askNumber]);
    await t.send(typed(PERSON_1, "/cancelar"));
    expect((await session(id)).data).toEqual({});
  });
});
