import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { assertConsented } from "@/server/auth/consent-guard";
import type { Config } from "@/server/config";
import { bogotaToday, RECEIPT_NOTICE, validateInformationRequest } from "@/server/domain/information-request";
import { AppError } from "@/server/errors";
import { getConsentState } from "./consent";
import { uuidPattern } from "./managed-listings";
import { consumeRateLimit } from "./rate-limit";
import type { Db } from "./types";

export type InformationRequestReceipt = components["schemas"]["InformationRequestReceipt"];

export const INFORMATION_REQUEST_ACTION = "information_request";
// Plantilla de la alerta al prestador (B14, F031) en `notification_outbox`.
export const TEMPLATE_INFORMATION_REQUEST = "information_request_received";

const notFound = () => new AppError("not_found", 404, "Ficha no encontrada", undefined, { detail: "No encontramos esa ficha." });
const notAccepting = () =>
  new AppError("listing_not_accepting_requests", 409, "La ficha no recibe solicitudes", undefined, { detail: "Esta ficha ya no recibe solicitudes." });

const pgCode = (error: unknown): string | undefined => (error as { code?: unknown } | null)?.code as string | undefined;
const pgMessage = (error: unknown): string => String((error as { message?: unknown } | null)?.message ?? "");

// POST /api/v1/public/listings/{listingId}/information-requests (createInformationRequest, F030). La solicitud nace en `new`,
// dirigida al negocio de la ficha (nunca al que diga el cuerpo, invariante 1). Orden: aviso vigente, límite de intentos
// (cuenta toda petición con aviso vigente, también las que terminan en 422; D-183), validación, ficha, inserción. Lo escrito por
// el visitante nunca sale en un error ni en un registro (sección 3.15). Sin pagos ni reservas (invariante 5). La alerta al prestador
// dueño del negocio se encola en la misma transacción (ADR 0007); `onQueued` recibe los ids para enviarla con `after()` (F031).
export async function createInformationRequest(
  db: Db,
  config: Config,
  actor: Actor,
  listingId: string,
  rawInput: unknown,
  now: Date = new Date(),
  onQueued?: (notificationIds: string[]) => void,
): Promise<InformationRequestReceipt> {
  const state = await getConsentState(db, actor.telegramUserId);
  assertConsented(state);
  const account = state.account!;

  await consumeRateLimit(db, account.id, INFORMATION_REQUEST_ACTION, config.rateLimits[INFORMATION_REQUEST_ACTION], now);

  const { errors, value } = validateInformationRequest(rawInput, bogotaToday(now));
  if (!value) throw new AppError("validation_failed", 422, "Datos inválidos", errors);

  if (!uuidPattern.test(listingId)) throw notFound();
  // Ficha, versión publicada y rol vigente del prestador, leídos en el momento de crear (el bot no confía en su sesión).
  const row = await db
    .selectFrom("listings as l")
    .leftJoin("businesses as b", "b.id", "l.business_id")
    .leftJoin("accounts as pa", "pa.id", "b.provider_account_id")
    .select((eb) => [
      "l.business_id",
      "pa.telegram_user_id as provider_telegram_id",
      eb
        .selectFrom("listing_versions as pv")
        .select("pv.name")
        .whereRef("pv.listing_id", "=", "l.id")
        .where("pv.status", "=", "published")
        .limit(1)
        .as("listing_name"),
      eb
        .exists(eb.selectFrom("listing_versions as v").select("v.id").whereRef("v.listing_id", "=", "l.id").where("v.status", "=", "published"))
        .as("published"),
      eb
        .exists(
          eb
            .selectFrom("role_grants as g")
            .select("g.id")
            .whereRef("g.telegram_user_id", "=", "pa.telegram_user_id")
            .where("g.role", "=", "provider")
            .where("g.revoked_at", "is", null),
        )
        .as("provider_active"),
    ])
    .where("l.id", "=", listingId)
    .executeTakeFirst();
  if (!row || !row.published) throw notFound();
  if (!row.business_id || !row.provider_active) throw notAccepting();

  const businessId = row.business_id;
  try {
    const created = await db.transaction().execute(async (trx) => {
      const request = await trx
        .insertInto("information_requests")
        .values({
          listing_id: listingId,
          business_id: businessId,
          visitor_account_id: account.id,
          requester_name: value.requesterName,
          interest_date: value.interestDate,
          party_size: value.partySize,
          message: value.message,
          created_at: now,
          updated_at: now,
        })
        .returning(["id", "status", "created_at"])
        .executeTakeFirstOrThrow();
      const alert = await trx
        .insertInto("notification_outbox")
        .values({
          recipient_telegram_user_id: String(row.provider_telegram_id),
          template: TEMPLATE_INFORMATION_REQUEST,
          // Sin número de identidad ni datos del visitante fuera de lo que ve el prestador (invariante 7).
          payload: JSON.stringify({
            requestId: request.id,
            listingName: row.listing_name ?? "",
            requesterName: value.requesterName,
            interestDate: value.interestDate,
            partySize: value.partySize,
            message: value.message,
          }),
          created_at: now,
          next_attempt_at: null,
          sent_at: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { request, alertId: alert.id };
    });
    onQueued?.([created.alertId]);
    const { request } = created;
    return { id: request.id, status: "new", createdAt: request.created_at.toISOString(), notice: RECEIPT_NOTICE };
  } catch (error) {
    // Carrera con una revocación o un cambio de la ficha entre la lectura y la inserción: el disparador es la última defensa.
    if (pgCode(error) === "P0001") {
      const reason = pgMessage(error);
      if (reason === "listing_not_published") throw notFound();
      if (reason === "listing_not_accepting_requests") throw notAccepting();
    }
    throw error;
  }
}
