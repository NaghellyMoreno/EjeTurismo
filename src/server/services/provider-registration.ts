import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { assertConsented } from "@/server/auth/consent-guard";
import type { Config } from "@/server/config";
import {
  encryptIdentityNumber,
  identityHash,
  isIdentityDocumentType,
  trimIdentityNumber,
  validateIdentityNumber,
} from "@/server/domain/identity";
import { AppError, type FieldError } from "@/server/errors";
import { getConsentState } from "./consent";
import { consumeRateLimit } from "./rate-limit";
import type { Db } from "./types";

export type OwnProviderRegistration = components["schemas"]["OwnProviderRegistration"];
export type RegistrationStatus = components["schemas"]["ProviderRegistrationStatus"];
export type Role = components["schemas"]["Role"];

export const PROVIDER_REGISTRATION_ACTION = "provider_registration";

export interface AccountContext {
  roles: Role[];
  isPrincipalAdmin: boolean;
  // Estado del registro más reciente de la cuenta; null si nunca se registró.
  registrationStatus: RegistrationStatus | null;
}

// Roles activos según la base, en cada operación (ADR 0003): la revocación es inmediata.
export async function getActiveRoles(db: Db, telegramUserId: string): Promise<Role[]> {
  const rows = await db
    .selectFrom("role_grants")
    .select("role")
    .where("telegram_user_id", "=", telegramUserId)
    .where("revoked_at", "is", null)
    .execute();
  return rows.map((r) => r.role);
}

async function latestRegistration(db: Db, accountId: string) {
  return db
    .selectFrom("provider_registrations")
    .select(["id", "status", "created_at", "decided_at"])
    .where("account_id", "=", accountId)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
}

export async function getAccountContext(db: Db, config: Config, accountId: string, telegramUserId: string): Promise<AccountContext> {
  const [roles, registration] = await Promise.all([getActiveRoles(db, telegramUserId), latestRegistration(db, accountId)]);
  return {
    roles,
    isPrincipalAdmin: config.principalAdminTelegramId === telegramUserId,
    registrationStatus: registration?.status ?? null,
  };
}

const toOwn = (row: { id: string; status: RegistrationStatus; created_at: Date; decided_at: Date | null }): OwnProviderRegistration => ({
  id: row.id,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
});

// GET /provider-registrations/me: nunca devuelve el tipo ni el número.
export async function getMyProviderRegistration(db: Db, actor: Actor): Promise<OwnProviderRegistration> {
  const state = await getConsentState(db, actor.telegramUserId);
  assertConsented(state);
  const row = await latestRegistration(db, state.account!.id);
  if (!row) throw new AppError("not_found", 404, "Sin registro", undefined, { detail: "Todavía no tienes un registro de prestador." });
  return toOwn(row);
}

export interface CreateOptions {
  // El bot pide vaciar su borrador (número sellado incluido) en la misma transacción del insert (ADR 0015).
  clearBotSession?: boolean;
}

const KNOWN_FIELDS = new Set(["identityDocumentType", "identityNumber", "confirmed"]);

// Valida el cuerpo: confirmación explícita (invariante 8), tipo y número. Devuelve errores por campo.
function validateInput(raw: unknown): { errors: FieldError[]; type?: components["schemas"]["IdentityDocumentType"]; number?: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: [{ field: "body", code: "invalid_format", message: "Revisa los datos enviados." }] };
  }
  const body = raw as Record<string, unknown>;
  const errors: FieldError[] = [];
  // Un campo desconocido no se nombra: su nombre lo escribió quien envía y podría ser el número de identidad (F027).
  if (Object.keys(body).some((key) => !KNOWN_FIELDS.has(key))) {
    errors.push({ field: "body", code: "invalid_format", message: "Hay campos que no se admiten." });
  }
  if (body.confirmed !== true) errors.push({ field: "confirmed", code: "required", message: "Debes confirmar el registro." });
  errors.push(...validateIdentityNumber(body.identityDocumentType, body.identityNumber));
  if (errors.length > 0) return { errors };
  return { errors, type: body.identityDocumentType as never, number: body.identityNumber as string };
}

const pgCode = (error: unknown): string | undefined => (error as { code?: unknown } | null)?.code as string | undefined;
const pgMessage = (error: unknown): string => String((error as { message?: unknown } | null)?.message ?? "");

// Orden de comprobaciones (contrato F002, criterio 45): consentimiento, administrador, validación, límite, inserción.
// El tipo y el número nunca se registran ni se devuelven (invariante 7).
export async function createProviderRegistration(
  db: Db,
  config: Config,
  actor: Actor,
  rawInput: unknown,
  now: Date = new Date(),
  options: CreateOptions = {},
): Promise<OwnProviderRegistration> {
  const state = await getConsentState(db, actor.telegramUserId);
  assertConsented(state);
  const account = state.account!;

  const adminDenied = () =>
    new AppError("admin_cannot_register_as_provider", 403, "Administrador", undefined);
  if (config.principalAdminTelegramId === actor.telegramUserId) throw adminDenied();
  if ((await getActiveRoles(db, actor.telegramUserId)).includes("admin")) throw adminDenied();

  const { errors, type, number } = validateInput(rawInput);
  if (errors.length > 0 || !type || number === undefined || !isIdentityDocumentType(type)) {
    throw new AppError("validation_failed", 422, "Datos inválidos", errors);
  }

  await consumeRateLimit(db, account.id, PROVIDER_REGISTRATION_ACTION, config.rateLimits[PROVIDER_REGISTRATION_ACTION], now);

  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto("provider_registrations")
        .values({
          account_id: account.id,
          identity_document_type: type,
          identity_number_encrypted: encryptIdentityNumber(config.identityEncryptionKey, account.id, trimIdentityNumber(number)),
          identity_number_hash: identityHash(config.identityHashKey, type, number),
          created_at: now,
          decided_at: null,
          decided_by_account_id: null,
          rejection_reason: null,
        })
        .returning(["id", "status", "created_at", "decided_at"])
        .executeTakeFirstOrThrow();
      // D-076, D-081: quien se registra aún no tiene rol. Sin datos personales en `details`.
      await trx
        .insertInto("audit_events")
        .values({
          occurred_at: now,
          actor_account_id: account.id,
          actor_role: "none",
          action: "provider_registration.created",
          entity_type: "provider_registration",
          entity_id: row.id,
        })
        .execute();
      if (options.clearBotSession) {
        await trx.updateTable("bot_sessions").set({ data: "{}", updated_at: now }).where("account_id", "=", account.id).execute();
      }
      return toOwn(row);
    });
  } catch (error) {
    // Índices únicos parciales: documento repetido o cuenta con registro pendiente o aprobado (D-054).
    if (pgCode(error) === "23505") throw new AppError("duplicate", 409, "Duplicado");
    if (pgCode(error) === "P0001" && pgMessage(error) === "admin_cannot_register_as_provider") throw adminDenied();
    throw error;
  }
}
