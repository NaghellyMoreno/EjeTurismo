import type { Pool } from "pg";
import { normalizeName } from "@/server/domain/normalize-name";

// Datos ficticios de F013 (contrato, "Datos de prueba"): sin credenciales ni datos reales. Solo datos y SQL: sin manejadores
// HTTP, para que también los importen las pruebas de Playwright.
export const ESTABLISHMENT_ONE = "Establecimiento Ficticio Uno";
export const ESTABLISHMENT_TWO = "Establecimiento Ficticio Dos";
export const ESTABLISHMENT_MIN = "Establecimiento Ficticio Mínimo";
export const MAPS_URL = "https://maps.app.goo.gl/AbCdEf123";
export const CONTACT = "contacto@ejemplo.invalid";

export interface SeedListingOptions {
  accountId: string; // prestador dueño (establecimiento) o administrador que lo creó (atractivo)
  municipalityId: string;
  categoryId?: string;
  name: string;
  kind?: "establishment" | "attraction";
  status?: "draft" | "pending" | "published" | "rejected";
  complete?: boolean; // con los 7 campos de D-003 (siempre verdadero en pending y published)
}

// Inserta negocio (solo establecimientos), ficha y versión 1 con el rol propietario.
export async function seedListing(owner: Pool, options: SeedListingOptions): Promise<{ listingId: string; versionId: string; businessId: string | null }> {
  const kind = options.kind ?? "establishment";
  const status = options.status ?? "draft";
  const complete = options.complete ?? status !== "draft";
  if (complete && !options.categoryId) throw new Error("seedListing: una ficha completa necesita categoryId");
  const businessId =
    kind === "establishment"
      ? ((await owner.query("insert into app.businesses (provider_account_id) values ($1) returning id", [options.accountId])).rows[0].id as string)
      : null;
  const listingId = (
    await owner.query("insert into app.listings (kind, business_id, created_by_account_id) values ($1, $2, $3) returning id", [kind, businessId, options.accountId])
  ).rows[0].id as string;
  const versionId = (
    await owner.query(
      `insert into app.listing_versions (listing_id, version_number, status, name, name_normalized, municipality_id, category_id, description, schedule, contact, maps_url, rejection_reason)
       values ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        listingId, status, options.name, normalizeName(options.name), options.municipalityId,
        complete ? options.categoryId : null,
        complete ? "Descripción ficticia." : null, complete ? "Todos los días de 8:00 a 17:00" : null,
        complete ? CONTACT : null, complete ? MAPS_URL : null,
        status === "rejected" ? "Motivo ficticio" : null,
      ],
    )
  ).rows[0].id as string;
  return { listingId, versionId, businessId };
}
