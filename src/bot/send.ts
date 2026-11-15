import type { Context, InlineKeyboard } from "grammy";

// Sin parse_mode: el texto se envía plano (ADR 0006). Responde al chat de la actualización.
export function send(ctx: Context, text: string, keyboard?: InlineKeyboard) {
  return ctx.api.sendMessage(ctx.chatId ?? ctx.from!.id, text, keyboard ? { reply_markup: keyboard } : undefined);
}
