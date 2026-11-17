import { z } from "zod";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { assertConsented } from "@/server/auth/consent-guard";
import type { Config } from "@/server/config";
import { normalizeName, parseCatalogName } from "@/server/domain/catalogs";
import { AppError, type FieldError } from "@/server/errors";
import { getConsentState } from "./consent";
import { assertAdmin } from "./provider-review";
import type { Db } from "./types";

export type CatalogItem = components["schemas"]["CatalogItem"];

// Las tres listas cerradas de F011 (D-004, D-040, D-123). La acción y el tipo de entidad de `audit_events` salen de aquí.
export type CatalogKind = "category" | "experience_type" | "establishment_type";
const TABLES = { category: "categories", experience_type: "experience_types", establishment_type: "establishment_types" } as const;

const NAME_MESSAGES = {
  required: ["required", "Escribe un nombre."],
  invalid_type: ["invalid_format", "El nombre debe ser texto."],
  too_long: ["too_long", "El nombre es demasiado largo."],
  control_characters: ["invalid_format", "El nombre tiene caracteres no permitidos."],
} as const;

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;

// Filas de una lista (o solo la de `id`), ordenadas por nombre sin tildes ni mayúsculas.
async function selectItems(db: Db, kind: CatalogKind, id?: string): Promise<CatalogItem[]> {
  const table = TABLES[kind];
  if (table === "categories") {
    const query = db.selectFrom(table).select(["id", "name"]).orderBy("name_normalized").orderBy("id");
    return (await (id ? query.where("id", "=", id) : query).execute()).map((row) => ({ ...row, isGastronomic: false }));
  }
  const query = db.selectFrom(table).select(["id", "name", "is_gastronomic"]).orderBy("name_normalized").orderBy("id");
  return (await (id ? query.where("id", "=", id) : query).execute()).map((row) => ({ id: row.id, name: row.name, isGastronomic: row.is_gastronomic }));
}

// Lectura: cualquier cuenta con el aviso vigente aceptado (D-039).
export async function listCatalog(db: Db, actor: Actor, kind: CatalogKind): Promise<CatalogItem[]> {
  assertConsented(await getConsentState(db, actor.telegramUserId));
  return selectItems(db, kind);
}

// Cuerpo de crear o editar: solo `name` y `confirmed`. `isGastronomic` u otros campos se rechazan (la API nunca fija la marca).
function validate(rawId: unknown, rawBody: unknown, creating: boolean): { errors: FieldError[]; name?: string } {
  const errors: FieldError[] = [];
  if (rawId !== undefined && !isUuid(rawId)) errors.push({ field: "id", code: "invalid_format", message: "El identificador no es válido." });
  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    errors.push({ field: "body", code: "invalid_format", message: "Revisa los datos enviados." });
    return { errors };
  }
  const body = rawBody as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (key !== "name" && key !== "confirmed") errors.push({ field: key, code: "invalid_format", message: "Este campo no se admite." });
  }
  if (body.confirmed !== true) errors.push({ field: "confirmed", code: "required", message: "Debes confirmar la operación." });
  let name: string | undefined;
  if (body.name === undefined) {
    // Al editar sin nombre no hay nada que cambiar (contrato F011, criterio 20).
    errors.push({ field: "name", code: "required", message: creating ? "Escribe un nombre." : "No hay nada que cambiar." });
  } else {
    const parsed = parseCatalogName(body.name);
    if ("problem" in parsed) {
      const [code, message] = NAME_MESSAGES[parsed.problem];
      errors.push({ field: "name", code, message });
    } else {
      name = parsed.name;
    }
  }
  return { errors, name };
}

const isUniqueViolation = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === "23505";
const duplicate = () => new AppError("duplicate", 409, "Nombre duplicado", undefined, { detail: "Ya existe un elemento con ese nombre." });

// Crear o editar es una sola transacción con su traza (sección 3.12; D-121). Orden: 401 (ruta), 403 `consent_required`,
// 403 `forbidden`, 422, 404 y 409; ningún rechazo escribe `audit_events` ni cambia filas. `details` queda vacío: sin datos personales.
export async function createCatalogItem(db: Db, config: Config, actor: Actor, kind: CatalogKind, rawBody: unknown, now: Date = new Date()): Promise<CatalogItem> {
  const admin = await assertAdmin(db, config, actor);
  const { errors, name } = validate(undefined, rawBody, true);
  if (errors.length > 0 || name === undefined) throw new AppError("validation_failed", 422, "Datos inválidos", errors);
  const table = TABLES[kind];
  try {
    return await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto(table)
        .values({ name, name_normalized: normalizeName(name), created_by_account_id: admin.id, created_at: now, updated_by_account_id: admin.id, updated_at: now })
        .returning(["id", "name"])
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("audit_events")
        .values({ occurred_at: now, actor_account_id: admin.id, actor_role: "admin", action: `${kind}.created`, entity_type: kind, entity_id: created.id })
        .execute();
      // La marca nunca la escribe la API: lo creado por ella es siempre no gastronómico.
      return { id: created.id, name: created.name, isGastronomic: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate();
    throw error;
  }
}

export async function renameCatalogItem(
  db: Db,
  config: Config,
  actor: Actor,
  kind: CatalogKind,
  id: string,
  rawBody: unknown,
  now: Date = new Date(),
): Promise<CatalogItem> {
  const admin = await assertAdmin(db, config, actor);
  const { errors, name } = validate(id, rawBody, false);
  if (errors.length > 0 || name === undefined) throw new AppError("validation_failed", 422, "Datos inválidos", errors);
  const table = TABLES[kind];
  try {
    await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable(table)
        .set({ name, name_normalized: normalizeName(name), updated_by_account_id: admin.id, updated_at: now })
        .where("id", "=", id)
        .returning("id")
        .executeTakeFirst();
      if (!updated) throw new AppError("not_found", 404, "Elemento no encontrado", undefined, { detail: "No existe ese elemento." });
      await trx
        .insertInto("audit_events")
        .values({ occurred_at: now, actor_account_id: admin.id, actor_role: "admin", action: `${kind}.updated`, entity_type: kind, entity_id: id })
        .execute();
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate();
    throw error;
  }
  return (await selectItems(db, kind, id))[0]!;
}
