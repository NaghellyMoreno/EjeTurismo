/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON y cargas útiles sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RETRY_DELAY_MS } from "@/server/notifications";
import type { Deps } from "@/server/http/deps";
import { testConfig } from "../helpers/config";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { ADMIN, forbiddenIn, L1_NAME, P1, P3, revokeProvider, V } from "../helpers/information-request";
import {
  CANARIES, EDGE, eventRows, FIXED_CLOCK, insertRequest, outboxRows, REPLY, replyRows, requestsApi, seedWorld32, statusOf, UNKNOWN_ID, type World32,
} from "../helpers/provider-requests";
import { telegramError } from "../helpers/review-http";

// F032, criterios 5 a 8, 10 a 13, 15, 16, 18, 20 y 21 (HTTP): responder y cambiar el estado con los manejadores reales.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

interface Sent { chatId: string; text: string; extra?: any }
let owner: Pool;
let world: World32;
let clock = FIXED_CLOCK;
let r1: string;
const sent: Sent[] = [];
const state = { mode: "ok" as "ok" | "error500" | "error403" };
const db = appDb();
const deps: Deps = {
  config: () => testConfig(),
  db: () => db,
  now: () => clock,
  send: async (chatId, text, extra) => {
    if (state.mode === "error500") throw new Error("fallo-generico");
    if (state.mode === "error403") throw telegramError(403);
    sent.push({ chatId, text, extra });
  },
};
const api = requestsApi(deps);
const flush = async () => {
  while (afterTasks.length) await afterTasks.shift()!();
};
const logs = { log: vi.spyOn(console, "log"), warn: vi.spyOn(console, "warn"), error: vi.spyOn(console, "error") };
const logLines = () => [...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls].map((a) => a.map(String).join(" "));
const text = async (res: Response) => res.text();

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await db.destroy();
});
beforeEach(async () => {
  clock = FIXED_CLOCK;
  afterTasks.length = 0;
  sent.length = 0;
  state.mode = "ok";
  await resetDb(owner);
  world = await seedWorld32(owner);
  r1 = await insertRequest(owner, { listingId: world.l1.listingId, businessId: world.l1.businessId, visitorAccountId: world.accounts[V] });
  for (const spy of Object.values(logs)) spy.mockClear().mockImplementation(() => undefined);
});
afterEach(() => {
  for (const line of logLines()) for (const canary of CANARIES) expect(line).not.toContain(canary);
});

describe("criterios 5 y 6: responder por la API", () => {
  it("201 con id, body, sentAt y deliveryStatus queued; una llamada a V en texto plano; la bandeja pasa a sent", async () => {
    const res = await api.reply(P1, r1, { body: REPLY, confirmed: true });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ body: REPLY, sentAt: FIXED_CLOCK.toISOString(), deliveryStatus: "queued" });
    expect(await statusOf(owner, r1)).toBe("new");
    expect(await replyRows(owner)).toMatchObject([{ request_id: r1, body: REPLY, sent_by_account_id: world.accounts[P1] }]);
    const rows = await outboxRows(owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipient_telegram_user_id: String(V), template: "information_request_reply", status: "pending" });
    // El payload no lleva el texto ni datos del visitante; el envío lee la respuesta de su tabla.
    expect(JSON.stringify(rows[0].payload)).not.toMatch(/CANARIO|Ana de Prueba/);
    expect(sent).toHaveLength(0);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chatId: String(V), text: `Respuesta a tu solicitud de información\nFicha: ${L1_NAME}\nMensaje del prestador: ${REPLY}` });
    expect(sent[0].extra).toBeUndefined();
    expect(await outboxRows(owner)).toMatchObject([{ status: "sent", attempts: 1 }]);
    expect(forbiddenIn([sent[0].text])).toEqual([]);
  });

  it("borde de 4096 caracteres: el mensaje mide a lo más 4096, conserva Ficha y termina en …; el texto con marcas llega literal", async () => {
    await api.reply(P1, r1, { body: "x".repeat(4096), confirmed: true });
    await api.reply(P1, r1, { body: EDGE, confirmed: true });
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[0].text.length).toBeLessThanOrEqual(4096);
    expect(sent[0].text).toContain(`Ficha: ${L1_NAME}`);
    expect(sent[0].text.endsWith("…")).toBe(true);
    expect(sent[1].text).toBe(`Respuesta a tu solicitud de información\nFicha: ${L1_NAME}\nMensaje del prestador: ${EDGE}`);
    expect(sent.every((m) => m.extra === undefined)).toBe(true);
  });
});

describe("criterio 7: errores al responder", () => {
  it("401 sin sesión o con initData alterado", async () => {
    expect((await api.reply(null, r1, { body: REPLY, confirmed: true })).status).toBe(401);
    expect((await api.reply(P1, r1, { body: REPLY, confirmed: true }, { "Content-Type": "application/json", Authorization: "tma user=%7B%7D&hash=00" })).status).toBe(401);
  });
  it("422 sin repetir el texto: vacío, largo, claves extra y confirmed distinto de true", async () => {
    for (const body of [{ body: "   ", confirmed: true }, { body: "y".repeat(4097), confirmed: true }, { body: REPLY, confirmed: true, extra: 1 }, { body: REPLY, confirmed: false }, { body: REPLY }]) {
      const res = await api.reply(P1, r1, body);
      expect(res.status).toBe(422);
      expect(await text(res)).not.toContain("CANARIO");
    }
    expect(await replyRows(owner)).toHaveLength(0);
    expect(await outboxRows(owner)).toHaveLength(0);
  });
  it("403 con el mismo cuerpo para ajena, inexistente y de id mal formado", async () => {
    const bodies: string[] = [];
    for (const id of [r1, UNKNOWN_ID, "no-es-un-id"]) {
      const res = await api.reply(P3, id, { body: REPLY, confirmed: true });
      expect(res.status).toBe(403);
      bodies.push(await text(res));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(await replyRows(owner)).toHaveLength(0);
    expect(await outboxRows(owner)).toHaveLength(0);
  });
});

describe("criterio 8: entrega fallida", () => {
  it("error genérico: 201, respuesta guardada y fila pending con next_attempt_at", async () => {
    state.mode = "error500";
    expect((await api.reply(P1, r1, { body: REPLY, confirmed: true })).status).toBe(201);
    await flush();
    expect(await replyRows(owner)).toHaveLength(1);
    const [row] = await outboxRows(owner);
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(new Date(row.next_attempt_at).getTime()).toBe(FIXED_CLOCK.getTime() + RETRY_DELAY_MS);
  });
  it("403 de Telegram: 201 y fila failed sin next_attempt_at", async () => {
    state.mode = "error403";
    expect((await api.reply(P1, r1, { body: REPLY, confirmed: true })).status).toBe(201);
    await flush();
    expect(await outboxRows(owner)).toMatchObject([{ status: "failed", attempts: 1, next_attempt_at: null }]);
  });
  it("si falla la inserción en la bandeja no queda respuesta y responde 500 genérico", async () => {
    await owner.query("create function app.f032_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo simulado'; end $$");
    await owner.query("create trigger f032_fail before insert on app.notification_outbox for each row execute function app.f032_fail()");
    try {
      const res = await api.reply(P1, r1, { body: REPLY, confirmed: true });
      expect(res.status).toBe(500);
      expect(await text(res)).not.toContain("CANARIO");
    } finally {
      await owner.query("drop trigger f032_fail on app.notification_outbox");
      await owner.query("drop function app.f032_fail()");
    }
    expect(await replyRows(owner)).toHaveLength(0);
  });
});

describe("criterios 10 a 13: estados por la API", () => {
  it("new a attended: 200 con el esquema, updatedAt del reloj y un evento del prestador", async () => {
    const res = await api.change(P1, r1, { status: "attended", confirmed: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ id: r1, status: "attended", updatedAt: FIXED_CLOCK.toISOString(), listingName: L1_NAME });
    expect(json.statusHistory).toMatchObject([{ fromStatus: "new", toStatus: "attended", occurredAt: FIXED_CLOCK.toISOString(), actor: { role: "provider" } }]);
    expect(JSON.stringify(json)).not.toContain(String(V));
  });
  it("422: confirmed distinto de true, new, estado inexistente y claves extra; no cambia nada", async () => {
    for (const body of [{ status: "attended", confirmed: false }, { status: "new", confirmed: true }, { status: "otro", confirmed: true }, { status: "attended", confirmed: true, x: 1 }]) {
      expect((await api.change(P1, r1, body)).status).toBe(422);
    }
    expect(await statusOf(owner, r1)).toBe("new");
    expect(await eventRows(owner)).toHaveLength(0);
  });
  it("attended a closed: 200; luego no se vuelve atrás ni se repite; new a closed y repetir dan 409", async () => {
    expect((await api.change(P1, r1, { status: "closed", confirmed: true })).status).toBe(409);
    expect((await api.change(P1, r1, { status: "attended", confirmed: true })).status).toBe(200);
    expect((await api.change(P1, r1, { status: "attended", confirmed: true })).status).toBe(409);
    clock = new Date("2026-11-21T16:00:00-05:00");
    const closed = await api.change(P1, r1, { status: "closed", confirmed: true });
    expect(closed.status).toBe(200);
    expect((await closed.json()).status).toBe("closed");
    for (const status of ["attended", "closed"]) {
      const res = await api.change(P1, r1, { status, confirmed: true });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("invalid_state_transition");
    }
    expect(await statusOf(owner, r1)).toBe("closed");
    expect(await eventRows(owner)).toHaveLength(2);
  });
  it("responder una cerrada: 409 sin respuesta ni bandeja", async () => {
    await api.change(P1, r1, { status: "attended", confirmed: true });
    await api.change(P1, r1, { status: "closed", confirmed: true });
    expect((await api.reply(P1, r1, { body: REPLY, confirmed: true })).status).toBe(409);
    expect(await replyRows(owner)).toHaveLength(0);
    expect(await outboxRows(owner)).toHaveLength(0);
  });
});

describe("criterio 16: historial y respuestas en el detalle", () => {
  it("dos eventos con los dos relojes, escritos por el disparador, y la respuesta", async () => {
    await api.reply(P1, r1, { body: REPLY, confirmed: true });
    await api.change(P1, r1, { status: "attended", confirmed: true });
    const later = new Date("2026-11-21T17:00:00-05:00");
    clock = later;
    await api.change(P1, r1, { status: "closed", confirmed: true });
    const events = await eventRows(owner);
    expect(events.map((e) => [e.from_status, e.to_status, e.actor_account_id, e.occurred_at.toISOString()])).toEqual([
      ["new", "attended", world.accounts[P1], FIXED_CLOCK.toISOString()],
      ["attended", "closed", world.accounts[P1], later.toISOString()],
    ]);
    const detail = await (await api.get(P1, r1)).json();
    expect(detail.statusHistory.map((e: any) => e.toStatus)).toEqual(["attended", "closed"]);
    expect(detail.replies).toMatchObject([{ body: REPLY, deliveryStatus: "queued" }]);
  });
});

describe("criterios 15 y 18: lista y detalle", () => {
  it("lista solo lo de P1, con filtro, paginación y errores", async () => {
    const a = await insertRequest(owner, { listingId: world.l1.listingId, businessId: world.l1.businessId, visitorAccountId: world.accounts[V], status: "closed", createdAt: new Date("2026-11-21T13:00:00-05:00") });
    await insertRequest(owner, { listingId: world.l2b.listingId, businessId: world.l2b.businessId, visitorAccountId: world.accounts[V] });
    const all = await (await api.list(P1)).json();
    expect(all).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(all.items.map((i: any) => i.id)).toEqual([r1, a]);
    const closed = await (await api.list(P1, "?status=closed")).json();
    expect(closed.items.map((i: any) => i.id)).toEqual([a]);
    expect(closed.total).toBe(1);
    const paged = await (await api.list(P1, "?pageSize=1&page=2")).json();
    expect(paged).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(JSON.stringify(all)).not.toMatch(/identity|900030001/);
    for (const query of ["?status=foo", "?page=0", "?pageSize=0", "?pageSize=51"]) expect((await api.list(P1, query)).status).toBe(422);
    expect((await api.list(null)).status).toBe(401);
  });
  it("detalle: 200 completo; inexistente y mal formado dan 403 igual que ajena; sin sesión 401", async () => {
    const res = await api.get(P1, r1);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: r1, listingId: world.l1.listingId, listingName: L1_NAME, requesterName: "Ana de Prueba", interestDate: "2026-11-25", partySize: 3, status: "new", replies: [], statusHistory: [] });
    const bodies = [];
    for (const id of [UNKNOWN_ID, "no-es-un-id"]) {
      const bad = await api.get(P1, id);
      expect(bad.status).toBe(403);
      bodies.push(await text(bad));
    }
    const foreign = await api.get(P3, r1);
    expect(foreign.status).toBe(403);
    expect(new Set([...bodies, await text(foreign)]).size).toBe(1);
    expect((await api.get(null, r1)).status).toBe(401);
  });
});

describe("criterios 20 y 21: acceso", () => {
  it("P3, ADM y V reciben 403 en las operaciones; sin sesión 401; nada cambia", async () => {
    for (const user of [P3, ADMIN, V]) {
      expect((await api.get(user, r1)).status).toBe(403);
      expect((await api.reply(user, r1, { body: REPLY, confirmed: true })).status).toBe(403);
      expect((await api.change(user, r1, { status: "attended", confirmed: true })).status).toBe(403);
    }
    for (const user of [ADMIN, V]) expect((await api.list(user)).status).toBe(403);
    expect((await api.get(null, r1)).status).toBe(401);
    expect((await api.reply(null, r1, { body: REPLY, confirmed: true })).status).toBe(401);
    expect((await api.change(null, r1, { status: "attended", confirmed: true })).status).toBe(401);
    expect(await statusOf(owner, r1)).toBe("new");
    expect(await replyRows(owner)).toHaveLength(0);
    expect(await eventRows(owner)).toHaveLength(0);
    expect(await outboxRows(owner)).toHaveLength(0);
  });
  it("un prestador con el rol revocado recibe 403 en las cuatro operaciones", async () => {
    await revokeProvider(owner, P1);
    expect((await api.list(P1)).status).toBe(403);
    expect((await api.get(P1, r1)).status).toBe(403);
    expect((await api.reply(P1, r1, { body: REPLY, confirmed: true })).status).toBe(403);
    expect((await api.change(P1, r1, { status: "attended", confirmed: true })).status).toBe(403);
    expect(await statusOf(owner, r1)).toBe("new");
  });
  it("las respuestas de error no llevan canarios ni el ID del visitante", async () => {
    const bodies = [await api.get(P3, r1), await api.reply(P3, r1, { body: REPLY, confirmed: true }), await api.change(ADMIN, r1, { status: "attended", confirmed: true })];
    for (const res of bodies) {
      const body = await text(res);
      for (const canary of [...CANARIES, String(V)]) expect(body).not.toContain(canary);
    }
  });
});

