import { Bot, type Context, InlineKeyboard } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { displayNameOf } from "@/server/auth/init-data";
import { buildNoticeMessages } from "@/server/domain/notice";
import { AppError } from "@/server/errors";
import { logError } from "@/server/observability/logger";
import { acceptPrivacyNotice, claimUpdate, getConsentState } from "@/server/services";
import type { Db, PrivacyNotice } from "@/server/services";
import type { Config } from "@/server/config";
import { handleAccountUpdate, showAccountMenu } from "./forms/provider-registration";
import { handleSelfRevokeCallback, parseSelfRevokeCallback, SELF_REVOKE_ASK, withSelfRevoke } from "./self-revoke";
import { AccountGoneError, SessionConflictError } from "./common";
import { send } from "./send";
import { es } from "./texts/es";

export interface BotDeps {
  db: () => Db;
  config: () => Config;
  now: () => Date;
}

// callback_data (máximo 64 bytes): solo identifica la acción; nunca autoriza nada (ADR 0006).
const ACCEPT = "consent:accept:";
const DECLINE = "consent:decline";
const SHOW_AGAIN = "consent:show";

export function createBot(token: string, deps: BotDeps, options: { botInfo?: UserFromGetMe } = {}): Bot {
  const bot = new Bot(token, options);
  // handleUpdate (webhook) no usa bot.catch: el error se atrapa aquí para avisar sin datos técnicos (ADR 0008, HU-027).
  bot.use(async (ctx) => {
    try {
      await handle(ctx, deps);
    } catch (error) {
      // El choque de sesión es esperable: se pide repetir el paso y no se registra como fallo (ADR 0015, D-085).
      if (error instanceof SessionConflictError) return void (await send(ctx, es.common.sessionConflict).catch(() => undefined));
      logError("bot.handler_failed", error);
      await send(ctx, es.errors.generic).catch(() => undefined);
    }
  });
  return bot;
}

// B01: el aviso en 3 mensajes (D-066); "Acepto" y "No acepto" solo en el último. Una cuenta con una versión anterior ve además,
// al final del último mensaje, la frase de D-023 y el botón "Revocar mi autorización" en otra fila (F036, D-133, D-141).
async function showNotice(ctx: Context, notice: PrivacyNotice, hasAccount = false) {
  const [first, second, third] = buildNoticeMessages(notice);
  await send(ctx, first);
  await send(ctx, second);
  const keyboard = new InlineKeyboard().text(es.notice.accept, `${ACCEPT}${notice.version}`).text(es.notice.decline, DECLINE);
  if (hasAccount) keyboard.row().text(es.selfRevoke.button, SELF_REVOKE_ASK);
  await send(ctx, hasAccount ? withSelfRevoke(third) : third, keyboard);
}

async function handle(ctx: Context, deps: BotDeps): Promise<void> {
  // El actor sale solo de `from.id` de una actualización ya autenticada por el secreto del webhook; nunca de `chat.id`.
  const from = ctx.from;
  if (!from || from.is_bot) return;
  const actor = { telegramUserId: String(from.id), displayName: displayNameOf(from) };
  const db = deps.db();
  const callbackData = ctx.callbackQuery?.data;
  const acknowledge = async () => {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
  };

  const state = await getConsentState(db, actor.telegramUserId);

  if (state.accepted) {
    // Solo las cuentas con el aviso vigente escriben en processed_updates (ADR 0008).
    if (!(await claimUpdate(db, ctx.update.update_id))) return;
    await acknowledge();
    try {
      await handleAccountUpdate(ctx, deps, actor, state.account!.id);
      return;
    } catch (error) {
      // Revocación repetida o simultánea: la cuenta ya no existe, así que se muestra el aviso y no se ejecuta nada más.
      if (!(error instanceof AccountGoneError)) throw error;
      await showNotice(ctx, state.notice!);
      return;
    }
  }

  // Sin cuenta o con una versión anterior (D-039): todo mensaje o botón recibe el aviso y no se escribe nada más.
  if (!state.notice) throw new Error("No hay un aviso de privacidad vigente");

  const hasAccount = !!state.account;
  // B03 con una versión anterior del aviso (ADR 0005): se puede revocar sin aceptar la nueva. Es el único botón que se atiende;
  // sin cuenta no hay nada que revocar. No escribe en processed_updates y "Cancelar" vuelve a mostrar el aviso (F036, P9).
  if (hasAccount && callbackData !== undefined && parseSelfRevokeCallback(callbackData)) {
    await acknowledge();
    try {
      // Con una versión anterior `getMe` no informa roles: el texto de confirmación es el común (P4).
      const info = { roles: [], isPrincipalAdmin: false, registrationStatus: null };
      await handleSelfRevokeCallback(ctx, deps, actor, info, callbackData, () => showNotice(ctx, state.notice!, true));
      return;
    } catch (error) {
      // Revocación repetida o simultánea: la cuenta ya no existe y se muestra el aviso sin el botón (D-039).
      if (!(error instanceof AccountGoneError)) throw error;
      await showNotice(ctx, state.notice);
      return;
    }
  }

  if (callbackData?.startsWith(ACCEPT)) {
    try {
      await acceptPrivacyNotice(db, actor, { noticeVersion: callbackData.slice(ACCEPT.length), channel: "bot" }, deps.now(), deps.config());
      await acknowledge();
      // Recién aceptada: B02 con el botón de registro si no tiene rol ni registro (D-074).
      const accepted = await getConsentState(db, actor.telegramUserId);
      await showAccountMenu(ctx, deps, actor, accepted.account!.id);
      return;
    } catch (error) {
      // Botón de un aviso viejo: no crea nada y se muestra el aviso vigente.
      if (!(error instanceof AppError && error.code === "notice_version_outdated")) throw error;
    }
  } else if (callbackData === DECLINE) {
    await acknowledge();
    await send(ctx, es.decline.text, new InlineKeyboard().text(es.decline.showAgain, SHOW_AGAIN));
    return;
  }

  await acknowledge();
  await showNotice(ctx, state.notice, hasAccount);
}
