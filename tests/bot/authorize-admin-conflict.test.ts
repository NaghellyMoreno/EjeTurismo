import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { admin, ADMIN_A } from "../factories/admin-auth";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { textUpdate, callbackUpdate } from "../helpers/telegram";

// Pausa controlada de la primera lectura de la sesión de la actualización U1 (criterio 39b; misma mecánica que el 27 de F028).
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

let clock = new Date("2026-11-16T15:00:00Z");
let owner: Pool;
const t = createTestBot({ now: () => clock });
beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  t.clear();
  clock = new Date("2026-11-16T15:00:00Z");
});

it("criterio 39b: la actualización que pierde el bloqueo responde solo sessionConflict y la sesión queda con la otra", async () => {
  const accountId = await admin(owner, ADMIN_A);
  await t.send(callbackUpdate("auth:start", { fromId: ADMIN_A }));
  t.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const before = (await owner.query("select (select count(*) from app.role_grants) g, (select count(*) from app.audit_events) a")).rows[0];

  let open!: () => void;
  gate.release = new Promise<void>((resolve) => (open = resolve));
  const reached = new Promise<void>((resolve) => (gate.reached = resolve));
  gate.armed = true;
  const u1 = t.send(textUpdate("900000052", { fromId: ADMIN_A }));
  await reached;
  clock = new Date(clock.getTime() + 1000);
  await t.send(textUpdate("900000053", { fromId: ADMIN_A }));
  open();
  await u1;

  expect(t.texts()).toEqual([es.adminAuth.confirm("900000053"), es.common.sessionConflict]);
  const data = (await owner.query("select data from app.bot_sessions where account_id = $1", [accountId])).rows[0].data;
  expect(data).toMatchObject({ step: "confirm", draft: { telegramUserId: "900000053" } });
  expect((await owner.query("select (select count(*) from app.role_grants) g, (select count(*) from app.audit_events) a")).rows[0]).toEqual(before);
  expect(console.error).not.toHaveBeenCalled();
});
