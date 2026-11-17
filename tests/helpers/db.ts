import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { createDb } from "@/server/db";

export const NOTICE_VERSION = "2026-11-v3";
export const COUNTED_TABLES = ["accounts", "consent_events", "bot_sessions", "rate_limit_counters", "processed_updates"] as const;

// Conexión con el rol propietario (postgres): reinicia datos, inspecciona y crea disparadores. La aplicación usa eje_app.
export function ownerPool(): Pool {
  return new Pool({ connectionString: process.env.TEST_OWNER_URL, max: 2 });
}

export function appDb() {
  return createDb(process.env.TEST_APP_URL!);
}

// Los tres municipios de la semilla (D-027), con el mismo UUID fijo de `supabase/seed/reference.sql`.
export const SEED_MUNICIPALITIES = [
  { id: "5f0c1a10-0000-4000-8000-000000000001", name: "Manizales" },
  { id: "5f0c1a10-0000-4000-8000-000000000002", name: "Supía" },
  { id: "5f0c1a10-0000-4000-8000-000000000003", name: "Filadelfia" },
] as const;

// Deja la tabla de municipios como la semilla (F010): cada prueba parte de exactamente 3 filas.
export async function restoreMunicipalitySeed(owner: Pool): Promise<void> {
  await owner.query("truncate app.municipalities");
  await owner.query(
    `insert into app.municipalities (id, name, name_normalized, department)
     values ('${SEED_MUNICIPALITIES[0].id}', 'Manizales', 'manizales', 'Caldas'),
            ('${SEED_MUNICIPALITIES[1].id}', 'Supía', 'supia', 'Caldas'),
            ('${SEED_MUNICIPALITIES[2].id}', 'Filadelfia', 'filadelfia', 'Caldas')`,
  );
}

export async function resetDb(owner: Pool): Promise<void> {
  await owner.query("truncate app.notification_outbox, app.audit_events, app.role_grants, app.provider_registrations, app.bot_sessions, app.rate_limit_counters, app.processed_updates, app.consent_events, app.municipalities, app.accounts, app.categories, app.experience_types, app.establishment_types restart identity");
  await restoreMunicipalitySeed(owner);
  // Las listas cerradas (F011) referencian cuentas y se truncan con ellas; se vuelve a cargar su semilla de referencia (ADR 0011).
  await owner.query(readFileSync(resolve(process.cwd(), "supabase/seed/reference-gastronomic-experience-type.sql"), "utf8"));
  await owner.query("delete from app.privacy_notice_versions where version <> $1", [NOTICE_VERSION]);
  await owner.query("update app.privacy_notice_versions set is_current = (version = $1)", [NOTICE_VERSION]);
}

export async function counts(owner: Pool): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    out[table] = Number((await owner.query(`select count(*) from app.${table}`)).rows[0].count);
  }
  return out;
}

export const EMPTY_COUNTS = Object.fromEntries(COUNTED_TABLES.map((t) => [t, 0]));

// Cuenta las filas de las 5 tablas cuyo contenido (todas las columnas) menciona el texto dado.
export async function rowsMentioning(owner: Pool, needle: string): Promise<number> {
  let total = 0;
  for (const table of COUNTED_TABLES) {
    const res = await owner.query(`select count(*) from app.${table} t where row_to_json(t)::text like $1`, [`%${needle}%`]);
    total += Number(res.rows[0].count);
  }
  return total;
}

// Las siete tablas del criterio 33 de F002: de esas, cuenta filas y busca un texto en el contenido completo.
export const F002_TABLES = ["accounts", "consent_events", "bot_sessions", "provider_registrations", "rate_limit_counters", "audit_events", "role_grants"] as const;

export async function countsF002(owner: Pool): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of F002_TABLES) out[table] = Number((await owner.query(`select count(*) from app.${table}`)).rows[0].count);
  return out;
}

export async function rowsMentioningF002(owner: Pool, needle: string): Promise<number> {
  let total = 0;
  for (const table of F002_TABLES) {
    const res = await owner.query(`select count(*) from app.${table} t where row_to_json(t)::text like $1`, [`%${needle}%`]);
    total += Number(res.rows[0].count);
  }
  return total;
}
