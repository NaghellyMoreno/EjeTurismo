/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON y cargas útiles sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { unpack } from "@/bot/callback-ids";
import { createInformationRequestHandler } from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { RETRY_DELAY_MS } from "@/server/notifications";
import { testConfig } from "../helpers/config";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { ADMIN, CLOCK, forbiddenIn, L1_NAME, LATE_CLOCK, P1, PARTY_SIZE, requestCount, seedInfoWorld, V, V0, type InfoWorld } from "../helpers/information-request";
import { telegramError } from "../helpers/review-http";
import { signInitData, tma } from "../helpers/telegram";

// F031, criterios 1 a 4, 7 a 15 (HTTP): alerta B14 al prestador dueño, en la bandeja y enviada con `after()`.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

const NAME = "Ana de Prueba";
const MSG = "Consulta de prueba CANARIO-F031-4420";
const CANARIES = [NAME, "CANARIO-F031-4420"];
const SOURCE_P2 = 900031002; // prestador con ficha propia distinta (L2)

interface Sent {
  chatId: string;
  text: string;
  extra?: any;
}
let owner: Pool;
let world: InfoWorld;
let clock = CLOCK;
let l2: string;
const sent: Sent[] = [];
const state = { mode: "ok" as "ok" | "error500" | "error403", gate: null as Promise<void> | null };
const db = appDb();
const deps: Deps = {
  config: () => testConfig(),
  db: () => db,
  now: () => clock,
  send: async (chatId, text, extra) => {
    if (state.gate) await state.gate;
    if (state.mode === "error500") throw new Error("fallo-generico");
    if (state.mode === "error403") throw telegramError(403);
    sent.push({ chatId, text, extra });
  },
};
const create = createInformationRequestHandler(deps);
const body = (over: Record<string, unknown> = {}) => ({ requesterName: NAME, interestDate: "2026-11-25", partySize: PARTY_SIZE, message: MSG, confirmed: true, ...over });
const post = (user: number | null, listingId: string, payload: unknown, headers?: Record<string, string>) =>
  create(
    new Request(`http://localhost/api/v1/public/listings/${listingId}/information-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(headers ?? (user === null ? {} : tma(signInitData({ userId: user, authDate: Math.floor(clock.getTime() / 1000) })))) },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ listingId }) },
  );
const flush = async () => {
  while (afterTasks.length) await afterTasks.shift()!();
};
const outbox = async () => (await owner.query("select * from app.notification_outbox order by created_at, id")).rows as any[];
const logs = { log: vi.spyOn(console, "log"), warn: vi.spyOn(console, "warn"), error: vi.spyOn(console, "error") };
const logLines = () => [...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls].map((a) => a.map(String).join(" "));

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await db.destroy();
});
beforeEach(async () => {
  clock = CLOCK;
  afterTasks.length = 0;
  sent.length = 0;
  state.mode = "ok";
  state.gate = null;
  await resetDb(owner);
  world = await seedInfoWorld(owner);
  // P2 de F030 está revocado; se crea otro prestador aprobado con su propia ficha (L2) para el criterio 3.
  const { makeProvider } = await import("../factories/review");
  const { seedListing } = await import("../helpers/listing-data");
  const account = await makeProvider(owner, SOURCE_P2, "1031000002");
  l2 = (await seedListing(owner, { accountId: account, municipalityId: world.municipalityId, categoryId: world.categoryId, name: "Hostal Ejemplo de Prueba", status: "published" })).listingId;
  for (const spy of Object.values(logs)) spy.mockClear().mockImplementation(() => undefined);
});
afterEach(() => {
  for (const line of logLines()) for (const canary of CANARIES) expect(line).not.toContain(canary);
});

describe("criterios 1, 2, 3 y 9: alerta al prestador", () => {
  it("201, una sola llamada al chat de P1 con texto y botón; P2 no recibe nada; la fila pasa a sent", async () => {
    const res = await post(V, world.l1.listingId, body());
    expect(res.status).toBe(201);
    const receipt = (await res.json()) as any;
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe(String(P1));
    expect(sent[0].text).toBe(`Nueva solicitud de información\nFicha: ${L1_NAME}\nNombre: ${NAME}\nFecha de interés: 25/11/2026\nPersonas: 3\nMensaje: ${MSG}`);
    const keyboard = sent[0].extra.reply_markup.inline_keyboard;
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]).toHaveLength(1);
    expect(keyboard[0][0].text).toBe("Atender");
    const data = keyboard[0][0].callback_data as string;
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(data.startsWith("ra:")).toBe(true);
    expect(unpack(data.slice(3))).toBe(receipt.id);
    for (const secret of [NAME, MSG, String(V), String(P1)]) expect(data).not.toContain(secret);
    expect(sent.some((s) => s.chatId === String(SOURCE_P2))).toBe(false);
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", attempts: 1, next_attempt_at: null });
    expect(rows[0].sent_at).not.toBeNull();
    expect(rows[0].recipient_telegram_user_id).toBe(String(P1));
  });

  it("criterio 3: una solicitud a L2 solo alerta a su prestador", async () => {
    expect((await post(V, l2, body())).status).toBe(201);
    await flush();
    expect(sent.map((s) => s.chatId)).toEqual([String(SOURCE_P2)]);
  });

  it("criterio 4: el visitante y el administrador que envían no reciben la alerta", async () => {
    expect((await post(V, world.l1.listingId, body())).status).toBe(201);
    expect((await post(ADMIN, world.l1.listingId, body())).status).toBe(201);
    await flush();
    expect(sent.map((s) => s.chatId)).toEqual([String(P1), String(P1)]);
  });

  it("criterio 15: P1 sobre su propia ficha recibe la alerta", async () => {
    expect((await post(P1, world.l1.listingId, body())).status).toBe(201);
    await flush();
    expect(sent.map((s) => s.chatId)).toEqual([String(P1)]);
  });
});

describe("criterio 1: fecha de interés en America/Bogota", () => {
  it("23:30 en Bogota (22/11 en UTC): hoy es válida y el texto no se desplaza", async () => {
    clock = LATE_CLOCK;
    expect((await post(V, world.l1.listingId, body({ interestDate: "2026-11-21" }))).status).toBe(201);
    await flush();
    expect(sent[0].text).toContain("Fecha de interés: 21/11/2026");
  });
  it("00:00 en Bogota del 22/11: la misma fecha es pasada, 422 y sin alerta", async () => {
    clock = new Date("2026-11-22T05:00:00Z");
    const res = await post(V, world.l1.listingId, body({ interestDate: "2026-11-21" }));
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("must_be_future");
    await flush();
    expect(sent).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);
  });
});

describe("criterio 7: sin solicitud no hay alerta", () => {
  it("cada fallo deja la bandeja vacía y no llama a Telegram", async () => {
    const l = world.l1.listingId;
    const cases: Array<[number, Promise<Response>]> = [];
    cases.push([401, post(null, l, body())]);
    cases.push([401, post(V, l, body(), { Authorization: "tma esto-esta-alterado" })]);
    cases.push([403, post(V0, l, body())]);
    cases.push([422, post(V, l, body({ interestDate: "2026-11-20" }))]);
    cases.push([422, post(V, l, body({ partySize: 0 }))]);
    cases.push([422, post(V, l, body({ message: "" }))]);
    cases.push([422, post(V, l, { ...body(), extra: 1 })]);
    cases.push([409, post(V, world.a1.listingId, body())]);
    cases.push([409, post(V, world.l2.listingId, body())]);
    cases.push([404, post(V, world.l3.listingId, body())]);
    for (const [status, pending] of cases) {
      const res = await pending;
      expect(res.status).toBe(status);
      const text = await res.text();
      for (const canary of CANARIES) expect(text).not.toContain(canary);
    }
    await flush();
    expect(sent).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);
  });
  it("la solicitud 11 del día responde 429 y no deja alerta", async () => {
    for (let i = 0; i < 10; i++) expect((await post(V, world.l1.listingId, body())).status).toBe(201);
    const res = await post(V, world.l1.listingId, body());
    expect(res.status).toBe(429);
    expect(await outbox()).toHaveLength(10);
  });
});

describe("criterio 8: atomicidad", () => {
  it("si falla la inserción en la bandeja, no queda la solicitud", async () => {
    await owner.query("create or replace function app.f031_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo-simulado-f031'; end $$");
    await owner.query("create trigger f031_fail before insert on app.notification_outbox for each row execute function app.f031_fail()");
    try {
      const res = await post(V, world.l1.listingId, body());
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain("fallo-simulado-f031");
      for (const canary of CANARIES) expect(text).not.toContain(canary);
      await flush();
      expect(await requestCount(owner)).toBe(0);
      expect(sent).toHaveLength(0);
    } finally {
      await owner.query("drop trigger f031_fail on app.notification_outbox");
      await owner.query("drop function app.f031_fail()");
    }
  });
});

describe("criterio 10: fallos de Telegram", () => {
  it("error genérico: 201, fila pending con reintento una hora después", async () => {
    state.mode = "error500";
    expect((await post(V, world.l1.listingId, body())).status).toBe(201);
    await flush();
    const [row] = await outbox();
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(new Date(row.next_attempt_at).getTime()).toBe(CLOCK.getTime() + RETRY_DELAY_MS);
    expect(await requestCount(owner)).toBe(1);
  });
  it("403: la fila queda failed sin reintento", async () => {
    state.mode = "error403";
    expect((await post(V, world.l1.listingId, body())).status).toBe(201);
    await flush();
    const [row] = await outbox();
    expect(row).toMatchObject({ status: "failed", attempts: 1, next_attempt_at: null });
  });
});

describe("criterio 11: el envío no bloquea", () => {
  it("responde 201 con la solicitud creada antes de que Telegram conteste", async () => {
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => void (release = resolve));
    const res = await post(V, world.l1.listingId, body());
    expect(res.status).toBe(201);
    expect(await requestCount(owner)).toBe(1);
    expect(sent).toHaveLength(0);
    const running = flush();
    release();
    await running;
    expect(sent).toHaveLength(1);
  });
});

describe("criterios 12, 13 y 14: contenido y datos personales", () => {
  it("texto literal con marcas, sin parse_mode", async () => {
    const name = "<b>Ana</b> & *x*";
    const message = "<i>hola</i> _a_ [a](http://x)";
    expect((await post(V, world.l1.listingId, body({ requesterName: name, message }))).status).toBe(201);
    await flush();
    expect(sent[0].text).toBe(`Nueva solicitud de información\nFicha: ${L1_NAME}\nNombre: ${name}\nFecha de interés: 25/11/2026\nPersonas: 3\nMensaje: ${message}`);
    expect(sent[0].extra.parse_mode).toBeUndefined();
  });
  it("nombre y mensaje de 4096 caracteres: recorta el mensaje y conserva fecha, personas y botón", async () => {
    const long = "x".repeat(4096);
    expect((await post(V, world.l1.listingId, body({ requesterName: long, message: long }))).status).toBe(201);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].text.length).toBeLessThanOrEqual(4096);
    expect(sent[0].text).toContain("Fecha de interés: 25/11/2026");
    expect(sent[0].text).toContain("Personas: 3");
    expect(sent[0].text.endsWith("…")).toBe(true);
    expect(sent[0].extra.reply_markup.inline_keyboard[0][0].text).toBe("Atender");
  });
  it("el texto fijo no ofrece pagos ni reservas y el payload no lleva datos del visitante", async () => {
    expect((await post(V, world.l1.listingId, body({ message: "Consulta neutra" }))).status).toBe(201);
    await flush();
    const fixed = sent[0].text.replace(/Mensaje: .*/s, "") + sent[0].extra.reply_markup.inline_keyboard[0][0].text;
    expect(forbiddenIn([fixed.replace(L1_NAME, "")])).toEqual([]);
    const [row] = await outbox();
    const payload = JSON.stringify(row.payload);
    const visitor = (await owner.query("select id from app.accounts where telegram_user_id = $1", [V])).rows[0].id as string;
    for (const secret of [String(V), visitor, "1030000001"]) expect(payload).not.toContain(secret);
  });
  it("las respuestas y los registros de los fallos no llevan los canarios", async () => {
    state.mode = "error500";
    const res = await post(V, world.l1.listingId, body());
    await flush();
    const text = await res.text();
    for (const canary of CANARIES) expect(text).not.toContain(canary);
    expect(logLines().some((line) => line.includes("notification.delivery_failed"))).toBe(true);
  });
});
