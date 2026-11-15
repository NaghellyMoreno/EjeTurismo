import { createHash, timingSafeEqual } from "node:crypto";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { internalError, problem } from "@/server/http/problem";
import { logError } from "@/server/observability/logger";

export const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export interface WebhookOptions {
  secret: () => string;
  bot: () => Promise<Bot>;
}

// Comparación en tiempo constante sobre resúmenes del mismo largo.
function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

// POST /api/v1/telegram/webhook (ADR 0003 y 0008). Sin el secreto correcto responde 401 sin tocar el bot ni la base.
// Con el secreto correcto siempre responde 200, incluso con cuerpos que no sirven, para que Telegram no los reenvíe.
export function createWebhookHandler(options: WebhookOptions) {
  return async (request: Request): Promise<Response> => {
    let expected: string;
    try {
      expected = options.secret();
    } catch (error) {
      logError("webhook.config_failed", error);
      return internalError();
    }
    if (!sameSecret(request.headers.get(SECRET_HEADER) ?? "", expected)) {
      return problem(401, "unauthenticated", "No pudimos verificar el origen de la petición.");
    }

    let update: unknown;
    try {
      update = JSON.parse(await request.text());
    } catch {
      return Response.json({ ok: true });
    }
    const updateId = (update as { update_id?: unknown } | null)?.update_id;
    if (typeof updateId !== "number" || !Number.isSafeInteger(updateId)) return Response.json({ ok: true });

    try {
      const bot = await options.bot();
      await bot.handleUpdate(update as Update);
    } catch (error) {
      logError("webhook.update_failed", error);
    }
    return Response.json({ ok: true });
  };
}
