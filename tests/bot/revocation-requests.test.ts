/* eslint-disable @typescript-eslint/no-explicit-any -- cargas útiles de llamadas salientes sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pack } from "@/bot/callback-ids";
import { SELF_REVOKE_ASK, SELF_REVOKE_CONFIRM } from "@/bot/self-revoke";
import { es } from "@/bot/texts/es";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { P1, V, V2, requestCount } from "../helpers/information-request";
import { insertRequest, seedWorld32, type World32 } from "../helpers/provider-requests";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F037 (bot): criterios 2, 3, 6, 8, 12, 14, 18 y 19 (parte del bot). Los avisos salen con `after()`, aquí ejecutado a mano.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let world: World32;
const t = createTestBot();
const flush = async () => {
  while (afterTasks.length) await afterTasks.shift()!();
};
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const say = (user: number, text: string) => t.send(textUpdate(text, { fromId: user }));
const toChat = (user: number) => t.messages().filter((m) => String(m.payload.chat_id) === String(user)).map((m) => String(m.payload.text));
const buttons = (call: { payload: any }): string[] => (call.payload.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => b.text);
const add = (visitor: number) => insertRequest(owner, { listingId: world.l1.listingId, businessId: world.l1.businessId, visitorAccountId: world.accounts[visitor] });
const account = async (user: number) => (await owner.query("select 1 from app.accounts where telegram_user_id = $1", [user])).rows.length;
const revokeInBot = async (user: number) => {
  await press(user, SELF_REVOKE_ASK);
  await press(user, SELF_REVOKE_CONFIRM);
  await flush();
};

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  await resetDb(owner);
  world = await seedWorld32(owner);
  t.clear();
});

describe("revoca un visitante en el bot", () => {
  it("2, 3, 6 y 8: P1 ve la solicitud; V revoca; la respuesta es selfRevoke.revoked; P1 recibe el aviso literal y la lista queda vacía", async () => {
    await add(V);
    await say(P1, "/solicitudes");
    expect(t.texts()[0]).toBe(es.providerRequests.listTitle);
    expect(t.texts()).not.toContain(es.providerRequests.empty);
    t.clear();
    await revokeInBot(V);
    expect(toChat(V).at(-1)).toBe(es.selfRevoke.revoked);
    expect(await account(V)).toBe(0);
    expect(await requestCount(owner)).toBe(0);
    expect(toChat(P1)).toEqual(["Una solicitud de información que habías recibido ya no está disponible porque la persona que la envió retiró su autorización."]);
    expect((await owner.query("select status from app.notification_outbox where recipient_telegram_user_id = $1", [P1])).rows).toEqual([{ status: "sent" }]);
    t.clear();
    await say(P1, "/solicitudes");
    expect(t.texts()).toEqual([es.providerRequests.empty]);
  });
});

describe("revoca un prestador en el bot", () => {
  it("12, 14, 18 y 19: P1 revoca; V2 recibe el aviso literal, ve la ficha sin solicitar y el botón antiguo responde que ya no recibe solicitudes", async () => {
    await add(V2);
    await revokeInBot(P1);
    expect(toChat(P1).at(-1)).toBe(es.selfRevoke.revoked);
    expect(await account(P1)).toBe(0);
    expect((await owner.query("select 1 from app.role_grants where telegram_user_id = $1", [P1])).rows).toEqual([]);
    expect(await requestCount(owner)).toBe(0);
    expect(toChat(V2)).toEqual(["Una solicitud que enviaste ya no está disponible porque el prestador que la recibió retiró su autorización."]);
    t.clear();
    await press(V, `exp:d:${pack(world.l1.listingId)}:1`);
    const detail = t.messages().at(-1)!;
    expect(String(detail.payload.text)).toContain("Café Mirador de Prueba");
    expect(buttons(detail)).not.toContain(es.informationRequest.button);
    t.clear();
    await press(V, `exp:r:${pack(world.l1.listingId)}:1`);
    expect(t.texts().at(-1)).toBe(es.informationRequest.unavailable);
    expect(await requestCount(owner)).toBe(0);
  });
});
