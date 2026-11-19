import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_COMMANDS } from "@/bot/commands";
import { es } from "@/bot/texts/es";
import { buttonsOf, createTestBot, providerMenu } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { adminCallbacks, PROVIDER_A6, PROVIDER_A6B, seedA6b } from "../helpers/provider-denial";
import { changedTables, seedRoleDenial, snapshotAll, type RoleFixtures } from "../helpers/role-denial";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F008, criterios 13 a 17: el prestador activo no ejecuta acciones de administrador desde el bot.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let fx: RoleFixtures;
const t = createTestBot();
const MENU = providerMenu;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  t.clear();
  await resetDb(owner);
  fx = await seedRoleDenial(owner);
  await seedA6b(owner);
});
afterEach(() => vi.restoreAllMocks());

const label = (callback: string) => callback.replace(/[0-9a-f-]{36}/, "<uuid>");

describe("criterios 13, 14 y 17: 23 callbacks de administrador (14 de F003 a F008, 7 de revisión de F014 y 2 de historial de F029) x A6 y A6b (46 casos)", () => {
  it("13, 14 y 17: A6 recibe es.admin.forbidden; A6b recibe el aviso B01; sin datos en el registro técnico", async () => {
    const data = adminCallbacks(fx);
    expect(data).toHaveLength(23);
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
    let cases = 0;
    for (const callback of data) {
      // A6: aviso vigente.
      t.clear();
      let before = await snapshotAll(owner);
      await t.send(callbackUpdate(callback, { fromId: PROVIDER_A6 }));
      let after = await snapshotAll(owner);
      expect(t.texts(), `A6 / ${label(callback)}`).toEqual([es.admin.forbidden]);
      expect(t.calls.filter((c) => c.method === "editMessageText"), `A6 / ${label(callback)}`).toHaveLength(0);
      expect(after.bot_sessions.count, `A6 / ${label(callback)}`).toBe(0);
      expect(changedTables(before, after), `A6 / ${label(callback)}: tablas que cambiaron`).toEqual(["processed_updates"]);
      expect(after.processed_updates.count - before.processed_updates.count, `A6 / ${label(callback)}`).toBe(1);
      cases++;

      // A6b: aviso anterior; el aviso va primero (D-039) y no cambia nada, ni processed_updates.
      t.clear();
      before = await snapshotAll(owner);
      await t.send(callbackUpdate(callback, { fromId: PROVIDER_A6B }));
      after = await snapshotAll(owner);
      const calls = t.messages();
      expect(calls, `A6b / ${label(callback)}`).toHaveLength(3);
      const texts = calls.map((c) => String(c.payload.text));
      expect(texts[0]).toMatch(/^<b>Eje Turismo\. Aviso de privacidad, versión /);
      expect(texts[2]).toContain("Leí el aviso de privacidad de Eje Turismo");
      // F036 (criterio 40): la cuenta con versión anterior ve además el botón de revocar.
      expect(buttonsOf(calls[2].payload)).toEqual(["Acepto", "No acepto", es.selfRevoke.button]);
      for (const text of texts) expect(text).not.toBe(es.admin.forbidden);
      expect(after.bot_sessions.count, `A6b / ${label(callback)}`).toBe(0);
      expect(changedTables(before, after), `A6b / ${label(callback)}: tablas que cambiaron`).toEqual([]);
      cases++;
    }
    expect(cases).toBe(46);

    const joined = logs.join("\n");
    for (const secret of [...data, String(PROVIDER_A6), String(PROVIDER_A6B), fx.ids.registrationId, fx.ids.grantId]) {
      expect(joined, `el registro técnico contiene ${secret}`).not.toContain(secret);
    }
  });
});

describe("criterio 15: A6 no se autoriza administrador desde el bot", () => {
  it("auth:start da es.admin.forbidden y el texto 900007041 solo muestra el menú; no hay sesión ni permiso admin", async () => {
    await t.send(callbackUpdate("auth:start", { fromId: PROVIDER_A6 }));
    expect(t.texts()).toEqual([es.admin.forbidden]);
    t.clear();
    await t.send(textUpdate("900007041", { fromId: PROVIDER_A6 }));
    expect(t.texts()).toEqual(MENU);
    const state = await snapshotAll(owner);
    expect(state.bot_sessions.count).toBe(0);
    const admins = await owner.query("select count(*)::int as count from app.role_grants where role = 'admin' and telegram_user_id in ($1, $2)", [PROVIDER_A6, 900007041]);
    expect(admins.rows[0].count).toBe(0);
    for (const call of t.calls) expect(String(call.payload.chat_id)).toBe(String(PROVIDER_A6));
  });
});

describe("criterio 16: menú del prestador", () => {
  it("/start antes y después de las 23 pulsaciones: solo welcome y providerAvailable, sin opciones de administrador", async () => {
    const outgoing: Array<Record<string, unknown>> = [];
    const start = async () => {
      t.clear();
      await t.send(textUpdate("/start", { fromId: PROVIDER_A6 }));
      expect(t.texts()).toEqual(MENU);
      outgoing.push(...t.messages().map((c) => c.payload));
    };
    await start();
    for (const callback of adminCallbacks(fx)) await t.send(callbackUpdate(callback, { fromId: PROVIDER_A6 }));
    await start();
    const forbidden = [es.admin.pendingButton, es.menu.reviews, es.admin.authorizeButton, es.revoke.button];
    for (const payload of outgoing) {
      // F035: el prestador ve solo "Revocar mi autorización" (en el mensaje de bienvenida); ninguna opción de administrador.
      const text = JSON.stringify(payload);
      for (const word of forbidden) expect(text).not.toContain(word);
      expect(text).not.toMatch(/"(adm|auth|rev):/);
    }
    expect(BOT_COMMANDS.map((c) => c.command)).toEqual(["start"]);
  });
});
