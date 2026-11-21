import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLORE_START } from "@/bot/explore";
import { es } from "@/bot/texts/es";
import { createTestBot } from "../helpers/bot";
import { ownerPool } from "../helpers/db";
import { expectNoIdentity, IDS, N1_NUMBER, N1_TYPE, plainNeedles, seedIdentityWorld, watchConsole, type IdentityWorld } from "../helpers/identity-leak";
import { makeReviewListingApi } from "../helpers/review-listing";
import { callbackUpdate, textUpdate } from "../helpers/telegram";

// F027, criterios 1, 13, 14 y 15 (bot): B15, B16 y B04 no repiten el número de identidad y la sesión solo guarda el número sellado.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let w: IdentityWorld;
let consoleWatch: ReturnType<typeof watchConsole>;
const t = createTestBot();
const api = makeReviewListingApi(t.db);
const REGISTER = "provider:register";
const CONFIRM = "provider:confirm";
const CANCEL = "provider:cancel";

const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const typed = (user: number, text: string) => t.send(textUpdate(text, { fromId: user }));
const lastMarkup = () => (t.messages().at(-1)!.payload.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> }).inline_keyboard.flat();
const noLeak = (label: string) => expectNoIdentity(JSON.stringify(t.calls), w.secrets, label);
const sessionOf = async (telegramId: number) =>
  ((await owner.query("select s.data::text as data from app.bot_sessions s join app.accounts a on a.id = s.account_id where a.telegram_user_id = $1", [telegramId])).rows[0]?.data ?? "") as string;
const fillForm = async (user: number, type: string, number: string) => {
  await press(user, REGISTER);
  await press(user, type);
  await typed(user, number);
};

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  w = await seedIdentityWorld(owner, api, afterTasks);
  consoleWatch = watchConsole();
  t.clear();
});
afterEach(async () => {
  await owner.query("drop trigger if exists test_fail_insert on app.provider_registrations");
  consoleWatch.expectClean(w.secrets);
  vi.restoreAllMocks();
});

describe("criterio 1: el visitante recorre Explorar, la lista y el detalle de L1", () => {
  it("ninguna llamada saliente (textos, pies de foto, botones y callback_data) lleva identidad", async () => {
    await press(IDS.v, EXPLORE_START);
    await press(IDS.v, lastMarkup().find((b) => b.text === "Municipio Ficticio Uno")!.callback_data!);
    await press(IDS.v, lastMarkup().find((b) => b.text === "Categoria Ficticia Uno")!.callback_data!);
    const detail = lastMarkup().find((b) => b.text === "Café Mirador de Prueba");
    expect(detail?.callback_data).toBeTruthy();
    await press(IDS.v, detail!.callback_data!);
    expect(t.texts().join("\n")).toContain("Café Mirador de Prueba");
    expect(t.calls.length).toBeGreaterThan(4);
    noLeak("B15 y B16");
  });
});

describe("criterio 13: registro de prestador por el bot con N1", () => {
  const TYPE_NAME = "cédula de ciudadanía";

  it("la confirmación solo nombra el tipo de documento", async () => {
    await fillForm(IDS.rateLimited, N1_TYPE, N1_NUMBER);
    expect(t.texts().at(-1)).toBe(es.provider.confirm(TYPE_NAME));
    noLeak("confirmación");
  });

  it("número inválido (con carácter de control) y /cancelar en el paso del número", async () => {
    await press(IDS.rateLimited, REGISTER);
    await press(IDS.rateLimited, N1_TYPE);
    await typed(IDS.rateLimited, `${N1_NUMBER}\u0000`);
    expect(t.texts().at(-2)).toBe(es.provider.numberInvalid);
    await typed(IDS.rateLimited, "/cancelar");
    expect(t.texts()).toContain(es.provider.cancelled);
    noLeak("inválido y cancelar");
  });

  it("cancelar con el número sellado, por botón y por comando", async () => {
    for (const cancel of [() => press(IDS.rateLimited, CANCEL), () => typed(IDS.rateLimited, "/cancelar")]) {
      await fillForm(IDS.rateLimited, N1_TYPE, N1_NUMBER);
      await cancel();
    }
    noLeak("cancelar con sellado");
  });

  it("duplicado: provider.duplicate sin repetir el número", async () => {
    await fillForm(IDS.rateLimited, N1_TYPE, N1_NUMBER);
    t.clear();
    await press(IDS.rateLimited, CONFIRM);
    expect(t.texts()).toEqual([es.provider.duplicate]);
    noLeak("duplicado");
  });

  it("fallo interno al confirmar: provider.error sin el número ni el texto de la base", async () => {
    await fillForm(IDS.v, N1_TYPE, "5550123988");
    await owner.query(`create or replace function app.test_fail() returns trigger language plpgsql as $$ begin raise exception 'fallo con 5550123987 CC5550123987'; end $$`);
    await owner.query("create trigger test_fail_insert before insert on app.provider_registrations for each row execute function app.test_fail()");
    t.clear();
    await press(IDS.v, CONFIRM);
    expect(t.texts()).toEqual([es.provider.error]);
    expect(consoleWatch.lines.length).toBeGreaterThan(0);
    noLeak("fallo interno");
  });
});

describe("criterio 14: bot_sessions solo guarda el número sellado", () => {
  it("con el número escrito la fila lleva sealedIdentity y no N1; tras cancelar y tras registrar no conserva el número", async () => {
    await fillForm(IDS.rateLimited, N1_TYPE, N1_NUMBER);
    const during = await sessionOf(IDS.rateLimited);
    expect(during).toContain("sealedIdentity");
    expectNoIdentity(during, w.secrets, "sesión con sellado", true);
    for (const needle of plainNeedles()) expect(during.toLowerCase()).not.toContain(needle.toLowerCase());
    await press(IDS.rateLimited, CANCEL);
    const afterCancel = await sessionOf(IDS.rateLimited);
    expect(afterCancel).not.toContain("sealedIdentity");
    for (const needle of plainNeedles()) expect(afterCancel).not.toContain(needle);

    await fillForm(IDS.v, N1_TYPE, "5550123988");
    expect(await sessionOf(IDS.v)).not.toContain("5550123988");
    await press(IDS.v, CONFIRM);
    const afterRegister = await sessionOf(IDS.v);
    expect(afterRegister).not.toContain("sealedIdentity");
    expect(afterRegister).not.toContain("5550123988");
  });
});
