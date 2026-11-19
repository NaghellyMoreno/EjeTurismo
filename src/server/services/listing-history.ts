import { sql } from "kysely";
import { z } from "zod";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import type { Config } from "@/server/config";
import { AppError } from "@/server/errors";
import { assertAdmin } from "./provider-review";
import type { Db } from "./types";

type ListingStatusEvent = components["schemas"]["ListingStatusEvent"];
type Status = components["schemas"]["ListingVersionStatus"];

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;
const notFound = () => new AppError("not_found", 404, "Ficha no encontrada", undefined, { detail: "No encontramos la ficha." });

// F029 (HU-028): historial de estados de una ficha, solo para el administrador. Orden: 401, 403 `consent_required`,
// 403 `forbidden`, 404 (ficha inexistente o con ID mal formado). Solo lectura. Nunca devuelve número de identidad, ID de
// Telegram ni ID de cuenta: el responsable es el nombre visible y el rol guardado en el evento.
export async function getListingStatusHistory(db: Db, config: Config, actor: Actor, listingId: string): Promise<ListingStatusEvent[]> {
  await assertAdmin(db, config, actor);
  if (!isUuid(listingId)) throw notFound();
  const listing = await db.selectFrom("listings").select("id").where("id", "=", listingId).executeTakeFirst();
  if (!listing) throw notFound();
  const rows = await db
    .selectFrom("listing_status_events as e")
    .innerJoin("listing_versions as v", "v.id", "e.version_id")
    .leftJoin("accounts as a", "a.id", "e.actor_account_id")
    .select(["e.occurred_at", "e.version_id", "v.version_number", "e.from_status", "e.to_status", "e.actor_role", "e.reason", "a.telegram_display_name"])
    .where("e.listing_id", "=", listingId)
    .orderBy("e.occurred_at", "asc")
    .orderBy("e.id", "asc")
    .execute();
  return rows.map((row) => ({
    occurredAt: new Date(row.occurred_at).toISOString(),
    versionId: row.version_id,
    versionNumber: row.version_number,
    fromStatus: row.from_status as Status | null,
    toStatus: row.to_status as Status,
    actor: { displayName: row.telegram_display_name, role: row.actor_role },
    reason: row.reason,
  }));
}

// Nombre de la última versión de la ficha (título del mensaje del bot). El llamador ya pasó `getListingStatusHistory`.
export async function getHistoryListingName(db: Db, listingId: string): Promise<string> {
  const row = await db.selectFrom("listing_versions").select("name").where("listing_id", "=", listingId).orderBy("version_number", "desc").executeTakeFirst();
  return row?.name ?? "";
}

export interface HistoryListItem {
  listingId: string;
  name: string;
  municipalityName: string;
}

// Lista interna del bot (B11, P1): las fichas con actividad más reciente (`max(occurred_at)` descendente y, en empate,
// `listingId` ascendente), de cualquier estado y tipo. Sin ruta: no está en el openapi.
export async function listListingsForHistory(db: Db, config: Config, actor: Actor, limit: number): Promise<{ items: HistoryListItem[]; total: number }> {
  await assertAdmin(db, config, actor);
  const total = await db.selectFrom("listings").select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow();
  const rows = await db
    .selectFrom("listings as l")
    .innerJoin("listing_status_events as e", "e.listing_id", "l.id")
    .select(["l.id", sql<Date>`max(e.occurred_at)`.as("last_at")])
    .groupBy("l.id")
    .orderBy("last_at", "desc")
    .orderBy("l.id", "asc")
    .limit(limit)
    .execute();
  const items: HistoryListItem[] = [];
  for (const row of rows) {
    const latest = await db
      .selectFrom("listing_versions as v")
      .innerJoin("municipalities as m", "m.id", "v.municipality_id")
      .select(["v.name", "m.name as municipality_name"])
      .where("v.listing_id", "=", row.id)
      .orderBy("v.version_number", "desc")
      .executeTakeFirstOrThrow();
    items.push({ listingId: row.id, name: latest.name, municipalityName: latest.municipality_name });
  }
  return { items, total: Number(total.n) };
}
