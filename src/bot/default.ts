import type { Bot } from "grammy";
import { defaultDeps } from "@/server/http/deps";
import { createBot } from "./bot";
import { createWebhookHandler } from "./webhook";

let bot: Promise<Bot> | undefined;

// Un bot por instancia de la función; grammY consulta getMe una vez al arrancar.
function getBot(): Promise<Bot> {
  bot ??= (async () => {
    const instance = createBot(defaultDeps.config().botToken, defaultDeps);
    await instance.init();
    return instance;
  })().catch((error) => {
    bot = undefined;
    throw error;
  });
  return bot;
}

export const webhookPost = createWebhookHandler({ secret: () => defaultDeps.config().webhookSecret, bot: getBot });
