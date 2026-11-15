import { Api, GrammyError } from "grammy";
import { after } from "next/server";
import { es } from "@/bot/texts/es";
import type { Config } from "@/server/config";
import { logError } from "@/server/observability/logger";
import { TEMPLATE_APPROVED, TEMPLATE_REJECTED } from "@/server/services/provider-review";
import type { Db } from "@/server/services";

// Envío de los avisos de `notification_outbox` (ADR 0007). Las filas se crean dentro de la transacción de la operación;
// aquí se envían después de responder (`after()`). Los mensajes no llevan tipo, número ni motivo (invariante 7).

export type Sender = (chatId: string, text: string) => Promise<unknown>;

export interface NotifyDeps {
  db: () => Db;
  now: () => Date;
  send: Sender;
}

// Inferido: ADR 0007 no fija el intervalo; un fallo de Telegram se vuelve a intentar una hora después (D-093: sin cron todavía).
export const RETRY_DELAY_MS = 60 * 60 * 1000;

const TEXTS: Record<string, string> = {
  [TEMPLATE_APPROVED]: es.provider.approved,
  [TEMPLATE_REJECTED]: es.provider.rejected,
};

// Telegram responde 403 cuando la persona bloqueó el bot: no se reintenta.
const isBlocked = (error: unknown) => error instanceof GrammyError && error.error_code === 403;

// Envía las filas pendientes dadas y registra el resultado. Nunca lanza: un fallo de envío no deshace la operación.
export async function deliverNotifications(ids: string[], deps: NotifyDeps): Promise<void> {
  if (ids.length === 0) return;
  const db = deps.db();
  const rows = await db
    .selectFrom("notification_outbox")
    .select(["id", "recipient_telegram_user_id", "template", "attempts"])
    .where("id", "in", ids)
    .where("status", "=", "pending")
    .execute();
  for (const row of rows) {
    const text = TEXTS[row.template];
    const now = deps.now();
    try {
      if (!text) throw new Error("plantilla_desconocida");
      await deps.send(String(row.recipient_telegram_user_id), text);
      await db
        .updateTable("notification_outbox")
        .set({ status: "sent", attempts: row.attempts + 1, next_attempt_at: null, sent_at: now })
        .where("id", "=", row.id)
        .where("status", "=", "pending")
        .execute();
    } catch (error) {
      logError("notification.delivery_failed", error);
      const blocked = isBlocked(error);
      await db
        .updateTable("notification_outbox")
        .set({
          status: blocked ? "failed" : "pending",
          attempts: row.attempts + 1,
          next_attempt_at: blocked ? null : new Date(now.getTime() + RETRY_DELAY_MS),
        })
        .where("id", "=", row.id)
        .where("status", "=", "pending")
        .execute()
        .catch((e) => logError("notification.update_failed", e));
    }
  }
}

// Registra el envío con `after()`; fuera de un contexto de petición (por ejemplo, un script) lo lanza sin esperar.
export function scheduleDelivery(ids: string[], deps: NotifyDeps): void {
  if (ids.length === 0) return;
  const run = () => deliverNotifications(ids, deps).catch((error) => logError("notification.schedule_failed", error));
  try {
    after(run);
  } catch {
    void run();
  }
}

// Remitente real: la API de Telegram con el token del bot.
export function telegramSender(config: Config): Sender {
  const api = new Api(config.botToken);
  return (chatId, text) => api.sendMessage(chatId, text);
}
