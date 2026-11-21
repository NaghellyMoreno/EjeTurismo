/* eslint-disable @typescript-eslint/no-explicit-any -- cargas útiles de llamadas salientes sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pack } from "@/bot/callback-ids";
import { es } from "@/bot/texts/es";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import {
  ADMIN, CHANGED_NAME, CLOCK, counterOf, forbiddenIn, FUTURE, LATE_CLOCK, MESSAGE, P1, PARTY_SIZE, PAST, requestCount, requestRows, revokeProvider, seedInfoWorld,
  TODAY, V, V0, V_NAME, type InfoWorld,
} from "../helpers/information-request";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F030, criterios 1 a 4, 6 a 16, 21 (bot) y 27: B16, B19 y el formulario sobre `bot_sessions`, observados en las llamadas salientes.
let owner: Pool;
let world: InfoWorld;
let clock = CLOCK;
const t = createTestBot({ now: () => clock });
const T = es.informationRequest;

type Button = { text: string; callback_data?: string; url?: string };
const buttonsOf = (call: { payload: any }): Button[] => (call.payload.reply_markup?.inline_keyboard ?? []).flat();
const last = () => t.messages().at(-1)!;
const lastButtons = () => buttonsOf(last());
const press = (user: number, data: string, name = V_NAME) => t.send(callbackUpdate(data, { fromId: user, firstName: name }));
const say = (user: number, text: string, name = V_NAME) => t.send(textUpdate(text, { fromId: user, firstName: name }));
const detailData = (id: string) => `exp:d:${pack(id)}:1`;
const dataOf = (text: string) => lastButtons().find((b) => b.text === text)!.callback_data!;
const session = async (user = V) => (await owner.query("select data from app.bot_sessions s join app.accounts a on a.id = s.account_id where a.telegram_user_id = $1", [user])).rows[0]?.data;
const sessionRows = async () => Number((await owner.query("select count(*) from app.bot_sessions")).rows[0].count);

// Abre B16 de la ficha y pulsa "Solicitar información" (como V, salvo que se indique otro).
async function openRequest(user = V, listingId = () => world.l1.listingId, name = V_NAME) {
  await press(user, detailData(listingId()), name);
  await press(user, dataOf(T.button), name);
}
const allOutgoing = () => t.messages().flatMap((m) => [String((m.payload as any).text), ...buttonsOf(m).map((b) => b.text)]);

const STEPS = ["name_choice", "name", "date", "party", "message", "confirm"] as const;
// Avanza el formulario hasta el paso indicado con los datos de la prueba.
async function advanceTo(step: (typeof STEPS)[number], user = V) {
  await openRequest(user);
  if (step === "name_choice") return;
  await press(user, dataOf(T.changeName));
  if (step === "name") return;
  await say(user, CHANGED_NAME);
  if (step === "date") return;
  await say(user, FUTURE.bot);
  if (step === "party") return;
  await say(user, String(PARTY_SIZE));
  if (step === "message") return;
  await say(user, MESSAGE);
  confirmData = dataOf(T.confirmButton);
}
// Callback del botón Confirmar del último resumen mostrado (se guarda antes de limpiar las llamadas).
let confirmData = "";

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  clock = CLOCK;
  await resetDb(owner);
  world = await seedInfoWorld(owner);
  t.clear();
});

describe("criterio 1: sin aviso", () => {
  it("/start, un mensaje y el botón de solicitud reciben solo el aviso: sin datos, sin sesión, sin solicitud", async () => {
    for (const update of [textUpdate("/start", { fromId: V0 }), textUpdate("hola", { fromId: V0 }), callbackUpdate(`exp:r:${pack(world.l1.listingId)}:1`, { fromId: V0 }), callbackUpdate("ir:ok", { fromId: V0 })]) {
      t.clear();
      await t.send(update);
      expect(t.messages().length).toBeGreaterThan(0);
      expect(buttonsOf(t.messages().at(-1)!).map((b) => b.text)).toContain(es.notice.accept);
      const texts = allOutgoing().join("\n");
      for (const text of [T.askName, T.askDate, T.proposeName(V_NAME), T.sent]) expect(texts).not.toContain(text);
    }
    expect(await requestCount(owner)).toBe(0);
    expect(await sessionRows()).toBe(0);
    expect((await owner.query("select count(*) from app.accounts where telegram_user_id = $1", [V0])).rows[0].count).toBe("0");
  });
});

describe("criterios 2 a 4: botón en B16", () => {
  it("con V, el botón aparece junto a Ver ubicación y Volver; también para P1 en su propia ficha", async () => {
    for (const user of [V, P1, ADMIN]) {
      t.clear();
      await press(user, detailData(world.l1.listingId));
      expect(lastButtons().map((b) => b.text)).toEqual([es.location.button, T.button, es.explore.back]);
      expect(lastButtons()[1].callback_data!.startsWith("exp:r:")).toBe(true);
      expect(Buffer.byteLength(lastButtons()[1].callback_data!)).toBeLessThanOrEqual(64);
    }
  });

  it("no hay botón en un atractivo ni en la ficha de un prestador con el rol revocado", async () => {
    for (const id of [world.a1.listingId, world.l2.listingId]) {
      t.clear();
      await press(V, detailData(id));
      expect(lastButtons().map((b) => b.text)).toEqual([es.location.button, es.explore.back]);
    }
  });

  it("si el rol se revoca después de abrir B16, pulsar el botón avisa que la ficha ya no recibe solicitudes y no crea sesión", async () => {
    await press(V, detailData(world.l1.listingId));
    const data = dataOf(T.button);
    await revokeProvider(owner, P1);
    t.clear();
    await press(V, data);
    expect(t.texts()).toEqual([T.unavailable]);
    expect(await sessionRows()).toBe(0);
  });
});

describe("criterios 6 y 7: nombre, fecha, personas y mensaje en orden", () => {
  it("propone el nombre de Telegram con botones para usarlo o cambiarlo", async () => {
    await openRequest();
    expect(last().payload.text).toBe(T.proposeName(V_NAME));
    expect(lastButtons().map((b) => b.text)).toEqual([T.useName, T.changeName, T.cancelButton]);
  });

  it("cambiar el nombre y enviar Ana de Prueba: la guarda y pide fecha, luego personas y luego mensaje", async () => {
    await openRequest();
    await press(V, dataOf(T.changeName));
    expect(last().payload.text).toBe(T.askName);
    await say(V, CHANGED_NAME);
    expect(last().payload.text).toBe(T.askDate);
    expect((await session()).draft.name).toBe(CHANGED_NAME);
    await say(V, FUTURE.bot);
    expect(last().payload.text).toBe(T.askParty);
    await say(V, String(PARTY_SIZE));
    expect(last().payload.text).toBe(T.askMessage);
    await say(V, MESSAGE);
    expect(last().payload.text).toBe(T.summary({ listing: "Café Mirador de Prueba", name: CHANGED_NAME, date: FUTURE.bot, partySize: PARTY_SIZE, message: MESSAGE }));
    expect(await requestCount(owner)).toBe(0);
  });

  it("usar el nombre propuesto pasa directo a la fecha", async () => {
    await openRequest();
    await press(V, dataOf(T.useName));
    expect(last().payload.text).toBe(T.askDate);
    expect((await session()).draft.name).toBe(V_NAME);
  });
});

describe("criterios 8 a 11: validación en el bot", () => {
  it("fecha pasada, formato inválido y texto vacío: un mensaje que la rechaza y vuelve a pedirla, sin avanzar", async () => {
    await advanceTo("date");
    for (const [bad, text] of [[PAST.bot, T.datePast], ["mañana", T.dateInvalid], ["31/02/2027", T.dateInvalid], ["", T.dateInvalid], ["   ", T.dateInvalid], ["2026-12-25", T.dateInvalid]] as const) {
      t.clear();
      await say(V, bad);
      expect(t.texts(), bad).toEqual([text]);
      expect((await session()).step).toBe("date");
    }
  });

  it("la fecha de hoy se acepta con el reloj a las 23:30 de Bogotá (ya es mañana en UTC)", async () => {
    clock = LATE_CLOCK;
    await advanceTo("date");
    await say(V, TODAY.bot);
    expect(last().payload.text).toBe(T.askParty);
    t.clear();
    await advanceTo("date");
    await say(V, PAST.bot);
    expect(last().payload.text).toBe(T.datePast);
  });

  it("0, -2, 2.5 y dos se rechazan; 3 avanza", async () => {
    await advanceTo("party");
    for (const bad of ["0", "-2", "2.5", "dos"]) {
      t.clear();
      await say(V, bad);
      expect(t.texts(), bad).toEqual([T.partyInvalid]);
      expect((await session()).step).toBe("party");
    }
    await say(V, "3");
    expect((await session()).step).toBe("message");
  });

  it("mensaje y nombre vacíos, de solo espacios o de más de 4096 caracteres se rechazan", async () => {
    await advanceTo("message");
    for (const bad of ["", "   ", "x".repeat(4097)]) {
      t.clear();
      await say(V, bad);
      expect(t.texts()).toEqual([T.messageInvalid]);
      expect((await session()).step).toBe("message");
    }
    await say(V, "x".repeat(4096));
    expect((await session()).step).toBe("confirm");
    t.clear();
    await advanceTo("name");
    for (const bad of ["", "   ", "x".repeat(4097)]) {
      t.clear();
      await say(V, bad);
      expect(t.texts()).toEqual([T.nameInvalid]);
      expect((await session()).step).toBe("name");
    }
  });

  it("un archivo en lugar de texto se rechaza como entrada inválida", async () => {
    await advanceTo("date");
    t.clear();
    await t.send({ update_id: 5000001, message: { message_id: 2, date: 0, chat: { id: V, type: "private" }, from: { id: V, is_bot: false, first_name: V_NAME }, photo: [{ file_id: "f", file_unique_id: "u", width: 1, height: 1 }] } });
    expect(t.texts()).toEqual([T.dateInvalid]);
  });

  it("en los pasos con botones, un texto repite el paso", async () => {
    await advanceTo("name_choice");
    t.clear();
    await say(V, "hola");
    expect(t.texts()).toEqual([es.common.useButtons, T.proposeName(V_NAME)]);
    expect((await session()).step).toBe("name_choice");
  });
});

describe("criterios 12 y 13: resumen y confirmación", () => {
  it("el resumen pide Confirmar o Cancelar y aún no hay solicitud; Confirmar la crea en new", async () => {
    await advanceTo("confirm");
    expect(lastButtons().map((b) => b.text)).toEqual([T.confirmButton, T.cancelButton]);
    expect(await requestCount(owner)).toBe(0);
    t.clear();
    await press(V, confirmData);
    expect(t.texts()).toEqual([T.sent]);
    expect(t.texts()[0]).toContain("No es una reserva confirmada.");
    const rows = await requestRows(owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "new", listing_id: world.l1.listingId, business_id: world.l1.businessId, visitor_account_id: world.accounts[V],
      requester_name: CHANGED_NAME, party_size: PARTY_SIZE, message: MESSAGE,
    });
    expect(String(rows[0].interest_date)).toContain("2026");
    expect(await session()).toEqual({});
  });

  it("un prestador puede enviar una solicitud a su propio negocio (D-183): nace en new", async () => {
    await advanceTo("confirm", P1);
    await press(P1, dataOf(T.confirmButton), "Persona Prueba");
    expect((await requestRows(owner))[0]).toMatchObject({ status: "new", visitor_account_id: world.accounts[P1], business_id: world.l1.businessId });
  });
});

describe("criterio 14: cancelar", () => {
  const cancelWith = async (how: "button" | "command", data: string) => (how === "button" ? press(V, data) : say(V, "/cancelar"));
  for (const how of ["button", "command"] as const) {
    for (const step of STEPS) {
      it(`${how === "button" ? "botón Cancelar" : "/cancelar"} en el paso ${step}: texto propio y siempre el detalle B16`, async () => {
        await advanceTo(step);
        const cancelData = dataOf(T.cancelButton);
        t.clear();
        await cancelWith(how, cancelData);
        expect(t.texts()[0]).toBe(T.cancelled);
        expect(lastButtons().map((b) => b.text)).toEqual([es.location.button, T.button, es.explore.back]);
        expect(t.texts().some((text) => text.includes("Café Mirador de Prueba"))).toBe(true);
        expect(await requestCount(owner)).toBe(0);
        expect(await session()).toEqual({});
      });
    }
  }

  it("el Volver del detalle conserva el origen (la página de la lista)", async () => {
    await press(V, `exp:d:${pack(world.l1.listingId)}:g3`);
    await press(V, dataOf(T.button));
    t.clear();
    await say(V, "/cancelar");
    expect(lastButtons().at(-1)!.callback_data).toBe(`exp:b:${pack(world.l1.listingId)}:g3`);
  });

  it("/cancelar sin formulario en curso no responde Solicitud cancelada.", async () => {
    await say(V, "/cancelar");
    expect(t.texts()).not.toContain(T.cancelled);
  });

  it("otra orden (/start) durante el formulario lo abandona y muestra el menú", async () => {
    await advanceTo("name");
    t.clear();
    await say(V, "/start");
    expect(t.texts().join("\n")).toContain(es.menu.welcome);
    expect(await session()).toEqual({});
    expect(await requestCount(owner)).toBe(0);
  });
});

describe("criterio 15: doble Confirmar", () => {
  it("una sola solicitud; el segundo toque avisa que ya fue enviada, sin recibo, sin fila y sin consumir el contador", async () => {
    await advanceTo("confirm");
    await press(V, confirmData);
    expect(await counterOf(owner, world.accounts[V])).toBe(1);
    t.clear();
    await press(V, confirmData);
    expect(t.texts()).toEqual([T.alreadySent]);
    expect(await requestCount(owner)).toBe(1);
    expect(await counterOf(owner, world.accounts[V])).toBe(1);
    expect(await session()).toEqual({});
  });

  it("dos toques simultáneos crean una sola solicitud", async () => {
    await advanceTo("confirm");
    t.clear();
    await Promise.all([press(V, confirmData), press(V, confirmData)]);
    expect(await requestCount(owner)).toBe(1);
    expect(t.texts().filter((text) => text === T.sent)).toHaveLength(1);
    expect(await counterOf(owner, world.accounts[V])).toBe(1);
  });
});

describe("criterio 21 (bot): límite de intentos", () => {
  it("con el contador de V en 10, Confirmar responde el mensaje de límite y no crea la fila", async () => {
    await advanceTo("confirm");
    const windowStart = new Date(Math.floor(clock.getTime() / 86400000) * 86400000);
    await owner.query("insert into app.rate_limit_counters (account_id, action, window_start, count) values ($1, 'information_request', $2, 10)", [world.accounts[V], windowStart]);
    t.clear();
    await press(V, confirmData);
    expect(t.texts()).toEqual([T.rateLimited]);
    expect(await requestCount(owner)).toBe(0);
    expect(await counterOf(owner, world.accounts[V])).toBe(10);
  });

  it("las solicitudes del bot suman al mismo contador que la API", async () => {
    await advanceTo("confirm");
    await press(V, confirmData);
    expect(await counterOf(owner, world.accounts[V])).toBe(1);
  });
});

describe("criterio 27: estado cambiado durante el formulario", () => {
  it("(a) P1 pierde el rol antes de Confirmar: se rechaza, se limpia la sesión y no hay fila", async () => {
    await advanceTo("confirm");
    expect((await session()).draft).toMatchObject({ name: CHANGED_NAME, partySize: PARTY_SIZE, message: MESSAGE });
    await revokeProvider(owner, P1);
    t.clear();
    await press(V, confirmData);
    expect(t.texts()).toEqual([T.unavailable]);
    expect(await session()).toEqual({});
    expect(await requestCount(owner)).toBe(0);
  });

  it("(b) V revoca su aviso antes de Confirmar: recibe el aviso B01 y no hay fila", async () => {
    await advanceTo("confirm");
    expect((await session()).step).toBe("confirm");
    const confirm = confirmData;
    await owner.query("delete from app.accounts where telegram_user_id = $1", [V]);
    t.clear();
    await press(V, confirm);
    expect(buttonsOf(t.messages().at(-1)!).map((b) => b.text)).toContain(es.notice.accept);
    expect(t.texts().join("\n")).not.toContain(T.sent);
    expect(await requestCount(owner)).toBe(0);
    expect(await sessionRows()).toBe(0);
  });

  it("la ficha deja de estar publicada: Confirmar avisa que ya no recibe solicitudes", async () => {
    await advanceTo("confirm");
    await owner.query("update app.listing_versions set status = 'superseded' where listing_id = $1", [world.l1.listingId]);
    t.clear();
    await press(V, confirmData);
    expect(t.texts()).toEqual([T.unavailable]);
    expect(await requestCount(owner)).toBe(0);
  });

  it("un fallo inesperado al crear conserva la sesión para reintentar y avisa sin datos", async () => {
    await advanceTo("confirm");
    await owner.query("create function app.f030_bot_boom() returns trigger language plpgsql as $$ begin raise exception 'detalle-interno-secreto'; end $$");
    await owner.query("create trigger a_boom before insert on app.information_requests for each row execute function app.f030_bot_boom()");
    try {
      t.clear();
      await press(V, confirmData);
      expect(t.texts()).toEqual([T.error]);
      expect((await session()).step).toBe("confirm");
    } finally {
      await owner.query("drop trigger a_boom on app.information_requests");
      await owner.query("drop function app.f030_bot_boom()");
    }
    t.clear();
    await press(V, confirmData);
    expect(t.texts()).toEqual([T.sent]);
  });
});

describe("criterio 16: sin pagos, reservas ni disponibilidad", () => {
  it("ningún mensaje ni botón del flujo completo ofrece pagar, cupos, disponibilidad o reserva, salvo la frase aprobada", async () => {
    // Flujo feliz con errores de validación intercalados.
    await openRequest();
    await press(V, dataOf(T.changeName));
    await say(V, "   ");
    await say(V, CHANGED_NAME);
    await say(V, "mañana");
    await say(V, PAST.bot);
    await say(V, FUTURE.bot);
    await say(V, "0");
    await say(V, "3");
    await say(V, "");
    await say(V, MESSAGE);
    await say(V, "texto donde van botones");
    await press(V, confirmData);
    // Cancelaciones, doble toque y límite.
    await advanceTo("confirm");
    await press(V, dataOf(T.cancelButton));
    await advanceTo("message");
    await say(V, "/cancelar");
    await press(V, "ir:ok");
    await advanceTo("confirm");
    await owner.query("insert into app.rate_limit_counters (account_id, action, window_start, count) values ($1, 'information_request', $2, 10) on conflict (account_id, action, window_start) do update set count = 10", [world.accounts[V], new Date(Math.floor(clock.getTime() / 86400000) * 86400000)]);
    await press(V, confirmData);
    const outgoing = allOutgoing();
    expect(outgoing.length).toBeGreaterThan(20);
    expect(forbiddenIn(outgoing)).toEqual([]);
    expect(outgoing).toContain(T.sent);
    expect(outgoing).toContain(T.rateLimited);
  });
});

describe("robustez del formulario", () => {
  it("callback_data alterado o de un paso que no corresponde no cambia la sesión ni crea solicitudes", async () => {
    await advanceTo("date");
    const before = await session();
    for (const data of ["ir:n:y", "ir:n:c", "ir:ok", "ir:zzz", `exp:r:${pack(world.l1.listingId).slice(0, 5)}:1`]) {
      t.clear();
      await press(V, data);
      expect(t.messages().length, data).toBeGreaterThan(0);
    }
    expect(await session()).toEqual(before);
    expect(await requestCount(owner)).toBe(0);
  });

  it("una sesión forjada (otro formulario o datos inválidos) no se interpreta como solicitud", async () => {
    await advanceTo("name_choice");
    await owner.query("update app.bot_sessions set data = $1", [JSON.stringify({ form: "information_request", step: "confirm", listingId: "no-es-uuid", listingName: "x", backSuffix: "1", draft: {} })]);
    t.clear();
    await press(V, "ir:ok");
    expect(t.texts()).toEqual([T.alreadySent]);
    expect(await requestCount(owner)).toBe(0);
  });

  it("la sesión del formulario no la lee otra cuenta: cada cuenta usa la suya", async () => {
    await advanceTo("name");
    t.clear();
    await say(ADMIN, "texto cualquiera", "Administrador Prueba");
    expect(t.texts().join("\n")).not.toContain(T.askDate);
    expect((await session()).step).toBe("name");
  });
});
