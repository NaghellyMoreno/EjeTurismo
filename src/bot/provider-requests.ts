import { type Context, InlineKeyboard } from "grammy";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { checkReplyBody } from "@/server/domain/information-request-reply";
import { TELEGRAM_TEXT_LIMIT, clip } from "@/server/domain/information-request-alert";
import { formatBotDate } from "@/server/domain/information-request";
import { AppError } from "@/server/errors";
import { scheduleDelivery } from "@/server/notifications";
import { logError } from "@/server/observability/logger";
import {
  changeInformationRequestStatus,
  claimBotSession,
  clearBotSession,
  getInformationRequest,
  listMyBusinessInformationRequests,
  loadBotSession,
  replyToInformationRequest,
  saveBotSession,
} from "@/server/services";
import type { Db, InformationRequest, InformationRequestStatus } from "@/server/services";
import { formatBogotaShort } from "@/lib/time";
import { pack, REQUEST_ATTEND, unpack } from "./callback-ids";
import { isCancelCommand, SessionConflictError } from "./common";
import { send } from "./send";
import { es } from "./texts/es";

// B13 (F032): solicitudes de información del prestador (lista, detalle, responder y estados). `callback_data` solo identifica la
// acción y la solicitud (máximo 64 bytes); nunca autoriza nada: el rol y el dueño del negocio se verifican en los servicios en
// cada pulsación (invariante 1, ADR 0006). La respuesta en curso vive en `bot_sessions` (ADR 0015); los cambios de estado
// piden confirmación con un botón y no guardan nada hasta pulsarlo (invariante 8).
export const REQUESTS_PREFIX = "rq:";
export const REQUESTS_PAGE_SIZE = 8;
const LIST = "rq:l:";
const OPEN = "rq:o:";
const REPLY = "rq:r:";
const ASK_ATTENDED = "rq:sa:";
const ASK_CLOSED = "rq:sc:";
const DO_ATTENDED = "rq:ya:";
const DO_CLOSED = "rq:yc:";
const CANCEL_STATUS = "rq:x";
const CANCEL_REPLY = "rq:xr";
const SEND_REPLY = "rq:ok";
const BACK_TO_LIST = "rq:b";
const BACK_TO_MENU = "rq:m";

// Filtro y página de la lista: una letra y el número de página. `Todas` en la primera página es la entrada normal.
const FILTERS = { t: undefined, n: "new", a: "attended", c: "closed" } as const;
type FilterKey = keyof typeof FILTERS;
export const MY_REQUESTS = `${LIST}t1`;
export const SOLICITUDES_COMMAND = "/solicitudes";

const FORM = "information_request_reply";
type ReplyStep = "text" | "confirm";
interface Session {
  form: typeof FORM;
  step: ReplyStep;
  requestId: string;
  body?: string;
  startedAt: string;
}

export interface ProviderRequestsDeps {
  db: () => Db;
  config: () => Config;
  now: () => Date;
}

export const isProviderRequestsCallback = (data: string | undefined): data is string =>
  data !== undefined && (data.startsWith(REQUESTS_PREFIX) || data.startsWith(REQUEST_ATTEND));

// `/solicitudes` solo o con el nombre del propio bot (`/solicitudes@MiBot`).
export function isRequestsCommand(ctx: Context): boolean {
  const text = ctx.message?.text;
  if (text === undefined) return false;
  if (text === SOLICITUDES_COMMAND) return true;
  return text.startsWith(`${SOLICITUDES_COMMAND}@`) && text.slice(SOLICITUDES_COMMAND.length + 1).toLowerCase() === ctx.me.username.toLowerCase();
}

type Parsed =
  | { action: "list"; filter: FilterKey; page: number }
  | { action: "open" | "reply" | "askAttended" | "askClosed" | "doAttended" | "doClosed" | "attend"; id: string }
  | { action: "cancelStatus" | "cancelReply" | "sendReply" | "backToList" | "backToMenu" };

const ID_ACTIONS: [string, Extract<Parsed, { id: string }>["action"]][] = [
  [OPEN, "open"], [REPLY, "reply"], [ASK_ATTENDED, "askAttended"], [ASK_CLOSED, "askClosed"],
  [DO_ATTENDED, "doAttended"], [DO_CLOSED, "doClosed"], [REQUEST_ATTEND, "attend"],
];
const SIMPLE: Record<string, "cancelStatus" | "cancelReply" | "sendReply" | "backToList" | "backToMenu"> = {
  [CANCEL_STATUS]: "cancelStatus", [CANCEL_REPLY]: "cancelReply", [SEND_REPLY]: "sendReply", [BACK_TO_LIST]: "backToList", [BACK_TO_MENU]: "backToMenu",
};

// Nulo si la acción es desconocida o el identificador no es uno empaquetado válido (truncado, mal formado o forjado).
export function parseRequestsCallback(data: string): Parsed | null {
  if (Buffer.byteLength(data) > 64) return null;
  if (SIMPLE[data]) return { action: SIMPLE[data] } as Parsed;
  if (data.startsWith(LIST)) {
    const match = /^([tnac])([1-9][0-9]{0,5})$/.exec(data.slice(LIST.length));
    return match ? { action: "list", filter: match[1] as FilterKey, page: Number(match[2]) } : null;
  }
  for (const [prefix, action] of ID_ACTIONS) {
    if (data.startsWith(prefix)) {
      const id = unpack(data.slice(prefix.length));
      return id ? ({ action, id } as Parsed) : null;
    }
  }
  return null;
}

function parseSession(data: unknown): Session | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = data as Partial<Session>;
  if (raw.form !== FORM || (raw.step !== "text" && raw.step !== "confirm") || typeof raw.requestId !== "string") return null;
  if (raw.step === "confirm" && typeof raw.body !== "string") return null;
  return raw as Session;
}

const t = es.providerRequests;
const label = (status: InformationRequestStatus) => t.statuses[status];

// Divide un texto en mensajes de a lo más 4096 caracteres, por líneas y, si una línea sola no cabe, en trozos.
function splitText(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current !== "") chunks.push(current);
    current = "";
  };
  for (const line of text.split("\n")) {
    for (let rest = line; ; ) {
      const piece = rest.slice(0, TELEGRAM_TEXT_LIMIT);
      rest = rest.slice(piece.length);
      const next = current === "" ? piece : `${current}\n${piece}`;
      if (next.length > TELEGRAM_TEXT_LIMIT) {
        push();
        current = piece;
      } else current = next;
      if (rest === "") break;
      push();
    }
  }
  push();
  return chunks;
}

const detailText = (r: InformationRequest): string => {
  const lines = [
    t.detailTitle,
    `Ficha: ${r.listingName}`,
    `Estado: ${label(r.status)}`,
    `Nombre: ${r.requesterName}`,
    `Fecha de interés: ${formatBotDate(r.interestDate)}`,
    `Personas: ${r.partySize}`,
    `Mensaje: ${r.message}`,
  ];
  if (r.replies.length > 0) lines.push(t.repliesTitle, ...r.replies.map((reply) => `${formatBogotaShort(new Date(reply.sentAt))} ${reply.body}`));
  if (r.statusHistory.length > 0) {
    lines.push(
      t.historyTitle,
      ...r.statusHistory.map((e) => `${formatBogotaShort(new Date(e.occurredAt))} ${t.historyChange(label(e.fromStatus ?? "new"), label(e.toStatus))}`),
    );
  }
  return lines.join("\n");
};

async function showDetail(ctx: Context, request: InformationRequest) {
  const keyboard = new InlineKeyboard();
  if (request.status !== "closed") keyboard.text(t.replyButton, `${REPLY}${pack(request.id)}`).row();
  if (request.status === "new") keyboard.text(t.markAttendedButton, `${ASK_ATTENDED}${pack(request.id)}`).row();
  if (request.status === "attended") keyboard.text(t.markClosedButton, `${ASK_CLOSED}${pack(request.id)}`).row();
  keyboard.text(t.back, BACK_TO_LIST);
  const chunks = splitText(detailText(request));
  for (const [index, chunk] of chunks.entries()) await send(ctx, chunk, index === chunks.length - 1 ? keyboard : undefined);
}

async function showList(ctx: Context, deps: ProviderRequestsDeps, actor: Actor, filter: FilterKey, page: number) {
  const status = FILTERS[filter];
  const params = new URLSearchParams({ page: String(page), pageSize: String(REQUESTS_PAGE_SIZE), ...(status ? { status } : {}) });
  const result = await listMyBusinessInformationRequests(deps.db(), actor, params);
  const keyboard = new InlineKeyboard();
  for (const [key, name] of [["t", t.filters.all], ["n", t.filters.new], ["a", t.filters.attended], ["c", t.filters.closed]] as const) {
    keyboard.text(name, `${LIST}${key}1`);
  }
  keyboard.row();
  for (const item of result.items) {
    keyboard.text(`${label(item.status)} · ${clip(item.requesterName, 40)} · ${formatBotDate(item.interestDate)}`, `${OPEN}${pack(item.id)}`).row();
  }
  if (page * REQUESTS_PAGE_SIZE < result.total) keyboard.text(t.more, `${LIST}${filter}${page + 1}`).row();
  keyboard.text(t.back, BACK_TO_MENU);
  await send(ctx, result.items.length === 0 ? (status ? t.emptyFiltered : t.empty) : t.listTitle, keyboard);
}

// Traduce el error de un servicio al texto del bot; el detalle técnico solo va al registro (sin datos personales).
async function fail(ctx: Context, error: unknown, target?: InformationRequestStatus): Promise<void> {
  if (error instanceof AppError) {
    if (error.code === "forbidden" || error.code === "consent_required") return void (await send(ctx, t.noAccess));
    if (error.code === "invalid_state_transition") {
      return void (await send(ctx, target === "attended" ? t.alreadyAttended : target === "closed" ? t.alreadyClosed : t.closed));
    }
  }
  logError("provider_requests.callback_failed", error);
  await send(ctx, es.errors.generic);
}

// Atiende la actualización de un prestador (el llamador ya comprobó el rol con la base; los servicios lo vuelven a verificar).
// Devuelve falso si no le toca. `showMenu` muestra B12 (destino de "Volver" desde la lista, D-190).
export async function handleProviderRequestsUpdate(
  ctx: Context,
  deps: ProviderRequestsDeps,
  actor: Actor,
  accountId: string,
  showMenu: () => Promise<void>,
): Promise<boolean> {
  const db = deps.db();
  const now = deps.now();
  const callback = ctx.callbackQuery?.data;
  const stored = await loadBotSession(db, accountId);
  const session = parseSession(stored?.data);
  const save = async (next: Session) => {
    if (!(await saveBotSession(db, accountId, next, stored?.updatedAt ?? null, now))) throw new SessionConflictError();
  };
  const dropSession = async () => {
    if (session) await clearBotSession(db, accountId, now);
  };

  if (callback === undefined) {
    const text = ctx.message?.text;
    if (isRequestsCommand(ctx)) {
      await dropSession();
      await showList(ctx, deps, actor, "t", 1).catch((error) => fail(ctx, error));
      return true;
    }
    if (!session) return false;
    if (isCancelCommand(ctx)) {
      await clearBotSession(db, accountId, now);
      await send(ctx, t.cancelled);
      return true;
    }
    if (text?.startsWith("/")) {
      await clearBotSession(db, accountId, now);
      return false;
    }
    if (ctx.message === undefined) return false;
    if (session.step === "confirm") {
      await send(ctx, es.common.useButtons);
      await send(ctx, t.replySummary(session.body ?? ""), summaryKeyboard());
      return true;
    }
    if (text === undefined || checkReplyBody(text) !== null) {
      await send(ctx, t.replyInvalid);
      return true;
    }
    const body = text.trim();
    await save({ ...session, step: "confirm", body });
    await send(ctx, t.replySummary(body), summaryKeyboard());
    return true;
  }

  const parsed = parseRequestsCallback(callback);
  if (!parsed) {
    await send(ctx, es.errors.generic);
    return true;
  }

  try {
    switch (parsed.action) {
      case "list":
        await showList(ctx, deps, actor, parsed.filter, parsed.page);
        return true;
      case "backToList":
        await showList(ctx, deps, actor, "t", 1);
        return true;
      case "backToMenu":
        await showMenu();
        return true;
      case "open":
      case "attend":
        await showDetail(ctx, await getInformationRequest(db, actor, parsed.id));
        return true;
      case "reply": {
        const request = await getInformationRequest(db, actor, parsed.id);
        if (request.status === "closed") return await reply(ctx, t.closed);
        await save({ form: FORM, step: "text", requestId: request.id, startedAt: now.toISOString() });
        await send(ctx, t.askReply, new InlineKeyboard().text(t.cancelButton, CANCEL_REPLY));
        return true;
      }
      case "askAttended":
      case "askClosed": {
        const target = parsed.action === "askAttended" ? "attended" : "closed";
        const request = await getInformationRequest(db, actor, parsed.id);
        if (request.status === "closed") return await reply(ctx, t.alreadyClosed);
        if (target === "attended" && request.status !== "new") return await reply(ctx, t.alreadyAttended);
        const yes = `${target === "attended" ? DO_ATTENDED : DO_CLOSED}${pack(request.id)}`;
        await send(ctx, target === "attended" ? t.confirmAttended : t.confirmClosed, new InlineKeyboard().text(t.confirmButton, yes).text(t.cancelButton, CANCEL_STATUS));
        return true;
      }
      case "doAttended":
      case "doClosed": {
        const target = parsed.action === "doAttended" ? "attended" : "closed";
        try {
          const changed = await changeInformationRequestStatus(db, actor, parsed.id, { status: target, confirmed: true }, now);
          await send(ctx, target === "attended" ? t.markedAttended : t.markedClosed);
          await showDetail(ctx, changed);
        } catch (error) {
          await fail(ctx, error, target);
        }
        return true;
      }
      case "cancelStatus":
        return await reply(ctx, t.cancelled);
      case "cancelReply":
        await dropSession();
        return await reply(ctx, t.cancelled);
      case "sendReply":
        return await sendReply(ctx, deps, actor, accountId, session, stored?.updatedAt ?? null, now);
    }
  } catch (error) {
    if (error instanceof SessionConflictError) throw error;
    await fail(ctx, error);
    return true;
  }
}

const reply = async (ctx: Context, text: string) => {
  await send(ctx, text);
  return true;
};

const summaryKeyboard = () => new InlineKeyboard().text(t.sendButton, SEND_REPLY).text(t.cancelButton, CANCEL_REPLY);

// "Enviar": un solo toque gana (se reclama la sesión con bloqueo optimista antes de crear); el servicio vuelve a verificar rol,
// dueño y que la solicitud no esté cerrada, y guarda la respuesta junto con la fila de la bandeja en una transacción (ADR 0007).
async function sendReply(ctx: Context, deps: ProviderRequestsDeps, actor: Actor, accountId: string, session: Session | null, loadedAt: Date | null, now: Date): Promise<boolean> {
  if (!session || session.step !== "confirm" || session.body === undefined || loadedAt === null) return reply(ctx, t.replyNotInProgress);
  const db = deps.db();
  if (!(await claimBotSession(db, accountId, FORM, loadedAt, now))) return reply(ctx, t.replyNotInProgress);
  try {
    await replyToInformationRequest(db, actor, session.requestId, { body: session.body, confirmed: true }, now, (ids) =>
      scheduleDelivery(ids, { db: deps.db, now: deps.now, send: (chatId, text, extra) => ctx.api.sendMessage(chatId, text, extra) }),
    );
    return await reply(ctx, t.replySent);
  } catch (error) {
    if (error instanceof AppError && error.code === "validation_failed") return reply(ctx, t.replyInvalid);
    if (!(error instanceof AppError)) {
      // Fallo inesperado: se intenta devolver el borrador para reintentar. Nada de lo escrito se registra (sección 3.15).
      await saveBotSession(db, accountId, session, now, now).catch(() => undefined);
    }
    await fail(ctx, error);
    return true;
  }
}
