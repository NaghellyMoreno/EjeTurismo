import type { Pool } from "pg";
import { normalizeName } from "@/server/domain/normalize-name";
import { seedListing } from "./listing-data";

// F016: siembra de las fichas de A y de B y resumen de filas. Solo datos y SQL con el rol propietario (sin manejadores HTTP),
// para que también lo importen las pruebas de Playwright.
export const ATTACK_NAME = "Nombre de ataque de A";
export const B_REASON = "Motivo ficticio de B";
export const B_SECRET = {
  description: "Descripción secreta de B",
  schedule: "Horario secreto de B",
  contact: "secreto-b@ejemplo.invalid",
  mapsUrl: "https://maps.app.goo.gl/SecretoB123",
} as const;
export const A_NAMES = { borrador: "Ficha de A Borrador", pendiente: "Ficha de A Pendiente", borrador2: "Ficha de A Borrador Dos" } as const;
export const B_NAMES = {
  borrador: "Ficha de B Borrador",
  pendiente: "Ficha de B Pendiente",
  publicada: "Ficha de B Publicada",
  edicion: "Ficha de B Edicion",
  rechazada: "Ficha de B Rechazada",
} as const;

export interface Seeded {
  name: string;
  listingId: string;
  versionId: string; // la versión más reciente (la de trabajo en la edición)
  businessId: string;
}
export interface IsolationFixtures {
  a: Record<keyof typeof A_NAMES, Seeded>;
  b: Record<keyof typeof B_NAMES, Seeded>;
}

export interface IsolationOptions {
  aAccountId: string;
  bAccountId: string;
  municipalityId: string;
  categoryId: string;
}

// A: borrador, pendiente y un segundo borrador de otro negocio (D-006). B: borrador, pendiente, publicada, publicada con una
// edición en borrador (F015) y rechazada sin haber sido publicada. Todo el contenido de B es reconocible para detectar fugas.
export async function seedIsolation(owner: Pool, o: IsolationOptions): Promise<IsolationFixtures> {
  const common = { municipalityId: o.municipalityId, categoryId: o.categoryId, complete: true };
  const seedB = async (name: string, status: "draft" | "pending" | "published" | "rejected"): Promise<Seeded> => {
    const s = await seedListing(owner, { ...common, accountId: o.bAccountId, name, status });
    await owner.query(
      "update app.listing_versions set description = $2, schedule = $3, contact = $4, maps_url = $5, rejection_reason = case when status = 'rejected' then $6 else rejection_reason end where id = $1",
      [s.versionId, B_SECRET.description, B_SECRET.schedule, B_SECRET.contact, B_SECRET.mapsUrl, B_REASON],
    );
    return { name, listingId: s.listingId, versionId: s.versionId, businessId: s.businessId! };
  };
  const seedA = async (name: string, status: "draft" | "pending"): Promise<Seeded> => {
    const s = await seedListing(owner, { ...common, accountId: o.aAccountId, name, status });
    return { name, listingId: s.listingId, versionId: s.versionId, businessId: s.businessId! };
  };
  const edicion = await seedB(B_NAMES.edicion, "published");
  const draftVersion = (
    await owner.query(
      `insert into app.listing_versions (listing_id, version_number, status, name, name_normalized, municipality_id, category_id, description, schedule, contact, maps_url)
       values ($1, 2, 'draft', $2, $3, $4, $5, $6, 'Horario de la edición de B', $7, $8) returning id`,
      [edicion.listingId, B_NAMES.edicion, normalizeName(B_NAMES.edicion), o.municipalityId, o.categoryId, B_SECRET.description, B_SECRET.contact, B_SECRET.mapsUrl],
    )
  ).rows[0].id as string;
  return {
    a: { borrador: await seedA(A_NAMES.borrador, "draft"), pendiente: await seedA(A_NAMES.pendiente, "pending"), borrador2: await seedA(A_NAMES.borrador2, "draft") },
    b: {
      borrador: await seedB(B_NAMES.borrador, "draft"),
      pendiente: await seedB(B_NAMES.pendiente, "pending"),
      publicada: await seedB(B_NAMES.publicada, "published"),
      edicion: { ...edicion, versionId: draftVersion },
      rechazada: await seedB(B_NAMES.rechazada, "rejected"),
    },
  };
}

// Textos que identifican el contenido de B (nombres, campos secretos, motivo) y sus IDs de negocio, ficha y versión.
export function foreignStrings(fx: IsolationFixtures): string[] {
  const all = Object.values(fx.b);
  return [...Object.values(B_NAMES), ...Object.values(B_SECRET), B_REASON, ...all.flatMap((s) => [s.businessId, s.listingId, s.versionId])];
}

const DIGEST_TABLES = ["listings", "listing_versions", "listing_status_events", "audit_events", "notification_outbox"] as const;

// Resumen de filas ligadas a una ficha: por tabla, conteo y md5 de las filas que mencionan el ID de la ficha o de alguna versión.
export async function rowDigest(owner: Pool, listingId: string): Promise<Record<string, { count: number; md5: string }>> {
  const ids = [listingId, ...(await owner.query("select id from app.listing_versions where listing_id = $1", [listingId])).rows.map((r) => r.id as string)];
  const out: Record<string, { count: number; md5: string }> = {};
  for (const table of DIGEST_TABLES) {
    const { rows } = await owner.query(
      `select count(*)::int as count, md5(coalesce(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text), '')) as md5
       from app."${table}" t where row_to_json(t)::text ~ ANY($1::text[])`,
      [ids],
    );
    out[table] = rows[0];
  }
  return out;
}
