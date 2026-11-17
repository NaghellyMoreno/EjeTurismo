import type { Context, InlineKeyboard } from "grammy";

// Sin parse_mode: el texto se envía plano (ADR 0006). Responde al chat de la actualización.
export function send(ctx: Context, text: string, keyboard?: InlineKeyboard) {
  return ctx.api.sendMessage(ctx.chatId ?? ctx.from!.id, text, keyboard ? { reply_markup: keyboard } : undefined);
}

// Con parse_mode HTML: el llamador entrega el texto ya escapado (ADR 0006). Solo para el aviso de privacidad (D-143).
export function sendHtml(ctx: Context, html: string, keyboard?: InlineKeyboard) {
  return ctx.api.sendMessage(ctx.chatId ?? ctx.from!.id, html, { parse_mode: "HTML", ...(keyboard ? { reply_markup: keyboard } : {}) });
}
