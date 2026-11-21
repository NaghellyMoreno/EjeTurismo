import { type Context, InlineKeyboard } from "grammy";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { AppError } from "@/server/errors";
import { getPublishedListing, listCatalog, listMunicipalities, listPublishedListings } from "@/server/services";
import type { Db } from "@/server/services";
import { pack, unpack } from "./callback-ids";
import { showListingDetail } from "./listing-detail";
import { send } from "./send";
import { es } from "./texts/es";

// B15 (F022): municipios -> categorías -> fichas publicadas. Sin estado: el municipio, la categoría y la página viajan en el
// `callback_data` (máximo 64 bytes), con cada UUID en base64url (22 caracteres). Solo identifica la acción; nunca autoriza (ADR 0006).
export const EXPLORE_PREFIX = "exp:";
export const EXPLORE_START = "exp:m";
const CATEGORIES = "exp:c:";
const LIST = "exp:l:";
const DETAIL = "exp:d:";
const BACK = "exp:b:";
// B18 (F017): directorio gastronómico por municipio. `exp:gm` lista municipios; `exp:g:<municipio>:<página>` lista las fichas.
const GASTRO_START = "exp:gm";
const GASTRO_LIST = "exp:g:";
// En el detalle y en "Volver" de B18 la página lleva el prefijo `g` para recordar el origen (exp:d:<ficha>:g<página>).
const GASTRO_PAGE = "g";

// B17 (F024): tipos de experiencia de un municipio y sus rutas y experiencias. `exp:t:<municipio>` lista los tipos;
// `exp:e:<municipio>:<tipo>:<página>` lista las fichas; el detalle y "Volver" llevan `e<página>` (exp:d:<ficha>:e<página>).
const EXPERIENCE_TYPES = "exp:t:";
const EXPERIENCE_LIST = "exp:e:";
const EXPERIENCE_PAGE = "e";

// Fichas por página (P4, D-164).
export const EXPLORE_PAGE_SIZE = 10;
const MAX_PAGE = 100000;

export interface ExploreDeps {
  db: () => Db;
  config: () => Config;
  now?: () => Date;
}

export const isExploreCallback = (data: string | undefined): data is string => data !== undefined && data.startsWith(EXPLORE_PREFIX);

// Pantalla desde la que se abrió el detalle: la lista de B15 (""), el directorio de B18 ("g") o la lista de B17 ("e").
type Origin = "" | typeof GASTRO_PAGE | typeof EXPERIENCE_PAGE;

type Parsed = { action: "municipalities" } | { action: "categories"; municipalityId: string } | { action: "list"; municipalityId: string; categoryId: string; page: number }
  | { action: "detail"; listingId: string; page: number; origin: Origin }
  | { action: "back"; listingId: string; page: number; origin: Origin }
  | { action: "experienceTypes"; municipalityId: string } | { action: "experienceList"; municipalityId: string; experienceTypeId: string; page: number }
  | { action: "gastroMunicipalities" } | { action: "gastroList"; municipalityId: string; page: number };

export function parseExploreCallback(data: string): Parsed | null {
  if (Buffer.byteLength(data) > 64) return null;
  if (data === EXPLORE_START) return { action: "municipalities" };
  if (data === GASTRO_START) return { action: "gastroMunicipalities" };
  if (data.startsWith(GASTRO_LIST)) {
    const parts = data.slice(GASTRO_LIST.length).split(":");
    if (parts.length !== 2 || !/^[1-9][0-9]{0,5}$/.test(parts[1])) return null;
    const municipalityId = unpack(parts[0]);
    const page = Number(parts[1]);
    return municipalityId && page <= MAX_PAGE ? { action: "gastroList", municipalityId, page } : null;
  }
  if (data.startsWith(EXPERIENCE_TYPES)) {
    const municipalityId = unpack(data.slice(EXPERIENCE_TYPES.length));
    return municipalityId ? { action: "experienceTypes", municipalityId } : null;
  }
  if (data.startsWith(EXPERIENCE_LIST)) {
    const parts = data.slice(EXPERIENCE_LIST.length).split(":");
    if (parts.length !== 3 || !/^[1-9][0-9]{0,5}$/.test(parts[2])) return null;
    const municipalityId = unpack(parts[0]);
    const experienceTypeId = unpack(parts[1]);
    const page = Number(parts[2]);
    return municipalityId && experienceTypeId && page <= MAX_PAGE ? { action: "experienceList", municipalityId, experienceTypeId, page } : null;
  }
  if (data.startsWith(CATEGORIES)) {
    const municipalityId = unpack(data.slice(CATEGORIES.length));
    return municipalityId ? { action: "categories", municipalityId } : null;
  }
  if (data.startsWith(LIST)) {
    const parts = data.slice(LIST.length).split(":");
    if (parts.length !== 3 || !/^[1-9][0-9]{0,5}$/.test(parts[2])) return null;
    const municipalityId = unpack(parts[0]);
    const categoryId = unpack(parts[1]);
    const page = Number(parts[2]);
    return municipalityId && categoryId && page <= MAX_PAGE ? { action: "list", municipalityId, categoryId, page } : null;
  }
  for (const [prefix, action] of [[DETAIL, "detail"], [BACK, "back"]] as const) {
    if (!data.startsWith(prefix)) continue;
    const parts = data.slice(prefix.length).split(":");
    const origin: Origin = parts[1]?.startsWith(GASTRO_PAGE) ? GASTRO_PAGE : parts[1]?.startsWith(EXPERIENCE_PAGE) ? EXPERIENCE_PAGE : "";
    const pageText = origin ? parts[1].slice(1) : parts[1];
    if (parts.length !== 2 || !/^[1-9][0-9]{0,5}$/.test(pageText)) return null;
    const listingId = unpack(parts[0]);
    const page = Number(pageText);
    return listingId && page <= MAX_PAGE ? { action, listingId, page, origin } : null;
  }
  return null;
}

const stale = (ctx: Context) => send(ctx, es.explore.stale, new InlineKeyboard().text(es.explore.startOver, EXPLORE_START));

async function showMunicipalities(ctx: Context, deps: ExploreDeps, actor: Actor) {
  const municipalities = await listMunicipalities(deps.db(), actor);
  if (municipalities.length === 0) return void (await send(ctx, es.explore.noMunicipalities));
  const keyboard = new InlineKeyboard();
  for (const municipality of municipalities) keyboard.text(municipality.name, `${CATEGORIES}${pack(municipality.id)}`).row();
  keyboard.text(es.explore.gastronomicButton, GASTRO_START);
  await send(ctx, es.explore.chooseMunicipality, keyboard);
}

async function showGastroMunicipalities(ctx: Context, deps: ExploreDeps, actor: Actor) {
  const municipalities = await listMunicipalities(deps.db(), actor);
  if (municipalities.length === 0) return void (await send(ctx, es.explore.noMunicipalities));
  const keyboard = new InlineKeyboard();
  for (const municipality of municipalities) keyboard.text(municipality.name, `${GASTRO_LIST}${pack(municipality.id)}:1`).row();
  keyboard.text(es.explore.back, EXPLORE_START);
  await send(ctx, es.explore.chooseMunicipality, keyboard);
}

async function showGastroList(ctx: Context, deps: ExploreDeps, actor: Actor, municipalityId: string, page: number) {
  const municipality = (await listMunicipalities(deps.db(), actor)).find((item) => item.id === municipalityId);
  if (!municipality) return void (await stale(ctx));
  const params = new URLSearchParams({ municipalityId, gastronomic: "true", page: String(page), pageSize: String(EXPLORE_PAGE_SIZE) });
  const result = await listPublishedListings(deps.db(), actor, params);
  const back = () => new InlineKeyboard().text(es.explore.back, GASTRO_START);
  if (result.items.length === 0) {
    if (page > 1) return void (await stale(ctx));
    return void (await send(ctx, es.explore.gastronomicEmpty, back()));
  }
  const keyboard = new InlineKeyboard();
  for (const item of result.items) keyboard.text(item.name, `${DETAIL}${pack(item.id)}:${GASTRO_PAGE}${page}`).row();
  if (page * EXPLORE_PAGE_SIZE < result.total) keyboard.text(es.explore.more, `${GASTRO_LIST}${pack(municipalityId)}:${page + 1}`).row();
  keyboard.text(es.explore.back, GASTRO_START);
  await send(ctx, [es.explore.gastronomicHeader(municipality.name), ...result.items.map((item) => item.name)].join("\n"), keyboard);
}

async function showCategories(ctx: Context, deps: ExploreDeps, actor: Actor, municipalityId: string) {
  const municipality = (await listMunicipalities(deps.db(), actor)).find((item) => item.id === municipalityId);
  if (!municipality) return void (await stale(ctx));
  const keyboard = new InlineKeyboard();
  for (const category of await listCatalog(deps.db(), actor, "category")) {
    keyboard.text(category.name, `${LIST}${pack(municipalityId)}:${pack(category.id)}:1`).row();
  }
  keyboard.text(es.explore.experienceButton, `${EXPERIENCE_TYPES}${pack(municipalityId)}`).row();
  keyboard.text(es.explore.back, EXPLORE_START);
  await send(ctx, es.explore.chooseCategory(municipality.name), keyboard);
}

async function showExperienceTypes(ctx: Context, deps: ExploreDeps, actor: Actor, municipalityId: string) {
  const municipality = (await listMunicipalities(deps.db(), actor)).find((item) => item.id === municipalityId);
  if (!municipality) return void (await stale(ctx));
  const back = () => new InlineKeyboard().text(es.explore.back, `${CATEGORIES}${pack(municipalityId)}`);
  const types = await listCatalog(deps.db(), actor, "experience_type");
  if (types.length === 0) return void (await send(ctx, es.explore.noExperienceTypes, back()));
  const keyboard = new InlineKeyboard();
  for (const type of types) keyboard.text(type.name, `${EXPERIENCE_LIST}${pack(municipalityId)}:${pack(type.id)}:1`).row();
  keyboard.text(es.explore.back, `${CATEGORIES}${pack(municipalityId)}`);
  await send(ctx, es.explore.chooseExperienceType(municipality.name), keyboard);
}

async function showExperienceList(ctx: Context, deps: ExploreDeps, actor: Actor, municipalityId: string, experienceTypeId: string, page: number) {
  const municipality = (await listMunicipalities(deps.db(), actor)).find((item) => item.id === municipalityId);
  const type = (await listCatalog(deps.db(), actor, "experience_type")).find((item) => item.id === experienceTypeId);
  if (!municipality || !type) return void (await stale(ctx));
  const params = new URLSearchParams({ kind: "route_experience", municipalityId, experienceTypeId, page: String(page), pageSize: String(EXPLORE_PAGE_SIZE) });
  const result = await listPublishedListings(deps.db(), actor, params);
  const back = `${EXPERIENCE_TYPES}${pack(municipalityId)}`;
  if (result.items.length === 0) {
    if (page > 1) return void (await stale(ctx));
    return void (await send(ctx, es.explore.experienceEmpty(type.name, municipality.name), new InlineKeyboard().text(es.explore.back, back)));
  }
  const keyboard = new InlineKeyboard();
  for (const item of result.items) keyboard.text(item.name, `${DETAIL}${pack(item.id)}:${EXPERIENCE_PAGE}${page}`).row();
  if (page * EXPLORE_PAGE_SIZE < result.total) keyboard.text(es.explore.more, `${EXPERIENCE_LIST}${pack(municipalityId)}:${pack(experienceTypeId)}:${page + 1}`).row();
  keyboard.text(es.explore.back, back);
  await send(ctx, [es.explore.experienceHeader(type.name, municipality.name), ...result.items.map((item) => item.name)].join("\n"), keyboard);
}

async function showList(ctx: Context, deps: ExploreDeps, actor: Actor, municipalityId: string, categoryId: string, page: number) {
  const municipality = (await listMunicipalities(deps.db(), actor)).find((item) => item.id === municipalityId);
  const category = (await listCatalog(deps.db(), actor, "category")).find((item) => item.id === categoryId);
  if (!municipality || !category) return void (await stale(ctx));
  const params = new URLSearchParams({ municipalityId, categoryId, page: String(page), pageSize: String(EXPLORE_PAGE_SIZE) });
  const result = await listPublishedListings(deps.db(), actor, params);
  const back = () => new InlineKeyboard().text(es.explore.back, `${CATEGORIES}${pack(municipalityId)}`);
  if (result.items.length === 0) {
    if (page > 1) return void (await stale(ctx));
    return void (await send(ctx, es.explore.empty(municipality.name, category.name), back()));
  }
  const keyboard = new InlineKeyboard();
  for (const item of result.items) keyboard.text(item.name, `${DETAIL}${pack(item.id)}:${page}`).row();
  if (page * EXPLORE_PAGE_SIZE < result.total) keyboard.text(es.explore.more, `${LIST}${pack(municipalityId)}:${pack(categoryId)}:${page + 1}`).row();
  keyboard.text(es.explore.back, `${CATEGORIES}${pack(municipalityId)}`);
  const names = result.items.map((item) => item.name);
  await send(ctx, [es.explore.listHeader(municipality.name, category.name), ...names].join("\n"), keyboard);
}

// B16 (F023): solo se abre una ficha con versión publicada; cualquier otra cosa (inexistente, borrador, pendiente, rechazada) es "stale".
// "Volver" toma el municipio y la categoría de la ficha publicada y la página del `callback_data`.
async function showDetail(ctx: Context, deps: ExploreDeps, actor: Actor, listingId: string, page: number, back: boolean, origin: Origin) {
  let detail;
  try {
    detail = await getPublishedListing(deps.db(), actor, listingId, deps.now?.() ?? new Date());
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") return void (await stale(ctx));
    throw error;
  }
  if (back && origin === GASTRO_PAGE) return showGastroList(ctx, deps, actor, detail.municipality.id, page);
  if (back && origin === EXPERIENCE_PAGE && detail.kind === "route_experience" && detail.experienceType) {
    return showExperienceList(ctx, deps, actor, detail.municipality.id, detail.experienceType.id, page);
  }
  if (back) return showList(ctx, deps, actor, detail.municipality.id, detail.category.id, page);
  await showListingDetail(ctx, detail, `${BACK}${pack(listingId)}:${origin}${page}`);
}

// El llamador ya comprobó que la cuenta tiene el aviso vigente; los servicios lo vuelven a verificar con el actor.
export async function handleExploreCallback(ctx: Context, deps: ExploreDeps, actor: Actor, data: string): Promise<void> {
  const parsed = parseExploreCallback(data);
  if (!parsed) return void (await stale(ctx));
  if (parsed.action === "municipalities") return showMunicipalities(ctx, deps, actor);
  if (parsed.action === "categories") return showCategories(ctx, deps, actor, parsed.municipalityId);
  if (parsed.action === "gastroMunicipalities") return showGastroMunicipalities(ctx, deps, actor);
  if (parsed.action === "gastroList") return showGastroList(ctx, deps, actor, parsed.municipalityId, parsed.page);
  if (parsed.action === "experienceTypes") return showExperienceTypes(ctx, deps, actor, parsed.municipalityId);
  if (parsed.action === "experienceList") return showExperienceList(ctx, deps, actor, parsed.municipalityId, parsed.experienceTypeId, parsed.page);
  if (parsed.action === "detail") return showDetail(ctx, deps, actor, parsed.listingId, parsed.page, false, parsed.origin);
  if (parsed.action === "back") return showDetail(ctx, deps, actor, parsed.listingId, parsed.page, true, parsed.origin);
  return showList(ctx, deps, actor, parsed.municipalityId, parsed.categoryId, parsed.page);
}
