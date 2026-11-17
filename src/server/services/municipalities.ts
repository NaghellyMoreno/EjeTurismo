import { z } from "zod";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { assertConsented } from "@/server/auth/consent-guard";
import type { Config } from "@/server/config";
import { normalizeName } from "@/server/domain/normalize-name";
import { AppError, type FieldError } from "@/server/errors";
import { getConsentState } from "./consent";
import { assertAdmin } from "./provider-review";
import type { Db } from "./types";

export type Municipality = components["schemas"]["Municipality"];

export const MUNICIPALITY_CREATED_ACTION = "municipality.created";
export const MUNICIPALITY_UPDATED_ACTION = "municipality.updated";

// D-122: mismo límite que `api/openapi.yaml` en los cuatro campos, en POST y en PATCH.
const MAX = 4096;
const length = (value: string) => [...value].length;

interface Row {
  id: string;
  name: string;
  department: string;
  general_info: string | null;
  zone: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = ["id", "name", "department", "general_info", "zone", "created_at", "updated_at"] as const;

// El catálogo es público: la respuesta no lleva responsables ni datos de auditoría (criterios 8 y 32).
const toMunicipality = (row: Row): Municipality => ({
  id: row.id,
  name: row.name,
  department: row.department,
  generalInfo: row.general_info,
  zone: row.zone,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const duplicate = () =>
  new AppError("duplicate", 409, "Duplicado", undefined, { detail: "Ya existe un municipio con ese nombre." });

const pgCode = (error: unknown): string | undefined => (error as { code?: unknown } | null)?.code as string | undefined;

// GET /municipalities: cualquier cuenta con el aviso vigente aceptado (D-039). Orden alfabético por nombre normalizado (D-122).
export async function listMunicipalities(db: Db, actor: Actor): Promise<Municipality[]> {
  assertConsented(await getConsentState(db, actor.telegramUserId));
  const rows = await db.selectFrom("municipalities").select(COLUMNS).orderBy("name_normalized", "asc").orderBy("id", "asc").execute();
  return rows.map(toMunicipality);
}

type Field = "name" | "department" | "generalInfo" | "zone";
interface Parsed {
  errors: FieldError[];
  name?: string;
  department?: string;
  generalInfo?: string | null;
  zone?: string | null;
}

const required = (field: string): FieldError => ({ field, code: "required", message: "Este campo es obligatorio." });
const invalid = (field: string): FieldError => ({ field, code: "invalid_format", message: "Revisa este campo." });

// Valida el cuerpo según `MunicipalityCreate` (`nullable` falso) o `MunicipalityUpdate` (`generalInfo` y `zone` anulables).
function parse(raw: unknown, mode: "create" | "update"): Parsed {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: [{ field: "body", code: "invalid_format", message: "Revisa los datos enviados." }] };
  }
  const body = raw as Record<string, unknown>;
  const errors: FieldError[] = [];
  const out: Parsed = { errors };
  const known = new Set(["name", "department", "generalInfo", "zone", "confirmed"]);
  for (const key of Object.keys(body)) {
    if (!known.has(key)) errors.push({ field: key, code: "invalid_format", message: "Este campo no se admite." });
  }
  if (body.confirmed !== true) errors.push({ field: "confirmed", code: "required", message: "Debes confirmar la operación." });

  for (const field of ["name", "department"] as const) {
    const value = body[field];
    if (value === undefined) {
      if (mode === "create") errors.push(required(field));
    } else if (typeof value !== "string") {
      errors.push(invalid(field));
    } else if (value.trim() === "") {
      errors.push(required(field));
    } else if (length(value) > MAX) {
      errors.push({ field, code: "too_long", message: "El texto es demasiado largo." });
    } else {
      out[field] = value.trim();
    }
  }
  for (const field of ["generalInfo", "zone"] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (value === null && mode === "update") out[field] = null;
    else if (typeof value !== "string") errors.push(invalid(field));
    else if (length(value) > MAX) errors.push({ field, code: "too_long", message: "El texto es demasiado largo." });
    else out[field] = value;
  }
  return out;
}

const fail = (errors: FieldError[]) => new AppError("validation_failed", 422, "Datos inválidos", errors);

// POST /municipalities. Orden: 401 (ruta), 403, 422, 409. La fila y el evento de auditoría van en una transacción.
export async function createMunicipality(db: Db, config: Config, actor: Actor, rawBody: unknown, now: Date = new Date()): Promise<Municipality> {
  const admin = await assertAdmin(db, config, actor);
  const input = parse(rawBody, "create");
  if (input.errors.length > 0) throw fail(input.errors);
  const name = input.name!;
  try {
    return await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto("municipalities")
        .values({
          name,
          name_normalized: normalizeName(name),
          department: input.department!,
          general_info: input.generalInfo ?? null,
          zone: input.zone ?? null,
          created_by: admin.id,
          updated_by: admin.id,
          created_at: now,
          updated_at: now,
        })
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("audit_events")
        .values({
          occurred_at: now,
          actor_account_id: admin.id,
          actor_role: "admin",
          action: MUNICIPALITY_CREATED_ACTION,
          entity_type: "municipality",
          entity_id: row.id,
        })
        .execute();
      return toMunicipality(row);
    });
  } catch (error) {
    // El índice único sobre `name_normalized` decide también las peticiones simultáneas (ADR 0002).
    if (pgCode(error) === "23505") throw duplicate();
    throw error;
  }
}

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;

// PATCH /municipalities/{id}. Orden: 401 (ruta), 403, 422, 404, 409. Sin cambios reales (D-122): 200 sin tocar la fila
// ni la auditoría. Con cambios: `updated_by`, `updated_at` y el evento con los nombres de los campos, en una transacción.
export async function updateMunicipality(
  db: Db,
  config: Config,
  actor: Actor,
  municipalityId: string,
  rawBody: unknown,
  now: Date = new Date(),
): Promise<Municipality> {
  const admin = await assertAdmin(db, config, actor);
  const input = parse(rawBody, "update");
  if (!isUuid(municipalityId)) input.errors.push({ field: "municipalityId", code: "invalid_format", message: "El identificador no es válido." });
  if (input.errors.length > 0) throw fail(input.errors);

  try {
    return await db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom("municipalities").select(COLUMNS).where("id", "=", municipalityId).forUpdate().executeTakeFirst();
      if (!current) throw new AppError("not_found", 404, "Municipio no encontrado", undefined, { detail: "No existe ese municipio." });

      const changes: Partial<Pick<Row, "name" | "department" | "general_info" | "zone">> = {};
      const changed: Field[] = [];
      if (input.name !== undefined && input.name !== current.name) {
        changes.name = input.name;
        changed.push("name");
      }
      if (input.department !== undefined && input.department !== current.department) {
        changes.department = input.department;
        changed.push("department");
      }
      if (input.generalInfo !== undefined && input.generalInfo !== current.general_info) {
        changes.general_info = input.generalInfo;
        changed.push("generalInfo");
      }
      if (input.zone !== undefined && input.zone !== current.zone) {
        changes.zone = input.zone;
        changed.push("zone");
      }
      if (changed.length === 0) return toMunicipality(current);

      const row = await trx
        .updateTable("municipalities")
        .set({
          ...changes,
          ...(changes.name !== undefined ? { name_normalized: normalizeName(changes.name) } : {}),
          updated_by: admin.id,
          updated_at: now,
        })
        .where("id", "=", municipalityId)
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("audit_events")
        .values({
          occurred_at: now,
          actor_account_id: admin.id,
          actor_role: "admin",
          action: MUNICIPALITY_UPDATED_ACTION,
          entity_type: "municipality",
          entity_id: municipalityId,
          details: JSON.stringify({ fields: changed }),
        })
        .execute();
      return toMunicipality(row);
    });
  } catch (error) {
    if (pgCode(error) === "23505") throw duplicate();
    throw error;
  }
}
