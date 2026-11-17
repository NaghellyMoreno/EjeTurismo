import { type Context, InlineKeyboard } from "grammy";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { AppError } from "@/server/errors";
import { logError } from "@/server/observability/logger";
import {
  authorizeAdministrator,
  clearBotSession,
  loadBotSession,
  saveBotSession,
  TELEGRAM_USER_ID_PATTERN,
} from "@/server/services";
import type { Db } from "@/server/services";
import { isCancelCommand, SessionConflictError } from "../common";
import { send } from "../send";
import { es } from "../texts/es";

// B08: autorizar administradores, formulario de dos pasos sobre `bot_sessions` (ADR 0015, D-111). El borrador guarda solo el
// ID escrito. `callback_data` identifica la acción y nunca autoriza nada: el rol se lee de la base en cada operación.
export const AUTH_PREFIX = "auth:";
export const AUTH_START = "auth:start";
const AUTH_CONFIRM = "auth:confirm";
const AUTH_CANCEL = "auth:cancel";

const FORM = "authorize_admin";

interface Session {
  form?: typeof FORM;
  step?: "id" | "confirm";
  draft?: { telegramUserId?: string };
  startedAt?: string;
  expiresAt?: string;
}

export interface AuthorizeDeps {
  db: () => Db;
  config: () => Config;
  now: () => Date;
}

export const isAuthCallback = (data: string | undefined): data is string => data !== undefined && data.startsWith(AUTH_PREFIX);

// Sesión de este formulario con forma válida; cualquier otra cosa (otro formulario, datos forjados) es nula.
function parseSession(data: unknown): Session | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = data as Session;
  return raw.form === FORM && (raw.step === "id" || raw.step === "confirm") ? raw : null;
}

// Sesión de este formulario con forma válida (la usa el bot para negar el paso siguiente a quien ya no es administrador).
export const isAuthorizeAdminSession = (data: unknown): boolean => parseSession(data) !== null;

const idKeyboard = () => new InlineKeyboard().text(es.adminAuth.cancelButton, AUTH_CANCEL);
const confirmKeyboard = () =>
  new InlineKeyboard().text(es.adminAuth.confirmButton, AUTH_CONFIRM).text(es.adminAuth.cancelButton, AUTH_CANCEL);

const isExpired = (session: Session, now: Date) => !session.expiresAt || now.getTime() >= new Date(session.expiresAt).getTime();

// Atiende la actualización de un administrador si pertenece a B08. Devuelve false si no le toca (el llamador sigue con el menú).
// El llamador ya comprobó que la cuenta es administradora; `authorizeAdministrator` lo vuelve a verificar contra la base.
export async function handleAuthorizeUpdate(ctx: Context, deps: AuthorizeDeps, actor: Actor, accountId: string): Promise<boolean> {
  const db = deps.db();
  const now = deps.now();
  const callback = ctx.callbackQuery?.data;
  if (callback !== undefined && !isAuthCallback(callback)) return false;
  if (callback !== undefined && callback !== AUTH_START && callback !== AUTH_CONFIRM && callback !== AUTH_CANCEL) {
    await send(ctx, es.admin.error);
    return true;
  }

  const stored = await loadBotSession(db, accountId);
  const session = parseSession(stored?.data);
  if (callback === undefined && !session) return false;

  const save = async (next: Session) => {
    if (!(await saveBotSession(db, accountId, next, stored?.updatedAt ?? null, now))) throw new SessionConflictError();
  };
  const begin = async () => {
    // Reemplaza cualquier sesión anterior sin copiar su borrador (D-111).
    const expiresAt = new Date(now.getTime() + deps.config().sensitiveDraftTtlSeconds * 1000);
    await save({ form: FORM, step: "id", draft: {}, startedAt: now.toISOString(), expiresAt: expiresAt.toISOString() });
    await send(ctx, es.adminAuth.askId, idKeyboard());
  };

  if (callback === AUTH_START) {
    await begin();
    return true;
  }

  if (callback === AUTH_CANCEL || (callback === undefined && isCancelCommand(ctx))) {
    if (session) await clearBotSession(db, accountId, now);
    await send(ctx, es.adminAuth.cancelled);
    return true;
  }

  if (callback === AUTH_CONFIRM) {
    const id = session?.draft?.telegramUserId;
    if (!session) {
      await send(ctx, es.adminAuth.noDraft);
    } else if (isExpired(session, now) || (session.step === "confirm" && (typeof id !== "string" || !TELEGRAM_USER_ID_PATTERN.test(id)))) {
      // Vencida o forjada: no hay nada por confirmar y la sesión se descarta (criterios 29 y 38).
      await clearBotSession(db, accountId, now);
      await send(ctx, es.adminAuth.noDraft);
    } else if (session.step === "id") {
      await send(ctx, es.adminAuth.askId, idKeyboard());
    } else {
      await confirm(ctx, deps, actor, accountId, id as string);
    }
    return true;
  }

  // Mensaje de texto o de otro tipo con una sesión de B08 abierta.
  if (!session) return false;
  if (session.step === "confirm" && !isExpired(session, now)) {
    await send(ctx, es.common.useButtons);
    return true;
  }
  if (session.step === "id" && !isExpired(session, now)) {
    const text = ctx.message?.text;
    const id = text?.trim();
    if (id === undefined || !TELEGRAM_USER_ID_PATTERN.test(id)) {
      await send(ctx, es.adminAuth.idInvalid, idKeyboard());
      return true;
    }
    const expiresAt = new Date(now.getTime() + deps.config().sensitiveDraftTtlSeconds * 1000);
    await save({ ...session, step: "confirm", draft: { telegramUserId: id }, expiresAt: expiresAt.toISOString() });
    await send(ctx, es.adminAuth.confirm(id), confirmKeyboard());
    return true;
  }
  // Sesión vencida: se inicia de nuevo.
  await begin();
  return true;
}

async function confirm(ctx: Context, deps: AuthorizeDeps, actor: Actor, accountId: string, id: string): Promise<void> {
  const db = deps.db();
  const now = deps.now();
  try {
    await authorizeAdministrator(db, deps.config(), actor, { telegramUserId: id, confirmed: true }, now);
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "forbidden" || error.code === "consent_required") return void (await send(ctx, es.admin.forbidden));
      if (error.code === "duplicate" || error.code === "role_conflict") {
        await clearBotSession(db, accountId, now);
        return void (await send(ctx, error.code === "duplicate" ? es.adminAuth.alreadyAdmin : es.adminAuth.conflict));
      }
    }
    // Cualquier otro fallo conserva el borrador para reintentar hasta que venza.
    logError("admin_authorization.confirm_failed", error);
    return void (await send(ctx, es.adminAuth.error));
  }
  await clearBotSession(db, accountId, now);
  await send(ctx, es.adminAuth.authorized(id));
}
