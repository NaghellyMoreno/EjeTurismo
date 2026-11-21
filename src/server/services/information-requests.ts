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

const notFound = () => new AppError("not_found", 404, "Ficha no encontrada", undefined, { detail: "No encontramos esa ficha." });
const notAccepting = () =>
  new AppError("listing_not_accepting_requests", 409, "La ficha no recibe solicitudes", undefined, { detail: "Esta ficha ya no recibe solicitudes." });

const pgCode = (error: unknown): string | undefined => (error as { code?: unknown } | null)?.code as string | undefined;
const pgMessage = (error: unknown): string => String((error as { message?: unknown } | null)?.message ?? "");

// POST /api/v1/public/listings/{listingId}/information-requests (createInformationRequest, F030). La solicitud nace en `new`,
// dirigida al negocio de la ficha (nunca al que diga el cuerpo, invariante 1). Orden: aviso vigente, límite de intentos
// (cuenta toda petición con aviso vigente, también las que terminan en 422; D-183), validación, ficha, inserción. Lo escrito por
// el visitante nunca sale en un error ni en un registro (sección 3.15). Sin pagos ni reservas (invariante 5).
export async function createInformationRequest(
  db: Db,
  config: Config,
  actor: Actor,
  listingId: string,
  rawInput: unknown,
  now: Date = new Date(),
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

  try {
    const created = await db
      .insertInto("information_requests")
      .values({
        listing_id: listingId,
        business_id: row.business_id,
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
    return { id: created.id, status: "new", createdAt: created.created_at.toISOString(), notice: RECEIPT_NOTICE };
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
