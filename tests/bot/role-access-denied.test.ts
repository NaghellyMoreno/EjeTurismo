import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { buttonsOf, createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { adminCallbacks } from "../helpers/provider-denial";
import {
  ADMIN_TEST,
  changedTables,
  PERSON_IDS,
  seedRoleDenial,
  snapshotAll,
  type PersonKey,
  type RoleFixtures,
} from "../helpers/role-denial";
import { callbackUpdate } from "../helpers/telegram";

// F007, criterios 18 a 20: el bot no decide permisos; el backend niega aunque el callback_data sea correcto.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let fx: RoleFixtures;
const t = createTestBot();

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
});
afterEach(() => vi.restoreAllMocks());

const callbacks = (): string[] => adminCallbacks(fx);

// F036 (criterio 40): una cuenta con versión anterior (A3) ve además el botón de revocar en el último mensaje.
function expectNotice(calls = t.messages(), oldVersionAccount = false) {
  expect(calls).toHaveLength(3);
  const texts = calls.map((c) => String(c.payload.text));
  expect(texts[0]).toMatch(/^<b>Eje Turismo\. Aviso de privacidad, versión /);
  expect(texts[2]).toContain("Leí el aviso de privacidad de Eje Turismo");
  expect(buttonsOf(calls[2].payload)).toEqual(oldVersionAccount ? ["Acepto", "No acepto", es.selfRevoke.button] : ["Acepto", "No acepto"]);
  for (const text of texts) expect(text).not.toBe(es.admin.forbidden);
}

describe("criterio 18: 14 callbacks de administrador x A1 a A4 (56 casos)", () => {
  it("A1 y A3 reciben el aviso B01 y no cambia nada; A2 y A4 reciben es.admin.forbidden y solo processed_updates gana 1 fila", async () => {
    const data = callbacks();
    expect(data).toHaveLength(14);
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    }
    let cases = 0;
    for (const person of ["A1", "A2", "A3", "A4"] as PersonKey[]) {
      for (const callback of data) {
        t.clear();
        const before = await snapshotAll(owner);
        await t.send(callbackUpdate(callback, { fromId: PERSON_IDS[person] }));
        const after = await snapshotAll(owner);
        const label = `${person} / ${callback.replace(/[0-9a-f-]{36}/, "<uuid>")}`;
        expect(after.bot_sessions.count, label).toBe(0);
        if (person === "A1" || person === "A3") {
          expectNotice(t.messages(), person === "A3");
          expect(changedTables(before, after), `${label}: tablas que cambiaron`).toEqual([]);
        } else {
          expect(t.texts(), label).toEqual([es.admin.forbidden]);
          expect(t.calls.filter((c) => c.method === "editMessageText"), label).toHaveLength(0);
          expect(changedTables(before, after), `${label}: tablas que cambiaron`).toEqual(["processed_updates"]);
          expect(after.processed_updates.count - before.processed_updates.count, label).toBe(1);
        }
        cases++;
      }
    }
    expect(cases).toBe(56);

    // Criterio 20: el registro técnico no lleva callback_data, ID de Telegram ni UUID del recurso.
    const joined = logs.join("\n");
    for (const forbidden of [...data, ...Object.values(PERSON_IDS).map(String), fx.ids.registrationId, fx.ids.grantId, String(ADMIN_TEST)]) {
      expect(joined, `el registro técnico contiene ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("19: control positivo, el administrador de prueba pulsando adm:list no recibe es.admin.forbidden", async () => {
    await t.send(callbackUpdate("adm:list", { fromId: ADMIN_TEST }));
    expect(t.texts().length).toBeGreaterThan(0);
    expect(t.texts()).not.toContain(es.admin.forbidden);
  });
});
