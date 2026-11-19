import { type Context, InlineKeyboard } from "grammy";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { AppError } from "@/server/errors";
import { logError } from "@/server/observability/logger";
import { getHistoryListingName, getListingStatusHistory, listListingsForHistory } from "@/server/services";
import type { Db } from "@/server/services";
import { formatBogotaShort } from "@/lib/time";
import { send } from "./send";
import { es } from "./texts/es";

// B11 (F029): historial de estados de una ficha, solo lectura y solo del administrador. `callback_data` lleva la acción y el
// `listingId` (máximo 64 bytes); nunca autoriza nada: el rol se lee de la base en cada pulsación (ADR 0003).
export const HISTORY_PREFIX = "his:";
export const HISTORY_LIST = "his:l";
const OPEN = "his:o:";

// Tope de fichas por pulsación (D-096) y de caracteres por mensaje de Telegram.
export const HISTORY_PAGE_SIZE = 10;
const MAX_MESSAGE = 4096;

export interface HistoryDeps {
  db: () => Db;
  config: () => Config;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedHistory = { action: "list" } | { action: "open"; id: string };

// Nulo si la acción es desconocida o el id no es un UUID (truncado, mal formado o forjado).
export function parseHistoryCallback(data: string): ParsedHistory | null {
  if (Buffer.byteLength(data) > 64) return null;
  if (data === HISTORY_LIST) return { action: "list" };
  if (data.startsWith(OPEN)) {
    const id = data.slice(OPEN.length);
    return UUID.test(id) ? { action: "open", id } : null;
  }
  return null;
}

export const isHistoryCallback = (data: string | undefined): data is string => data !== undefined && data.startsWith(HISTORY_PREFIX);

async function showList(ctx: Context, deps: HistoryDeps, actor: Actor) {
  const page = await listListingsForHistory(deps.db(), deps.config(), actor, HISTORY_PAGE_SIZE);
  if (page.items.length === 0) return void (await send(ctx, es.history.empty));
  const lines = page.items.map((item) => `«${item.name}» · ${item.municipalityName}`);
  const keyboard = InlineKeyboard.from(page.items.map((item) => [InlineKeyboard.text(`${item.name} · ${item.municipalityName}`, `${OPEN}${item.listingId}`)]));
  await send(ctx, [es.history.listTitle, ...lines].join("\n"), keyboard);
  if (page.total > page.items.length) await send(ctx, es.history.moreListings);
}

type Event = Awaited<ReturnType<typeof getListingStatusHistory>>[number];

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

// `{fecha} · {de} → {a} · {responsable}` y, si hubo rechazo, `· Motivo: {motivo}`. La fecha va en America/Bogota.
function lineOf(event: Event): string {
  const to = es.history.statuses[event.toStatus];
  const change = event.fromStatus == null ? (event.toStatus === "draft" ? es.history.created : es.history.createdAs(to)) : `${es.history.statuses[event.fromStatus]} → ${to}`;
  const who = event.actor?.displayName ?? es.history.actorRemoved;
  const parts = [formatBogotaShort(new Date(event.occurredAt)), change, who];
  if (event.reason) parts.push(`${es.history.reasonLabel}: ${oneLine(event.reason)}`);
  const line = parts.join(" · ");
  return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE - 1)}…` : line;
}

// Une las líneas en mensajes de a lo más 4096 caracteres, sin partir una línea.
export function chunkLines(lines: string[], max = MAX_MESSAGE): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current === "" ? line : `${current}\n${line}`;
    if (next.length > max && current !== "") {
      chunks.push(current);
      current = line;
    } else current = next;
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

async function showHistory(ctx: Context, deps: HistoryDeps, actor: Actor, listingId: string) {
  const events = await getListingStatusHistory(deps.db(), deps.config(), actor, listingId);
  const title = es.history.title(await getHistoryListingName(deps.db(), listingId));
  for (const chunk of chunkLines([title, ...events.map(lineOf)])) await send(ctx, chunk);
}

// El llamador ya comprobó que la cuenta es administradora; los servicios lo vuelven a verificar contra la base.
export async function handleHistoryCallback(ctx: Context, deps: HistoryDeps, actor: Actor, data: string): Promise<void> {
  const parsed = parseHistoryCallback(data);
  if (!parsed) return void (await send(ctx, es.history.notFound));
  try {
    if (parsed.action === "list") return await showList(ctx, deps, actor);
    return await showHistory(ctx, deps, actor, parsed.id);
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "forbidden" || error.code === "consent_required") return void (await send(ctx, es.admin.forbidden));
      if (error.code === "not_found") return void (await send(ctx, es.history.notFound));
    }
    logError("history.callback_failed", error);
    await send(ctx, es.history.genericError);
  }
}
