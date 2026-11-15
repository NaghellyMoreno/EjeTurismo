import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { AppError, type FieldError } from "@/server/errors";
import { assertAdmin } from "./provider-review";
import type { Db } from "./types";

export type RoleGrant = components["schemas"]["RoleGrant"];

export const ADMIN_AUTHORIZED_ACTION = "role_grant.admin_authorized";

// Mismo patrón de `TelegramUserId` en api/openapi.yaml (D-107).
export const TELEGRAM_USER_ID_PATTERN = /^[1-9][0-9]{0,15}$/;

const KNOWN_FIELDS = new Set(["telegramUserId", "confirmed"]);

function validate(raw: unknown): { errors: FieldError[]; telegramUserId?: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: [{ field: "body", code: "invalid_format", message: "Revisa los datos enviados." }] };
  }
  const body = raw as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const key of Object.keys(body)) {
    if (!KNOWN_FIELDS.has(key)) errors.push({ field: key, code: "invalid_format", message: "Este campo no se admite." });
  }
  if (body.confirmed !== true) errors.push({ field: "confirmed", code: "required", message: "Debes confirmar la operación." });
  const id = body.telegramUserId;
  if (id === undefined || id === "") errors.push({ field: "telegramUserId", code: "required", message: "Escribe el ID de Telegram." });
  else if (typeof id !== "string" || !TELEGRAM_USER_ID_PATTERN.test(id)) {
    errors.push({ field: "telegramUserId", code: "invalid_format", message: "El ID de Telegram solo lleva dígitos." });
  }
  return { errors, telegramUserId: errors.length === 0 ? (id as string) : undefined };
}

const pgCode = (error: unknown): string | undefined => (error as { code?: unknown } | null)?.code as string | undefined;

const duplicate = () =>
  new AppError("duplicate", 409, "Duplicado", undefined, { detail: "Ese ID ya está autorizado como administrador." });
const roleConflict = () =>
  new AppError("role_conflict", 409, "Conflicto de roles", undefined, {
    detail: "Ese ID ya tiene un rol de prestador o un registro de prestador pendiente, y no puede ser administrador.",
  });

// Autoriza el ID de Telegram de otra persona como administrador: una sola transacción (permiso y traza).
// Orden (D-108): 401 en la ruta; 403 `consent_required` y `forbidden`; 422; 409 `duplicate`; 409 `role_conflict`.
// La traza no lleva el ID autorizado ni nombres (D-105).
export async function authorizeAdministrator(
  db: Db,
  config: Config,
  actor: Actor,
  rawBody: unknown,
  now: Date = new Date(),
): Promise<RoleGrant> {
  const admin = await assertAdmin(db, config, actor);
  const { errors, telegramUserId } = validate(rawBody);
  if (errors.length > 0 || telegramUserId === undefined) throw new AppError("validation_failed", 422, "Datos inválidos", errors);
  if (config.principalAdminTelegramId === telegramUserId) throw duplicate();

  try {
    return await db.transaction().execute(async (trx) => {
      const activeAdmin = await trx
        .selectFrom("role_grants")
        .select("id")
        .where("telegram_user_id", "=", telegramUserId)
        .where("role", "=", "admin")
        .where("revoked_at", "is", null)
        .executeTakeFirst();
      if (activeAdmin) throw duplicate();

      const activeProvider = await trx
        .selectFrom("role_grants")
        .select("id")
        .where("telegram_user_id", "=", telegramUserId)
        .where("role", "=", "provider")
        .where("revoked_at", "is", null)
        .executeTakeFirst();
      const pending = await trx
        .selectFrom("provider_registrations as r")
        .innerJoin("accounts as a", "a.id", "r.account_id")
        .select("r.id")
        .where("a.telegram_user_id", "=", telegramUserId)
        .where("r.status", "=", "pending")
        .executeTakeFirst();
      if (activeProvider || pending) throw roleConflict();

      const grant = await trx
        .insertInto("role_grants")
        .values({
          telegram_user_id: telegramUserId,
          role: "admin",
          is_principal: false,
          provider_registration_id: null,
          granted_by_account_id: admin.id,
          granted_at: now,
          revoked_at: null,
          revoked_by_account_id: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("audit_events")
        .values({
          occurred_at: now,
          actor_account_id: admin.id,
          actor_role: "admin",
          action: ADMIN_AUTHORIZED_ACTION,
          entity_type: "role_grant",
          entity_id: grant.id,
        })
        .execute();
      const person = await trx.selectFrom("accounts").select("telegram_display_name").where("telegram_user_id", "=", telegramUserId).executeTakeFirst();
      return {
        id: grant.id,
        telegramUserId,
        displayName: person?.telegram_display_name ?? null,
        role: "admin",
        isPrincipal: false,
        grantedAt: now.toISOString(),
        grantedBy: { displayName: admin.displayName, role: "admin" },
        revokedAt: null,
      };
    });
  } catch (error) {
    // Dos autorizaciones simultáneas del mismo ID: el índice único parcial deja pasar solo una.
    if (pgCode(error) === "23505") throw duplicate();
    throw error;
  }
}
