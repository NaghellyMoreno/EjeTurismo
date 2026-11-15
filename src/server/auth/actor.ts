// Quien actúa en una operación. Sale de `update.from.id` (bot, ya autenticado por el secreto del webhook) o de
// `initData` validado (API); nunca de `chat_id` ni del texto de un mensaje (invariante 1; ADR 0003).
export interface Actor {
  telegramUserId: string;
  displayName: string | null;
}
