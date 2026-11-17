import { z } from "zod";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { assertConsented } from "@/server/auth/consent-guard";
import type { Config } from "@/server/config";
import { decryptIdentityNumber } from "@/server/domain/identity";
import { AppError, type FieldError } from "@/server/errors";
import { getConsentState } from "./consent";
import { getActiveRoles, type RegistrationStatus } from "./provider-registration";
import type { Db } from "./types";

export type AdminProviderRegistration = components["schemas"]["AdminProviderRegistration"];
export type AdminProviderRegistrationPage = components["schemas"]["AdminProviderRegistrationPage"];

export const TEMPLATE_APPROVED = "provider_registration.approved";
export const TEMPLATE_REJECTED = "provider_registration.rejected";

export interface AdminAccount {
  id: string;
  displayName: string | null;
}

// Guardián de rol `admin` (ADR 0003): consentimiento vigente y permiso `admin` activo en `role_grants`, o el ID del
// administrador principal. Se lee de la base en cada operación; nunca de la sesión del bot ni de `callback_data`.
export async function assertAdmin(db: Db, config: Config, actor: Actor): Promise<AdminAccount> {
  const state = await getConsentState(db, actor.telegramUserId);
  assertConsented(state);
  const isAdmin =
    config.principalAdminTelegramId === actor.telegramUserId || (await getActiveRoles(db, actor.telegramUserId)).includes("admin");
  if (!isAdmin) throw new AppError("forbidden", 403, "Sin rol de administrador");
  return { id: state.account!.id, displayName: state.account!.displayName };
}

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;

// ---- Listado -------------------------------------------------------------------------------------------------

export interface ListQuery {
  status?: string | null;
  page?: string | null;
  pageSize?: string | null;
}

const STATUSES = ["pending", "approved", "rejected"] as const;
const isStatus = (v: string): v is RegistrationStatus => (STATUSES as readonly string[]).includes(v);

export function parseInteger(raw: string | null | undefined, field: string, max: number, fallback: number, errors: FieldError[]): number {
  if (raw === undefined || raw === null) return fallback;
  const n = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    errors.push({ field, code: "invalid_format", message: "Revisa este valor." });
    return fallback;
  }
  return n;
}

interface Row {
  id: string;
  account_id: string;
  identity_document_type: AdminProviderRegistration["identityDocumentType"];
  identity_number_encrypted: Buffer;
  status: RegistrationStatus;
  created_at: Date;
  decided_at: Date | null;
  rejection_reason: string | null;
  decided_by_account_id: string | null;
  telegram_user_id: string;
  telegram_display_name: string | null;
  decider_name: string | null;
}

function baseQuery(db: Db) {
  return db
    .selectFrom("provider_registrations as r")
    .innerJoin("accounts as a", "a.id", "r.account_id")
    .leftJoin("accounts as d", "d.id", "r.decided_by_account_id")
    .select([
      "r.id",
      "r.account_id",
      "r.identity_document_type",
      "r.identity_number_encrypted",
      "r.status",
      "r.created_at",
      "r.decided_at",
      "r.rejection_reason",
      "r.decided_by_account_id",
      "a.telegram_user_id",
      "a.telegram_display_name",
      "d.telegram_display_name as decider_name",
    ]);
}

// El número se descifra solo aquí, y solo para quien ya pasó el guardián de administrador (invariante 7).
function toAdminView(config: Config, row: Row): AdminProviderRegistration {
  return {
    id: row.id,
    telegramUserId: String(row.telegram_user_id),
    telegramDisplayName: row.telegram_display_name ?? "",
    identityDocumentType: row.identity_document_type,
    identityNumber: decryptIdentityNumber(config.identityEncryptionKey, row.account_id, row.identity_number_encrypted),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    // Los registros se deciden solo con el rol de administrador.
    decidedBy: row.decided_by_account_id ? { displayName: row.decider_name, role: "admin" } : null,
    rejectionReason: row.rejection_reason,
  };
}

// GET /provider-registrations. Orden de comprobaciones: guardián (401 en la ruta; 403 aquí) y luego 422.
export async function listProviderRegistrations(db: Db, config: Config, actor: Actor, query: ListQuery): Promise<AdminProviderRegistrationPage> {
  await assertAdmin(db, config, actor);
  const errors: FieldError[] = [];
  let status: RegistrationStatus | null = null;
  if (query.status !== undefined && query.status !== null) {
    if (isStatus(query.status)) status = query.status;
    else errors.push({ field: "status", code: "not_in_list", message: "Elige un estado permitido." });
  }
  const page = parseInteger(query.page, "page", Number.MAX_SAFE_INTEGER, 1, errors);
  const pageSize = parseInteger(query.pageSize, "pageSize", 50, 20, errors);
  if (errors.length > 0) throw new AppError("validation_failed", 422, "Datos inválidos", errors);

  let rows = baseQuery(db);
  let total = db.selectFrom("provider_registrations").select((eb) => eb.fn.countAll<string>().as("n"));
  if (status) {
    rows = rows.where("r.status", "=", status);
    total = total.where("status", "=", status);
  }
  // D-095: del más antiguo al más reciente; el id desempata.
  const items = await rows
    .orderBy("r.created_at", "asc")
    .orderBy("r.id", "asc")
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute();
  const count = Number((await total.executeTakeFirstOrThrow()).n);
  return { page, pageSize, total: count, items: items.map((row) => toAdminView(config, row)) };
}

// Lectura de un registro para el bot, antes de pedir la confirmación. Nulo si no existe o el id no es un UUID.
export async function findProviderRegistration(db: Db, config: Config, actor: Actor, registrationId: string): Promise<AdminProviderRegistration | null> {
  await assertAdmin(db, config, actor);
  if (!isUuid(registrationId)) return null;
  const row = await baseQuery(db).where("r.id", "=", registrationId).executeTakeFirst();
  return row ? toAdminView(config, row) : null;
}

// ---- Decisión ------------------------------------------------------------------------------------------------

export interface Decision {
  registration: AdminProviderRegistration;
  // Filas de `notification_outbox` creadas por la operación; el llamador las envía con `after()` (ADR 0007).
  notificationIds: string[];
}

const REASON_MAX = 4096;

function validateDecision(registrationId: unknown, raw: unknown, allowReason: boolean): { errors: FieldError[]; reason: string | null } {
  const errors: FieldError[] = [];
  let reason: string | null = null;
  if (!isUuid(registrationId)) errors.push({ field: "registrationId", code: "invalid_format", message: "El identificador no es válido." });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ field: "body", code: "invalid_format", message: "Revisa los datos enviados." });
    return { errors, reason };
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== "confirmed" && !(allowReason && key === "reason")) {
      errors.push({ field: key, code: "invalid_format", message: "Este campo no se admite." });
    }
  }
  if (body.confirmed !== true) errors.push({ field: "confirmed", code: "required", message: "Debes confirmar la operación." });
  if (allowReason && body.reason !== undefined) {
    if (typeof body.reason !== "string") {
      errors.push({ field: "reason", code: "invalid_format", message: "El motivo debe ser texto." });
    } else if (body.reason.length > REASON_MAX) {
      errors.push({ field: "reason", code: "too_long", message: "El motivo es demasiado largo." });
    } else if (body.reason.trim() !== "") {
      // D-098: un motivo vacío o solo de espacios equivale a no enviarlo.
      reason = body.reason;
    }
  }
  return { errors, reason };
}

const pgMessage = (error: unknown): string => String((error as { message?: unknown } | null)?.message ?? "");

// Una decisión es una sola transacción: estado del registro, permiso `provider` (solo al aprobar), traza y aviso.
// Orden (contrato F003, criterios 27 y 42; D-097): 401, 403 `consent_required`, 403 `forbidden`, 422, 404,
// 409 `invalid_state_transition` y 409 `role_conflict`. Ni `details` ni `payload` llevan datos personales ni el motivo.
async function decide(
  db: Db,
  config: Config,
  actor: Actor,
  registrationId: string,
  rawBody: unknown,
  kind: "approve" | "reject",
  now: Date,
): Promise<Decision> {
  const admin = await assertAdmin(db, config, actor);
  const { errors, reason } = validateDecision(registrationId, rawBody, kind === "reject");
  if (errors.length > 0) throw new AppError("validation_failed", 422, "Datos inválidos", errors);

  const approve = kind === "approve";
  const notificationIds: string[] = [];
  try {
    await db.transaction().execute(async (trx) => {
      // Bloquea la fila: dos decisiones simultáneas se atienden una tras otra y la segunda ve el estado ya cambiado.
      const current = await trx
        .selectFrom("provider_registrations")
        .select(["id", "status", "account_id"])
        .where("id", "=", registrationId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw new AppError("not_found", 404, "Registro no encontrado", undefined, { detail: "No existe ese registro." });
      if (current.status !== "pending") throw new AppError("invalid_state_transition", 409, "Registro ya decidido");
      const owner = await trx.selectFrom("accounts").select("telegram_user_id").where("id", "=", current.account_id).executeTakeFirstOrThrow();
      const recipient = String(owner.telegram_user_id);
      if (approve && (await getActiveRoles(trx, recipient)).includes("admin")) {
        throw new AppError("role_conflict", 409, "Conflicto de roles");
      }

      await trx
        .updateTable("provider_registrations")
        .set({
          status: approve ? "approved" : "rejected",
          decided_at: now,
          decided_by_account_id: admin.id,
          rejection_reason: approve ? null : reason,
        })
        .where("id", "=", registrationId)
        .execute();
      if (approve) {
        await trx
          .insertInto("role_grants")
          .values({
            telegram_user_id: recipient,
            role: "provider",
            is_principal: false,
            provider_registration_id: registrationId,
            granted_by_account_id: admin.id,
            granted_at: now,
            revoked_at: null,
            revoked_by_account_id: null,
          })
          .execute();
      }
      await trx
        .insertInto("audit_events")
        .values({
          occurred_at: now,
          actor_account_id: admin.id,
          actor_role: "admin",
          action: approve ? "provider_registration.approved" : "provider_registration.rejected",
          entity_type: "provider_registration",
          entity_id: registrationId,
        })
        .execute();
      const outbox = await trx
        .insertInto("notification_outbox")
        .values({
          recipient_telegram_user_id: recipient,
          template: approve ? TEMPLATE_APPROVED : TEMPLATE_REJECTED,
          created_at: now,
          next_attempt_at: null,
          sent_at: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      notificationIds.push(outbox.id);
    });
  } catch (error) {
    // La base no permite el cruce con `admin` aunque la comprobación anterior falle (D-038, F002).
    if ((error as { code?: unknown } | null)?.code === "P0001" && pgMessage(error) === "admin_cannot_be_provider") {
      throw new AppError("role_conflict", 409, "Conflicto de roles");
    }
    throw error;
  }

  const row = await baseQuery(db).where("r.id", "=", registrationId).executeTakeFirstOrThrow();
  return { registration: toAdminView(config, row), notificationIds };
}

export const approveProviderRegistration = (db: Db, config: Config, actor: Actor, registrationId: string, body: unknown, now: Date = new Date()) =>
  decide(db, config, actor, registrationId, body, "approve", now);

export const rejectProviderRegistration = (db: Db, config: Config, actor: Actor, registrationId: string, body: unknown, now: Date = new Date()) =>
  decide(db, config, actor, registrationId, body, "reject", now);
