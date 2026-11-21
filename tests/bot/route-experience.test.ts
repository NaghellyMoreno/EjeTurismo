/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLORE_START } from "@/bot/explore";
import { es } from "@/bot/texts/es";
import { memoryStorage } from "@/server/storage";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { CONTACT, MAPS_URL, SUBMIT_BODY } from "../helpers/listing-http";
import { A6, ADMIN, flush, makeReviewListingApi, seedWorld, VISITOR, type World } from "../helpers/review-listing";
import { callbackUpdate } from "../helpers/telegram";

// F018, criterios 19 y 29 (bot): la ruta o experiencia en B15 y B16, con llamadas salientes interceptadas.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

type Button = { text: string; callback_data?: string; url?: string };
const GUIDE = "Ana Prueba, 3000000000";
const ROUTE = "Ruta del café ficticia";
let owner: Pool;
let world: World;
let typeId: string;
const t = createTestBot();
const api = makeReviewListingApi(t.db);
const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const pack = (uuid: string) => Buffer.from(uuid.replaceAll("-", ""), "hex").toString("base64url");
const lastText = () => t.messages().at(-1)!.payload as any;
const buttons = (): Button[] => (lastText().reply_markup?.inline_keyboard ?? []).flat();
const content = () => ({
  name: ROUTE,
  municipalityId: world.municipalityOne,
  categoryId: world.categoryOne,
  description: "Recorrido ficticio por una finca.",
  schedule: "Sábados de 8:00 a 12:00",
  contact: CONTACT,
  mapsUrl: MAPS_URL,
  experienceTypeId: typeId,
  guidesInfo: GUIDE,
});

async function createRoute() {
  const created = (await (await api.create(A6, { kind: "route_experience", content: content(), confirmed: true })).json()) as { id: string; working: { id: string } };
  return { listingId: created.id, versionId: created.working.id };
}
async function openCategory() {
  await press(VISITOR, EXPLORE_START);
  await press(VISITOR, buttons().find((b) => b.text === "Municipio Ficticio Uno")!.callback_data!);
  await press(VISITOR, buttons().find((b) => b.text === "Categoria Ficticia Uno")!.callback_data!);
}

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  memoryStorage().reset();
  t.clear();
  await resetDb(owner);
  world = await seedWorld(owner);
  typeId = (await owner.query("select id from app.experience_types where name = 'Sabores de Caldas'")).rows[0].id as string;
});
afterEach(() => vi.restoreAllMocks());

describe("criterio 19: la ruta aprobada en B15 y B16", () => {
  it("B15 la lista y B16 envía un solo mensaje con los campos en el orden de ADR 0008 y sin números de identidad", async () => {
    const route = await createRoute();
    expect((await api.submit(A6, route.listingId, SUBMIT_BODY)).status).toBe(200);
    expect((await api.approve(ADMIN, route.versionId)).status).toBe(200);
    await flush(afterTasks);
    t.clear();
    await openCategory();
    const button = buttons().find((b) => b.text === ROUTE);
    expect(button, "B15 lista la ruta con su nombre").toBeDefined();
    expect(button!.callback_data).toBe(`exp:d:${pack(route.listingId)}:1`);

    t.clear();
    await press(VISITOR, button!.callback_data!);
    expect(t.calls.filter((c) => c.method === "sendMessage")).toHaveLength(1);
    const text = String(lastText().text);
    expect(text.length).toBeLessThan(4096);
    const L = es.listingDetail;
    const ordered = [ROUTE, `${L.municipality}: Municipio Ficticio Uno`, `${L.category}: Categoria Ficticia Uno`, `${L.type}: Sabores de Caldas`, `${L.description}: Recorrido ficticio por una finca.`, `${L.schedule}: Sábados de 8:00 a 12:00`, `${L.contact}: ${CONTACT}`, `${L.guides}: ${GUIDE}`];
    let from = 0;
    for (const part of ordered) {
      const at = text.indexOf(part, from);
      expect(at, part).toBeGreaterThanOrEqual(from);
      from = at + part.length;
    }
    expect(text).not.toContain("9000070310");
    expect(text).not.toContain(String(A6));
    expect(buttons().find((b) => b.text === es.location.button)?.url).toBe(MAPS_URL);
  });
});

describe("criterio 29: la ruta pendiente no se ve en el bot", () => {
  it("B15 no la lista y un exp:d: forjado no envía nombre, tipo ni datos de guía", async () => {
    const route = await createRoute();
    expect((await api.submit(A6, route.listingId, SUBMIT_BODY)).status).toBe(200);
    // Otra ficha publicada deja la categoría con contenido para que B15 liste algo.
    const other = await api.pending(world, "Establecimiento Publicado Ficticio", A6);
    expect((await api.approve(ADMIN, other.versionId)).status).toBe(200);
    await flush(afterTasks);
    t.clear();
    await openCategory();
    expect(String(lastText().text)).not.toContain(ROUTE);
    expect(buttons().map((b) => b.text)).not.toContain(ROUTE);

    t.clear();
    await press(VISITOR, `exp:d:${pack(route.listingId)}:1`);
    const out = JSON.stringify(t.calls.map((c) => c.payload));
    for (const secret of [ROUTE, GUIDE, "Sabores de Caldas"]) expect(out).not.toContain(secret);
    expect(t.texts()).toEqual([es.explore.stale]);
  });
});
