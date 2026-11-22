/* eslint-disable @typescript-eslint/no-explicit-any -- cargas útiles de llamadas salientes sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pack } from "@/bot/callback-ids";
import { es } from "@/bot/texts/es";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { ADMIN, V } from "../helpers/information-request";
import { CANARIES, FIXED_CLOCK, REPLY, REQUEST_MESSAGE } from "../helpers/provider-requests";
import { ADM2, B, seedAccessWorld, snapshot, type AccessWorld } from "../helpers/request-access";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F033, criterios 15, 16 y 18 (bot): B13 no muestra ni acepta acciones sobre una solicitud de otro negocio.
vi.mock("next/server", () => ({ after: () => undefined }));

let owner: Pool;
let w: AccessWorld;
const t = createTestBot({ now: () => FIXED_CLOCK });
const T = es.providerRequests;
const logs = { log: vi.spyOn(console, "log"), warn: vi.spyOn(console, "warn"), error: vi.spyOn(console, "error") };
const say = (user: number, text: string) => t.send(textUpdate(text, { fromId: user, firstName: "Persona Prueba" }));
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user, firstName: "Persona Prueba" }));
const everything = () => JSON.stringify(t.calls) + JSON.stringify([...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls]);
const noLeak = (text: string, label: string) => {
  for (const n of [...CANARIES, REQUEST_MESSAGE, "25/11/2026", "Café Mirador de Prueba"]) expect(text, `${label}: ${n}`).not.toContain(n);
};
const buttons = (payload: any): Array<{ text: string; callback_data?: string }> => (payload.reply_markup?.inline_keyboard ?? []).flat();

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  w = await seedAccessWorld(owner);
  t.clear();
  for (const spy of Object.values(logs)) spy.mockClear().mockImplementation(() => undefined);
});

describe("criterio 15: /solicitudes", () => {
  it("B ve la lista con una sola solicitud, la de RB, y nada de RA", async () => {
    await say(B, "/solicitudes");
    const messages = t.messages();
    expect(messages).toHaveLength(1);
    expect(messages[0].payload.text).toBe(T.listTitle);
    const items = buttons(messages[0].payload).filter((b) => b.text.includes(" · "));
    expect(items).toEqual([{ text: "Nueva · Persona Tres · 01/12/2026", callback_data: `rq:o:${pack(w.rb)}` }]);
    noLeak(everything(), "B");
  });
  it("ADM y V reciben solo el texto de permiso, sin lista ni botones", async () => {
    for (const user of [ADMIN, V]) {
      t.clear();
      await say(user, "/solicitudes");
      expect(t.texts()).toEqual([es.admin.forbidden]);
      expect(t.messages().flatMap((m) => buttons(m.payload))).toEqual([]);
      noLeak(everything(), `user ${user}`);
    }
  });
});

describe("criterio 16: callbacks fabricados sobre RA", () => {
  const actions = ["ra:", "rq:o:", "rq:r:", "rq:sa:", "rq:sc:", "rq:ya:", "rq:yc:"];
  const sessionFor = async (user: number) => {
    const accountId = w.world.accounts[user] ?? (await owner.query("select id from app.accounts where telegram_user_id = $1", [user])).rows[0].id;
    await owner.query(
      "insert into app.bot_sessions (account_id, data, updated_at) values ($1, $2, $3) on conflict (account_id) do update set data = $2, updated_at = $3",
      [accountId, JSON.stringify({ form: "information_request_reply", step: "confirm", requestId: w.ra, body: REPLY, startedAt: FIXED_CLOCK.toISOString() }), FIXED_CLOCK],
    );
  };

  it("B y ADM2 (con rol de prestador): No tienes acceso a esta solicitud., sin formulario ni cambios", async () => {
    const before = await snapshot(owner);
    for (const user of [B, ADM2]) {
      for (const prefix of actions) {
        t.clear();
        await press(user, `${prefix}${pack(w.ra)}`);
        expect(t.texts(), `${user} ${prefix}`).toEqual([T.noAccess]);
      }
      await sessionFor(user);
      t.clear();
      await press(user, "rq:ok");
      expect(t.texts(), `${user} Enviar`).toEqual([T.noAccess]);
    }
    expect(await snapshot(owner)).toBe(before);
    noLeak(everything(), "callbacks B y ADM2");
  });

  it("ADM y V (sin rol de prestador): No tienes permiso para hacer esta acción., sin formulario ni cambios", async () => {
    const before = await snapshot(owner);
    for (const user of [ADMIN, V]) {
      for (const prefix of [...actions, "rq:ok"]) {
        t.clear();
        if (prefix === "rq:ok") await sessionFor(user);
        await press(user, prefix === "rq:ok" ? prefix : `${prefix}${pack(w.ra)}`);
        expect(t.texts(), `${user} ${prefix}`).toEqual([es.admin.forbidden]);
      }
    }
    expect(await snapshot(owner)).toBe(before);
    expect((await owner.query("select count(*)::int as n from app.bot_sessions where data->>'form' = 'information_request_reply' and data->>'step' = 'text'")).rows[0].n).toBe(0);
    noLeak(everything(), "callbacks ADM y V");
  });
});
