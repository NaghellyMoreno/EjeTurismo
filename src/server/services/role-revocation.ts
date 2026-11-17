import { z } from "zod";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { assertConsented } from "@/server/auth/consent-guard";
import type { Config } from "@/server/config";
import { AppError, type FieldError } from "@/server/errors";
import type { RoleGrant } from "./administrator-authorization";
import { getConsentState } from "./consent";
import { getActiveRoles } from "./provider-registration";
import { assertAdmin, parseInteger } from "./provider-review";
import type { Db } from "./types";

export type RoleGrantPage = components["schemas"]["RoleGrantPage"];

export const ROLE_REVOKED_ACTION = "role_grant.revoked";

export interface RoleGrantQuery {
  role?: string | null;
  page?: string | null;
  pageSize?: string | null;
}

// Guardián de rol `provider` (ADR 0003, D-126): consentimiento vigente y permiso `provider` activo leído de `role_grants`
// en cada llamada, sin caché. Las rutas de prestador (F013 y siguientes) lo usarán.
export async function assertProvider(db: Db, actor: Actor): Promise<{ id: string; displayName: string | null }> {
  const state = await getConsentState(db, actor.telegramUserId);
  assertConsented(state);
  if (!(await getActiveRoles(db, actor.telegramUserId)).includes("provider")) {
    throw new AppError("forbidden", 403, "Sin rol de prestador");
  }
  return { id: state.account!.id, displayName: state.account!.displayName };
}

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;

interface GrantRow {
  id: string;
  telegram_user_id: string;
  role: "admin" | "provider";
  is_principal: boolean;
  granted_at: Date;
  revoked_at: Date | null;
  person_name: string | null;
  granter_name: string | null;
  granted_by_account_id: string | null;
  revoker_name: string | null;
  revoked_by_account_id: string | null;
}

function grantsQuery(db: Db) {
  return db
    .selectFrom("role_grants as g")
    .leftJoin("accounts as p", "p.telegram_user_id", "g.telegram_user_id")
    .leftJoin("accounts as gb", "gb.id", "g.granted_by_account_id")
    .leftJoin("accounts as rb", "rb.id", "g.revoked_by_account_id")
    .select([
      "g.id",
      "g.telegram_user_id",
      "g.role",
      "g.is_principal",
      "g.granted_at",
      "g.revoked_at",
      "g.granted_by_account_id",
      "g.revoked_by_account_id",
      "p.telegram_display_name as person_name",
      "gb.telegram_display_name as granter_name",
      "rb.telegram_display_name as revoker_name",
    ]);
}

// Nunca lleva número ni tipo de documento: esos datos no se leen aquí (invariante 7).
function toRoleGrant(config: Config, row: GrantRow): RoleGrant {
  return {
    id: row.id,
    telegramUserId: String(row.telegram_user_id),
    displayName: row.person_name,
    role: row.role,
    isPrincipal: row.is_principal || String(row.telegram_user_id) === config.principalAdminTelegramId,
    grantedAt: row.granted_at.toISOString(),
    grantedBy: row.granted_by_account_id ? { displayName: row.granter_name, role: "admin" } : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    ...(row.revoked_by_account_id ? { revokedBy: { displayName: row.revoker_name, role: "admin" as const } } : {}),
  };
}

// GET /role-grants: solo permisos activos. Orden de comprobaciones: guardián (401 en la ruta; 403 aquí) y luego 422.
export async function listRoleGrants(db: Db, config: Config, actor: Actor, query: RoleGrantQuery): Promise<RoleGrantPage> {
  await assertAdmin(db, config, actor);
  const errors: FieldError[] = [];
  let role: "admin" | "provider" | null = null;
  if (query.role !== undefined && query.role !== null) {
    if (query.role === "admin" || query.role === "provider") role = query.role;
    else errors.push({ field: "role", code: "not_in_list", message: "Elige un rol permitido." });
  }
  const page = parseInteger(query.page, "page", Number.MAX_SAFE_INTEGER, 1, errors);
  const pageSize = parseInteger(query.pageSize, "pageSize", 50, 20, errors);
  if (errors.length > 0) throw new AppError("validation_failed", 422, "Datos inválidos", errors);

  let rows = grantsQuery(db).where("g.revoked_at", "is", null);
  let total = db.selectFrom("role_grants").select((eb) => eb.fn.countAll<string>().as("n")).where("revoked_at", "is", null);
  if (role) {
    rows = rows.where("g.role", "=", role);
    total = total.where("role", "=", role);
  }
  const items = await rows
    .orderBy("g.granted_at", "asc")
    .orderBy("g.id", "asc")
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute();
  const count = Number((await total.executeTakeFirstOrThrow()).n);
  return { page, pageSize, total: count, items: items.map((row) => toRoleGrant(config, row)) };
}

// Lectura de un permiso activo para el bot, antes de pedir la confirmación. Nulo si no existe, está revocado o el id no es UUID.
export async function findActiveRoleGrant(db: Db, config: Config, actor: Actor, grantId: string): Promise<RoleGrant | null> {
  await assertAdmin(db, config, actor);
  if (!isUuid(grantId)) return null;
  const row = await grantsQuery(db).where("g.id", "=", grantId).where("g.revoked_at", "is", null).executeTakeFirst();
  return row ? toRoleGrant(config, row) : null;
}

function validate(grantId: unknown, raw: unknown): FieldError[] {
  const errors: FieldError[] = [];
  if (!isUuid(grantId)) errors.push({ field: "grantId", code: "invalid_format", message: "El identificador no es válido." });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ field: "body", code: "invalid_format", message: "Revisa los datos enviados." });
    return errors;
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== "confirmed") errors.push({ field: key, code: "invalid_format", message: "Este campo no se admite." });
  }
  if (body.confirmed !== true) errors.push({ field: "confirmed", code: "required", message: "Debes confirmar la operación." });
  return errors;
}

const notFound = () => new AppError("not_found", 404, "No encontrado", undefined, { detail: "Ese permiso no existe o ya fue revocado." });

// POST /role-grants/{grantId}/revocation. Una sola transacción: marca el permiso y escribe la traza; no toca ninguna otra
// tabla (D-043). Orden (contrato F006, criterio 31): 401 en la ruta; 403 `consent_required` y `forbidden`; 422; 404;
// 409 `principal_admin_protected`; 409 `last_admin_protected`. La traza lleva solo el rol (D-105, D-127).
export async function revokeRole(db: Db, config: Config, actor: Actor, grantId: string, rawBody: unknown, now: Date = new Date()): Promise<RoleGrant> {
  const admin = await assertAdmin(db, config, actor);
  const errors = validate(grantId, rawBody);
  if (errors.length > 0) throw new AppError("validation_failed", 422, "Datos inválidos", errors);

  await db.transaction().execute(async (trx) => {
    const peek = await trx.selectFrom("role_grants").select("role").where("id", "=", grantId).executeTakeFirst();
    if (!peek) throw notFound();
    // Bloqueo: dos revocaciones del mismo permiso se atienden una tras otra (la segunda ya no lo ve activo) y, al revocar
    // administradores, se bloquean todos los activos en el mismo orden para que dos revocaciones cruzadas no dejen al sistema sin ninguno.
    const locked =
      peek.role === "admin"
        ? await trx
            .selectFrom("role_grants")
            .select(["id", "role", "is_principal", "telegram_user_id"])
            .where("role", "=", "admin")
            .where("revoked_at", "is", null)
            .orderBy("id")
            .forUpdate()
            .execute()
        : await trx
            .selectFrom("role_grants")
            .select(["id", "role", "is_principal", "telegram_user_id"])
            .where("id", "=", grantId)
            .where("revoked_at", "is", null)
            .forUpdate()
            .execute();
    const target = locked.find((row) => row.id === grantId);
    if (!target) throw notFound();
    if (target.role === "admin") {
      if (target.is_principal || String(target.telegram_user_id) === config.principalAdminTelegramId) {
        throw new AppError("principal_admin_protected", 409, "Administrador principal", undefined, {
          detail: "No se puede quitar el rol al administrador principal.",
        });
      }
      if (locked.length <= 1) {
        throw new AppError("last_admin_protected", 409, "Último administrador", undefined, {
          detail: "No se puede quitar el rol porque el sistema se quedaría sin administradores.",
        });
      }
    }
    await trx.updateTable("role_grants").set({ revoked_at: now, revoked_by_account_id: admin.id }).where("id", "=", grantId).execute();
    await trx
      .insertInto("audit_events")
      .values({
        occurred_at: now,
        actor_account_id: admin.id,
        actor_role: "admin",
        action: ROLE_REVOKED_ACTION,
        entity_type: "role_grant",
        entity_id: grantId,
        details: JSON.stringify({ role: target.role }),
      })
      .execute();
  });

  const row = await grantsQuery(db).where("g.id", "=", grantId).executeTakeFirstOrThrow();
  return toRoleGrant(config, row);
}
