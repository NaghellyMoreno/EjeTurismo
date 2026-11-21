import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_COMMANDS } from "@/bot/commands";
import { EXPLORE_START } from "@/bot/explore";
import { es } from "@/bot/texts/es";
import * as services from "@/server/services";
import { listCatalog, listMunicipalities } from "@/server/services";
import { buttonsOf, createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { seedExplore } from "../helpers/explore";
import { A6, ADMIN, makeReviewListingApi, VISITOR } from "../helpers/review-listing";
import { changedTables, PERSON_IDS, snapshotAll } from "../helpers/role-denial";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F022, criterios 1 a 5, 9 y 15 (bot): entrada, municipios y categorías de B15.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

type Button = { text: string; callback_data?: string };
let owner: Pool;
const t = createTestBot();
const api = makeReviewListingApi(t.db);
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const say = (user: number, text: string) => t.send(textUpdate(text, { fromId: user }));
const buttons = (index = -1): Button[] => {
  const markup = t.messages().at(index)!.payload.reply_markup as { inline_keyboard: Button[][] } | undefined;
  return (markup?.inline_keyboard ?? []).flat();
};
const rowsOf = (index = -1): Button[][] => (t.messages().at(index)!.payload.reply_markup as { inline_keyboard: Button[][] }).inline_keyboard.filter((row) => row.length > 0);
const data = (text: string, index = -1) => buttons(index).find((b) => b.text === text)!.callback_data!;
const actor = { telegramUserId: String(VISITOR), displayName: null };
// Cada actualización pasa por claimUpdate: processed_updates es la única tabla que cambia por el solo hecho de recibirla.
const changed = (before: Awaited<ReturnType<typeof snapshotAll>>, after: Awaited<ReturnType<typeof snapshotAll>>) => changedTables(before, after).filter((table) => table !== "processed_updates");
const bytes = (value: string) => Buffer.byteLength(value);

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  t.clear();
  await resetDb(owner);
  await seedExplore(owner, api, afterTasks);
});
afterEach(() => vi.restoreAllMocks());

describe("criterio 1: entrada", () => {
  it("todas las cuentas con el aviso vigente ven Explorar con el prefijo exp: y el registro se conserva", async () => {
    for (const user of [VISITOR, A6, ADMIN]) {
      t.clear();
      await say(user, "/start");
      const explore = buttons(0).find((b) => b.text === es.menu.exploreButton);
      expect(explore?.callback_data?.startsWith("exp:")).toBe(true);
    }
    t.clear();
    await say(VISITOR, "/start");
    expect(buttonsOf(t.messages()[0].payload)).toContain(es.menu.registerButton);
    expect(BOT_COMMANDS.map((c) => c.command)).toEqual(["start"]);
  });
});

describe("criterio 2: municipios como botones", () => {
  it("un botón por municipio, uno por fila, en el orden de listMunicipalities y con 64 bytes o menos", async () => {
    await press(VISITOR, EXPLORE_START);
    expect(t.texts()).toEqual([es.explore.chooseMunicipality]);
    const rows = rowsOf();
    expect(rows.every((row) => row.length === 1)).toBe(true);
    const list = buttons();
    expect(list.length).toBeLessThanOrEqual(100);
    for (const b of list) expect(bytes(b.callback_data!)).toBeLessThanOrEqual(64);
    expect(list.map((b) => b.text)).toEqual(expect.arrayContaining(["Municipio Ficticio Uno", "Municipio Ficticio Dos"]));
    expect(list.map((b) => b.text).filter((text) => text !== es.explore.gastronomicButton)).toEqual((await listMunicipalities(t.db, actor)).map((m) => m.name));
  });
});

describe("criterio 3: sin municipios", () => {
  it("responde explore.noMunicipalities sin teclado y no cambia nada", async () => {
    const before = await snapshotAll(owner);
    vi.spyOn(services, "listMunicipalities").mockResolvedValue([]);
    const bot = createTestBot();
    await bot.send(callbackUpdate(EXPLORE_START, { fromId: VISITOR }));
    expect(bot.texts()).toEqual([es.explore.noMunicipalities]);
    expect(bot.messages()[0].payload.reply_markup).toBeUndefined();
    await bot.db.destroy();
    expect(changed(before, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterio 4: aviso vigente", () => {
  it("A3 (aviso anterior) y A1 (sin cuenta) reciben el aviso de privacidad y ninguna lista", async () => {
    for (const user of [PERSON_IDS.A3, PERSON_IDS.A1]) {
      t.clear();
      const before = await snapshotAll(owner);
      await press(user, EXPLORE_START);
      const text = t.texts().join("\n");
      expect(text).toContain("Aviso de privacidad");
      expect(text).not.toContain(es.explore.chooseMunicipality);
      expect(text).not.toContain("Municipio Ficticio");
      if (user === PERSON_IDS.A1) expect(changed(before, await snapshotAll(owner))).toEqual([]);
    }
  });
});

describe("criterio 5 y 9: categorías y volver", () => {
  it("las categorías salen en el orden de listCatalog, con Volver aparte, y Volver regresa a los municipios", async () => {
    await press(VISITOR, EXPLORE_START);
    const municipalities = buttons().map((b) => b.text);
    const mu1 = data("Municipio Ficticio Uno");
    t.clear();
    await press(VISITOR, mu1);
    expect(t.texts()).toEqual([es.explore.chooseCategory("Municipio Ficticio Uno")]);
    const shown = buttons().map((b) => b.text);
    expect(shown.slice(0, -1)).toEqual((await listCatalog(t.db, actor, "category")).map((c) => c.name));
    expect(shown.at(-1)).toBe(es.explore.back);
    const rows = rowsOf();
    expect(rows.every((row) => row.length === 1)).toBe(true);
    for (const b of buttons()) expect(bytes(b.callback_data!)).toBeLessThanOrEqual(64);
    const back = data(es.explore.back);
    t.clear();
    await press(VISITOR, back);
    expect(t.texts()).toEqual([es.explore.chooseMunicipality]);
    expect(buttons().map((b) => b.text)).toEqual(municipalities);
  });
});

describe("criterio 15: sin estado en memoria", () => {
  it("una instancia nueva produce el mismo mensaje y teclado y no escribe en la base", async () => {
    const before = await snapshotAll(owner);
    await press(VISITOR, EXPLORE_START);
    const first = t.messages()[0].payload;
    const second = createTestBot();
    await second.send(callbackUpdate(EXPLORE_START, { fromId: VISITOR }));
    expect(second.messages()[0].payload).toEqual(first);
    await second.db.destroy();
    expect(changed(before, await snapshotAll(owner))).toEqual([]);
  });
});
