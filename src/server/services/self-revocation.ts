import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { es } from "@/bot/texts/es";
import { AppError, type FieldError } from "@/server/errors";
import type { Channel } from "./consent";
import type { Db } from "./types";

export type RevocationResult = components["schemas"]["RevocationResult"];

function validate(raw: unknown): FieldError[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return [{ field: "body", code: "invalid_format", message: "Revisa los datos enviados." }];
  }
  const body = raw as Record<string, unknown>;
  const errors: FieldError[] = Object.keys(body)
    .filter((key) => key !== "confirmed")
    .map((key) => ({ field: key, code: "invalid_format", message: "Este campo no se admite." }));
  if (body.confirmed !== true) errors.push({ field: "confirmed", code: "required", message: "Debes confirmar la operación." });
  return errors;
}

const noAccount = () => new AppError("forbidden", 403, "Sin cuenta");

// POST /consents/revocations (F034, cuenta sin rol activo; F035 cubre las cuentas con rol). Una sola transacción:
// escribe la prueba `revoked` (sin ningún identificador de la persona, D-036), borra la cuenta (la cascada borra sesión,
// contadores y registro de prestador con su número cifrado) y borra los permisos con su ID de Telegram.
// Orden: 401 en la ruta; 403 sin cuenta; 422; 409 `has_active_role`. No exige la versión vigente del aviso (ADR 0005).
export async function revokeMyAuthorization(
  db: Db,
  config: Config,
  actor: Actor,
  rawBody: unknown,
  channel: Channel,
  now: Date = new Date(),
): Promise<RevocationResult> {
  // Sin cuenta, 403 antes que 422.
  const exists = await db.selectFrom("accounts").select("id").where("telegram_user_id", "=", actor.telegramUserId).executeTakeFirst();
  if (!exists) throw noAccount();
  const errors = validate(rawBody);
  if (errors.length > 0) throw new AppError("validation_failed", 422, "Datos inválidos", errors);

  await db.transaction().execute(async (trx) => {
    // Bloqueo de la fila: dos revocaciones simultáneas se atienden una tras otra y la segunda ya no encuentra la cuenta.
    const account = await trx
      .selectFrom("accounts")
      .select(["id", "consent_notice_version"])
      .where("telegram_user_id", "=", actor.telegramUserId)
      .forUpdate()
      .executeTakeFirst();
    if (!account) throw noAccount();

    const active = await trx
      .selectFrom("role_grants")
      .select("id")
      .where("telegram_user_id", "=", actor.telegramUserId)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    if (active || config.principalAdminTelegramId === actor.telegramUserId) {
      throw new AppError("has_active_role", 409, "Rol activo", undefined, { detail: es.selfRevoke.activeRole });
    }

    await trx
      .insertInto("consent_events")
      .values({ event: "revoked", channel, notice_version: account.consent_notice_version, occurred_at: now })
      .execute();
    await trx.deleteFrom("role_grants").where("telegram_user_id", "=", actor.telegramUserId).execute();
    await trx.deleteFrom("accounts").where("id", "=", account.id).execute();
  });

  return { revokedAt: now.toISOString(), message: es.selfRevoke.revoked };
}
