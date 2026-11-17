import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_COMMANDS } from "@/bot/commands";
import { es } from "@/bot/texts/es";
import { DATE_PLACEHOLDER, TELEGRAM_MESSAGE_LIMIT } from "@/server/domain/notice";
import { formatBogotaDate } from "@/lib/time";
import { buttonsOf, createTestBot, noRoleMenu } from "../helpers/bot";
import { counts, EMPTY_COUNTS, NOTICE_VERSION, ownerPool, resetDb, rowsMentioning } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { readNoticeSource } from "../helpers/notice-source";
import { ACCEPTING_USER, callbackUpdate, NEW_USER, textUpdate } from "../helpers/telegram";

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
afterEach(() => vi.restoreAllMocks());

const ACCEPT_DATA = `consent:accept:${NOTICE_VERSION}`;
const start = (fromId = NEW_USER, extra = {}) => textUpdate("/start", { fromId, ...extra });
const accept = (fromId = NEW_USER, version = NOTICE_VERSION) => callbackUpdate(`consent:accept:${version}`, { fromId });

// El aviso completo: 3 mensajes, con "Acepto" y "No acepto" solo en el último.
function expectNoticeShown(calls = t.messages()) {
  expect(calls).toHaveLength(3);
  const texts = calls.map((c) => String(c.payload.text));
  expect(texts[0]).toMatch(/^\*\*Eje Turismo\. Aviso de privacidad, versión 2026-11-v3\./);
  expect(texts[0]).toContain("### 4.");
  expect(texts[0]).not.toContain("### 5.");
  expect(texts[1]).toMatch(/^### 5\./);
  expect(texts[1]).toContain("### 9.");
  expect(texts[1]).not.toContain("### 10.");
  expect(texts[2]).toMatch(/^### 10\./);
  expect(texts[2]).toContain("### 13.");
  expect(texts[2]).toContain("Leí el aviso de privacidad de Eje Turismo");
  for (const text of texts) expect(text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  expect(buttonsOf(calls[0].payload)).toEqual([]);
  expect(calls[0].payload.reply_markup).toBeUndefined();
  expect(calls[1].payload.reply_markup).toBeUndefined();
  expect(buttonsOf(calls[2].payload)).toEqual(["Acepto", "No acepto"]);
}

describe("paso 1 y 2: primer contacto (criterios 1, 2, 4)", () => {
  it("/start de un ID sin cuenta envía exactamente los 3 mensajes del aviso y nada más", async () => {
    await t.send(start());
    expect(t.calls.map((c) => c.method)).toEqual(["sendMessage", "sendMessage", "sendMessage"]);
    expectNoticeShown();
  });

  it("los mensajes unidos son el Texto 1 más la declaración, con la fecha de vigencia en Bogotá y sin marcas", async () => {
    await t.send(start());
    const source = readNoticeSource({ keepAnnotations: true });
    const clean = readNoticeSource();
    const { rows } = await owner.query("select published_at from app.privacy_notice_versions where is_current");
    const date = formatBogotaDate(rows[0].published_at);
    const expected = `${clean.body.replaceAll(DATE_PLACEHOLDER, date)}\n\n${clean.declaration}`;
    expect(t.texts().join("\n\n")).toBe(expected);
    expect(source.body).toMatch(/\[Confirmado/); // la fuente sí traía marcas
    expect(t.texts().join("")).not.toMatch(/\[(Confirmado|Inferido|Pendiente)/);
    expect(t.texts().join("")).not.toContain("El número de identidad se usa solo para verificar");
  });

  it("no escribe nada: ni cuenta, ni constancia, ni sesión, ni contador, ni processed_updates, ni el ID", async () => {
    await t.send(start());
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
    expect(await rowsMentioning(owner, String(NEW_USER))).toBe(0);
  });
});

describe("cualquier mensaje o botón sin cuenta recibe el aviso (criterio 3; D-039)", () => {
  const updates: Record<string, () => unknown> = {
    "/help": () => textUpdate("/help", { fromId: NEW_USER }),
    "/datos": () => textUpdate("/datos", { fromId: NEW_USER }),
    "texto libre": () => textUpdate("hola, ¿qué destinos hay?", { fromId: NEW_USER }),
    "callback de otra pantalla": () => callbackUpdate("menu:destinos", { fromId: NEW_USER }),
    "callback desconocido": () => callbackUpdate("x", { fromId: NEW_USER }),
  };
  for (const [name, build] of Object.entries(updates)) {
    it(`${name} devuelve el aviso y no escribe nada`, async () => {
      await t.send(build());
      expectNoticeShown();
      expect(await counts(owner)).toEqual(EMPTY_COUNTS);
    });
  }
});

describe("paso 3: no acepta (criterios 7, 8, 9; D-008, D-067)", () => {
  it('"No acepto" envía un solo mensaje con el texto exacto y el botón "Volver a ver el aviso"', async () => {
    await t.send(callbackUpdate("consent:decline", { fromId: NEW_USER }));
    expect(t.messages()).toHaveLength(1);
    const [message] = t.messages();
    expect(message.payload.text).toBe(
      "Sin tu autorización no podemos guardar ningún dato. Si cambias de opinión, envía /start para ver de nuevo el aviso.",
    );
    expect(buttonsOf(message.payload)).toEqual(["Volver a ver el aviso"]);
    expect(t.texts().join("")).not.toContain("Acepto");
  });

  it("no guarda nada: 0 filas, ni el ID ni el nombre de la cuenta", async () => {
    await t.send(callbackUpdate("consent:decline", { fromId: NEW_USER, firstName: "Persona Prueba Uno" }));
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
    expect(await rowsMentioning(owner, String(NEW_USER))).toBe(0);
    expect(await rowsMentioning(owner, "Persona Prueba")).toBe(0);
  });

  it('después de "No acepto", el botón, un mensaje cualquiera y /start vuelven a mostrar el aviso', async () => {
    await t.send(callbackUpdate("consent:decline", { fromId: NEW_USER }));
    for (const update of [callbackUpdate("consent:show", { fromId: NEW_USER }), textUpdate("hola", { fromId: NEW_USER }), start()]) {
      t.clear();
      await t.send(update);
      expectNoticeShown();
    }
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
  });
});

describe("paso 4: aceptar y menú (criterios 10, 11, 12, 13, 14)", () => {
  it('"Acepto" envía solo el menú B02, con el botón de registro y sin texto del aviso', async () => {
    await t.send(accept());
    expect(t.messages()).toHaveLength(1);
    const [menu] = t.messages();
    expect(menu.payload.text).toBe("Te damos la bienvenida a Eje Turismo.\n\nComandos disponibles:\n/start: mostrar este menú\n\nEl número de identidad se usa solo para verificar tu identidad y atender tu solicitud de registro como prestador");
    expect(menu.payload.text).toBe(noRoleMenu);
    // D-074: un único botón en línea para la cuenta recién aceptada (sin rol y sin registro).
    expect(buttonsOf(menu.payload)).toEqual(["Registrarme como prestador", "Revocar mi autorización"]);
    expect(t.texts().join("")).not.toContain("Aviso de privacidad");
    // La única otra llamada es el acuse del botón (answerCallbackQuery), que no es un mensaje.
    expect(t.calls.map((c) => c.method).sort()).toEqual(["answerCallbackQuery", "sendMessage"]);
  });

  it('el callback de "Acepto" lleva la versión que se mostró', async () => {
    await t.send(start());
    const data = (t.messages()[2].payload.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0][0].callback_data;
    expect(data).toBe(ACCEPT_DATA);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
  });

  it("/start, Acepto, /start: la segunda vez muestra el menú y no el aviso", async () => {
    await t.send(start());
    await t.send(accept());
    t.clear();
    await t.send(start());
    expect(t.texts()).toEqual([noRoleMenu]);
  });

  it('pulsar "Acepto" dos veces deja una cuenta y una constancia', async () => {
    await t.send(accept());
    await t.send(accept());
    expect(await counts(owner)).toMatchObject({ accounts: 1, consent_events: 1 });
    expect(t.texts().filter((x) => x === noRoleMenu)).toHaveLength(2);
  });

  it('el "Acepto" de un aviso viejo no crea nada y muestra el aviso vigente', async () => {
    await t.send(accept(NEW_USER, "2026-10-vX"));
    expectNoticeShown();
    expect(await counts(owner)).toEqual(EMPTY_COUNTS);
  });
});

describe("el bot no ofrece consultar ni corregir datos (criterio 14; HU-001, criterio 7)", () => {
  it("los comandos registrados son exactamente start", () => {
    expect(BOT_COMMANDS.map((c) => c.command)).toEqual(["start"]);
  });

  it("los teclados son solo los de B01 y la respuesta a No acepto, y B02 solo tiene el botón de registro y lista solo /start", async () => {
    await t.send(start());
    expect(buttonsOf(t.messages()[2].payload)).toEqual(["Acepto", "No acepto"]);
    t.clear();
    await t.send(callbackUpdate("consent:decline", { fromId: NEW_USER }));
    expect(buttonsOf(t.messages()[0].payload)).toEqual(["Volver a ver el aviso"]);
    t.clear();
    await t.send(accept());
    // D-074 y D-071: B02 solo trae el botón de registro (cuenta sin rol y sin registro); los comandos siguen siendo solo /start.
    expect(buttonsOf(t.messages()[0].payload)).toEqual(["Registrarme como prestador", "Revocar mi autorización"]);
    expect(es.menu.welcome.match(/\/\w+/g)).toEqual(["/start"]);
  });

  it("/datos y /corregir de una cuenta aceptada solo responden el menú B02", async () => {
    await t.send(accept(ACCEPTING_USER));
    for (const command of ["/datos", "/corregir"]) {
      t.clear();
      await t.send(textUpdate(command, { fromId: ACCEPTING_USER }));
      expect(t.texts()).toEqual([noRoleMenu]);
    }
  });

  it("el aviso conserva la indicación de correo y teléfono del apartado 8", async () => {
    await t.send(start());
    const notice = t.texts().join("\n");
    expect(notice).toContain("el bot y la Mini App no tienen una opción para consultar o corregir datos");
    expect(notice).toContain("karen.moreno35879@ucaldas.edu.co");
    expect(notice).toContain("305 382 7085");
  });
});

describe("pasos 5 y 6: constancia y no se repite el aviso (criterios 15, 16, 21)", () => {
  it("al aceptar por el bot quedan la cuenta y la constancia con canal bot", async () => {
    await t.send(accept(ACCEPTING_USER));
    expect((await owner.query("select consent_channel, consent_notice_version from app.accounts")).rows).toEqual([
      { consent_channel: "bot", consent_notice_version: NOTICE_VERSION },
    ]);
    expect((await owner.query("select event, channel, notice_version from app.consent_events")).rows).toEqual([
      { event: "accepted", channel: "bot", notice_version: NOTICE_VERSION },
    ]);
  });

  it("después de aceptar, ninguna actualización vuelve a mostrar el aviso ni toca la constancia; solo crece processed_updates", async () => {
    await t.send(accept(ACCEPTING_USER));
    const before = (await owner.query("select consent_accepted_at from app.accounts")).rows[0].consent_accepted_at;
    const updates = [start(ACCEPTING_USER), textUpdate("hola", { fromId: ACCEPTING_USER }), callbackUpdate("lo-que-sea", { fromId: ACCEPTING_USER })];
    for (const update of updates) {
      t.clear();
      await t.send(update);
      expect(t.texts()).toEqual([noRoleMenu]);
    }
    expect(await counts(owner)).toMatchObject({ accounts: 1, consent_events: 1, processed_updates: 3, bot_sessions: 0, rate_limit_counters: 0 });
    expect((await owner.query("select consent_accepted_at from app.accounts")).rows[0].consent_accepted_at).toEqual(before);
    expect(await rowsMentioning(owner, String(ACCEPTING_USER))).toBe(1); // solo la cuenta
    expect((await owner.query("select column_name from information_schema.columns where table_schema='app' and table_name='processed_updates'")).rows.map((r) => r.column_name).sort()).toEqual(["received_at", "update_id"]);
  });
});

describe("paso 7: versión nueva (criterios 25, 26, 27)", () => {
  async function publishNewVersion() {
    await owner.query("update app.privacy_notice_versions set is_current = false");
    await owner.query(
      "insert into app.privacy_notice_versions (version, body_markdown, declaration_text, revocation_note, is_current) select '2026-12-v1', body_markdown, declaration_text, revocation_note, true from app.privacy_notice_versions where version = $1",
      [NOTICE_VERSION],
    );
  }

  it("la cuenta anterior recibe los 3 mensajes del aviso nuevo, sin menú ni botón de revocar", async () => {
    await t.send(accept(ACCEPTING_USER));
    await publishNewVersion();
    t.clear();
    await t.send(start(ACCEPTING_USER));
    expectNoticeShown();
    expect(t.texts().join("")).not.toContain(es.menu.welcome);
    expect(buttonsOf(t.messages()[2].payload).join(" ")).not.toMatch(/Revocar/i);
    expect((t.messages()[2].payload.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0][0].callback_data).toBe("consent:accept:2026-12-v1");
  });

  it("mientras no acepte, todo devuelve el aviso, sin processed_updates, y No acepto no cambia nada", async () => {
    await t.send(accept(ACCEPTING_USER));
    await publishNewVersion();
    const state = async () => [(await owner.query("select * from app.accounts")).rows, (await owner.query("select * from app.consent_events order by id")).rows, await counts(owner)];
    const before = await state();
    for (const update of [textUpdate("hola", { fromId: ACCEPTING_USER }), callbackUpdate("x", { fromId: ACCEPTING_USER }), callbackUpdate("consent:decline", { fromId: ACCEPTING_USER }), accept(ACCEPTING_USER, NOTICE_VERSION)]) {
      t.clear();
      await t.send(update);
      if (JSON.stringify(update).includes("consent:decline")) expect(t.texts()).toEqual([es.decline.text]);
      else expectNoticeShown();
    }
    expect(await state()).toEqual(before);
  });

  it("al aceptar el aviso nuevo se actualiza la cuenta, hay una constancia nueva y /start muestra el menú", async () => {
    await t.send(accept(ACCEPTING_USER));
    await publishNewVersion();
    await t.send(accept(ACCEPTING_USER, "2026-12-v1"));
    expect((await owner.query("select consent_notice_version from app.accounts")).rows).toEqual([{ consent_notice_version: "2026-12-v1" }]);
    expect((await owner.query("select event, channel, notice_version from app.consent_events order by id")).rows).toEqual([
      { event: "accepted", channel: "bot", notice_version: NOTICE_VERSION },
      { event: "accepted", channel: "bot", notice_version: "2026-12-v1" },
    ]);
    t.clear();
    await t.send(start(ACCEPTING_USER));
    expect(t.texts()).toEqual([noRoleMenu]);
  });
});

describe("seguridad (criterios 33, 34; invariante 1)", () => {
  it("el actor sale de from.id y no de chat.id: la cuenta es la de from.id y se responde al chat", async () => {
    await t.send(callbackUpdate(ACCEPT_DATA, { fromId: NEW_USER, chatId: 777 }));
    expect((await owner.query("select telegram_user_id from app.accounts")).rows).toEqual([{ telegram_user_id: String(NEW_USER) }]);
    expect(t.messages()[0].payload.chat_id).toBe(777);
  });

  it("ignora actualizaciones de bots", async () => {
    const update = textUpdate("hola", { fromId: 424242 });
    update.message.from.is_bot = true;
    await t.send(update);
    expect(t.calls).toEqual([]);
  });

  it("en el flujo normal no se registra nada con el texto ni con el ID", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    await t.send(textUpdate("texto-privado-123", { fromId: NEW_USER }));
    await t.send(callbackUpdate("consent:decline", { fromId: NEW_USER }));
    const logged = spies.flatMap((s) => s.mock.calls).flat().join(" ");
    expect(logged).not.toContain("texto-privado-123");
    expect(logged).not.toContain(String(NEW_USER));
  });

  it("si la base falla responde un mensaje genérico y el registro no trae el texto, el ID ni el error de la base", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = createTestBot({ db: () => failingDb("Key (telegram_user_id)=(900000001)").db });
    await broken.send(textUpdate("texto-privado-123", { fromId: NEW_USER }));
    expect(broken.texts()).toEqual([es.errors.generic]);
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).toContain("bot.handler_failed");
    for (const secret of ["texto-privado-123", String(NEW_USER), "telegram_user_id"]) expect(logged).not.toContain(secret);
  });
});
