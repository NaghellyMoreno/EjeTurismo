import { Api, GrammyError } from "grammy";
import { after } from "next/server";
import { attendData } from "@/bot/callback-ids";
import { es } from "@/bot/texts/es";
import { REQUEST_PROVIDER_REVOKED_TEXT, REQUEST_WITHDRAWN_TEXT } from "@/server/domain/request-revocation-notices";
import { renderInformationRequestAlert } from "@/server/domain/information-request-alert";
import { renderInformationRequestReply } from "@/server/domain/information-request-reply";
import type { Config } from "@/server/config";
import { logError } from "@/server/observability/logger";
import { TEMPLATE_INFORMATION_REQUEST } from "@/server/services/information-requests";
import { TEMPLATE_INFORMATION_REQUEST_REPLY } from "@/server/services/provider-requests";
import { TEMPLATE_LISTING_APPROVED, TEMPLATE_LISTING_REJECTED } from "@/server/services/listing-review";
import { TEMPLATE_APPROVED, TEMPLATE_REJECTED } from "@/server/services/provider-review";
import { TEMPLATE_REQUEST_PROVIDER_REVOKED, TEMPLATE_REQUEST_WITHDRAWN } from "@/server/services/self-revocation";
import type { Db } from "@/server/services";

// Envío de los avisos de `notification_outbox` (ADR 0007). Las filas se crean dentro de la transacción de la operación;
// aquí se envían después de responder (`after()`). Ningún mensaje lleva tipo, número de identidad ni ID de Telegram (invariante 7);
// el rechazo de una ficha lleva el motivo que el administrador escribió para el prestador (F014, P1).

// `extra` lleva el teclado en línea de las alertas que lo tienen (B14); los avisos de F003 y F014 no lo usan.
export interface SendExtra {
  reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] };
}
export type Sender = (chatId: string, text: string, extra?: SendExtra) => Promise<unknown>;

export interface NotifyDeps {
  db: () => Db;
  now: () => Date;
  send: Sender;
}

// Inferido: ADR 0007 no fija el intervalo; un fallo de Telegram se vuelve a intentar una hora después (D-093: sin cron todavía).
export const RETRY_DELAY_MS = 60 * 60 * 1000;

type Payload = {
  listingName?: string;
  reason?: string;
  isEdit?: boolean;
  requestId?: string;
  requesterName?: string;
  interestDate?: string;
  partySize?: number;
  message?: string;
  replyId?: string;
  replyBody?: string;
} | null;
const alertText = (p: Payload) =>
  renderInformationRequestAlert({
    listingName: p?.listingName ?? "",
    requesterName: p?.requesterName ?? "",
    interestDate: p?.interestDate ?? "",
    partySize: p?.partySize ?? 0,
    message: p?.message ?? "",
  });

const TEXTS: Record<string, (payload: Payload) => string> = {
  [TEMPLATE_APPROVED]: () => es.provider.approved,
  [TEMPLATE_REJECTED]: () => es.provider.rejected,
  [TEMPLATE_LISTING_APPROVED]: (p) => (p?.isEdit ? es.provider.editApproved : es.provider.listingApproved)(p?.listingName ?? ""),
  [TEMPLATE_INFORMATION_REQUEST]: alertText,
  [TEMPLATE_INFORMATION_REQUEST_REPLY]: (p) => renderInformationRequestReply(p?.listingName ?? "", p?.replyBody ?? ""),
  [TEMPLATE_REQUEST_WITHDRAWN]: () => REQUEST_WITHDRAWN_TEXT,
  [TEMPLATE_REQUEST_PROVIDER_REVOKED]: () => REQUEST_PROVIDER_REVOKED_TEXT,
  [TEMPLATE_LISTING_REJECTED]: (p) => (p?.isEdit ? es.provider.editRejected : es.provider.listingRejected)(p?.listingName ?? "", p?.reason ?? ""),
};

// Solo la alerta de solicitud lleva botón; `callback_data` identifica la solicitud, nunca autoriza (ADR 0006).
const extraFor = (template: string, p: Payload): SendExtra | undefined =>
  template === TEMPLATE_INFORMATION_REQUEST && p?.requestId
    ? { reply_markup: { inline_keyboard: [[{ text: es.informationRequest.attendButton, callback_data: attendData(p.requestId) }]] } }
    : undefined;

// Telegram responde 403 cuando la persona bloqueó el bot: no se reintenta.
const isBlocked = (error: unknown) => error instanceof GrammyError && error.error_code === 403;

// Envía las filas pendientes dadas y registra el resultado. Nunca lanza: un fallo de envío no deshace la operación.
export async function deliverNotifications(ids: string[], deps: NotifyDeps): Promise<void> {
  if (ids.length === 0) return;
  const db = deps.db();
  const rows = await db
    .selectFrom("notification_outbox")
    .select(["id", "recipient_telegram_user_id", "template", "attempts", "payload"])
    .where("id", "in", ids)
    .where("status", "=", "pending")
    .execute();
  for (const row of rows) {
    const render = TEXTS[row.template];
    const now = deps.now();
    try {
      if (!render) throw new Error("plantilla_desconocida");
      let payload = row.payload as Payload;
      // B20 (F032): la bandeja no guarda el texto de la respuesta; se lee de su tabla al enviar.
      if (row.template === TEMPLATE_INFORMATION_REQUEST_REPLY) {
        const reply = payload?.replyId
          ? await db.selectFrom("information_request_replies").select("body").where("id", "=", payload.replyId).executeTakeFirst()
          : undefined;
        if (!reply) throw new Error("respuesta_no_encontrada");
        payload = { ...payload, replyBody: reply.body };
      }
      const extra = extraFor(row.template, payload);
      const chatId = String(row.recipient_telegram_user_id);
      if (extra) await deps.send(chatId, render(payload), extra);
      else await deps.send(chatId, render(payload));
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
  return (chatId, text, extra) => api.sendMessage(chatId, text, extra);
}
