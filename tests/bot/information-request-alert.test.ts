/* eslint-disable @typescript-eslint/no-explicit-any -- cargas útiles de llamadas salientes sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pack, unpack } from "@/bot/callback-ids";
import { es } from "@/bot/texts/es";
import { GrammyError } from "grammy";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { CHANGED_NAME, CLOCK, FUTURE, L1_NAME, MESSAGE, P1, PARTY_SIZE, requestCount, seedInfoWorld, V, V_NAME, type InfoWorld } from "../helpers/information-request";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F031, criterios 5, 6 y 10 (bot): la alerta B14 al prestador tras "Confirmar" en B19.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let world: InfoWorld;
const t = createTestBot({ now: () => CLOCK });
const T = es.informationRequest;
type Button = { text: string; callback_data?: string };
const buttonsOf = (call: { payload: any }): Button[] => (call.payload.reply_markup?.inline_keyboard ?? []).flat();
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user, firstName: V_NAME }));
const say = (user: number, text: string) => t.send(textUpdate(text, { fromId: user, firstName: V_NAME }));
const dataOf = (text: string) => buttonsOf(t.messages().at(-1)!).find((b) => b.text === text)!.callback_data!;
const flush = async () => {
  while (afterTasks.length) await afterTasks.shift()!();
};
const outboxRows = async () => (await owner.query("select * from app.notification_outbox")).rows as any[];
// Transformador que hace fallar los envíos al chat de P1 mientras `failP1.error` esté definido.
const failP1: { error?: () => Error } = {};
t.bot.api.config.use(async (prev, method, payload, signal) => {
  if (method === "sendMessage" && String((payload as any).chat_id) === String(P1) && failP1.error) throw failP1.error();
  return prev(method, payload, signal);
});
const alerts = () => t.messages().filter((m) => String(m.payload.chat_id) === String(P1));

// Llena el formulario hasta el resumen y devuelve el callback de "Confirmar".
async function fillForm(): Promise<string> {
  await press(V, `exp:d:${pack(world.l1.listingId)}:1`);
  await press(V, dataOf(T.button));
  await press(V, dataOf(T.changeName));
  await say(V, CHANGED_NAME);
  await say(V, FUTURE.bot);
  await say(V, String(PARTY_SIZE));
  await say(V, MESSAGE);
  return dataOf(T.confirmButton);
}

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  failP1.error = undefined;
  afterTasks.length = 0;
  await resetDb(owner);
  world = await seedInfoWorld(owner);
  t.clear();
});

describe("criterio 5: alerta tras confirmar en el bot", () => {
  it("V recibe la confirmación de F030 y P1 la alerta con el botón Atender; nadie más", async () => {
    const confirm = await fillForm();
    t.clear();
    await press(V, confirm);
    await flush();
    const toV = t.messages().filter((m) => String(m.payload.chat_id) !== String(P1));
    expect(toV.map((m) => m.payload.text)).toContain(T.sent);
    expect(alerts()).toHaveLength(1);
    const alert = alerts()[0];
    expect(alert.payload.text).toBe(`Nueva solicitud de información\nFicha: ${L1_NAME}\nNombre: ${CHANGED_NAME}\nFecha de interés: ${FUTURE.bot}\nPersonas: ${PARTY_SIZE}\nMensaje: ${MESSAGE}`);
    expect(alert.payload.parse_mode).toBeUndefined();
    const buttons = buttonsOf(alert);
    expect(buttons.map((b) => b.text)).toEqual(["Atender"]);
    const request = (await owner.query("select id from app.information_requests")).rows[0].id as string;
    expect(unpack(buttons[0].callback_data!.slice(3))).toBe(request);
    expect(Buffer.byteLength(buttons[0].callback_data!)).toBeLessThanOrEqual(64);
    expect(t.messages().filter((m) => buttonsOf(m).some((b) => b.text === "Atender"))).toHaveLength(1);
  });
});

describe("criterio 6: doble pulsación", () => {
  it("una solicitud, una fila en la bandeja y una alerta", async () => {
    const confirm = await fillForm();
    t.clear();
    await press(V, confirm);
    await press(V, confirm);
    await flush();
    expect(await requestCount(owner)).toBe(1);
    expect(await outboxRows()).toHaveLength(1);
    expect(alerts()).toHaveLength(1);
  });
});

describe("criterio 10: fallo de Telegram con el bot", () => {
  it("el visitante recibe igual su confirmación y la fila queda pending", async () => {
    const confirm = await fillForm();
    t.clear();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    failP1.error = () => new Error("fallo-generico");
    await press(V, confirm);
    await flush();
    expect(t.texts()).toContain(T.sent);
    expect(await requestCount(owner)).toBe(1);
    expect(await outboxRows()).toMatchObject([{ status: "pending", attempts: 1 }]);
    for (const call of spy.mock.calls) for (const canary of [CHANGED_NAME, "CANARIO-F030-7731"]) expect(call.map(String).join(" ")).not.toContain(canary);
    vi.restoreAllMocks();
  });
  it("403 del prestador: la fila queda failed", async () => {
    const confirm = await fillForm();
    t.clear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    failP1.error = () => new GrammyError("bloqueado", { ok: false, error_code: 403, description: "simulado" }, "sendMessage", {});
    await press(V, confirm);
    await flush();
    expect(t.texts()).toContain(T.sent);
    expect(await outboxRows()).toMatchObject([{ status: "failed", attempts: 1, next_attempt_at: null }]);
    vi.restoreAllMocks();
  });
});
