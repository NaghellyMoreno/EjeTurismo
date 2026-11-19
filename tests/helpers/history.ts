import type { Pool } from "pg";
import { getListingStatusHistoryHandler } from "@/server/http/handlers";
import { createAccount } from "../factories/accounts";
import { grantAdminRole } from "../factories/review";
import { draftBody, SUBMIT_BODY } from "./listing-http";
import { A6, ADMIN, flush, makeReviewListingApi, NAME_ONE, REASON, type World } from "./review-listing";
import { signInitData, tma } from "./telegram";

// F029: datos ficticios y recorrido de la ficha de prueba del historial (FH) con los servicios reales.
export const AD2 = 900007002; // segundo administrador común
export const AD2_NAME = "Administrador Ficticio Dos";
export const A6_NAME = "Prestadora Ficticia";
export const ADMIN_NAME = "Administrador Ficticio";
export const FIXED_INSTANT = "2026-11-20T03:30:00Z"; // se muestra 19/11/2026 22:30 en Bogotá
export const FIXED_BOGOTA = "19/11/2026 22:30";

export interface FhIds {
  listingId: string;
  v1: string;
  v2: string;
}

// Segundo administrador (AD2) con cuenta y permiso `admin`.
export async function seedAd2(owner: Pool): Promise<void> {
  await createAccount(owner, AD2, AD2_NAME);
  await grantAdminRole(owner, AD2);
}

// FH: borrador (v1, A6), enviada, rechazada por el administrador de prueba con REASON, corregida (v2), enviada y aprobada por AD2.
// Fija `occurred_at` de los 6 eventos con el rol propietario (el evento 3 en FIXED_INSTANT) y devuelve los ids.
export async function recorrerFh(api: ReturnType<typeof makeReviewListingApi>, owner: Pool, world: World, tasks: Array<() => unknown>, name = NAME_ONE): Promise<FhIds> {
  // El nombre de cuenta por defecto de la factoría trae el ID de Telegram; se cambia para que su ausencia en las respuestas se pueda comprobar.
  await owner.query("update app.accounts set telegram_display_name = $1 where telegram_user_id = $2", [A6_NAME, A6]);
  const { listingId, versionId: v1 } = await api.pending(world, name);
  expectOk(await api.reject(ADMIN, v1, { confirmed: true, reason: REASON }));
  await flush(tasks);
  expectOk(await api.save(A6, listingId, draftBody(world, { name })));
  const submitted = await api.submit(A6, listingId, SUBMIT_BODY);
  expectOk(submitted);
  const v2 = ((await submitted.json()) as { working: { id: string } }).working.id;
  expectOk(await api.approve(AD2, v2));
  await flush(tasks);
  await fijarInstantes(owner, listingId);
  return { listingId, v1, v2 };
}

function expectOk(res: Response): void {
  if (res.status >= 300) throw new Error(`Paso del recorrido de FH falló con ${res.status}`);
}

// Eventos 1 y 2 antes de FIXED_INSTANT (03:10 y 03:20), el 3 en FIXED_INSTANT y 4, 5 y 6 después (03:40, 03:50 y 04:00).
export async function fijarInstantes(owner: Pool, listingId: string): Promise<void> {
  const ids = (await owner.query("select id from app.listing_status_events where listing_id = $1 order by id", [listingId])).rows.map((r) => r.id);
  const instants = ["2026-11-20T03:10:00Z", "2026-11-20T03:20:00Z", FIXED_INSTANT, "2026-11-20T03:40:00Z", "2026-11-20T03:50:00Z", "2026-11-20T04:00:00Z"];
  for (const [i, id] of ids.entries()) await owner.query("update app.listing_status_events set occurred_at = $1 where id = $2", [instants[i], id]);
}

// Manejador real del historial con el reloj de la base de prueba.
export function makeHistoryApi(deps: Parameters<typeof getListingStatusHistoryHandler>[0]) {
  const handler = getListingStatusHistoryHandler(deps);
  return (userId: number | null, listingId: string, headers?: Record<string, string>) =>
    handler(
      new Request(`http://localhost/api/v1/managed-listings/${listingId}/status-history`, { headers: headers ?? (userId === null ? {} : tma(signInitData({ userId }))) }),
      { params: Promise.resolve({ listingId }) },
    );
}

// Siembra `count` eventos de una ficha con el rol propietario, en una sola transacción cuando `sameTransaction` es true.
export async function seedEvents(
  owner: Pool,
  listingId: string,
  versionId: string,
  events: Array<{ from: string | null; to: string; role?: "provider" | "admin" | "system"; accountId?: string | null; reason?: string | null; at?: string }>,
): Promise<void> {
  const client = await owner.connect();
  try {
    await client.query("begin");
    for (const e of events) {
      await client.query(
        `insert into app.listing_status_events (listing_id, version_id, from_status, to_status, actor_account_id, actor_role, reason, occurred_at)
         values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()))`,
        [listingId, versionId, e.from, e.to, e.accountId ?? null, e.role ?? "system", e.reason ?? null, e.at ?? null],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
