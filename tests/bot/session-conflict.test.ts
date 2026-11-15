import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { createAccount, PERSON_1 } from "../factories/accounts";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { callbackUpdate } from "../helpers/telegram";

// Pausa controlada de la primera lectura de la sesión de la actualización U1 (criterio 27).
const gate = vi.hoisted(() => ({ armed: false, reached: undefined as undefined | (() => void), release: undefined as undefined | Promise<void> }));
vi.mock("@/server/services/bot-session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/services/bot-session")>();
  return {
    ...real,
    loadBotSession: async (...args: Parameters<typeof real.loadBotSession>) => {
      const stored = await real.loadBotSession(...args);
      if (gate.armed) {
        gate.armed = false;
        gate.reached?.();
        await gate.release;
      }
      return stored;
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
});

it("criterio 27: la actualización que pierde el bloqueo optimista responde sessionConflict y la sesión queda con la otra", async () => {
  const id = await createAccount(owner, PERSON_1);
  await t.send(callbackUpdate("provider:register", { fromId: PERSON_1 }));
  t.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  let open!: () => void;
  gate.release = new Promise<void>((resolve) => (open = resolve));
  const reached = new Promise<void>((resolve) => (gate.reached = resolve));
  gate.armed = true;
  const u1 = t.send(callbackUpdate("CC", { fromId: PERSON_1 }));
  await reached;
  // U2 se procesa completa mientras U1 espera; el guardado de U2 cambia updated_at.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await t.send(callbackUpdate("CE", { fromId: PERSON_1 }));
  open();
  await u1;

  const texts = t.texts();
  expect(texts).toHaveLength(2);
  expect(texts).toContain(es.provider.askNumber);
  expect(texts).toContain(es.common.sessionConflict);
  expect(texts).not.toContain(es.errors.generic);
  const data = (await owner.query("select data from app.bot_sessions where account_id = $1", [id])).rows[0].data;
  expect(data).toMatchObject({ step: "number", draft: { identityDocumentType: "CE" } });
  expect(Number((await owner.query("select count(*) from app.provider_registrations")).rows[0].count)).toBe(0);
  expect(console.error).not.toHaveBeenCalled();
});
