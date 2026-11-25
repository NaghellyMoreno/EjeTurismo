import type { Transformer } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { createBot, type BotDeps } from "@/bot/bot";
import { es } from "@/bot/texts/es";
import { testConfig } from "./config";
import { appDb } from "./db";

export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

const BOT_INFO: UserFromGetMe = {
  id: 123456,
  is_bot: true,
  first_name: "Eje Turismo Prueba",
  username: "eje_turismo_prueba_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

// Bot real con la API de Telegram interceptada: ninguna llamada sale a la red (ADR 0008).
export function createTestBot(deps?: Partial<BotDeps>) {
  const calls: ApiCall[] = [];
  const db = appDb();
  const bot = createBot("123456:TEST-bot-token", { db: () => db, config: () => testConfig(), now: () => new Date(), ...deps }, { botInfo: BOT_INFO });
  const intercept: Transformer = async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: method === "sendMessage" ? { message_id: calls.length, date: 0, chat: { id: 1, type: "private" } } : true } as never;
  };
  bot.api.config.use(intercept);
  return {
    bot,
    db,
    calls,
    send: (update: unknown) => bot.handleUpdate(update as Update),
    messages: () => calls.filter((c) => c.method === "sendMessage"),
    texts: () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text)),
    clear: () => void (calls.length = 0),
  };
}

type Button = { text: string; callback_data?: string };
export function buttonsOf(payload: Record<string, unknown>): string[] {
  const markup = payload.reply_markup as { inline_keyboard?: Button[][] } | undefined;
  return (markup?.inline_keyboard ?? []).flat().map((b) => b.text);
}

// F034: el menú de una cuenta sin rol lleva la frase de D-023 al final (y el botón de revocar); el estado pendiente, igual.
export const noRoleMenu = `${es.menu.welcome}\n\n${es.selfRevoke.note}`;
// F035: el menú de administrador y el de prestador también llevan la frase y el botón de revocar la autorización.
export const adminMenu = noRoleMenu;
export const ADMIN_MENU_BUTTONS = [es.admin.pendingButton, es.menu.reviews, es.menu.history, es.admin.authorizeButton, es.revoke.button, es.menu.exploreButton, es.selfRevoke.button];
// F014: el menú del prestador agrega "Mis fichas" antes de "Revocar mi autorización".
export const PROVIDER_MENU_BUTTONS = [es.menu.myListings, es.menu.exploreButton, es.selfRevoke.button];
// D-204: el prestador ya no recibe el aviso provisional de F003 después del menú; se conserva para comprobar que no vuelve.
export const retiredProviderNotice = "Ya tienes el rol de prestador. Las opciones de prestador estarán disponibles pronto.";
export const providerMenu = [noRoleMenu];
export const pendingMenu = `${es.provider.pending}\n\n${es.selfRevoke.note}`;
