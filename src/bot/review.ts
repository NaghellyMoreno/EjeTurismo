import { type Context, InlineKeyboard } from "grammy";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { normalizeReason } from "@/server/domain/review";
import { AppError } from "@/server/errors";
import { scheduleDelivery } from "@/server/notifications";
import { logError } from "@/server/observability/logger";
import {
  approveListingVersion,
  clearBotSession,
  getManagedListing,
  getReview,
  listManagedListings,
  listPendingReviews,
  loadBotSession,
  OwnerRevokedError,
  rejectListingVersion,
  saveBotSession,
} from "@/server/services";
import type { Db, ReviewDecision } from "@/server/services";
import { isCancelCommand, SessionConflictError } from "./common";
import { send } from "./send";
import { es } from "./texts/es";

// B10 (F014): revisión de fichas pendientes por el administrador. `callback_data` lleva solo la acción y el `versionId` (máximo
// 64 bytes); nunca autoriza nada: el rol se lee de la base en cada pulsación (ADR 0003). El motivo del rechazo y el paso de
// confirmación viven en `bot_sessions` (ADR 0015, D-111), con el vencimiento de B08 y solo el `versionId` y el motivo.
export const REVIEW_PREFIX = "rev:";
export const REVIEW_LIST = "rev:l";
const OPEN = "rev:o:";
const APPROVE = "rev:a:";
const REJECT = "rev:r:";
const CONFIRM_APPROVE = "rev:ca:";
const CONFIRM_REJECT = "rev:cr:";
const CANCEL = "rev:x:";

// Tope de fichas por pulsación (D-096).
export const REVIEW_PAGE_SIZE = 10;

const FORM = "listing_review";

export interface ReviewDeps {
  db: () => Db;
  config: () => Config;
  now: () => Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Parsed = { action: "list" } | { action: "open" | "approve" | "reject" | "confirmApprove" | "confirmReject" | "cancel"; id: string };

const PREFIXES: [string, Exclude<Parsed, { action: "list" }>["action"]][] = [
  [OPEN, "open"],
  [APPROVE, "approve"],
  [REJECT, "reject"],
  [CONFIRM_APPROVE, "confirmApprove"],
  [CONFIRM_REJECT, "confirmReject"],
  [CANCEL, "cancel"],
];

// Nulo si la acción es desconocida o el id no es un UUID (truncado, mal formado o forjado).
export function parseReviewCallback(data: string): Parsed | null {
  if (Buffer.byteLength(data) > 64) return null;
  if (data === REVIEW_LIST) return { action: "list" };
  for (const [prefix, action] of PREFIXES) {
    if (data.startsWith(prefix)) {
      const id = data.slice(prefix.length);
      return UUID.test(id) ? { action, id } : null;
    }
  }
  return null;
}

export const isReviewCallback = (data: string | undefined): data is string => data !== undefined && data.startsWith(REVIEW_PREFIX);

interface Session {
  form?: typeof FORM;
  step?: "reason" | "confirm_reject" | "confirm_approve";
  draft?: { versionId?: string; reason?: string };
  startedAt?: string;
  expiresAt?: string;
}

// Sesión de este formulario con forma válida; cualquier otra cosa (otro formulario, datos forjados) es nula.
function parseSession(data: unknown): Session | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = data as Session;
  const validStep = raw.step === "reason" || raw.step === "confirm_reject" || raw.step === "confirm_approve";
  return raw.form === FORM && validStep && typeof raw.draft?.versionId === "string" ? raw : null;
}

export const isReviewSession = (data: unknown): boolean => parseSession(data) !== null;

const isExpired = (session: Session, now: Date) => !session.expiresAt || now.getTime() >= new Date(session.expiresAt).getTime();

const confirmKeyboard = (confirm: string, yes: string, id: string) => new InlineKeyboard().text(yes, `${confirm}${id}`).text(es.review.cancel, `${CANCEL}${id}`);

// Una conversación a la vez por cuenta: guarda el paso con el vencimiento de la sesión sensible (misma comparación que B08).
async function begin(deps: ReviewDeps, accountId: string, step: NonNullable<Session["step"]>, draft: Session["draft"]) {
  const db = deps.db();
  const now = deps.now();
  const stored = await loadBotSession(db, accountId);
  const expiresAt = new Date(now.getTime() + deps.config().sensitiveDraftTtlSeconds * 1000);
  const next: Session = { form: FORM, step, draft, startedAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
  if (!(await saveBotSession(db, accountId, next, stored?.updatedAt ?? null, now))) throw new SessionConflictError();
}

const clear = (deps: ReviewDeps, accountId: string) => clearBotSession(deps.db(), accountId, deps.now());

// Traduce el error de un servicio al texto del bot; el detalle técnico solo va al registro (sin datos personales).
async function fail(ctx: Context, error: unknown): Promise<void> {
  if (error instanceof OwnerRevokedError) return void (await send(ctx, es.review.ownerRevoked));
  if (error instanceof AppError) {
    if (error.code === "forbidden" || error.code === "consent_required") return void (await send(ctx, es.admin.forbidden));
    if (error.code === "not_found") return void (await send(ctx, es.review.notFound));
    if (error.code === "invalid_state_transition") return void (await send(ctx, es.review.alreadyDecided));
  }
  logError("review.callback_failed", error);
  await send(ctx, es.review.genericError);
}

// Una ficha pendiente o nulo (inexistente, mal formada o ya decidida).
async function findReview(deps: ReviewDeps, actor: Actor, id: string) {
  try {
    return await getReview(deps.db(), deps.config(), actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") return null;
    throw error;
  }
}

async function showPending(ctx: Context, deps: ReviewDeps, actor: Actor) {
  const page = await listPendingReviews(deps.db(), deps.config(), actor, new URLSearchParams({ page: "1", pageSize: String(REVIEW_PAGE_SIZE) }));
  if (page.items.length === 0) return void (await send(ctx, es.review.empty));
  const lines = page.items.map((item) => `«${item.name}» · ${item.municipality.name} (${es.review.kinds[item.kind]})`);
  const keyboard = InlineKeyboard.from(page.items.map((item) => [InlineKeyboard.text(`${item.name} · ${item.municipality.name}`, `${OPEN}${item.versionId}`)]));
  await send(ctx, [es.review.listTitle, ...lines].join("\n"), keyboard);
  if (page.total > page.items.length) await send(ctx, es.review.morePending);
}

async function showDetail(ctx: Context, deps: ReviewDeps, actor: Actor, id: string) {
  const review = await findReview(deps, actor, id);
  if (!review) return void (await send(ctx, es.review.notFound));
  const content = review.proposed.content;
  const lines = [
    `«${content.name}» (${es.review.kinds[review.kind]})`,
    `${es.review.fields.municipality}: ${content.municipality.name}`,
    `${es.review.fields.category}: ${content.category?.name ?? ""}`,
    `${es.review.fields.description}: ${content.description ?? ""}`,
    `${es.review.fields.schedule}: ${content.schedule ?? ""}`,
    `${es.review.fields.contact}: ${content.contact ?? ""}`,
    `${es.review.fields.mapsUrl}: ${content.mapsUrl ?? ""}`,
  ];
  if (!review.published) lines.push(es.review.firstReview);
  if (review.changedFields.length > 0) lines.push(es.review.changed(review.changedFields.map((field) => es.review.fields[field]).join(", ")));
  const keyboard = new InlineKeyboard().text(es.review.approve, `${APPROVE}${id}`).text(es.review.reject, `${REJECT}${id}`);
  await send(ctx, lines.join("\n"), keyboard);
}

async function askApproval(ctx: Context, deps: ReviewDeps, actor: Actor, accountId: string, id: string) {
  const review = await findReview(deps, actor, id);
  if (!review) return void (await send(ctx, es.review.alreadyDecided));
  await begin(deps, accountId, "confirm_approve", { versionId: id });
  await send(ctx, es.review.confirmApprove(review.proposed.content.name), confirmKeyboard(CONFIRM_APPROVE, es.review.yesApprove, id));
}

async function askReason(ctx: Context, deps: ReviewDeps, actor: Actor, accountId: string, id: string) {
  if (!(await findReview(deps, actor, id))) return void (await send(ctx, es.review.alreadyDecided));
  await begin(deps, accountId, "reason", { versionId: id });
  await send(ctx, es.review.askReason, new InlineKeyboard().text(es.review.cancel, `${CANCEL}${id}`));
}

// "Sí, aprobar" o "Sí, rechazar": solo con la sesión propia de ese paso, esa ficha y sin vencer. Sin sesión, una ficha ya
// decidida responde `alreadyDecided` (doble pulsación) y una pendiente `sessionExpired`.
async function confirm(ctx: Context, deps: ReviewDeps, actor: Actor, accountId: string, id: string, kind: "approve" | "reject") {
  const stored = await loadBotSession(deps.db(), accountId);
  const session = parseSession(stored?.data);
  const mine = session !== null && session.step === (kind === "approve" ? "confirm_approve" : "confirm_reject") && session.draft?.versionId === id;
  if (mine && isExpired(session, deps.now())) {
    await clear(deps, accountId);
    return void (await send(ctx, es.review.sessionExpired));
  }
  if (!mine) {
    const pending = await findReview(deps, actor, id);
    return void (await send(ctx, pending ? es.review.sessionExpired : es.review.alreadyDecided));
  }
  const reason = kind === "reject" ? normalizeReason(session.draft?.reason) : null;
  if (kind === "reject" && reason === null) {
    await clear(deps, accountId);
    return void (await send(ctx, es.review.sessionExpired));
  }
  let result: ReviewDecision;
  try {
    result =
      kind === "approve"
        ? await approveListingVersion(deps.db(), deps.config(), actor, id, { confirmed: true }, deps.now())
        : await rejectListingVersion(deps.db(), deps.config(), actor, id, { confirmed: true, reason }, deps.now());
  } catch (error) {
    if (error instanceof AppError) await clear(deps, accountId);
    throw error;
  }
  await clear(deps, accountId);
  await send(ctx, kind === "approve" ? es.review.approved : es.review.rejected);
  // El aviso al prestador sale después de responder (ADR 0007), por la API del bot.
  scheduleDelivery(result.notificationIds, { db: deps.db, now: deps.now, send: (chatId, text) => ctx.api.sendMessage(chatId, text) });
}

// El llamador ya comprobó que la cuenta es administradora; los servicios lo vuelven a verificar contra la base.
export async function handleReviewCallback(ctx: Context, deps: ReviewDeps, actor: Actor, accountId: string, data: string): Promise<void> {
  const parsed = parseReviewCallback(data);
  if (!parsed) return void (await send(ctx, es.review.notFound));
  try {
    switch (parsed.action) {
      case "list":
        return await showPending(ctx, deps, actor);
      case "open":
        return await showDetail(ctx, deps, actor, parsed.id);
      case "approve":
        return await askApproval(ctx, deps, actor, accountId, parsed.id);
      case "reject":
        return await askReason(ctx, deps, actor, accountId, parsed.id);
      case "cancel":
        await clear(deps, accountId);
        return void (await send(ctx, es.review.cancelled));
      case "confirmApprove":
        return await confirm(ctx, deps, actor, accountId, parsed.id, "approve");
      case "confirmReject":
        return await confirm(ctx, deps, actor, accountId, parsed.id, "reject");
    }
  } catch (error) {
    if (error instanceof SessionConflictError) throw error;
    await fail(ctx, error);
  }
}

// Mensajes de la conversación de rechazo. Devuelve false si la cuenta no tiene una sesión de este formulario.
export async function handleReviewUpdate(ctx: Context, deps: ReviewDeps, actor: Actor, accountId: string): Promise<boolean> {
  const stored = await loadBotSession(deps.db(), accountId);
  const session = parseSession(stored?.data);
  if (!session) return false;
  if (isCancelCommand(ctx)) {
    await clear(deps, accountId);
    await send(ctx, es.review.cancelled);
    return true;
  }
  if (isExpired(session, deps.now())) {
    await clear(deps, accountId);
    await send(ctx, es.review.sessionExpired);
    return true;
  }
  if (session.step !== "reason") {
    await send(ctx, es.common.useButtons);
    return true;
  }
  const id = session.draft!.versionId!;
  const isCommand = ctx.message?.entities?.some((entity) => entity.type === "bot_command" && entity.offset === 0) ?? false;
  const reason = isCommand ? null : normalizeReason(ctx.message?.text);
  if (reason === null) {
    await send(ctx, es.review.reasonInvalid, new InlineKeyboard().text(es.review.cancel, `${CANCEL}${id}`));
    return true;
  }
  try {
    const review = await findReview(deps, actor, id);
    if (!review) {
      await clear(deps, accountId);
      await send(ctx, es.review.alreadyDecided);
      return true;
    }
    await begin(deps, accountId, "confirm_reject", { versionId: id, reason });
    await send(ctx, es.review.confirmReject(review.proposed.content.name, reason), confirmKeyboard(CONFIRM_REJECT, es.review.yesReject, id));
  } catch (error) {
    if (error instanceof SessionConflictError) throw error;
    await fail(ctx, error);
  }
  return true;
}

// ---- B12: mis fichas del prestador (solo lectura) -----------------------------------------------------------------

export const MY_LISTINGS = "ml:l";
export const isMyListingsCallback = (data: string | undefined): data is string => data === MY_LISTINGS;

// El estado y, en la rechazada, el motivo escrito por el administrador; con el botón que abre la Mini App. Crear y editar es
// de la Mini App (D-002). Los servicios aplican la regla "solo lo suyo" (invariante 2).
export async function showMyListings(ctx: Context, deps: ReviewDeps, actor: Actor): Promise<void> {
  const base = deps.config().appBaseUrl;
  const keyboard = base ? new InlineKeyboard().webApp(es.myListings.open, `${base}/fichas`) : undefined;
  const page = await listManagedListings(deps.db(), deps.config(), actor, new URLSearchParams({ pageSize: "50" }));
  if (page.items.length === 0) return void (await send(ctx, es.myListings.empty, keyboard));
  await send(ctx, es.myListings.title, keyboard);
  for (const item of page.items) {
    const lines = [es.myListings.line(item.name, es.myListings.statuses[item.displayStatus])];
    // Con versión publicada (F015) el estado de la edición no oculta la ficha: la línea dice que la publicada sigue visible.
    // Una edición rechazada se muestra como `published`; su motivo está en `lastRejection`.
    if (item.displayStatus === "rejected" || (item.hasPublishedVersion && item.displayStatus === "published")) {
      const reason = (await getManagedListing(deps.db(), deps.config(), actor, item.id)).lastRejection?.reason;
      if (reason) lines.push(es.myListings.reason(reason));
      if (reason && item.hasPublishedVersion) lines.push(es.myListings.stillVisible);
    } else if (item.hasPublishedVersion) lines.push(es.myListings.stillVisible);
    await send(ctx, lines.join("\n"));
  }
}
