import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXPLORE_PAGE_SIZE, EXPLORE_START } from "@/bot/explore";
import { es } from "@/bot/texts/es";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { type ExperienceWorld, NEW_NAME, SABORES_ID, seedExperienceWorld } from "../helpers/experience-filter";
import { A6, ADMIN, flush, makeReviewListingApi, P2P, seedWorld, VISITOR } from "../helpers/review-listing";
import { changedTables, PERSON_IDS, snapshotAll } from "../helpers/role-denial";
import { callbackUpdate } from "../helpers/telegram";

// F024, criterios 1, 2, 6 a 11, 13, 14, 16, 17a, 18 y 19 (bot): B17, rutas y experiencias por tipo en un municipio.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

type Button = { text: string; callback_data?: string };
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const T1_M1 = ["Ruta Aventura 01", "Ruta Aventura 02", "Ruta Cambio Publicada"];
let owner: Pool;
let w: ExperienceWorld;
const t = createTestBot();
const api = makeReviewListingApi(t.db);
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const buttons = (index = -1): Button[] => {
  const markup = t.messages().at(index)!.payload.reply_markup as { inline_keyboard: Button[][] } | undefined;
  return (markup?.inline_keyboard ?? []).flat();
};
const rowsOf = () => (t.messages().at(-1)!.payload.reply_markup as { inline_keyboard: Button[][] }).inline_keyboard;
const data = (text: string) => buttons().find((b) => b.text === text)!.callback_data!;
const lastText = () => String(t.messages().at(-1)!.payload.text);
const pack = (uuid: string) => Buffer.from(uuid.replaceAll("-", ""), "hex").toString("base64url");
const bytes = (text: string) => Buffer.byteLength(text);
const changed = (before: Awaited<ReturnType<typeof snapshotAll>>, after: Awaited<ReturnType<typeof snapshotAll>>) => changedTables(before, after).filter((table) => table !== "processed_updates");

async function openTypes(municipality = "Municipio Ficticio Uno", user = VISITOR) {
  t.clear();
  await press(user, EXPLORE_START);
  await press(user, data(municipality));
  await press(user, data(es.explore.experienceButton));
}
async function openList(type: string, municipality = "Municipio Ficticio Uno", user = VISITOR) {
  await openTypes(municipality, user);
  await press(user, data(type));
}
const listNames = () => lastText().split("\n").slice(1);

beforeAll(async () => {
  owner = ownerPool();
  await resetDb(owner);
  w = await seedExperienceWorld(owner, api, afterTasks, true);
  t.clear();
});
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});

describe("criterios 1 y 2: entrada, tipos y callback_data", () => {
  it("1: el botón T1 lleva a los tipos de la lista cerrada, uno por fila, con Volver aparte", async () => {
    t.clear();
    await press(VISITOR, EXPLORE_START);
    await press(VISITOR, data("Municipio Ficticio Uno"));
    const categoryScreen = buttons().map((b) => b.text);
    expect(categoryScreen).toContain("Rutas y experiencias");
    expect(categoryScreen.at(-1)).toBe(es.explore.back);
    await press(VISITOR, data(es.explore.experienceButton));
    expect(lastText()).toBe("Elige un tipo de experiencia en Municipio Ficticio Uno.");
    const types = (await owner.query("select name from app.experience_types order by name_normalized, id")).rows.map((r) => r.name as string);
    expect(types).toContain("Sabores de Caldas");
    expect(buttons().map((b) => b.text)).toEqual([...types, es.explore.back]);
    expect(rowsOf().every((row) => row.length === 1)).toBe(true);
    await press(VISITOR, data(es.explore.back));
    expect(buttons().map((b) => b.text)).toEqual(categoryScreen);
  });

  it("2: callback_data de 64 bytes o menos, sin datos personales, distintos de B15, B16 y B18; el despachador distingue cada ruta", async () => {
    await openList("Ruta de aventura ficticia");
    const all: string[] = [];
    const collect = () => buttons().forEach((b) => b.callback_data && all.push(b.callback_data));
    collect();
    await press(VISITOR, data("Ruta Aventura 01"));
    collect();
    await press(VISITOR, data(es.explore.back));
    await openList("Ruta cultural ficticia", "Municipio Ficticio Dos");
    collect();
    await press(VISITOR, data(es.explore.more));
    collect();
    for (const cb of all) {
      expect(bytes(cb), cb).toBeLessThanOrEqual(64);
      expect(cb, cb).toMatch(/^exp:[a-z]+:[A-Za-z0-9_:-]*$/);
    }
    const b17 = all.filter((cb) => /^exp:(t|e):/.test(cb) || /^exp:[db]:[^:]+:e/.test(cb));
    expect(b17.length).toBeGreaterThan(0);

    const m1 = pack(w.municipalityOne);
    const routes = {
      b15: [EXPLORE_START, `exp:c:${m1}`, `exp:l:${m1}:${pack(w.categoryOne)}:1`],
      b18: ["exp:gm", `exp:g:${m1}:1`],
      b16: [`exp:d:${pack(w.cambio.listingId)}:1`],
      b17: [`exp:t:${m1}`, `exp:e:${m1}:${pack(w.t1)}:1`, `exp:d:${pack(w.cambio.listingId)}:e1`],
    };
    const headers = [es.explore.chooseMunicipality, es.explore.chooseCategory("Municipio Ficticio Uno"), `Fichas publicadas en Municipio Ficticio Uno, categoría Categoria Ficticia Uno:`, es.explore.chooseMunicipality, es.explore.gastronomicHeader("Municipio Ficticio Uno"), "Ruta Cambio Publicada", es.explore.chooseExperienceType("Municipio Ficticio Uno"), es.explore.experienceHeader("Ruta de aventura ficticia", "Municipio Ficticio Uno"), "Ruta Cambio Publicada"];
    const sent = Object.values(routes).flat();
    expect(new Set(sent).size).toBe(sent.length);
    for (const [i, callback] of sent.entries()) {
      t.clear();
      await press(VISITOR, callback);
      expect(lastText(), callback).toContain(headers[i]);
    }
  });
});

describe("criterios 6 y 7: lista, detalle y Volver", () => {
  it("6: T3 y un botón por ficha, en orden, igual que la API", async () => {
    await openList("Ruta de aventura ficticia");
    expect(lastText().split("\n")[0]).toBe("Rutas y experiencias de tipo Ruta de aventura ficticia en Municipio Ficticio Uno:");
    expect(listNames()).toEqual(T1_M1);
    expect(buttons().map((b) => b.text).filter((x) => x.startsWith("Ruta"))).toEqual(T1_M1);
    const res = await api.published(VISITOR, `kind=route_experience&municipalityId=${w.municipalityOne}&experienceTypeId=${w.t1}`);
    expect(((await res.json()) as { items: Array<{ name: string }> }).items.map((i) => i.name)).toEqual(listNames());
  });

  it("7: el detalle muestra tipo y guía, sin identidad, y Volver regresa a la misma lista y página", async () => {
    await openList("Ruta de aventura ficticia");
    const detailButton = buttons().find((b) => b.text === "Ruta Aventura 02")!;
    expect(detailButton.callback_data).toMatch(/^exp:d:[A-Za-z0-9_-]{22}:e1$/);
    await press(VISITOR, detailButton.callback_data!);
    const detail = JSON.stringify(t.messages().at(-1)!.payload);
    expect(detail).toContain("Ruta Aventura 02");
    expect(detail).toContain("Ruta de aventura ficticia");
    expect(detail).toContain("Guía ficticio de prueba.");
    expect(detail).not.toContain("9000070310");
    expect(buttons().find((b) => b.text === es.explore.back)!.callback_data).toMatch(/^exp:b:[A-Za-z0-9_-]{22}:e1$/);
    await press(VISITOR, data(es.explore.back));
    expect(lastText().split("\n")[0]).toBe(es.explore.experienceHeader("Ruta de aventura ficticia", "Municipio Ficticio Uno"));
    expect(listNames()).toEqual(T1_M1);
  });
});

describe("criterio 8: paginación", () => {
  it("11 rutas: 10 y Ver más, luego 1; la página 3 es stale; Volver desde la página 2 conserva la página", async () => {
    await openList("Ruta cultural ficticia", "Municipio Ficticio Dos");
    const first = buttons().map((b) => b.text);
    expect(first.filter((x) => x.startsWith("Ruta Prueba"))).toEqual(Array.from({ length: EXPLORE_PAGE_SIZE }, (_, i) => `Ruta Prueba ${String(i + 1).padStart(2, "0")}`));
    expect(first).toContain(es.explore.more);
    await press(VISITOR, data(es.explore.more));
    expect(buttons().map((b) => b.text).filter((x) => x.startsWith("Ruta Prueba"))).toEqual(["Ruta Prueba 11"]);
    expect(buttons().map((b) => b.text)).not.toContain(es.explore.more);
    await press(VISITOR, data("Ruta Prueba 11"));
    expect(buttons().find((b) => b.text === es.explore.back)!.callback_data).toMatch(/:e2$/);
    await press(VISITOR, data(es.explore.back));
    expect(listNames()).toEqual(["Ruta Prueba 11"]);
    t.clear();
    await press(VISITOR, `exp:e:${pack(w.municipalityTwo)}:${pack(w.t2)}:3`);
    expect(t.texts()).toEqual([es.explore.stale]);
  });
});

describe("criterio 11: tipo sin fichas", () => {
  it("T4 con Volver a los tipos; sin error", async () => {
    await openList("Ruta sin fichas ficticia");
    expect(t.texts().at(-1)).toBe("Todavía no hay rutas ni experiencias publicadas de tipo Ruta sin fichas ficticia en Municipio Ficticio Uno.");
    expect(buttons().map((b) => b.text)).toEqual([es.explore.back]);
    await press(VISITOR, data(es.explore.back));
    expect(lastText()).toBe(es.explore.chooseExperienceType("Municipio Ficticio Uno"));
    await openList("Ruta sin fichas ficticia", "Municipio Ficticio Dos");
    expect(listNames()).toEqual(["Ruta Sin Tipo M2"]);
  });
});

describe("criterio 13: callback_data mal formado", () => {
  const m2 = () => pack(w.municipalityTwo);
  const t2 = () => pack(w.t2);
  it("responde solo stale, con Empezar de nuevo, sin escribir en la base", async () => {
    const cases = () => [
      `exp:e:${m2()}:${t2()}:0`, `exp:e:${m2()}:${t2()}:-1`, `exp:e:${m2()}:${t2()}:x`, `exp:e:${m2()}:${t2()}:3`,
      `exp:e:${m2()}:${t2()}`, `exp:e:${m2()}`, `exp:e:${pack(UNKNOWN)}:${t2()}:1`, `exp:e:${m2()}:${pack(UNKNOWN)}:1`,
      `exp:e:!!!:${t2()}:1`, `exp:e:${m2()}:${t2().slice(1)}:1`, "exp:t:", `exp:t:${pack(UNKNOWN)}`, "exp:t:!!!", `exp:t:${m2().slice(1)}`,
      `exp:d:${pack(w.unpublished.draft)}:e1`, `exp:d:${pack(w.unpublished.pending)}:e1`, `exp:d:${pack(w.unpublished.rejected)}:e1`, `exp:d:${pack(UNKNOWN)}:e1`,
      `exp:b:${pack(w.unpublished.draft)}:e1`, `exp:d:${pack(w.unpublished.pending)}:e`,
    ];
    const before = await snapshotAll(owner);
    for (const callback of cases()) {
      t.clear();
      await press(VISITOR, callback);
      expect(t.texts(), callback).toEqual([es.explore.stale]);
      expect(buttons().map((b) => b.text), callback).toEqual([es.explore.startOver]);
      for (const name of ["Ruta Borrador", "Ruta Pendiente", "Ruta Rechazada"]) expect(JSON.stringify(t.calls), callback).not.toContain(name);
    }
    expect(changed(before, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterio 14: Sabores de Caldas", () => {
  it("B17 lista solo 'Sabores de prueba' y B18 sigue igual", async () => {
    await openList("Sabores de Caldas");
    expect(lastText().split("\n")[0]).toBe(es.explore.experienceHeader("Sabores de Caldas", "Municipio Ficticio Uno"));
    expect(listNames()).toEqual(["Sabores de prueba"]);
    expect(SABORES_ID).toBeTruthy();
    t.clear();
    await press(VISITOR, "exp:gm");
    await press(VISITOR, data("Municipio Ficticio Uno"));
    expect(listNames()).toEqual(["Sabores de prueba"]);
  });
});

describe("criterio 16: sin aviso vigente", () => {
  it("la cuenta con aviso anterior recibe el aviso de privacidad y no se lista nada; sin cuenta no se escribe", async () => {
    const callbacks = [`exp:t:${pack(w.municipalityOne)}`, `exp:e:${pack(w.municipalityOne)}:${pack(w.t1)}:1`, `exp:d:${pack(w.cambio.listingId)}:e1`];
    for (const callback of callbacks) {
      t.clear();
      await press(PERSON_IDS.A3, callback);
      const text = t.texts().join("\n");
      expect(text).toContain("Aviso de privacidad");
      expect(text).not.toContain("Ruta Cambio Publicada");
      expect(text).not.toContain("Ruta de aventura ficticia");
    }
    const before = await snapshotAll(owner);
    t.clear();
    await press(987654321, callbacks[1]);
    expect(JSON.stringify(t.calls)).not.toContain("Ruta Aventura");
    expect(changedTables(before, await snapshotAll(owner)).filter((x) => x !== "processed_updates")).toEqual([]);
  });
});

describe("criterio 17a: otros roles", () => {
  it("P1, A1, P2 y V1 ven la misma lista y ningún borrador, pendiente ni rechazada", async () => {
    for (const user of [A6, ADMIN, P2P, VISITOR]) {
      await openList("Ruta de aventura ficticia", "Municipio Ficticio Uno", user);
      expect(listNames(), String(user)).toEqual(T1_M1);
      const serialized = JSON.stringify(t.calls);
      for (const name of ["Ruta Borrador", "Ruta Pendiente", "Ruta Rechazada", NEW_NAME]) expect(serialized, `${user} ${name}`).not.toContain(name);
    }
  });
});

describe("criterios 18 y 19: sin datos personales, sin estado y sin integraciones", () => {
  it("18: ningún texto trae identidad ni ID de Telegram de otra cuenta", async () => {
    await openList("Ruta de aventura ficticia");
    await press(VISITOR, data("Ruta Aventura 01"));
    const account = (await owner.query("select * from app.accounts where telegram_user_id = $1", [A6])).rows[0];
    const secrets = Object.values(account).filter((value): value is string => typeof value === "string" && value.length > 3 && !/^[0-9a-f-]{36}$/.test(value));
    const serialized = JSON.stringify(t.calls);
    for (const secret of ["9000070310", String(A6), ...secrets]) expect(serialized).not.toContain(secret);
  });

  it("19: una instancia nueva produce el mismo mensaje y teclado, sin escribir en la base; src/bot no usa fetch", async () => {
    const callback = `exp:e:${pack(w.municipalityOne)}:${pack(w.t1)}:1`;
    await press(VISITOR, callback);
    const first = JSON.stringify(t.messages().at(-1)!.payload);
    const before = await snapshotAll(owner);
    const second = createTestBot();
    await second.send(callbackUpdate(callback, { fromId: VISITOR }));
    expect(JSON.stringify(second.messages().at(-1)!.payload)).toBe(first);
    expect(changed(before, await snapshotAll(owner))).toEqual([]);
    await second.db.destroy();
    const source = readFileSync("src/bot/explore.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(|axios|undici|node:http/);
    expect(source).not.toMatch(/^(let|var) /m);
  });
});

describe("criterios 9 y 10: edición de una ficha publicada", () => {
  it("B17 conserva la ficha en T1 con el nombre publicado y la pasa a T2 al aprobar", async () => {
    await openList("Ruta de aventura ficticia");
    expect(listNames()).toEqual(T1_M1);
    expect(JSON.stringify(t.calls)).not.toContain(NEW_NAME);
    expect((await api.approve(ADMIN, w.cambio.versionId)).status).toBe(200);
    await flush(afterTasks);
    await openList("Ruta de aventura ficticia");
    expect(listNames()).toEqual(["Ruta Aventura 01", "Ruta Aventura 02"]);
    await openList("Ruta cultural ficticia");
    expect(listNames()).toEqual([NEW_NAME, "Ruta Cultural 01"]);
  });
});

describe("criterio 11 (T5): lista cerrada vacía", () => {
  it("responde T5 con Volver a las categorías", async () => {
    await resetDb(owner);
    const world = await seedWorld(owner);
    await owner.query("delete from app.experience_types");
    t.clear();
    await press(VISITOR, EXPLORE_START);
    await press(VISITOR, data("Municipio Ficticio Uno"));
    await press(VISITOR, data(es.explore.experienceButton));
    expect(t.texts().at(-1)).toBe("Todavía no hay tipos de experiencia disponibles.");
    expect(buttons().map((b) => b.text)).toEqual([es.explore.back]);
    await press(VISITOR, data(es.explore.back));
    expect(lastText()).toBe(es.explore.chooseCategory("Municipio Ficticio Uno"));
    expect(world.municipalityOne).toBeTruthy();
  });
});
