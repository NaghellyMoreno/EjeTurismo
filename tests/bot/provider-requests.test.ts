/* eslint-disable @typescript-eslint/no-explicit-any -- cargas útiles de llamadas salientes sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pack } from "@/bot/callback-ids";
import { es } from "@/bot/texts/es";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { forbiddenIn, L1_NAME, P1, P3, revokeProvider, V } from "../helpers/information-request";
import { CANARIES, eventRows, FIXED_CLOCK, insertRequest, outboxRows, REPLY, replyRows, seedWorld32, statusOf, UNKNOWN_ID, type World32 } from "../helpers/provider-requests";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F032 (bot): B13 (lista, detalle, responder y estados), la acción de `Atender` de B14 y B20 al visitante.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let world: World32;
let clock = FIXED_CLOCK;
let r1: string;
const t = createTestBot({ now: () => clock });
const T = es.providerRequests;
type Button = { text: string; callback_data?: string };
const buttons = (call: { payload: any }): Button[] => (call.payload.reply_markup?.inline_keyboard ?? []).flat();
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user, firstName: "Prestador Prueba" }));
const say = (user: number, text: string) => t.send(textUpdate(text, { fromId: user, firstName: "Prestador Prueba" }));
const last = () => t.messages().at(-1)!;
const dataOf = (label: string) => buttons(last()).find((b) => b.text === label)!.callback_data!;
const flush = async () => {
  while (afterTasks.length) await afterTasks.shift()!();
};
const sessionOf = async (account: string) => (await owner.query("select data from app.bot_sessions where account_id = $1", [account])).rows[0]?.data ?? {};
const toChat = (user: number) => t.messages().filter((m) => String(m.payload.chat_id) === String(user));
const logs = { log: vi.spyOn(console, "log"), warn: vi.spyOn(console, "warn"), error: vi.spyOn(console, "error") };

const DETAIL_NEW = `Solicitud de información\nFicha: ${L1_NAME}\nEstado: Nueva\nNombre: Ana de Prueba\nFecha de interés: 25/11/2026\nPersonas: 3\nMensaje: Consulta de prueba CANARIO-F031-4420`;
const open = (id: string) => press(P1, `ra:${pack(id)}`);

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  clock = FIXED_CLOCK;
  afterTasks.length = 0;
  await resetDb(owner);
  world = await seedWorld32(owner);
  r1 = await insertRequest(owner, { listingId: world.l1.listingId, businessId: world.l1.businessId, visitorAccountId: world.accounts[V] });
  t.clear();
  for (const spy of Object.values(logs)) spy.mockClear().mockImplementation(() => undefined);
});

describe("criterio 1: Atender abre el detalle", () => {
  it("detalle con los textos, botones Responder, Marcar atendida y Volver; Volver muestra la lista Todas", async () => {
    await open(r1);
    expect(last().payload.text).toBe(DETAIL_NEW);
    expect(last().payload.parse_mode).toBeUndefined();
    expect(buttons(last()).map((b) => b.text)).toEqual([T.replyButton, T.markAttendedButton, T.back]);
    const back = dataOf(T.back);
    t.clear();
    await press(P1, back);
    expect(last().payload.text).toBe(T.listTitle);
    expect(buttons(last()).map((b) => b.text)).toEqual([T.filters.all, T.filters.new, T.filters.attended, T.filters.closed, "Nueva · Ana de Prueba · 25/11/2026", T.back]);
  });
});

describe("criterios 2 a 5: responder", () => {
  it("pide el texto, muestra el resumen sin crear nada y al enviar crea una respuesta y una fila; el doble toque no duplica", async () => {
    await open(r1);
    await press(P1, dataOf(T.replyButton));
    expect(last().payload.text).toBe(T.askReply);
    expect(await sessionOf(world.accounts[P1])).toMatchObject({ form: "information_request_reply", step: "text", requestId: r1 });
    await say(P1, REPLY);
    expect(last().payload.text).toBe(`Esta es tu respuesta:\n${REPLY}\n\n¿La envío al visitante?`);
    expect(buttons(last()).map((b) => b.text)).toEqual([T.sendButton, T.cancelButton]);
    expect(await replyRows(owner)).toHaveLength(0);
    expect(await outboxRows(owner)).toHaveLength(0);
    const send = dataOf(T.sendButton);
    t.clear();
    await press(P1, send);
    await press(P1, send);
    await flush();
    expect(t.texts().filter((x) => x === T.replySent)).toHaveLength(1);
    expect(await replyRows(owner)).toMatchObject([{ request_id: r1, body: REPLY, sent_by_account_id: world.accounts[P1], sent_at: FIXED_CLOCK }]);
    expect(await outboxRows(owner)).toMatchObject([{ recipient_telegram_user_id: String(V), template: "information_request_reply", status: "sent", attempts: 1 }]);
    expect(await statusOf(owner, r1)).toBe("new");
    const toV = toChat(V);
    expect(toV).toHaveLength(1);
    expect(toV[0].payload.text).toBe(`Respuesta a tu solicitud de información\nFicha: ${L1_NAME}\nMensaje del prestador: ${REPLY}`);
    expect(toV[0].payload.parse_mode).toBeUndefined();
    expect(toV[0].payload.reply_markup).toBeUndefined();
    expect(toChat(P3)).toHaveLength(0);
  });

  it("entradas inválidas mantienen el formulario; /cancelar y Cancelar terminan sin sesión residual", async () => {
    await open(r1);
    await press(P1, dataOf(T.replyButton));
    const before = await sessionOf(world.accounts[P1]);
    for (const text of ["", "   ", "z".repeat(4097)]) {
      t.clear();
      await say(P1, text);
      expect(t.texts()).toEqual([T.replyInvalid]);
    }
    t.clear();
    await t.send({ update_id: 9001, message: { message_id: 1, date: 0, chat: { id: P1, type: "private" }, from: { id: P1, is_bot: false, first_name: "x" }, photo: [{ file_id: "f", file_unique_id: "u", width: 1, height: 1 }] } });
    expect(t.texts()).toEqual([T.replyInvalid]);
    expect(await sessionOf(world.accounts[P1])).toEqual(before);
    expect(await replyRows(owner)).toHaveLength(0);
    t.clear();
    await say(P1, "/cancelar");
    expect(t.texts()).toEqual([T.cancelled]);
    expect(await sessionOf(world.accounts[P1])).toEqual({});
    await press(P1, `rq:r:${pack(r1)}`);
    await say(P1, REPLY);
    const cancel = dataOf(T.cancelButton);
    t.clear();
    await press(P1, cancel);
    expect(t.texts()).toEqual([T.cancelled]);
    expect(await sessionOf(world.accounts[P1])).toEqual({});
    expect(await replyRows(owner)).toHaveLength(0);
    expect(await outboxRows(owner)).toHaveLength(0);
  });
});

describe("criterios 9 y 11: cambios de estado", () => {
  it("pide confirmación, cancelar no cambia, confirmar cambia y repetir avisa sin error", async () => {
    await open(r1);
    await press(P1, dataOf(T.markAttendedButton));
    expect(last().payload.text).toBe(T.confirmAttended);
    expect(buttons(last()).map((b) => b.text)).toEqual([T.confirmButton, T.cancelButton]);
    expect(await statusOf(owner, r1)).toBe("new");
    const yes = dataOf(T.confirmButton);
    await press(P1, dataOf(T.cancelButton));
    expect(last().payload.text).toBe(T.cancelled);
    expect(await statusOf(owner, r1)).toBe("new");
    t.clear();
    await press(P1, yes);
    expect(t.texts()[0]).toBe(T.markedAttended);
    expect(t.texts()[1]).toContain("Estado: Atendida");
    expect(t.texts()[1]).toContain(`Historial:\n21/11/2026 15:00 Nueva a Atendida`);
    expect(buttons(last()).map((b) => b.text)).toEqual([T.replyButton, T.markClosedButton, T.back]);
    t.clear();
    await press(P1, yes);
    expect(t.texts()).toEqual([T.alreadyAttended]);
    expect(await eventRows(owner)).toHaveLength(1);
  });

  it("de atendida a cerrada; la cerrada no ofrece botones de acción y no se responde", async () => {
    await open(r1);
    await press(P1, dataOf(T.markAttendedButton));
    await press(P1, dataOf(T.confirmButton));
    await press(P1, dataOf(T.markClosedButton));
    expect(last().payload.text).toBe(T.confirmClosed);
    const yesClosed = dataOf(T.confirmButton);
    t.clear();
    await press(P1, yesClosed);
    expect(t.texts()[0]).toBe(T.markedClosed);
    expect(buttons(last()).map((b) => b.text)).toEqual([T.back]);
    expect(await statusOf(owner, r1)).toBe("closed");
    t.clear();
    await press(P1, `rq:r:${pack(r1)}`);
    expect(t.texts()).toEqual([T.closed]);
    expect(await sessionOf(world.accounts[P1])).toEqual({});
  });
});

describe("criterio 13: cerrada mientras el formulario estaba abierto", () => {
  it("Enviar responde que está cerrada y no envía nada", async () => {
    await open(r1);
    await press(P1, dataOf(T.replyButton));
    await say(P1, REPLY);
    const send = dataOf(T.sendButton);
    await owner.query("alter table app.information_requests disable trigger information_requests_check_update");
    await owner.query("update app.information_requests set status = 'closed'");
    await owner.query("alter table app.information_requests enable trigger information_requests_check_update");
    t.clear();
    await press(P1, send);
    await flush();
    expect(t.texts()).toEqual([T.closed]);
    expect(await replyRows(owner)).toHaveLength(0);
    expect(await outboxRows(owner)).toHaveLength(0);
  });
});

describe("criterio 14: lista con filtros y paginación", () => {
  it("el botón Mis solicitudes de B12 (menú de prestador) abre la lista B13 igual que /solicitudes", async () => {
    await say(P1, "/start");
    const menuButton = t.messages().flatMap((m) => buttons(m)).find((b) => b.text === T.menuButton);
    expect(menuButton).toBeDefined();
    t.clear();
    await press(P1, menuButton!.callback_data!);
    const viaButton = last().payload.text;
    t.clear();
    await say(P1, "/solicitudes");
    expect(viaButton).toBe(T.listTitle);
    expect(last().payload.text).toBe(viaButton);
  });

  it("filtra por estado, ordena de la más reciente a la más antigua, 8 por página con Ver más; Volver lleva al menú", async () => {
    const base = { listingId: world.l1.listingId, businessId: world.l1.businessId, visitorAccountId: world.accounts[V] };
    await owner.query("delete from app.information_requests");
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(await insertRequest(owner, { ...base, name: `Persona ${i}`, status: i === 0 ? "closed" : i === 1 ? "attended" : "new", createdAt: new Date(`2026-11-21T0${i}:00:00-05:00`) }));
    }
    await say(P1, "/solicitudes");
    expect(last().payload.text).toBe(T.listTitle);
    const first = buttons(last());
    const items = first.filter((b) => b.text.includes(" · "));
    expect(items).toHaveLength(8);
    expect(items[0].text).toBe("Nueva · Persona 9 · 25/11/2026");
    expect(first.map((b) => b.text)).toContain(T.more);
    const more = dataOf(T.more);
    const filters = Object.fromEntries(Object.entries(T.filters).map(([k, label]) => [k, dataOf(label)]));
    t.clear();
    await press(P1, more);
    expect(buttons(last()).filter((b) => b.text.includes(" · ")).map((b) => b.text)).toEqual(["Atendida · Persona 1 · 25/11/2026", "Cerrada · Persona 0 · 25/11/2026"]);
    t.clear();
    await press(P1, filters.closed);
    expect(buttons(last()).filter((b) => b.text.includes(" · ")).map((b) => b.text)).toEqual(["Cerrada · Persona 0 · 25/11/2026"]);
    t.clear();
    await press(P1, filters.attended);
    expect(buttons(last()).filter((b) => b.text.includes(" · ")).map((b) => b.text)).toEqual(["Atendida · Persona 1 · 25/11/2026"]);
    t.clear();
    await press(P1, filters.new);
    expect(buttons(last()).filter((b) => b.text.includes(" · "))).toHaveLength(8);
  });

  it("sin resultados responde el texto vacío; Volver desde la lista muestra el menú de prestador", async () => {
    await owner.query("delete from app.information_requests");
    await say(P1, "/solicitudes");
    expect(t.texts()).toEqual([T.empty]);
    const closedFilter = dataOf(T.filters.closed);
    const back = dataOf(T.back);
    t.clear();
    await press(P1, closedFilter);
    expect(t.texts()).toEqual([T.emptyFiltered]);
    t.clear();
    await press(P1, back);
    expect(t.texts()).toEqual([es.menu.welcome + "\n\n" + es.selfRevoke.note]);
    expect(t.messages()[0].payload.text).toContain(es.menu.welcome);
  });
});

describe("criterio 17: fecha en Bogotá", () => {
  it("con el reloj en 22/11 04:30 UTC el detalle muestra 21/11/2026 23:30", async () => {
    clock = new Date("2026-11-22T04:30:00Z");
    await open(r1);
    await press(P1, dataOf(T.markAttendedButton));
    await press(P1, dataOf(T.confirmButton));
    expect(last().payload.text).toContain("Historial:\n21/11/2026 23:30 Nueva a Atendida");
  });
});

describe("criterio 19: callbacks fabricados", () => {
  it("de una solicitud ajena o inexistente: sin datos, sin formulario y sin cambios", async () => {
    const other = await insertRequest(owner, { listingId: world.l2b.listingId, businessId: world.l2b.businessId, visitorAccountId: world.accounts[V] });
    for (const id of [other, UNKNOWN_ID]) {
      for (const prefix of ["ra:", "rq:o:", "rq:r:", "rq:sa:", "rq:sc:", "rq:ya:", "rq:yc:"]) {
        t.clear();
        await press(P1, `${prefix}${pack(id)}`);
        expect(t.texts(), `${prefix}${id}`).toEqual([T.noAccess]);
      }
    }
    expect(await sessionOf(world.accounts[P1])).toEqual({});
    expect(await statusOf(owner, other)).toBe("new");
    expect(await eventRows(owner)).toHaveLength(0);
  });
  it("callback mal formado: texto genérico sin excepción", async () => {
    for (const data of ["rq:o:corto", "rq:zz", "ra:", "ra:AAAA", "rq:l:x9", "rq:o:" + "A".repeat(80)]) {
      t.clear();
      await press(P1, data);
      expect(t.texts(), data).toEqual([es.errors.generic]);
    }
  });
});

describe("criterio 21: rol revocado y sin aviso", () => {
  it("un prestador revocado no abre la lista ni acepta Atender", async () => {
    await revokeProvider(owner, P1);
    await say(P1, "/solicitudes");
    expect(t.texts()).toEqual([es.admin.forbidden]);
    t.clear();
    await open(r1);
    expect(t.texts()).toEqual([es.admin.forbidden]);
  });
  it("el visitante que usa /solicitudes recibe el rechazo y nada más", async () => {
    await say(V, "/solicitudes");
    expect(t.texts()).toEqual([es.admin.forbidden]);
  });
});

describe("criterio 22: textos y registros", () => {
  it("ningún texto fijo ofrece pagos, cupos ni reservas; los registros no llevan canarios", async () => {
    const fixed = JSON.stringify(T).match(/"[^"]*"/g)!.map((x) => x.slice(1, -1));
    expect(forbiddenIn(fixed)).toEqual([]);
    await open(r1);
    await press(P1, dataOf(T.replyButton));
    await say(P1, REPLY);
    await press(P1, dataOf(T.sendButton));
    await flush();
    const lines = [...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls].map((a) => a.map(String).join(" "));
    for (const line of lines) for (const canary of [...CANARIES, String(V)]) expect(line).not.toContain(canary);
    // El detalle al prestador no incluye el ID del visitante.
    t.clear();
    await open(r1);
    expect(t.texts().join("\n")).not.toContain(String(V));
  });
});
