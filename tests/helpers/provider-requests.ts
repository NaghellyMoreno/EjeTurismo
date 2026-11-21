import type { Pool } from "pg";
import {
  changeInformationRequestStatusHandler,
  getInformationRequestHandler,
  listMyBusinessInformationRequestsHandler,
  replyToInformationRequestHandler,
} from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { seedInfoWorld, P3, type InfoWorld } from "./information-request";
import { seedListing } from "./listing-data";
import { signInitData, tma } from "./telegram";

// F032: datos ficticios (contrato, "Datos de prueba"). P1 (dueño de L1) y V vienen de F030; P3 hace de "P2" del contrato: prestador
// aprobado con su propia ficha L2; el prestador revocado es el P2 de F030.
export const REPLY = "Respuesta de prueba CANARIO-F032-7731";
export const REQUEST_NAME = "Ana de Prueba";
export const REQUEST_MESSAGE = "Consulta de prueba CANARIO-F031-4420";
export const CANARIES = [REQUEST_NAME, "CANARIO-F031-4420", "CANARIO-F032-7731"];
export const L2_NAME = "Hostal Ejemplo de Prueba";
export const FIXED_CLOCK = new Date("2026-11-21T15:00:00-05:00");
export const EDGE = "<b>x</b> & *y* _z_ [a](http://x)";
export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

export interface World32 extends InfoWorld {
  l2b: { listingId: string; businessId: string }; // ficha de P3
}

export async function seedWorld32(owner: Pool): Promise<World32> {
  const world = await seedInfoWorld(owner);
  const l2b = await seedListing(owner, { accountId: world.accounts[P3], municipalityId: world.municipalityId, categoryId: world.categoryId, name: L2_NAME, status: "published" });
  return { ...world, l2b: { listingId: l2b.listingId, businessId: l2b.businessId! } };
}

export interface RequestOptions {
  listingId: string;
  businessId: string;
  visitorAccountId: string;
  status?: "new" | "attended" | "closed";
  name?: string;
  message?: string;
  interestDate?: string;
  createdAt?: Date;
}

// Inserta una solicitud con el rol propietario (la aplicación solo puede crear nuevas).
export async function insertRequest(owner: Pool, o: RequestOptions): Promise<string> {
  const createdAt = o.createdAt ?? new Date("2026-11-21T14:00:00-05:00");
  const { rows } = await owner.query(
    `insert into app.information_requests (listing_id, business_id, visitor_account_id, requester_name, interest_date, party_size, message, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 3, $6, $7, $8, $8) returning id`,
    [o.listingId, o.businessId, o.visitorAccountId, o.name ?? REQUEST_NAME, o.interestDate ?? "2026-11-25", o.message ?? REQUEST_MESSAGE, o.status ?? "new", createdAt],
  );
  return rows[0].id as string;
}

export const replyRows = async (owner: Pool) => (await owner.query("select * from app.information_request_replies order by sent_at, id")).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const eventRows = async (owner: Pool) => (await owner.query("select * from app.information_request_status_events order by id")).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const outboxRows = async (owner: Pool) => (await owner.query("select * from app.notification_outbox order by created_at, id")).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const statusOf = async (owner: Pool, id: string) => (await owner.query("select status from app.information_requests where id = $1", [id])).rows[0].status as string;

// Manejadores reales de las cuatro operaciones; `user` nulo es sin sesión.
export function requestsApi(deps: Deps) {
  const list = listMyBusinessInformationRequestsHandler(deps);
  const get = getInformationRequestHandler(deps);
  const reply = replyToInformationRequestHandler(deps);
  const change = changeInformationRequestStatusHandler(deps);
  const headers = (user: number | null, json: boolean) => ({
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(user === null ? {} : tma(signInitData({ userId: user, authDate: Math.floor(deps.now().getTime() / 1000) }))),
  });
  const ctx = (id: string) => ({ params: Promise.resolve({ requestId: id }) });
  return {
    list: (user: number | null, query = "") => list(new Request(`http://localhost/api/v1/information-requests${query}`, { headers: headers(user, false) })),
    get: (user: number | null, id: string) => get(new Request(`http://localhost/api/v1/information-requests/${id}`, { headers: headers(user, false) }), ctx(id)),
    reply: (user: number | null, id: string, body: unknown, rawHeaders?: Record<string, string>) =>
      reply(new Request(`http://localhost/api/v1/information-requests/${id}/replies`, { method: "POST", headers: rawHeaders ?? headers(user, true), body: JSON.stringify(body) }), ctx(id)),
    change: (user: number | null, id: string, body: unknown) =>
      change(new Request(`http://localhost/api/v1/information-requests/${id}/status-changes`, { method: "POST", headers: headers(user, true), body: JSON.stringify(body) }), ctx(id)),
  };
}
