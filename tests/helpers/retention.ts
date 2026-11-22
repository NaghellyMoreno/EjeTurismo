import type { Pool } from "pg";
import type { Deps } from "@/server/http/deps";
import { MemoryStorage } from "@/server/storage";
import { testConfig } from "./config";
import { appDb, NOTICE_VERSION, resetDb } from "./db";
import { jpegBytes } from "./photo-data";

// Ayudantes de F038: siembra con datos ficticios en todas las tablas (ids de Telegram 9100xx) y conteos para comparar antes y después.
export const CRON_SECRET = "cron-secret-de-prueba";
export const TG = { admin: 910001, admin2: 910002, v1: 910011, v2: 910012, v3: 910013, a: 910021, b: 910022 } as const;
export const SEEDED_VALUES = [...Object.values(TG).map(String), "Visitante Uno", "Visitante Dos", "Visitante Tres", "Prestador A", "Prestador B", "1020304050", "Ana Solicitante"];

export const ALL_TABLES = [
  "accounts", "audit_events", "bot_sessions", "businesses", "categories", "consent_events", "establishment_types", "experience_types",
  "information_request_replies", "information_request_status_events", "information_requests", "listing_photos", "listing_status_events",
  "listing_versions", "listings", "municipalities", "notification_outbox", "photo_uploads", "privacy_notice_versions", "processed_updates",
  "provider_registrations", "rate_limit_counters", "role_grants",
] as const;
// Tablas que quedan en 0 y las de fichas de prestador, de las que solo se cuentan las filas de kind <> attraction.
export const WHOLE_TABLES = [
  "accounts", "bot_sessions", "rate_limit_counters", "role_grants", "consent_events", "provider_registrations", "information_requests",
  "information_request_replies", "information_request_status_events", "audit_events", "listing_status_events", "notification_outbox",
  "processed_updates", "businesses",
] as const;
export const PROVIDER_COUNTS = {
  listings: "select count(*) from app.listings where kind <> 'attraction'",
  listing_versions: "select count(*) from app.listing_versions v join app.listings l on l.id = v.listing_id where l.kind <> 'attraction'",
  listing_photos: "select count(*) from app.listing_photos p join app.listing_versions v on v.id = p.version_id join app.listings l on l.id = v.listing_id where l.kind <> 'attraction'",
  photo_uploads: "select count(*) from app.photo_uploads p join app.listing_versions v on v.id = p.version_id join app.listings l on l.id = v.listing_id where l.kind <> 'attraction'",
} as const;
export const PURGED_TABLES = [...WHOLE_TABLES, ...Object.keys(PROVIDER_COUNTS)];

const one = async (owner: Pool, text: string, params: unknown[] = []) => (await owner.query(text, params)).rows[0];
export const count = async (owner: Pool, table: string): Promise<number> => Number((await one(owner, `select count(*) from app.${table}`)).count);

export async function tableCounts(owner: Pool): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of ALL_TABLES) out[table] = await count(owner, table);
  return out;
}

// N del criterio 2: suma de los conteos previos de cada tabla del alcance (una sola vez) y de las fichas de prestador.
export async function expectedProcessed(owner: Pool): Promise<number> {
  let total = 0;
  for (const table of WHOLE_TABLES) total += await count(owner, table);
  for (const query of Object.values(PROVIDER_COUNTS)) total += Number((await one(owner, query)).count);
  return total;
}

export async function todayInBogota(owner: Pool): Promise<string> {
  return (await one(owner, "select (now() at time zone 'America/Bogota')::date::text as d")).d;
}

// Deja el plazo como lo crea la migración: 31 de enero de 2027 y sin ejecutar.
export async function restoreRetention(owner: Pool): Promise<void> {
  await owner.query("update app.retention_settings set deadline = '2027-01-31', executed_at = null");
}

export async function setDeadline(owner: Pool, deadline: string): Promise<void> {
  await owner.query("update app.retention_settings set deadline = $1::date, executed_at = null", [deadline]);
}

// Columnas con clave foránea hacia `accounts` en las tablas dadas (criterios 8 y 9).
export async function accountFkColumns(owner: Pool, tables: string[]): Promise<{ table: string; column: string }[]> {
  const { rows } = await owner.query(
    `select c.conrelid::regclass::text as t, a.attname as col
       from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = 'app.accounts'::regclass`,
  );
  return rows.map((r) => ({ table: String(r.t).replace(/^app\./, ""), column: r.col })).filter((r) => tables.includes(r.table));
}

export async function nonNullAccountReferences(owner: Pool, tables: string[]): Promise<number> {
  let total = 0;
  for (const { table, column } of await accountFkColumns(owner, tables)) total += await count(owner, `${table} where ${column} is not null`);
  return total;
}

// Contenido de las tablas conservadas sin las columnas que apuntan a cuentas (que pasan a nulo), ordenado por id.
export async function contentSnapshot(owner: Pool, tables: string[]): Promise<Record<string, unknown[]>> {
  const fks = await accountFkColumns(owner, tables);
  const out: Record<string, unknown[]> = {};
  for (const table of tables) {
    const drop = fks.filter((f) => f.table === table).map((f) => f.column);
    const { rows } = await owner.query(`select to_jsonb(t) as row from app.${table} t order by to_jsonb(t)::text`);
    out[table] = rows
      .map((r) => Object.fromEntries(Object.entries(r.row as Record<string, unknown>).filter(([key]) => !drop.includes(key))))
      .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  }
  return out;
}

export interface Seed {
  attractionId: string;
  attractionPublishedVersionId: string;
  attractionPhotoPaths: string[];
  providerPhotoPaths: string[];
  orphanPath: string;
  attractionUploadId: string;
}

// Base sembrada con al menos una fila en cada tabla del alcance y de lo conservado (criterio 1). Los archivos de las fotos van al almacén en memoria.
export async function seedRetention(owner: Pool, storage: MemoryStorage): Promise<Seed> {
  await resetDb(owner);
  await restoreRetention(owner);
  storage.reset();
  const id = async (text: string, params: unknown[] = []): Promise<string> => (await one(owner, text, params)).id;
  const account = (tg: number, name: string) =>
    id("insert into app.accounts (telegram_user_id, telegram_display_name, consent_notice_version, consent_accepted_at, consent_channel) values ($1, $2, $3, now(), 'bot') returning id", [tg, name, NOTICE_VERSION]);

  await owner.query("insert into app.privacy_notice_versions (version, body_markdown, declaration_text, is_current) values ('2026-12-v9', 'texto previo', 'declaración', false)");
  const admin = await account(TG.admin, "Administrador Principal");
  const v1 = await account(TG.v1, "Visitante Uno");
  const v2 = await account(TG.v2, "Visitante Dos");
  const v3 = await account(TG.v3, "Visitante Tres");
  const a = await account(TG.a, "Prestador A");
  const b = await account(TG.b, "Prestador B");

  // Permisos: administrador principal, administrador secundario autorizado que nunca aceptó el aviso (sin cuenta) y prestadores.
  await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values ($1, 'admin', true)", [TG.admin]);
  await owner.query("insert into app.role_grants (telegram_user_id, role, granted_by_account_id) values ($1, 'admin', $2)", [TG.admin2, admin]);
  const registration = (accountId: string, status: string, decidedBy: string | null) =>
    id(
      `insert into app.provider_registrations (account_id, identity_document_type, identity_number_encrypted, identity_number_hash, status, decided_by_account_id, decided_at)
       values ($1::uuid, 'CC', '\\x0102', decode(md5($1::uuid::text), 'hex'), $2, $3::uuid, case when $3::uuid is null then null else now() end) returning id`,
      [accountId, status, decidedBy],
    );
  const regA = await registration(a, "approved", admin);
  const regB = await registration(b, "approved", admin);
  await registration(v3, "pending", null);
  await owner.query("insert into app.role_grants (telegram_user_id, role, provider_registration_id, granted_by_account_id) values ($1, 'provider', $2, $3), ($4, 'provider', $5, $3)", [TG.a, regA, admin, TG.b, regB]);

  await owner.query("insert into app.consent_events (event, channel, notice_version) values ('accepted', 'bot', $1), ('accepted', 'mini_app', $1), ('revoked', 'bot', $1)", [NOTICE_VERSION]);
  await owner.query("insert into app.bot_sessions (account_id, data) values ($1, '{\"step\":\"x\"}'), ($2, '{}')", [v1, a]);
  await owner.query("insert into app.rate_limit_counters (account_id, action, window_start, count) values ($1, 'information_request', now(), 1)", [v1]);
  await owner.query("insert into app.processed_updates (update_id) values (1), (2), (3)");
  await owner.query("insert into app.audit_events (actor_account_id, actor_role, action, entity_type, entity_id) values ($1, 'admin', 'approve', 'provider_registration', $2)", [admin, regA]);
  await owner.query("insert into app.notification_outbox (recipient_telegram_user_id, template, status) values ($1, 'x', 'pending'), ($2, 'x', 'sent')", [TG.a, TG.b]);

  // Catálogos y municipios con responsables, que deben quedar en nulo.
  await owner.query("update app.municipalities set created_by = $1, updated_by = $1", [admin]);
  const category = await id("insert into app.categories (name, name_normalized, created_by_account_id, updated_by_account_id) values ('Naturaleza', 'naturaleza', $1, $1) on conflict (name_normalized) do update set created_by_account_id = $1, updated_by_account_id = $1 returning id", [admin]);
  const establishmentType = await id("insert into app.establishment_types (name, name_normalized, created_by_account_id, updated_by_account_id) values ('Hotel', 'hotel', $1, $1) on conflict (name_normalized) do update set created_by_account_id = $1, updated_by_account_id = $1 returning id", [admin]);
  await owner.query("update app.experience_types set created_by_account_id = $1, updated_by_account_id = $1", [admin]);
  const experienceType = (await one(owner, "select id from app.experience_types limit 1")).id as string;
  const municipality = (await one(owner, "select id from app.municipalities order by name limit 1")).id as string;

  // Fotos y fichas en estados de todo tipo. La guarda de fotos solo deja cambiar versiones editables; se suspende solo en la siembra.
  await owner.query("alter table app.listing_photos disable trigger listing_photos_guard");
  const providerPhotoPaths: string[] = [];
  const attractionPhotoPaths: string[] = [];
  let n = 0;
  const listing = async (kind: string, businessId: string | null, createdBy: string) =>
    id("insert into app.listings (kind, business_id, created_by_account_id) values ($1, $2, $3) returning id", [kind, businessId, createdBy]);
  const version = async (listingId: string, kind: string, number: number, status: string, submittedBy: string | null, photos: string[]) => {
    n += 1;
    const decided = status === "published" || status === "rejected" || status === "superseded" ? admin : null;
    const versionId = await id(
      `insert into app.listing_versions (listing_id, version_number, status, name, name_normalized, municipality_id, category_id, establishment_type_id, experience_type_id,
         description, schedule, contact, maps_url, guides_info, submitted_by, submitted_at, decided_by, decided_at, rejection_reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Descripción', 'Todos los días', '3000000000', 'https://maps.google.com/?q=1', $10, $11, now(), $12::uuid,
         case when $12::uuid is null then null else now() end, $13) returning id`,
      [
        listingId, number, status, `Ficha ${n}`, `ficha ${n}`, municipality, category,
        kind === "establishment" ? establishmentType : null, kind === "route_experience" ? experienceType : null,
        kind === "route_experience" ? "Guías" : null, submittedBy, decided, status === "rejected" ? "Falta información" : null,
      ],
    );
    for (const [index, uploader] of photos.entries()) {
      const path = `photos/${versionId}/${index + 1}.jpg`;
      await owner.query("insert into app.listing_photos (version_id, blob_pathname, content_type, size_bytes, position, uploaded_by) values ($1, $2, 'image/jpeg', 125, $3, $4)", [versionId, path, index + 1, uploader]);
      storage.put(path, jpegBytes(), "image/jpeg");
      (kind === "attraction" ? attractionPhotoPaths : providerPhotoPaths).push(path);
    }
    return versionId;
  };
  const business = (provider: string) => id("insert into app.businesses (provider_account_id) values ($1) returning id", [provider]);
  const bA1 = await business(a);
  const bA2 = await business(a);
  const bB1 = await business(b);
  const bB2 = await business(b);
  const l1 = await listing("establishment", bA1, a);
  const l2 = await listing("route_experience", bA2, a);
  const l3 = await listing("establishment", bB1, b);
  const l4 = await listing("route_experience", bB2, b);
  const two = (who: string) => [who, who];
  await version(l1, "establishment", 1, "superseded", a, two(a));
  await version(l1, "establishment", 2, "published", a, two(a));
  const l1Draft = await version(l1, "establishment", 3, "draft", a, two(a));
  await version(l2, "route_experience", 1, "rejected", a, two(a));
  const l2Pending = await version(l2, "route_experience", 2, "pending", a, two(a));
  await version(l3, "establishment", 1, "published", b, two(b));
  const l4Draft = await version(l4, "route_experience", 1, "draft", b, two(b));
  // Atractivo: una versión reemplazada y una publicada, ambas con foto subida por el administrador.
  const attraction = await listing("attraction", null, admin);
  await version(attraction, "attraction", 1, "superseded", admin, [admin]);
  const attractionPublished = await version(attraction, "attraction", 2, "published", admin, [admin]);
  await owner.query("alter table app.listing_photos enable trigger listing_photos_guard");

  const upload = (versionId: string, requestedBy: string, path: string) =>
    id("insert into app.photo_uploads (version_id, requested_by_account_id, pathname, declared_size, content_type, expires_at) values ($1, $2, $3, 125, 'image/jpeg', now() + interval '1 hour') returning id", [versionId, requestedBy, path]);
  await upload(l1Draft, a, "uploads/a-1.jpg");
  await upload(l2Pending, a, "uploads/a-2.jpg");
  await upload(l4Draft, b, "uploads/b-1.jpg");
  const attractionUploadId = await upload(attractionPublished, admin, "uploads/attraction-1.jpg");

  // Tres solicitudes con respuesta e historial de estados.
  const request = async (visitor: string, listingId: string, businessId: string, status: string) =>
    id(
      `insert into app.information_requests (listing_id, business_id, visitor_account_id, requester_name, interest_date, party_size, message, status)
       values ($1, $2, $3, 'Ana Solicitante', current_date + 1, 2, 'Quisiera información', $4) returning id`,
      [listingId, businessId, visitor, status],
    );
  const r1 = await request(v1, l1, bA1, "attended");
  const r2 = await request(v2, l3, bB1, "new");
  const r3 = await request(v3, l1, bA1, "closed");
  await owner.query("insert into app.information_request_replies (request_id, body, sent_by_account_id) values ($1, 'Con gusto', $2), ($3, 'Claro', $4)", [r1, a, r2, b]);
  await owner.query("insert into app.information_request_status_events (request_id, from_status, to_status, actor_account_id) values ($1, 'new', 'attended', $2), ($3, 'new', 'attended', $2), ($3, 'attended', 'closed', $2)", [r1, a, r3]);

  const orphanPath = "photos/huerfano/sin-referencia.jpg";
  storage.put(orphanPath, jpegBytes(), "image/jpeg");
  return { attractionId: attraction, attractionPublishedVersionId: attractionPublished, attractionPhotoPaths, providerPhotoPaths, orphanPath, attractionUploadId };
}

// Dependencias de los manejadores de las tareas programadas, con el almacén en memoria y el secreto de pruebas.
export function cronDeps(storage: MemoryStorage, overrides: Partial<Deps> = {}): Deps & { destroy: () => Promise<void> } {
  const db = appDb();
  return { config: () => testConfig(), db: () => db, now: () => new Date(), storage: () => storage, cronSecret: () => CRON_SECRET, destroy: () => db.destroy(), ...overrides };
}

export const cronRequest = (job: "retention" | "maintenance", authorization: string | null = `Bearer ${CRON_SECRET}`) =>
  new Request(`http://localhost/api/v1/internal/cron/${job}`, { headers: authorization === null ? {} : { Authorization: authorization } });
