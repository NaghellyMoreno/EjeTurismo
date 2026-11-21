import { type Context, InlineKeyboard } from "grammy";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { bogotaToday, checkMessage, checkRequesterName, formatBotDate, parseBotDate, parsePartySize } from "@/server/domain/information-request";
import { AppError } from "@/server/errors";
import { logError } from "@/server/observability/logger";
import { scheduleDelivery } from "@/server/notifications";
import { claimBotSession, clearBotSession, createInformationRequest, getPublishedListing, loadBotSession, saveBotSession } from "@/server/services";
import type { Db } from "@/server/services";
import { pack, REQUEST_PREFIX, REQUEST_START, unpack } from "./callback-ids";
import { isCancelCommand, SessionConflictError } from "./common";
import { showListingDetail } from "./listing-detail";
import { send } from "./send";
import { es } from "./texts/es";

// B19 (F030): formulario de solicitud de información como máquina de estado sobre `bot_sessions` (ADR 0015). Nada toca la tabla de
// solicitudes hasta "Confirmar"; ahí el servicio vuelve a verificar aviso, ficha y rol del prestador (invariante 1).
const USE_NAME = "ir:n:y";
const CHANGE_NAME = "ir:n:c";
const CONFIRM = "ir:ok";
const CANCEL = "ir:x";

const FORM = "information_request";
const STEPS = ["name_choice", "name", "date", "party", "message", "confirm"] as const;
type Step = (typeof STEPS)[number];

interface Session {
  form: typeof FORM;
  step: Step;
  listingId: string;
  listingName: string;
  // Lo que sigue al último ":" del "Volver" de B16 (`<origen><página>`); permite regresar al mismo detalle al cancelar.
  backSuffix: string;
  draft: { name?: string; date?: string; partySize?: number; message?: string };
  startedAt: string;
}

export interface InformationRequestDeps {
  db: () => Db;
  config: () => Config;
  now: () => Date;
}

export const isInformationRequestCallback = (data: string | undefined): data is string =>
  data !== undefined && (data.startsWith(REQUEST_PREFIX) || data.startsWith(REQUEST_START));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SUFFIX = /^[ge]?[1-9][0-9]{0,5}$/;

// Sesión de este formulario con forma válida; cualquier otra cosa (otro formulario, datos forjados) es nula.
function parseSession(data: unknown): Session | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = data as Partial<Session>;
  if (raw.form !== FORM || !STEPS.includes(raw.step as Step)) return null;
  if (typeof raw.listingId !== "string" || !UUID.test(raw.listingId) || typeof raw.listingName !== "string") return null;
  if (typeof raw.backSuffix !== "string" || !SUFFIX.test(raw.backSuffix) || !raw.draft || typeof raw.draft !== "object") return null;
  return raw as Session;
}

const cancelRow = (keyboard = new InlineKeyboard()) => keyboard.text(es.informationRequest.cancelButton, CANCEL);
const withCancel = () => cancelRow();
const choiceKeyboard = () => cancelRow(new InlineKeyboard().text(es.informationRequest.useName, USE_NAME).text(es.informationRequest.changeName, CHANGE_NAME).row());
const confirmKeyboard = () => new InlineKeyboard().text(es.informationRequest.confirmButton, CONFIRM).text(es.informationRequest.cancelButton, CANCEL);

const promptOf = (session: Session): { text: string; keyboard: InlineKeyboard } => {
  const t = es.informationRequest;
  switch (session.step) {
    case "name_choice": return { text: t.proposeName(session.draft.name ?? ""), keyboard: choiceKeyboard() };
    case "name": return { text: t.askName, keyboard: withCancel() };
    case "date": return { text: t.askDate, keyboard: withCancel() };
    case "party": return { text: t.askParty, keyboard: withCancel() };
    case "message": return { text: t.askMessage, keyboard: withCancel() };
    case "confirm":
      return {
        text: t.summary({
          listing: session.listingName,
          name: session.draft.name ?? "",
          date: formatBotDate(session.draft.date ?? ""),
          partySize: session.draft.partySize ?? 0,
          message: session.draft.message ?? "",
        }),
        keyboard: confirmKeyboard(),
      };
  }
};

const reply = async (ctx: Context, text: string) => {
  await send(ctx, text);
  return true;
};

const repeat = async (ctx: Context, session: Session) => {
  await showStep(ctx, session);
  return true;
};

const showStep = (ctx: Context, session: Session) => {
  const { text, keyboard } = promptOf(session);
  return send(ctx, text, keyboard);
};

// Vuelve a B16 de la ficha (siempre, también al cancelar); si ya no está publicada, avisa que la opción no está disponible.
async function showListing(ctx: Context, deps: InformationRequestDeps, actor: Actor, session: Session) {
  try {
    const detail = await getPublishedListing(deps.db(), actor, session.listingId, deps.now());
    await showListingDetail(ctx, detail, `exp:b:${pack(session.listingId)}:${session.backSuffix}`);
  } catch (error) {
    if (!(error instanceof AppError && error.code === "not_found")) throw error;
    await send(ctx, es.explore.stale);
  }
}

// Atiende la actualización de una cuenta con el aviso vigente si pertenece a B19. Devuelve falso si no le toca.
// Una orden distinta de /cancelar durante el formulario lo abandona y la atiende el resto del bot.
export async function handleInformationRequestUpdate(ctx: Context, deps: InformationRequestDeps, actor: Actor, accountId: string): Promise<boolean> {
  const callback = ctx.callbackQuery?.data;
  if (callback !== undefined && !isInformationRequestCallback(callback)) return false;
  if (callback === undefined && ctx.message === undefined) return false;

  const db = deps.db();
  const now = deps.now();
  const stored = await loadBotSession(db, accountId);
  const session = parseSession(stored?.data);
  const save = async (next: Session) => {
    if (!(await saveBotSession(db, accountId, next, stored?.updatedAt ?? null, now))) throw new SessionConflictError();
  };

  const t = es.informationRequest;
  const text = ctx.message?.text;

  if (callback === undefined) {
    if (!session) return false;
    if (isCancelCommand(ctx)) return cancel(ctx, deps, actor, accountId, session, now);
    if (text?.startsWith("/")) {
      await clearBotSession(db, accountId, now);
      return false;
    }
    return advance(ctx, session, text, now, save);
  }

  if (callback.startsWith(REQUEST_START)) {
    const parts = callback.slice(REQUEST_START.length).split(":");
    const listingId = parts.length === 2 && SUFFIX.test(parts[1]) ? unpack(parts[0]) : null;
    if (!listingId) return reply(ctx, t.expired);
    return start(ctx, deps, actor, listingId, parts[1], save);
  }

  if (callback === CANCEL) {
    if (!session) return reply(ctx, t.expired);
    return cancel(ctx, deps, actor, accountId, session, now);
  }

  if (callback === CONFIRM) {
    if (!session) return reply(ctx, t.alreadySent);
    if (session.step !== "confirm") return repeat(ctx, session);
    return confirm(ctx, deps, actor, accountId, session, stored!.updatedAt, now);
  }

  if (callback === USE_NAME || callback === CHANGE_NAME) {
    if (!session) return reply(ctx, t.expired);
    if (session.step !== "name_choice") return repeat(ctx, session);
    const next: Session = { ...session, step: callback === USE_NAME ? "date" : "name" };
    await save(next);
    await showStep(ctx, next);
    return true;
  }

  // Botón de este formulario que no se reconoce (callback_data alterado o de otra versión).
  await send(ctx, t.expired);
  return true;
}

async function start(ctx: Context, deps: InformationRequestDeps, actor: Actor, listingId: string, backSuffix: string, save: (next: Session) => Promise<void>): Promise<boolean> {
  let detail;
  try {
    detail = await getPublishedListing(deps.db(), actor, listingId, deps.now());
  } catch (error) {
    if (!(error instanceof AppError && error.code === "not_found")) throw error;
    await send(ctx, es.informationRequest.unavailable);
    return true;
  }
  if (!detail.acceptsRequests) {
    await send(ctx, es.informationRequest.unavailable);
    return true;
  }
  // D-010: el nombre de la cuenta de Telegram se propone y se puede cambiar. Sin nombre utilizable, se pide directamente.
  const proposed = actor.displayName && checkRequesterName(actor.displayName) === null ? actor.displayName.trim() : null;
  const session: Session = {
    form: FORM,
    step: proposed ? "name_choice" : "name",
    listingId,
    listingName: detail.name,
    backSuffix,
    draft: proposed ? { name: proposed } : {},
    startedAt: deps.now().toISOString(),
  };
  // Reemplaza cualquier sesión anterior sin copiar su borrador.
  await save(session);
  await showStep(ctx, session);
  return true;
}

async function cancel(ctx: Context, deps: InformationRequestDeps, actor: Actor, accountId: string, session: Session, now: Date): Promise<boolean> {
  await clearBotSession(deps.db(), accountId, now);
  await send(ctx, es.informationRequest.cancelled);
  await showListing(ctx, deps, actor, session);
  return true;
}

// Texto escrito durante el formulario. Una entrada inválida recibe un solo mensaje que la rechaza y vuelve a pedir el dato.
async function advance(ctx: Context, session: Session, text: string | undefined, now: Date, save: (next: Session) => Promise<void>): Promise<boolean> {
  const t = es.informationRequest;
  const reject = (message: string) => send(ctx, message, withCancel());
  const next = async (step: Step, draft: Session["draft"]) => {
    const updated: Session = { ...session, step, draft: { ...session.draft, ...draft } };
    await save(updated);
    await showStep(ctx, updated);
  };

  // Donde el paso espera botones, el texto no avanza: se repite el paso.
  if (session.step === "name_choice" || session.step === "confirm") {
    await send(ctx, es.common.useButtons);
    await showStep(ctx, session);
    return true;
  }
  if (session.step === "name") {
    if (text === undefined || checkRequesterName(text) !== null) await reject(t.nameInvalid);
    else await next("date", { name: text.trim() });
  } else if (session.step === "date") {
    const date = text === undefined ? null : parseBotDate(text);
    if (date === null) await reject(t.dateInvalid);
    else if (date < bogotaToday(now)) await reject(t.datePast);
    else await next("party", { date });
  } else if (session.step === "party") {
    const size = text === undefined ? null : parsePartySize(text);
    if (size === null) await reject(t.partyInvalid);
    else await next("message", { partySize: size });
  } else {
    if (text === undefined || checkMessage(text) !== null) await reject(t.messageInvalid);
    else await next("confirm", { message: text.trim() });
  }
  return true;
}

async function confirm(ctx: Context, deps: InformationRequestDeps, actor: Actor, accountId: string, session: Session, loadedAt: Date, now: Date): Promise<boolean> {
  const t = es.informationRequest;
  const db = deps.db();
  const { name, date, partySize, message } = session.draft;
  if (name === undefined || date === undefined || partySize === undefined || message === undefined) {
    await clearBotSession(db, accountId, now);
    await send(ctx, t.expired);
    return true;
  }
  // Un solo "Confirmar" gana: se reclama (vacía) la sesión con bloqueo optimista antes de crear. El segundo toque no llega al servicio,
  // así que no hay segunda solicitud ni nuevo consumo del límite de intentos.
  if (!(await claimBotSession(db, accountId, FORM, loadedAt, now))) {
    await send(ctx, t.alreadySent);
    return true;
  }
  try {
    await createInformationRequest(db, deps.config(), actor, session.listingId, { requesterName: name, interestDate: date, partySize, message, confirmed: true }, now, (ids) =>
      scheduleDelivery(ids, { db: deps.db, now: deps.now, send: (chatId, text, extra) => ctx.api.sendMessage(chatId, text, extra) }),
    );
    await send(ctx, t.sent);
  } catch (error) {
    if (error instanceof AppError && error.code === "rate_limited") await send(ctx, t.rateLimited);
    else if (error instanceof AppError && (error.code === "listing_not_accepting_requests" || error.code === "not_found")) await send(ctx, t.unavailable);
    else if (error instanceof AppError && error.code === "validation_failed") await send(ctx, t.expired);
    else {
      // Fallo inesperado: se intenta devolver la sesión para reintentar. Nada de lo escrito se registra (sección 3.15).
      logError("information_request.confirm_failed", error);
      await saveBotSession(db, accountId, session, now, now).catch(() => undefined);
      await send(ctx, t.error);
    }
  }
  return true;
}
