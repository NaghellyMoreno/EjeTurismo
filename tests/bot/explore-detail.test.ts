/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Transformer } from "grammy";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLORE_PAGE_SIZE, EXPLORE_START } from "@/bot/explore";
import { es } from "@/bot/texts/es";
import { buildListingDetailMessages } from "@/server/domain/listing-detail";
import { getPublishedListingHandler } from "@/server/http/handlers";
import { memoryStorage } from "@/server/storage";
import { createTestBot } from "../helpers/bot";
import { ownerPool, resetDb } from "../helpers/db";
import { insertMunicipality, seedExplore, SPECIAL_NAME, type ExploreWorld } from "../helpers/explore";
import { createBody, CONTACT, draftBody, MAPS_URL, SUBMIT_BODY } from "../helpers/listing-http";
import { seedListing } from "../helpers/listing-data";
import { jpegBytes } from "../helpers/photo-data";
import { A6, ADMIN, flush, makeReviewListingApi, VISITOR } from "../helpers/review-listing";
import { changedTables, PERSON_IDS, snapshotAll } from "../helpers/role-denial";
import { callbackUpdate, signInitData, tma } from "../helpers/telegram";

// F023, criterios 1 a 7 y 9 a 16 (bot): detalle B16 de una ficha publicada.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

type Button = { text: string; callback_data?: string; url?: string };
type Call = { method: string; payload: any };
let owner: Pool;
let world: ExploreWorld;
const t = createTestBot();
const api = makeReviewListingApi(t.db);
const detailApi = getPublishedListingHandler(api.deps);
const getDetail = (user: number | null, id: string) =>
  detailApi(new Request(`http://localhost/api/v1/public/listings/${id}`, { headers: user === null ? {} : tma(signInitData({ userId: user })) }), { params: Promise.resolve({ listingId: id }) });

// Fallos forzados de Telegram para el envío de fotos (se instala después del interceptor de createTestBot, por lo que corre primero).
const forced = { mode: "none" as "none" | "url400" | "all400" | "429" | "500" };
const hasFile = (payload: any) => (payload.media ? payload.media.some((m: any) => typeof m.media !== "string") : typeof payload.photo !== "string");
t.bot.api.config.use((async (prev, method, payload) => {
  const isPhoto = method === "sendPhoto" || method === "sendMediaGroup";
  if (isPhoto && forced.mode !== "none") {
    const fail = (code: number, description: string) => {
      t.calls.push({ method, payload });
      return { ok: false, error_code: code, description } as never;
    };
    if (forced.mode === "429") return fail(429, "Too Many Requests: retry after 5");
    if (forced.mode === "500") return fail(500, "Internal Server Error");
    if (forced.mode === "all400" || !hasFile(payload)) return fail(400, "Bad Request: failed to get HTTP URL content");
  }
  return prev(method, payload);
}) as Transformer);

const press = (user: number, data: string) => t.send(callbackUpdate(data, { fromId: user }));
const sent = () => t.calls.filter((c) => ["sendMessage", "sendPhoto", "sendMediaGroup"].includes(c.method)) as Call[];
const sequence = () => sent().map((c) => c.method);
const buttonsOf = (call: Call): Button[] => (call.payload.reply_markup?.inline_keyboard ?? []).flat();
const lastText = () => t.messages().at(-1)!.payload as any;
const changed = (before: Awaited<ReturnType<typeof snapshotAll>>, after: Awaited<ReturnType<typeof snapshotAll>>) => changedTables(before, after).filter((table) => table !== "processed_updates");
const pack = (uuid: string) => Buffer.from(uuid.replaceAll("-", ""), "hex").toString("base64url");
const detailData = (id: string, page = 1) => `exp:d:${pack(id)}:${page}`;
const backData = (id: string, page = 1) => `exp:b:${pack(id)}:${page}`;
const A6_IDENTITY = "9000070310";

interface Seed {
  name?: string;
  photos?: number;
  municipalityId?: string;
  schedule?: string;
  description?: string;
  contact?: string;
  mapsUrl?: string;
}
async function addPhotos(versionId: string, count: number, tag = "foto") {
  for (let i = 1; i <= count; i++) {
    const pathname = `listings/prueba/${tag}-${versionId}-${i}.jpg`;
    memoryStorage().put(pathname, jpegBytes(125 + i), "image/jpeg");
    await owner.query("insert into app.listing_photos (version_id, blob_pathname, content_type, size_bytes, position) values ($1, $2, 'image/jpeg', $3, $4)", [versionId, pathname, 125 + i, i]);
  }
}
// FDet: atractivo publicado (los atractivos admiten fotos en la versión publicada) de MU1 y CA1.
async function seedDetail(seed: Seed = {}) {
  const made = await seedListing(owner, { accountId: world.adminAccount, kind: "attraction", status: "published", municipalityId: seed.municipalityId ?? world.municipalityOne, categoryId: world.categoryOne, name: seed.name ?? "Mirador Ficticio De Detalle" });
  await owner.query("update app.listing_versions set schedule = coalesce($2, schedule), description = coalesce($3, description), contact = coalesce($4, contact), maps_url = coalesce($5, maps_url) where id = $1", [made.versionId, seed.schedule ?? null, seed.description ?? null, seed.contact ?? null, seed.mapsUrl ?? null]);
  await addPhotos(made.versionId, seed.photos ?? 3);
  return made;
}
// Ruta o experiencia publicada con datos de guías.
async function seedRoute(guides: string | null, name = "Ruta Ficticia De Guias") {
  const businessId = (await owner.query("insert into app.businesses (provider_account_id) values ($1) returning id", [world.a6Account])).rows[0].id as string;
  const listingId = (await owner.query("insert into app.listings (kind, business_id, created_by_account_id) values ('route_experience', $1, $2) returning id", [businessId, world.a6Account])).rows[0].id as string;
  await owner.query(
    `insert into app.listing_versions (listing_id, version_number, status, name, name_normalized, municipality_id, category_id, description, schedule, contact, maps_url, guides_info)
     values ($1, 1, 'published', $2, lower($2), $3, $4, 'Descripción de ruta.', 'Sábados', $5, $6, $7)`,
    [listingId, name, world.municipalityOne, world.categoryOne, CONTACT, MAPS_URL, guides],
  );
  return listingId;
}
const published = async (id: string, user = VISITOR) => (await (await getDetail(user, id)).json()) as any;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await t.db.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  forced.mode = "none";
  memoryStorage().reset();
  t.clear();
  await resetDb(owner);
  world = await seedExplore(owner, api, afterTasks);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("criterio 1: un botón por ficha en la lista", () => {
  it("botones en el orden de la lista, uno por fila, con callback exp:d: de 64 bytes o menos, y Ver más y Volver aparte", async () => {
    for (let i = 1; i <= EXPLORE_PAGE_SIZE + 1; i++) await seedDetail({ name: `Ficha Con Boton ${String(i).padStart(3, "0")}`, photos: 0 });
    t.clear();
    await press(VISITOR, EXPLORE_START);
    await press(VISITOR, (lastText().reply_markup.inline_keyboard.flat() as Button[]).find((b) => b.text === "Municipio Ficticio Uno")!.callback_data!);
    const category = (lastText().reply_markup.inline_keyboard.flat() as Button[]).find((b) => b.text === "Categoria Ficticia Uno")!.callback_data!;
    await press(VISITOR, category);
    const res = await api.published(VISITOR, `municipalityId=${world.municipalityOne}&categoryId=${world.categoryOne}&page=1&pageSize=${EXPLORE_PAGE_SIZE}`);
    const items = ((await res.json()) as any).items as Array<{ id: string; name: string }>;
    const rows: Button[][] = lastText().reply_markup.inline_keyboard;
    expect(rows.slice(0, items.length).map((row) => row.length)).toEqual(items.map(() => 1));
    expect(rows.slice(0, items.length).map((row) => row[0])).toEqual(items.map((item) => ({ text: item.name, callback_data: detailData(item.id, 1) })));
    for (const row of rows) for (const b of row) expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64);
    expect(rows.slice(items.length).map((row) => row.map((b) => b.text))).toEqual([[es.explore.more], [es.explore.back]]);
    for (const item of items) expect(String(lastText().text)).toContain(item.name);
  });
});

describe("criterios 2, 3, 5 y 7: abrir el detalle", () => {
  it("FDet con 3 fotos: sendMediaGroup y luego un mensaje con los datos de la API y los botones; sin editar la lista", async () => {
    const { listingId } = await seedDetail({ schedule: "Lunes a viernes de 9 a 5", contact: "contacto-detalle@ejemplo.invalid" });
    const before = await snapshotAll(owner);
    t.clear();
    await press(VISITOR, detailData(listingId));
    expect(sequence()).toEqual(["sendMediaGroup", "sendMessage"]);
    expect(t.calls.some((c) => c.method.startsWith("edit"))).toBe(false);
    const body = await published(listingId);
    const text = String(lastText().text);
    expect(lastText().parse_mode).toBeUndefined();
    for (const [label, value] of [
      [es.listingDetail.municipality, body.municipality.name],
      [es.listingDetail.category, body.category.name],
      [es.listingDetail.description, body.description],
      [es.listingDetail.schedule, body.schedule],
      [es.listingDetail.contact, body.contact],
    ]) expect(text).toContain(`${label}: ${value}`);
    expect(text.startsWith(body.name)).toBe(true);
    expect(text).not.toContain(body.mapsUrl);
    const location = (lastText().reply_markup.inline_keyboard.flat() as Button[]).find((b) => b.text === es.location.button)!;
    expect(location.url).toBe(body.mapsUrl);
    expect(location.callback_data).toBeUndefined();
    expect(changed(before, await snapshotAll(owner))).toEqual([]);
  });

  it("una ficha de establecimiento muestra el nombre de su tipo", async () => {
    const res = await api.published(VISITOR, `municipalityId=${world.municipalityOne}&categoryId=${world.categoryOne}&page=1&pageSize=50`);
    const item = ((await res.json()) as any).items.find((i: any) => i.kind === "establishment");
    await press(VISITOR, detailData(item.id));
    expect(String(lastText().text)).toContain(`${es.listingDetail.type}: Establecimiento Ficticio`);
  });

  it.each([0, 1, 2, 10])("con %i fotos envía el mensaje de fotos que corresponde y siempre el texto", async (count) => {
    const { listingId } = await seedDetail({ photos: count });
    t.clear();
    await press(VISITOR, detailData(listingId));
    const expected = count === 0 ? [] : count === 1 ? ["sendPhoto"] : ["sendMediaGroup"];
    expect(sequence()).toEqual([...expected, "sendMessage"]);
    if (count >= 2) expect(sent()[0].payload.media).toHaveLength(count);
    expect(t.texts().some((text) => text === es.errors.generic)).toBe(false);
  });
});

describe("criterio 4: fotos publicadas, en orden y vigentes", () => {
  it("FPubB muestra solo las fotos de la versión publicada, no las del borrador en curso", async () => {
    const created = (await (await api.create(A6, createBody(world, { name: "Publicada Con Fotos Ficticia" }))).json()) as { id: string };
    const v1 = (await owner.query("select id from app.listing_versions where listing_id = $1", [created.id])).rows[0].id as string;
    await addPhotos(v1, 3, "pub");
    expect((await api.submit(A6, created.id, SUBMIT_BODY)).status).toBe(200);
    expect((await api.approve(ADMIN, v1)).status).toBe(200);
    await flush(afterTasks);
    expect((await api.save(A6, created.id, draftBody(world, { name: "Version Nueva Con Otras Fotos" }))).status).toBe(200);
    const v2 = (await owner.query("select id from app.listing_versions where listing_id = $1 and status = 'draft'", [created.id])).rows[0].id as string;
    await owner.query("delete from app.listing_photos where version_id = $1", [v2]);
    await addPhotos(v2, 2, "borrador");
    t.clear();
    await press(VISITOR, detailData(created.id));
    const body = await published(created.id);
    expect(body.name).toBe("Publicada Con Fotos Ficticia");
    expect(body.photos.map((p: any) => p.position)).toEqual([1, 2, 3]);
    const urls: string[] = sent()[0].payload.media.map((m: any) => m.media);
    expect(urls).toHaveLength(3);
    for (const url of urls) expect(url).toMatch(/\/api\/test-storage\/read\//);
    const stored = (await owner.query("select blob_pathname from app.listing_photos where version_id = $1 order by position", [v1])).rows.map((r) => r.blob_pathname as string);
    expect(memoryStorage().calls.filter((c) => c.type === "createReadUrl").slice(-3).map((c) => c.pathname)).toEqual(stored);
    expect(String(lastText().text)).toContain("Publicada Con Fotos Ficticia");
    expect(String(lastText().text)).not.toContain("Version Nueva Con Otras Fotos");
    const location = (lastText().reply_markup.inline_keyboard.flat() as Button[]).find((b) => b.text === es.location.button)!;
    expect(location.url).toBe(MAPS_URL);
  });
});

describe("criterio 6: orden de envío con textos largos (bot)", () => {
  const guidesOf = (length: number) => "palabra ".repeat(Math.ceil(length / 8)).slice(0, length);

  it("total de 4096 o menos: fotos y un solo mensaje con los botones", async () => {
    const id = await seedRoute("Guía de trato amable.");
    t.clear();
    await press(VISITOR, detailData(id));
    expect(sequence()).toEqual(["sendMessage"]);
    expect(String(lastText().text)).toContain(`${es.listingDetail.guides}: Guía de trato amable.`);
    expect(buttonsOf(sent()[0]).map((b) => b.text)).toEqual([es.location.button, es.informationRequest.button, es.explore.back]);
  });

  it("guías en el máximo de 4096: mensajes aparte, completos, con los botones solo en el último", async () => {
    const guides = guidesOf(4096);
    const id = await seedRoute(guides);
    t.clear();
    await press(VISITOR, detailData(id));
    const messages = sent();
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(messages.every((m) => m.method === "sendMessage")).toBe(true);
    const texts = messages.map((m) => String(m.payload.text));
    for (const text of texts) expect(text.length).toBeLessThanOrEqual(4096);
    expect(texts[1].startsWith(`${es.listingDetail.guides}: `)).toBe(true);
    expect(texts.slice(1).join("").slice(`${es.listingDetail.guides}: `.length)).toBe(guides);
    expect(messages.slice(0, -1).every((m) => m.payload.reply_markup === undefined)).toBe(true);
    expect(buttonsOf(messages.at(-1)!).map((b) => b.text)).toEqual([es.location.button, es.informationRequest.button, es.explore.back]);
    expect(texts).toEqual(buildListingDetailMessages({ name: "Ruta Ficticia De Guias", municipality: "Municipio Ficticio Uno", category: "Categoria Ficticia Uno", description: "Descripción de ruta.", schedule: "Sábados", contact: CONTACT, guidesInfo: guides }, es.listingDetail));
  });

  it("4096 caracteres seguidos sin separador: el primer mensaje de guías mide 4096", async () => {
    const id = await seedRoute("x".repeat(4096));
    t.clear();
    await press(VISITOR, detailData(id));
    const texts = sent().map((m) => String(m.payload.text));
    expect(texts[1]).toHaveLength(4096);
    expect(texts.slice(1).join("").slice(`${es.listingDetail.guides}: `.length)).toBe("x".repeat(4096));
  });

  it("guías nulas: sin mensaje de guías", async () => {
    const id = await seedRoute(null);
    t.clear();
    await press(VISITOR, detailData(id));
    expect(sequence()).toEqual(["sendMessage"]);
    expect(String(lastText().text)).not.toContain(`${es.listingDetail.guides}: `);
  });
});

describe("criterio 9: Volver conserva la elección", () => {
  async function seedMany(count: number, municipalityId: string) {
    const ids: string[] = [];
    for (let i = 1; i <= count; i++) ids.push((await seedDetail({ name: `Ficha Paginada ${String(i).padStart(3, "0")}`, municipalityId, photos: 0 })).listingId);
    return ids;
  }
  const listFor = async (municipalityId: string, page: number) => {
    t.clear();
    await press(VISITOR, `exp:l:${pack(municipalityId)}:${pack(world.categoryOne)}:${page}`);
    return lastText();
  };

  it("desde la página 2, Volver reenvía el mismo encabezado, los mismos nombres y el mismo teclado", async () => {
    const mu3 = await insertMunicipality(owner, "Municipio Ficticio Tres");
    const ids = await seedMany(EXPLORE_PAGE_SIZE + 3, mu3);
    const page2 = await listFor(mu3, 2);
    const first = page2.reply_markup.inline_keyboard[0][0] as Button;
    const id = ids.find((candidate) => detailData(candidate, 2) === first.callback_data)!;
    expect(id).toBeDefined();
    t.clear();
    await press(VISITOR, first.callback_data!);
    const back = (lastText().reply_markup.inline_keyboard.flat() as Button[]).find((b) => b.text === es.explore.back)!;
    expect(back.callback_data).toBe(backData(id, 2));
    expect(Buffer.byteLength(back.callback_data!)).toBeLessThanOrEqual(64);
    t.clear();
    await press(VISITOR, back.callback_data!);
    expect(sequence()).toEqual(["sendMessage"]);
    expect(lastText().text).toBe(page2.text);
    expect(lastText().reply_markup).toEqual(page2.reply_markup);
    for (const b of page2.reply_markup.inline_keyboard.flat() as Button[]) expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64);
  });

  it("si la ficha cambió de municipio, Volver muestra la combinación nueva con la página del callback", async () => {
    const mu3 = await insertMunicipality(owner, "Municipio Ficticio Tres");
    const mu4 = await insertMunicipality(owner, "Municipio Ficticio Cuatro");
    const ids = await seedMany(EXPLORE_PAGE_SIZE + 2, mu3);
    await seedMany(0, mu4);
    for (let i = 1; i <= EXPLORE_PAGE_SIZE + 2; i++) await seedDetail({ name: `Otra Ficha ${String(i).padStart(3, "0")}`, municipalityId: mu4, photos: 0 });
    await owner.query("update app.listing_versions set municipality_id = $2 where listing_id = $1 and status = 'published'", [ids[0], mu4]);
    t.clear();
    await press(VISITOR, backData(ids[0], 2));
    const expected = await listFor(mu4, 2);
    expect(String(expected.text).split("\n")[0]).toBe(es.explore.listHeader("Municipio Ficticio Cuatro", "Categoria Ficticia Uno"));
    t.clear();
    await press(VISITOR, backData(ids[0], 2));
    expect(lastText().text).toBe(expected.text);
  });

  it("si la página ya no existe en la combinación nueva responde explore.stale sin error ni cambios", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mu3 = await insertMunicipality(owner, "Municipio Ficticio Tres");
    const ids = await seedMany(EXPLORE_PAGE_SIZE + 1, mu3);
    await owner.query("update app.listing_versions set municipality_id = $2 where listing_id = $1 and status = 'published'", [ids[0], world.municipalityTwo]);
    const before = await snapshotAll(owner);
    t.clear();
    await press(VISITOR, backData(ids[0], 2));
    expect(t.texts()).toEqual([es.explore.stale]);
    expect(buttonsOf(sent()[0])).toEqual([{ text: es.explore.startOver, callback_data: EXPLORE_START }]);
    expect(error).not.toHaveBeenCalled();
    expect(changed(before, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterio 10: solo publicadas", () => {
  it("inexistente, rechazada, borrador, pendiente, ajena en borrador y callbacks alterados dan explore.stale con exp:d: y exp:b:", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ghost = "00000000-0000-4000-8000-0000000000aa";
    expect((await owner.query("select 1 from app.listings where id = $1", [ghost])).rowCount).toBe(0);
    const pendA = await api.pending(world, "Pendiente Ajena Ficticia", A6);
    const real = detailData(world.fb);
    const cases: Record<string, (kind: "d" | "b") => string> = {
      inexistente: (k) => `exp:${k}:${pack(ghost)}:1`,
      rechazada: (k) => `exp:${k}:${pack(world.frej)}:1`,
      borrador: (k) => `exp:${k}:${pack(world.fb)}:1`,
      pendiente: (k) => `exp:${k}:${pack(world.fpend)}:1`,
      "pendiente de otro negocio": (k) => `exp:${k}:${pack(pendA.listingId)}:1`,
      truncado: (k) => `exp:${k}:${pack(world.fb).slice(0, 10)}`,
      alterado: (k) => `exp:${k}:${pack(world.fb).slice(0, 21)}!:1`,
      "identificador de otro largo": (k) => `exp:${k}:${pack(world.fb)}AA:1`,
      "página no numérica": (k) => `exp:${k}:${pack(world.fb)}:abc`,
      "página negativa": (k) => `exp:${k}:${pack(world.fb)}:-1`,
    };
    expect(real).toContain("exp:d:");
    const before = await snapshotAll(owner);
    for (const [name, build] of Object.entries(cases)) {
      for (const kind of ["d", "b"] as const) {
        t.clear();
        await press(VISITOR, build(kind));
        expect(t.texts(), `${name} ${kind}`).toEqual([es.explore.stale]);
        expect(buttonsOf(sent()[0])).toEqual([{ text: es.explore.startOver, callback_data: EXPLORE_START }]);
      }
    }
    expect((await getDetail(VISITOR, world.fb)).status).toBe(404);
    expect(error).not.toHaveBeenCalled();
    expect(changed(before, await snapshotAll(owner))).toEqual([]);
  });

  it("una ficha que dejó de estar publicada entre abrir y pulsar Volver da explore.stale", async () => {
    const { listingId, versionId } = await seedDetail({ photos: 0 });
    t.clear();
    await press(VISITOR, detailData(listingId));
    await owner.query("update app.listing_versions set status = 'superseded' where id = $1", [versionId]);
    for (const data of [backData(listingId), detailData(listingId)]) {
      t.clear();
      await press(VISITOR, data);
      expect(t.texts()).toEqual([es.explore.stale]);
    }
  });

  it("una ficha publicada de otro negocio se abre; con FPubB solo se ve la versión publicada y tras aprobar aparece la nueva", async () => {
    await press(VISITOR, detailData(world.fpubB));
    expect(String(lastText().text).startsWith("Publicada Con Edicion Ficticia")).toBe(true);
    const version = (await owner.query("select id from app.listing_versions where listing_id = $1 and status = 'pending'", [world.fpubB])).rows[0].id as string;
    expect((await api.approve(ADMIN, version)).status).toBe(200);
    await flush(afterTasks);
    t.clear();
    await press(VISITOR, detailData(world.fpubB));
    expect(String(lastText().text).startsWith("Version Nueva En Revision Ficticia")).toBe(true);
  });
});

describe("criterio 11: sin datos personales", () => {
  it("ninguna llamada saliente incluye el documento, la cuenta ni el identificador de A6", async () => {
    const { listingId } = await seedDetail();
    t.clear();
    await press(VISITOR, detailData(world.fpubB));
    await press(VISITOR, detailData(listingId));
    const serialized = JSON.stringify(sent().map((c) => c.payload));
    const account = (await owner.query("select id from app.accounts where telegram_user_id = $1", [A6])).rows[0].id as string;
    const identityType = (await owner.query("select identity_document_type as t from app.provider_registrations where account_id = $1", [account])).rows[0]?.t as string | undefined;
    for (const needle of [A6_IDENTITY, account, String(A6), "identity", ...(identityType ? [`Tipo de documento: ${identityType}`] : [])]) expect(serialized).not.toContain(needle);
    expect(JSON.stringify(await published(listingId))).not.toContain(A6_IDENTITY);
    expect(JSON.stringify(await published(world.fpubB))).not.toContain(A6_IDENTITY);
  });
});

describe("criterio 12: aviso vigente y roles", () => {
  it("A1 y A3 reciben el aviso y ninguna ficha; la API da 401 y 403 consent_required", async () => {
    const { listingId } = await seedDetail();
    for (const user of [PERSON_IDS.A1, PERSON_IDS.A3]) {
      const before = await snapshotAll(owner);
      t.clear();
      await press(user, detailData(listingId));
      expect(t.texts().join("\n")).toContain("Aviso de privacidad");
      expect(sent().some((c) => c.method !== "sendMessage")).toBe(false);
      expect(t.texts().join("\n")).not.toContain("Mirador Ficticio De Detalle");
      if (user === PERSON_IDS.A1) expect(changed(before, await snapshotAll(owner))).toEqual([]);
    }
    expect((await getDetail(null, listingId)).status).toBe(401);
    const forbidden = await getDetail(PERSON_IDS.A3, listingId);
    expect(forbidden.status).toBe(403);
    expect(JSON.stringify(await forbidden.json())).toContain("consent_required");
  });

  it("A6 y el administrador reciben el mismo detalle que A2; A6 no ve su borrador y recibe stale de una ficha ajena en borrador", async () => {
    const { listingId } = await seedDetail();
    const base = await published(listingId);
    const baseline = async (user: number, id: string) => {
      t.clear();
      await press(user, detailData(id));
      return sent().map((c) => JSON.stringify(c.payload.text ?? c.payload.media?.length));
    };
    for (const user of [A6, ADMIN]) {
      expect(await baseline(user, listingId)).toEqual(await baseline(VISITOR, listingId));
      const res = await getDetail(user, listingId);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ...base, photos: expect.any(Array) });
    }
    await baseline(A6, world.fpubB);
    expect(String(lastText().text)).not.toContain("Version Nueva En Revision Ficticia");
    t.clear();
    await press(A6, detailData(world.fb));
    expect(t.texts()).toEqual([es.explore.stale]);
    const adminDraft = await seedListing(owner, { accountId: world.adminAccount, kind: "attraction", status: "draft", municipalityId: world.municipalityOne, name: "Borrador Ajeno Ficticio" });
    t.clear();
    await press(A6, detailData(adminDraft.listingId));
    expect(t.texts()).toEqual([es.explore.stale]);
    expect((await getDetail(A6, adminDraft.listingId)).status).toBe(404);
  });
});

describe("criterio 13: texto literal y fotos sin pie", () => {
  it("nombre y campos con caracteres especiales van sin parse_mode y las fotos sin caption", async () => {
    const special = SPECIAL_NAME;
    const { listingId } = await seedDetail({ name: special, description: special, schedule: special, contact: special, photos: 2 });
    t.clear();
    await press(VISITOR, detailData(listingId));
    const text = lastText();
    expect(text.parse_mode).toBeUndefined();
    expect(String(text.text)).toBe(buildListingDetailMessages({ name: special, municipality: "Municipio Ficticio Uno", category: "Categoria Ficticia Uno", description: special, schedule: special, contact: special }, es.listingDetail)[0]);
    const group = sent()[0].payload;
    for (const item of group.media) {
      expect(item.caption).toBeUndefined();
      expect(item.parse_mode).toBeUndefined();
    }
    expect(group.caption).toBeUndefined();
    t.clear();
    await press(VISITOR, `exp:l:${pack(world.municipalityOne)}:${pack(world.categoryOne)}:1`);
    expect((lastText().reply_markup.inline_keyboard.flat() as Button[]).map((b) => b.text)).toContain(special);
  });
});

describe("criterio 14: respaldo de fotos y otros errores", () => {
  const logged = () => vi.spyOn(console, "error").mockImplementation(() => undefined);
  const noLeak = (spy: ReturnType<typeof logged>) => {
    const out = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("bot.photos_failed");
    for (const needle of ["test-storage", "http", A6_IDENTITY, String(A6)]) expect(out).not.toContain(needle);
  };

  it("sendMediaGroup de 3 fotos falla por URL: las 3 se envían como archivos en orden y el texto con los botones", async () => {
    const { listingId } = await seedDetail({ photos: 3 });
    forced.mode = "url400";
    t.clear();
    await press(VISITOR, detailData(listingId));
    expect(sequence()).toEqual(["sendMediaGroup", "sendMediaGroup", "sendMessage"]);
    const files = sent()[1].payload.media as any[];
    expect(files).toHaveLength(3);
    expect(files.every((m) => typeof m.media !== "string")).toBe(true);
    expect(files.map((m) => m.media.filename ?? m.media.fileName ?? "")).toEqual(expect.arrayContaining([expect.stringContaining("foto-1")]));
    expect(t.texts().join("\n")).not.toContain(es.errors.generic);
    expect(t.texts().join("\n")).not.toContain(es.listingDetail.photosUnavailable);
    expect(buttonsOf(sent()[2]).map((b) => b.text)).toEqual([es.location.button, es.explore.back]);
  });

  it("sendPhoto de una foto falla por URL: la envía como archivo", async () => {
    const { listingId } = await seedDetail({ photos: 1 });
    forced.mode = "url400";
    t.clear();
    await press(VISITOR, detailData(listingId));
    expect(sequence()).toEqual(["sendPhoto", "sendPhoto", "sendMessage"]);
    expect(typeof sent()[1].payload.photo).not.toBe("string");
  });

  it("si el respaldo también falla: texto con botones, aviso y registro bot.photos_failed sin URL ni datos de A6", async () => {
    const spy = logged();
    const { listingId } = await seedDetail({ photos: 3 });
    forced.mode = "all400";
    t.clear();
    await press(VISITOR, detailData(listingId));
    expect(t.texts()).toContain(es.listingDetail.photosUnavailable);
    expect(t.texts()).not.toContain(es.errors.generic);
    expect(buttonsOf(sent().at(-1)!).map((b) => b.text)).toEqual([es.location.button, es.explore.back]);
    noLeak(spy);
  });

  it.each(["429", "500"] as const)("error %s de Telegram: sin respaldo, aviso y registro, sin descargar nada del almacén", async (mode) => {
    const spy = logged();
    const { listingId } = await seedDetail({ photos: 3 });
    forced.mode = mode;
    const reads = memoryStorage().calls.length;
    t.clear();
    await press(VISITOR, detailData(listingId));
    expect(sequence()).toEqual(["sendMediaGroup", "sendMessage", "sendMessage"]);
    expect(t.texts()).toContain(es.listingDetail.photosUnavailable);
    expect(t.texts()).not.toContain(es.errors.generic);
    // Solo las URL firmadas de la apertura; ninguna lectura adicional para el respaldo.
    expect(memoryStorage().calls.length - reads).toBe(3);
    noLeak(spy);
  });
});

describe("criterio 15: URL firmada al abrir y sin estado guardado", () => {
  it("cada apertura pide una URL por foto, distintas entre sí, y la base no cambia", async () => {
    const { listingId } = await seedDetail({ photos: 2 });
    const before = await snapshotAll(owner);
    memoryStorage().calls.length = 0;
    t.clear();
    await press(VISITOR, detailData(listingId));
    const first = sent()[0].payload.media.map((m: any) => m.media as string);
    t.clear();
    await press(VISITOR, detailData(listingId));
    const second = sent()[0].payload.media.map((m: any) => m.media as string);
    expect(memoryStorage().calls.filter((c) => c.type === "createReadUrl")).toHaveLength(4);
    for (const url of first) expect(second).not.toContain(url);
    for (const data of t.calls.flatMap((c) => buttonsOf(c as Call))) expect(data.callback_data ?? "").not.toContain("test-storage");
    expect(changed(before, await snapshotAll(owner))).toEqual([]);
  });

  it("urlExpiresAt es posterior a la hora simulada", async () => {
    const { listingId } = await seedDetail({ photos: 1 });
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2030-01-01T12:00:00.000Z");
    vi.setSystemTime(now);
    const body = await published(listingId);
    for (const photo of body.photos) expect(new Date(photo.urlExpiresAt).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("criterio 16: sin estado entre instancias", () => {
  it("el mismo callback_data procesado por otra instancia de createBot da el mismo detalle", async () => {
    const { listingId } = await seedDetail({ photos: 0 });
    t.clear();
    await press(VISITOR, detailData(listingId));
    const mine = String(lastText().text);
    const other = createTestBot({ db: () => t.db });
    await other.send(callbackUpdate(detailData(listingId), { fromId: VISITOR }));
    expect(String(other.messages().at(-1)!.payload.text)).toBe(mine);
  });
});
