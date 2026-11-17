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

type Block = "principal_admin_protected" | "last_admin_protected";

const BLOCKS: Record<Block, { title: string; detail: string }> = {
  principal_admin_protected: { title: "Administrador principal", detail: es.selfRevoke.principalProtected },
  last_admin_protected: { title: "Último administrador", detail: es.selfRevoke.lastAdminProtected },
};

const blockError = (code: Block) => new AppError(code, 409, BLOCKS[code].title, undefined, { detail: BLOCKS[code].detail });

// Regla de F035 (D-020, D-032): el principal (por configuración o por fila) no revoca; tampoco el único administrador activo
// (misma regla de F006: una sola fila activa con `role = admin`). Si es principal y único, prevalece el principal.
// Con `lock`, bloquea las filas de administradores activos en el orden de `role-revocation.ts` (por `id`) y las del propio ID.
async function findBlock(db: Db, config: Config, telegramUserId: string, lock: boolean): Promise<Block | null> {
  const admins = db.selectFrom("role_grants").select(["id", "telegram_user_id", "is_principal"]).where("role", "=", "admin").where("revoked_at", "is", null).orderBy("id");
  const rows = await (lock ? admins.forUpdate() : admins).execute();
  const mine = rows.filter((row) => String(row.telegram_user_id) === telegramUserId);
  if (config.principalAdminTelegramId === telegramUserId || mine.some((row) => row.is_principal)) return "principal_admin_protected";
  if (mine.length > 0 && rows.length <= 1) return "last_admin_protected";
  return null;
}

// Consulta previa del bot (sin bloquear): el motivo por el que esta cuenta no puede revocar, o nulo.
export const getSelfRevocationBlock = (db: Db, config: Config, actor: Actor) => findBlock(db, config, actor.telegramUserId, false);

// POST /consents/revocations (F034 y F035). Una sola transacción: escribe la prueba `revoked` (sin ningún identificador de la
// persona, D-036), borra los avisos pendientes dirigidos a su ID, borra la cuenta (la cascada borra sesión, contadores y registro
// de prestador con su número cifrado) y borra todos los permisos con su ID de Telegram (prestador, administrador o ambos).
// Orden: 401 en la ruta; 403 sin cuenta; 422; 409 `principal_admin_protected`, luego `last_admin_protected`.
// No exige la versión vigente del aviso (ADR 0005).
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

    // Administradores activos bloqueados en el mismo orden que "Revocar rol" (F006): dos administradores que revocan a la vez
    // no dejan al sistema sin ninguno. Los permisos propios restantes también se bloquean.
    const block = await findBlock(trx, config, actor.telegramUserId, true);
    if (block) throw blockError(block);
    await trx.selectFrom("role_grants").select("id").where("telegram_user_id", "=", actor.telegramUserId).where("revoked_at", "is", null).forUpdate().execute();

    await trx
      .insertInto("consent_events")
      .values({ event: "revoked", channel, notice_version: account.consent_notice_version, occurred_at: now })
      .execute();
    await trx.deleteFrom("notification_outbox").where("recipient_telegram_user_id", "=", actor.telegramUserId).execute();
    await trx.deleteFrom("role_grants").where("telegram_user_id", "=", actor.telegramUserId).execute();
    await trx.deleteFrom("accounts").where("id", "=", account.id).execute();
  });

  return { revokedAt: now.toISOString(), message: es.selfRevoke.revoked };
}
