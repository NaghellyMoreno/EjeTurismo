import { Bot, type Context, InlineKeyboard } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { displayNameOf } from "@/server/auth/init-data";
import { buildNoticeMessages } from "@/server/domain/notice";
import { AppError } from "@/server/errors";
import { logError } from "@/server/observability/logger";
import { acceptPrivacyNotice, claimUpdate, getConsentState } from "@/server/services";
import type { Db, PrivacyNotice } from "@/server/services";
import { es } from "./texts/es";

export interface BotDeps {
  db: () => Db;
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
      logError("bot.handler_failed", error);
      await send(ctx, es.errors.generic).catch(() => undefined);
    }
  });
  return bot;
}

async function send(ctx: Context, text: string, keyboard?: InlineKeyboard) {
  // Sin parse_mode: el texto se envía plano (ADR 0006).
  return ctx.api.sendMessage(ctx.chatId ?? ctx.from!.id, text, keyboard ? { reply_markup: keyboard } : undefined);
}

// B01: el aviso en 3 mensajes (D-066); "Acepto" y "No acepto" solo en el último.
async function showNotice(ctx: Context, notice: PrivacyNotice) {
  const [first, second, third] = buildNoticeMessages(notice);
  await send(ctx, first);
  await send(ctx, second);
  await send(
    ctx,
    third,
    new InlineKeyboard().text(es.notice.accept, `${ACCEPT}${notice.version}`).text(es.notice.decline, DECLINE),
  );
}

const showMenu = (ctx: Context) => send(ctx, es.menu.welcome);

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
    await showMenu(ctx);
    return;
  }

  // Sin cuenta o con una versión anterior (D-039): todo mensaje o botón recibe el aviso y no se escribe nada más.
  if (!state.notice) throw new Error("No hay un aviso de privacidad vigente");

  if (callbackData?.startsWith(ACCEPT)) {
    try {
      await acceptPrivacyNotice(db, actor, { noticeVersion: callbackData.slice(ACCEPT.length), channel: "bot" }, deps.now());
      await acknowledge();
      await showMenu(ctx);
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
  await showNotice(ctx, state.notice);
}
