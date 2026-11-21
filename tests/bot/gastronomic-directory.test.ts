/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLORE_PAGE_SIZE, EXPLORE_START } from "@/bot/explore";
import { es } from "@/bot/texts/es";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { insertMunicipality } from "../helpers/explore";
import { createBody, draftBody, seedWorld, SUBMIT_BODY, type World } from "../helpers/listing-http";
import { seedListing } from "../helpers/listing-data";
import { A6, ADMIN, flush, makeReviewListingApi, VISITOR } from "../helpers/review-listing";
import { changedTables, PERSON_IDS, snapshotAll } from "../helpers/role-denial";
import { callbackUpdate } from "../helpers/telegram";

// F017, criterios 6, 10, 11, 12, 16, 18b, 21b, 24b y 25b (bot): directorio gastronómico B18.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

type Button = { text: string; callback_data?: string };
const GASTRO_START = "exp:gm";
const SABORES_ID = "5a0b0e50-0000-4000-8000-000000000001";
const IDENTITY = "9000070310";
let owner: Pool;
let world: World;
let municipalityThree: string;
const t = createTestBot();
const api = makeReviewListingApi(t.db);
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const buttons = (index = -1): Button[] => {
  const markup = t.messages().at(index)!.payload.reply_markup as { inline_keyboard: Button[][] } | undefined;
  return (markup?.inline_keyboard ?? []).flat();
};
const data = (text: string, index = -1) => buttons(index).find((b) => b.text === text)!.callback_data!;
const lastText = () => String(t.messages().at(-1)!.payload.text);
const pack = (uuid: string) => Buffer.from(uuid.replaceAll("-", ""), "hex").toString("base64url");
const typeId = async (name: string) => (await owner.query("select id from app.establishment_types where name = $1", [name])).rows[0].id as string;
const changed = (before: Awaited<ReturnType<typeof snapshotAll>>, after: Awaited<ReturnType<typeof snapshotAll>>) => changedTables(before, after).filter((table) => table !== "processed_updates");

// Entra por Explorar y el botón del directorio; deja la lista de municipios de B18 en el último mensaje.
async function openDirectory(user = VISITOR) {
  t.clear();
  await press(user, EXPLORE_START);
  await press(user, data(es.explore.gastronomicButton));
}
async function openMunicipality(name: string, user = VISITOR) {
  await openDirectory(user);
  await press(user, data(name));
}

async function publishEstablishment(name: string, type: string | null, municipalityId = world.municipalityOne) {
  const created = (await (await api.create(A6, createBody(world, { name, municipalityId, establishmentTypeId: type === null ? undefined : await typeId(type) }))).json()) as { id: string };
  const sub = (await (await api.submit(A6, created.id, SUBMIT_BODY)).json()) as { working: { id: string } };
  expect((await api.approve(ADMIN, sub.working.id)).status).toBe(200);
  await flush(afterTasks);
  return { id: created.id, versionId: sub.working.id };
}
async function pendingEstablishment(name: string, type: string) {
  const created = (await (await api.create(A6, createBody(world, { name, establishmentTypeId: await typeId(type) }))).json()) as { id: string };
  await api.submit(A6, created.id, SUBMIT_BODY);
  return created.id;
}
async function publishRoute(name: string, experienceTypeId: string) {
  const content = { name, municipalityId: world.municipalityOne, categoryId: world.categoryOne, description: "Descripción ficticia.", schedule: "Sábados", contact: "contacto@ejemplo.invalid", mapsUrl: "https://maps.app.goo.gl/ficticio", experienceTypeId };
  const created = (await (await api.create(A6, { kind: "route_experience", content, confirmed: true })).json()) as { id: string };
  const sub = (await (await api.submit(A6, created.id, SUBMIT_BODY)).json()) as { working: { id: string } };
  expect((await api.approve(ADMIN, sub.working.id)).status).toBe(200);
  await flush(afterTasks);
  return created.id;
}
// Fichas gastronómicas sembradas directamente (para la paginación).
async function seedCuisine(count: number, municipalityId: string) {
  const restaurant = await typeId("Restaurante");
  for (let i = 1; i <= count; i++) {
    const made = await seedListing(owner, { accountId: world.a6Account, status: "published", municipalityId, categoryId: world.categoryOne, name: `Cocina Prueba ${String(i).padStart(2, "0")}` });
    await owner.query("update app.listing_versions set establishment_type_id = $2 where id = $1", [made.versionId, restaurant]);
  }
}

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  t.clear();
  await resetDb(owner);
  world = await seedWorld(owner);
  municipalityThree = await insertMunicipality(owner, "Municipio Ficticio Tres");
});
afterEach(() => vi.restoreAllMocks());

describe("criterios 10, 11 y 16: entrada, lista, detalle y volver", () => {
  it("10: el botón está en la pantalla de municipios de B15 y las pantallas de B18 usan exp:g: y callbacks de 64 bytes o menos", async () => {
    await publishEstablishment("Restaurante Prueba", "Restaurante");
    t.clear();
    await press(VISITOR, EXPLORE_START);
    expect(buttons().map((b) => b.text)).toContain(es.explore.gastronomicButton);
    const screens: Button[][] = [buttons()];
    await press(VISITOR, data(es.explore.gastronomicButton));
    expect(lastText()).toBe(es.explore.chooseMunicipality);
    screens.push(buttons());
    await press(VISITOR, data("Municipio Ficticio Uno"));
    screens.push(buttons());
    const restaurant = buttons().find((b) => b.text === "Restaurante Prueba")!;
    expect(restaurant.callback_data).toMatch(/^exp:d:/);
    expect(buttons().find((b) => b.callback_data?.startsWith("exp:g:"))).toBeUndefined(); // sin más páginas
    expect(screens[1].find((b) => b.text === "Municipio Ficticio Uno")!.callback_data).toMatch(/^exp:g:/);
    for (const screen of screens) for (const b of screen) expect(Buffer.byteLength(b.callback_data!), b.callback_data).toBeLessThanOrEqual(64);
    for (const message of t.messages()) expect(JSON.stringify(message.payload)).not.toMatch(/telegram|identidad|permiso|rol/i);
  });

  it("11 y 16: la lista muestra restaurante y experiencia; el detalle abre B16 y Volver regresa a B18 en la misma página", async () => {
    const restaurant = await publishEstablishment("Restaurante Prueba", "Restaurante");
    const sabores = await publishRoute("Sabores de prueba", SABORES_ID);
    await openMunicipality("Municipio Ficticio Uno");
    expect(lastText().split("\n")[0]).toBe(es.explore.gastronomicHeader("Municipio Ficticio Uno"));
    expect(buttons().map((b) => b.text)).toEqual(expect.arrayContaining(["Restaurante Prueba", "Sabores de prueba"]));
    expect(buttons().find((b) => b.text === "Restaurante Prueba")!.callback_data).toBe(`exp:d:${pack(restaurant.id)}:g1`);

    await press(VISITOR, data("Restaurante Prueba"));
    const detail = JSON.stringify(t.messages().at(-1)!.payload);
    expect(detail).toContain("Restaurante Prueba");
    expect(detail).toContain("Tipo: Restaurante");
    expect(detail).toContain("https://maps.app.goo.gl/AbCdEf123");
    await press(VISITOR, data(es.explore.back));
    expect(lastText().split("\n")[0]).toBe(es.explore.gastronomicHeader("Municipio Ficticio Uno"));

    await press(VISITOR, data("Sabores de prueba"));
    expect(lastText()).toContain("Sabores de Caldas");
    expect(buttons().find((b) => b.text === es.explore.back)!.callback_data).toBe(`exp:b:${pack(sabores)}:g1`);
  });
});

describe("criterio 6: ficha pendiente", () => {
  it("no aparece en B18 y los callbacks forjados solo responden es.explore.stale", async () => {
    await publishEstablishment("Restaurante Publicado", "Restaurante");
    const pending = await pendingEstablishment("Restaurante Pendiente Secreto", "Restaurante");
    await openMunicipality("Municipio Ficticio Uno");
    expect(JSON.stringify(t.messages().map((m) => m.payload))).not.toContain("Restaurante Pendiente Secreto");
    for (const forged of [`exp:d:${pack(pending)}:1`, `exp:d:${pack(pending)}:g1`, `exp:g:${pack(pending)}:1`, `exp:b:${pack(pending)}:g1`]) {
      t.clear();
      await press(VISITOR, forged);
      expect(t.texts(), forged).toEqual([es.explore.stale]);
      expect(buttons().map((b) => b.text), forged).toEqual([es.explore.startOver]);
      expect(JSON.stringify(t.calls)).not.toContain("Restaurante Pendiente Secreto");
    }
  });
});

describe("criterio 12: paginación, orden y vacío", () => {
  it("M2 con 11 fichas: 10 en orden alfabético con Ver más, luego 1; la página 3 y los mal formados son stale; M3 vacío", async () => {
    const municipalityTwo = world.municipalityTwo;
    await seedCuisine(11, municipalityTwo);
    await openMunicipality("Municipio Ficticio Dos");
    const first = buttons().map((b) => b.text);
    expect(first.filter((text) => text.startsWith("Cocina"))).toEqual(Array.from({ length: EXPLORE_PAGE_SIZE }, (_, i) => `Cocina Prueba ${String(i + 1).padStart(2, "0")}`));
    expect(first).toContain(es.explore.more);
    await press(VISITOR, data(es.explore.more));
    expect(buttons().map((b) => b.text).filter((text) => text.startsWith("Cocina"))).toEqual(["Cocina Prueba 11"]);
    expect(buttons().map((b) => b.text)).not.toContain(es.explore.more);

    t.clear();
    await press(VISITOR, `exp:g:${pack(municipalityTwo)}:3`);
    expect(t.texts()).toEqual([es.explore.stale]);
    for (const bad of [`exp:g:${pack(municipalityTwo)}`, `exp:g:${pack(municipalityTwo)}:x`, `exp:g:corto:1`, `exp:g:${pack("00000000-0000-4000-8000-000000000000")}:1`, "exp:g:", `exp:d:${pack(municipalityTwo)}:g1`, `exp:d:${pack(municipalityTwo)}:g`]) {
      t.clear();
      await press(VISITOR, bad);
      expect(t.texts(), bad).toEqual([es.explore.stale]);
    }

    await openMunicipality("Municipio Ficticio Tres");
    expect(lastText()).toBe(es.explore.gastronomicEmpty);
    expect(municipalityThree).toBeTruthy();
  });
});

describe("criterio 18b: lo que no entra", () => {
  it("ninguna ficha no gastronómica aparece en B18 y todas aparecen en B15", async () => {
    const names = ["Hotel Prueba", "Finca Prueba", "Alojamiento Prueba", "Local sin tipo Prueba"];
    await publishEstablishment("Hotel Prueba", "Hotel");
    await publishEstablishment("Finca Prueba", "Finca cafetera");
    await publishEstablishment("Alojamiento Prueba", "Alojamiento rural");
    await publishEstablishment("Local sin tipo Prueba", null);
    const adventure = (await owner.query("insert into app.experience_types (name, name_normalized) values ('Ruta de aventura ficticia', 'ruta de aventura ficticia') returning id")).rows[0].id as string;
    await publishRoute("Ruta de aventura prueba", adventure);
    names.push("Ruta de aventura prueba");
    await openMunicipality("Municipio Ficticio Uno");
    expect(lastText()).toBe(es.explore.gastronomicEmpty);

    t.clear();
    await press(VISITOR, EXPLORE_START);
    await press(VISITOR, data("Municipio Ficticio Uno"));
    await press(VISITOR, data("Categoria Ficticia Uno"));
    expect(buttons().map((b) => b.text)).toEqual(expect.arrayContaining(names));
  });
});

describe("criterio 21b: sin aviso vigente", () => {
  it("A3 y A1 reciben el aviso de privacidad y ninguna lista", async () => {
    await publishEstablishment("Restaurante Prueba", "Restaurante");
    for (const user of [PERSON_IDS.A3, PERSON_IDS.A1]) {
      for (const callback of [GASTRO_START, `exp:g:${pack(world.municipalityOne)}:1`]) {
        t.clear();
        await press(user, callback);
        const text = t.texts().join("\n");
        expect(text).toContain("Aviso de privacidad");
        expect(text).not.toContain("Restaurante Prueba");
        expect(text).not.toContain(es.explore.gastronomicHeader("Municipio Ficticio Uno"));
      }
    }
  });
});

describe("criterio 24b: edición de una ficha publicada", () => {
  it("B18 conserva el nombre publicado mientras la nueva versión está pendiente y la quita tras aprobar el cambio de tipo", async () => {
    const { id } = await publishEstablishment("Restaurante Prueba", "Restaurante");
    expect((await api.save(A6, id, draftBody(world, { name: "Restaurante Nuevo Nombre", establishmentTypeId: await typeId("Hotel") }))).status).toBe(200);
    const versionId = (await (await api.submit(A6, id, SUBMIT_BODY)).json() as any).working.id as string;
    await openMunicipality("Municipio Ficticio Uno");
    expect(buttons().map((b) => b.text)).toContain("Restaurante Prueba");
    expect(JSON.stringify(t.messages().map((m) => m.payload))).not.toContain("Restaurante Nuevo Nombre");

    expect((await api.approve(ADMIN, versionId)).status).toBe(200);
    await flush(afterTasks);
    await openMunicipality("Municipio Ficticio Uno");
    expect(lastText()).toBe(es.explore.gastronomicEmpty);
    t.clear();
    await press(VISITOR, EXPLORE_START);
    await press(VISITOR, data("Municipio Ficticio Uno"));
    await press(VISITOR, data("Categoria Ficticia Uno"));
    expect(buttons().map((b) => b.text)).toContain("Restaurante Nuevo Nombre");
  });
});

describe("criterio 25b: sin datos personales", () => {
  it("los textos de B18 y B16 no traen identidad, ID de Telegram ni datos del prestador", async () => {
    await publishEstablishment("Restaurante Prueba", "Restaurante");
    const before = await snapshotAll(owner);
    await openMunicipality("Municipio Ficticio Uno");
    await press(VISITOR, data("Restaurante Prueba"));
    const account = (await owner.query("select * from app.accounts where telegram_user_id = $1", [A6])).rows[0];
    const names = Object.values(account).filter((value): value is string => typeof value === "string" && value.length > 3 && !/^[0-9a-f-]{36}$/.test(value));
    const serialized = JSON.stringify(t.messages().map((m) => m.payload.text));
    for (const secret of [IDENTITY, String(A6), ...names]) expect(serialized).not.toContain(secret);
    expect(changed(before, await snapshotAll(owner))).toEqual([]);
  });
});
