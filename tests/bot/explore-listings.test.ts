/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLORE_PAGE_SIZE, EXPLORE_START } from "@/bot/explore";
import { es } from "@/bot/texts/es";
import { createBody, CONTACT, MAPS_URL } from "../helpers/listing-http";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { ATTRACTION_NAME, explorePublished, FB_NAME, FPEND_NAME, FPUBB_NAME, FPUBB_NEW_NAME, FREJ_NAME, insertMunicipality, MU1_CA2_NAME, MU2_CA1_NAME, seedExplore, SPECIAL_NAME, type ExploreWorld } from "../helpers/explore";
import { seedListing } from "../helpers/listing-data";
import { A6, ADMIN, flush, makeReviewListingApi, VISITOR } from "../helpers/review-listing";
import { changedTables, snapshotAll } from "../helpers/role-denial";
import { callbackUpdate } from "../helpers/telegram";

// F022, criterios 6 a 8, 10 a 13 y 19 (bot): fichas publicadas de B15.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

type Button = { text: string; callback_data?: string };
let owner: Pool;
let world: ExploreWorld;
const t = createTestBot();
const api = makeReviewListingApi(t.db);
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const buttons = (index = -1): Button[] => {
  const markup = t.messages().at(index)!.payload.reply_markup as { inline_keyboard: Button[][] } | undefined;
  return (markup?.inline_keyboard ?? []).flat();
};
const data = (text: string, index = -1) => buttons(index).find((b) => b.text === text)!.callback_data!;
const changed = (before: Awaited<ReturnType<typeof snapshotAll>>, after: Awaited<ReturnType<typeof snapshotAll>>) => changedTables(before, after).filter((table) => table !== "processed_updates");
// Líneas de nombres de un mensaje de lista (sin el encabezado).
const namesOf = (index = -1) => String(t.messages().at(index)!.payload.text).split("\n").slice(1);

// Recorre Explorar -> municipio -> categoría y deja la lista en el último mensaje.
async function open(user: number, municipality: string, category: string) {
  t.clear();
  await press(user, EXPLORE_START);
  await press(user, data(municipality));
  await press(user, data(category));
}
const apiNames = async (user: number, municipalityId: string, categoryId: string, page = 1) => {
  const res = await api.published(user, `municipalityId=${municipalityId}&categoryId=${categoryId}&page=${page}&pageSize=${EXPLORE_PAGE_SIZE}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as any).items.map((i: any) => i.name as string);
};
const pack = (uuid: string) => Buffer.from(uuid.replaceAll("-", ""), "hex").toString("base64url");

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  t.clear();
  await resetDb(owner);
  world = await seedExplore(owner, api, afterTasks);
});
afterEach(() => vi.restoreAllMocks());

describe("criterios 6 y 7: lista de MU1 y CA1", () => {
  it("muestra solo las fichas publicadas, con el nombre publicado, en el orden de la API y sin mezclar combinaciones", async () => {
    const before = await snapshotAll(owner);
    await open(VISITOR, "Municipio Ficticio Uno", "Categoria Ficticia Uno");
    expect(String(t.messages().at(-1)!.payload.text).split("\n")[0]).toBe(es.explore.listHeader("Municipio Ficticio Uno", "Categoria Ficticia Uno"));
    const names = namesOf();
    expect(names).toEqual(await apiNames(VISITOR, world.municipalityOne, world.categoryOne));
    expect([...names].sort()).toEqual([...explorePublished].sort());
    for (const hidden of [FB_NAME, FPEND_NAME, FREJ_NAME, FPUBB_NEW_NAME, MU1_CA2_NAME, MU2_CA1_NAME]) expect(names).not.toContain(hidden);
    const serialized = JSON.stringify(t.messages().map((m) => m.payload));
    for (const id of [world.fb, world.fpend, world.frej]) expect(serialized).not.toContain(id);
    expect(names).toContain(ATTRACTION_NAME);
    expect(names).toContain(FPUBB_NAME);
    expect(changed(before, await snapshotAll(owner))).toEqual([]);
  });

  it("MU3 y CA1: tras aprobar FPendA aparece y tras rechazar FPend2 no aparece", async () => {
    const mu3 = await insertMunicipality(owner, "Municipio Ficticio Tres");
    const other = { ...world, municipalityOne: mu3 };
    const a = await api.pending(other, "Pendiente A Ficticia", A6);
    const b = await api.pending(other, "Pendiente B Ficticia", A6);
    const states = async () => (await owner.query("select id, status from app.listing_versions where id = any($1)", [[a.versionId, b.versionId]])).rows.map((r) => `${r.id}:${r.status}`);
    expect((await states()).every((s) => s.endsWith(":pending"))).toBe(true);
    await open(VISITOR, "Municipio Ficticio Tres", "Categoria Ficticia Uno");
    expect(t.texts().at(-1)).toBe(es.explore.empty("Municipio Ficticio Tres", "Categoria Ficticia Uno"));
    expect((await api.approve(ADMIN, a.versionId)).status).toBe(200);
    expect((await api.reject(ADMIN, b.versionId)).status).toBe(200);
    await flush(afterTasks);
    expect(await states()).toEqual(expect.arrayContaining([`${a.versionId}:published`, `${b.versionId}:rejected`]));
    await open(VISITOR, "Municipio Ficticio Tres", "Categoria Ficticia Uno");
    expect(namesOf()).toEqual(["Pendiente A Ficticia"]);
    expect(await apiNames(VISITOR, mu3, world.categoryOne)).toEqual(["Pendiente A Ficticia"]);
  });
});

describe("criterio 8: combinación sin fichas publicadas", () => {
  it("responde explore.empty con Volver, aunque solo haya un borrador, y Volver muestra las categorías", async () => {
    const draft = await api.create(A6, createBody({ ...world, municipalityOne: world.municipalityTwo }, { categoryId: world.categoryTwo, name: "Borrador En Dos Ficticio" }));
    expect(draft.status).toBe(201);
    await open(VISITOR, "Municipio Ficticio Dos", "Categoria Ficticia Dos");
    expect(t.texts().at(-1)).toBe(es.explore.empty("Municipio Ficticio Dos", "Categoria Ficticia Dos"));
    expect(buttons().map((b) => b.text)).toEqual([es.explore.back]);
    await press(VISITOR, data(es.explore.back));
    expect(t.texts().at(-1)).toBe(es.explore.chooseCategory("Municipio Ficticio Dos"));
  });
});

describe("criterio 10: paginación", () => {
  const N = EXPLORE_PAGE_SIZE;
  async function seedMany(count: number) {
    const mu3 = await insertMunicipality(owner, "Municipio Ficticio Tres");
    for (let i = 1; i <= count; i++) {
      await seedListing(owner, { accountId: world.a6Account, status: "published", municipalityId: mu3, categoryId: world.categoryTwo, name: `Ficha Paginada ${String(i).padStart(3, "0")}` });
    }
    return mu3;
  }
  const walk = async () => {
    await open(VISITOR, "Municipio Ficticio Tres", "Categoria Ficticia Dos");
    const pages: string[][] = [namesOf()];
    const sizes: number[] = [];
    while (buttons().some((b) => b.text === es.explore.more)) {
      const more = data(es.explore.more);
      sizes.push(Buffer.byteLength(more));
      expect(buttons().map((b) => b.text)).toContain(es.explore.back);
      const count = t.messages().length;
      await press(VISITOR, more);
      expect(t.messages().length).toBe(count + 1);
      pages.push(namesOf());
    }
    expect(buttons().map((b) => b.text)).toContain(es.explore.back);
    return { pages, sizes };
  };

  it("N + 1 fichas: dos páginas sin repetir ni omitir", async () => {
    const mu3 = await seedMany(N + 1);
    const { pages, sizes } = await walk();
    expect(pages.map((p) => p.length)).toEqual([N, 1]);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(64);
    const all = [...(await apiNames(VISITOR, mu3, world.categoryTwo, 1)), ...(await apiNames(VISITOR, mu3, world.categoryTwo, 2))];
    expect(pages.flat()).toEqual(all);
    expect(new Set(pages.flat()).size).toBe(N + 1);
  });

  it("N fichas exactas: sin botón Ver más", async () => {
    await seedMany(N);
    const { pages } = await walk();
    expect(pages.map((p) => p.length)).toEqual([N]);
  });

  it("2N + 1 fichas: tres páginas", async () => {
    await seedMany(2 * N + 1);
    const { pages } = await walk();
    expect(pages.map((p) => p.length)).toEqual([N, N, 1]);
    expect(new Set(pages.flat()).size).toBe(2 * N + 1);
  });
});

describe("criterio 11: callbacks alterados o de datos que ya no existen", () => {
  it("responde explore.stale con el botón para empezar de nuevo, sin error ni cambios", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await open(VISITOR, "Municipio Ficticio Uno", "Categoria Ficticia Uno");
    // Botón real de la categoría (con la página 1) a partir del cual se arman los alterados.
    t.clear();
    await press(VISITOR, EXPLORE_START);
    await press(VISITOR, data("Municipio Ficticio Uno"));
    const real = data("Categoria Ficticia Uno");
    const ghost = pack("00000000-0000-4000-8000-000000000000");
    const crafted = ["exp:x", "exp:c:abc", `exp:c:${ghost}`, real.slice(0, -3), `exp:l:${ghost}:${ghost}:1`, real.replace(/:1$/, ":0"), real.replace(/:1$/, ":99999999")];
    const before = await snapshotAll(owner);
    for (const callback of crafted) {
      t.clear();
      await press(VISITOR, callback);
      expect(t.texts()).toEqual([es.explore.stale]);
      expect(buttons()).toEqual([{ text: es.explore.startOver, callback_data: EXPLORE_START }]);
    }
    expect(error).not.toHaveBeenCalled();
    expect(changed(before, await snapshotAll(owner))).toEqual([]);
  });

  it("un callback armado a mano devuelve solo fichas publicadas de esa combinación", async () => {
    t.clear();
    await press(VISITOR, EXPLORE_START);
    await press(VISITOR, data("Municipio Ficticio Dos"));
    await press(VISITOR, data("Categoria Ficticia Uno"));
    expect(namesOf()).toEqual([MU2_CA1_NAME]);
  });
});

describe("criterio 12: nombres con caracteres especiales", () => {
  it("el nombre aparece literal, sin parse_mode, en el texto y en el encabezado", async () => {
    const special = await insertMunicipality(owner, 'Municipio <b>&"Cuatro"</b>');
    await seedListing(owner, { accountId: world.a6Account, status: "published", municipalityId: special, categoryId: world.categoryOne, name: SPECIAL_NAME });
    await open(VISITOR, 'Municipio <b>&"Cuatro"</b>', "Categoria Ficticia Uno");
    const message = t.messages().at(-1)!.payload;
    expect(message.parse_mode).toBeUndefined();
    expect(String(message.text)).toContain(SPECIAL_NAME);
    expect(String(message.text)).toContain('Municipio <b>&"Cuatro"</b>');
    t.clear();
    await press(VISITOR, EXPLORE_START);
    expect(t.messages()[0].payload.parse_mode).toBeUndefined();
    expect(buttons().map((b) => b.text)).toContain('Municipio <b>&"Cuatro"</b>');
  });
});

describe("criterio 13: sin datos personales", () => {
  it("ningún mensaje ni teclado lleva documento, contacto, identificadores de cuenta ni enlaces de ubicación", async () => {
    await open(VISITOR, "Municipio Ficticio Uno", "Categoria Ficticia Uno");
    const serialized = JSON.stringify(t.messages().map((m) => m.payload));
    const account = (await owner.query("select id from app.accounts where telegram_user_id = $1", [A6])).rows[0].id as string;
    for (const needle of ["9000070310", CONTACT, MAPS_URL, "maps.app.goo.gl", "google", account, String(A6)]) expect(serialized).not.toContain(needle);
  });
});

describe("criterio 19: otros roles", () => {
  it("A6 y el administrador reciben la misma lista pública que la API con su sesión", async () => {
    const expected = await apiNames(VISITOR, world.municipalityOne, world.categoryOne);
    for (const user of [A6, ADMIN]) {
      const before = await snapshotAll(owner);
      await open(user, "Municipio Ficticio Uno", "Categoria Ficticia Uno");
      expect(namesOf()).toEqual(expected);
      expect(namesOf()).toEqual(await apiNames(user, world.municipalityOne, world.categoryOne));
      for (const hidden of [FB_NAME, FPEND_NAME, FREJ_NAME, FPUBB_NEW_NAME]) expect(namesOf()).not.toContain(hidden);
      expect(changed(before, await snapshotAll(owner))).toEqual([]);
    }
  });
});
