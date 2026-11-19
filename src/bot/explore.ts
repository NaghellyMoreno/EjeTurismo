import { type Context, InlineKeyboard } from "grammy";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { listCatalog, listMunicipalities, listPublishedListings } from "@/server/services";
import type { Db } from "@/server/services";
import { send } from "./send";
import { es } from "./texts/es";

// B15 (F022): municipios -> categorías -> fichas publicadas. Sin estado: el municipio, la categoría y la página viajan en el
// `callback_data` (máximo 64 bytes), con cada UUID en base64url (22 caracteres). Solo identifica la acción; nunca autoriza (ADR 0006).
export const EXPLORE_PREFIX = "exp:";
export const EXPLORE_START = "exp:m";
const CATEGORIES = "exp:c:";
const LIST = "exp:l:";

// Fichas por página (P4, D-164).
export const EXPLORE_PAGE_SIZE = 10;
const MAX_PAGE = 100000;

export interface ExploreDeps {
  db: () => Db;
  config: () => Config;
}

export const isExploreCallback = (data: string | undefined): data is string => data !== undefined && data.startsWith(EXPLORE_PREFIX);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const pack = (uuid: string) => Buffer.from(uuid.replaceAll("-", ""), "hex").toString("base64url");

// Nulo si el texto no es un UUID empaquetado canónico (mal formado, truncado o alterado).
function unpack(text: string): string | null {
  if (text.length !== 22) return null;
  const hex = Buffer.from(text, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID.test(uuid) && pack(uuid) === text ? uuid : null;
}

type Parsed = { action: "municipalities" } | { action: "categories"; municipalityId: string } | { action: "list"; municipalityId: string; categoryId: string; page: number };

export function parseExploreCallback(data: string): Parsed | null {
  if (Buffer.byteLength(data) > 64) return null;
  if (data === EXPLORE_START) return { action: "municipalities" };
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
  return null;
}

const stale = (ctx: Context) => send(ctx, es.explore.stale, new InlineKeyboard().text(es.explore.startOver, EXPLORE_START));

async function showMunicipalities(ctx: Context, deps: ExploreDeps, actor: Actor) {
  const municipalities = await listMunicipalities(deps.db(), actor);
  if (municipalities.length === 0) return void (await send(ctx, es.explore.noMunicipalities));
  const keyboard = new InlineKeyboard();
  for (const municipality of municipalities) keyboard.text(municipality.name, `${CATEGORIES}${pack(municipality.id)}`).row();
  await send(ctx, es.explore.chooseMunicipality, keyboard);
}

async function showCategories(ctx: Context, deps: ExploreDeps, actor: Actor, municipalityId: string) {
  const municipality = (await listMunicipalities(deps.db(), actor)).find((item) => item.id === municipalityId);
  if (!municipality) return void (await stale(ctx));
  const keyboard = new InlineKeyboard();
  for (const category of await listCatalog(deps.db(), actor, "category")) {
    keyboard.text(category.name, `${LIST}${pack(municipalityId)}:${pack(category.id)}:1`).row();
  }
  keyboard.text(es.explore.back, EXPLORE_START);
  await send(ctx, es.explore.chooseCategory(municipality.name), keyboard);
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
  if (page * EXPLORE_PAGE_SIZE < result.total) keyboard.text(es.explore.more, `${LIST}${pack(municipalityId)}:${pack(categoryId)}:${page + 1}`).row();
  keyboard.text(es.explore.back, `${CATEGORIES}${pack(municipalityId)}`);
  const names = result.items.map((item) => item.name);
  await send(ctx, [es.explore.listHeader(municipality.name, category.name), ...names].join("\n"), keyboard);
}

// El llamador ya comprobó que la cuenta tiene el aviso vigente; los servicios lo vuelven a verificar con el actor.
export async function handleExploreCallback(ctx: Context, deps: ExploreDeps, actor: Actor, data: string): Promise<void> {
  const parsed = parseExploreCallback(data);
  if (!parsed) return void (await stale(ctx));
  if (parsed.action === "municipalities") return showMunicipalities(ctx, deps, actor);
  if (parsed.action === "categories") return showCategories(ctx, deps, actor, parsed.municipalityId);
  return showList(ctx, deps, actor, parsed.municipalityId, parsed.categoryId, parsed.page);
}
