import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createWebhookHandler } from "@/bot/webhook";
import { createTestBot } from "../helpers/bot";
import { counts, EMPTY_COUNTS, NOTICE_VERSION, ownerPool, resetDb } from "../helpers/db";
import { callbackUpdate, NEW_USER } from "../helpers/telegram";

let owner: Pool;
const harness = createTestBot();
const handler = createWebhookHandler({ secret: () => "test-webhook-secret", bot: async () => harness.bot });
const deliver = (body: string) =>
  handler(new Request("http://localhost/api/v1/telegram/webhook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret" }, body }));

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await harness.db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  harness.clear();
});

describe("el mismo update_id entregado tres veces (criterio 12; ADR 0008)", () => {
  it("la primera crea la cuenta sin escribir en processed_updates; la segunda lo registra; la tercera no cambia nada", async () => {
    const accept = JSON.stringify(callbackUpdate(`consent:accept:${NOTICE_VERSION}`, { fromId: NEW_USER, updateId: 5001 }));

    expect((await deliver(accept)).status).toBe(200);
    expect(await counts(owner)).toMatchObject({ accounts: 1, consent_events: 1, processed_updates: 0 });

    expect((await deliver(accept)).status).toBe(200);
    expect(await counts(owner)).toMatchObject({ accounts: 1, consent_events: 1, processed_updates: 1 });
    expect((await owner.query("select * from app.processed_updates")).rows).toEqual([
      { update_id: "5001", received_at: expect.any(Date) },
    ]);

    const sentBefore = harness.messages().length;
    expect((await deliver(accept)).status).toBe(200);
    expect(await counts(owner)).toMatchObject({ accounts: 1, consent_events: 1, processed_updates: 1 });
    expect(harness.messages().length).toBe(sentBefore);
  });
});

describe("cuerpos que no sirven con el secreto correcto (criterio 38)", () => {
  const cases: Record<string, string> = {
    "el cuerpo no es JSON": "{no es json",
    "el cuerpo es JSON pero no tiene update_id": JSON.stringify({ message: { text: "hola" } }),
    "la actualización no tiene from (channel_post)": JSON.stringify({
      update_id: 6001,
      channel_post: { message_id: 1, date: 0, chat: { id: -100123, type: "channel", title: "Canal" }, text: "hola" },
    }),
  };
  for (const [name, body] of Object.entries(cases)) {
    it(`responde 200 y no crea nada cuando ${name}`, async () => {
      expect((await deliver(body)).status).toBe(200);
      expect(await counts(owner)).toEqual(EMPTY_COUNTS);
      expect(harness.calls).toEqual([]);
    });
  }
});
