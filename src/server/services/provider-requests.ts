import { sql } from "kysely";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { PARAM_INVALID_TEXT } from "@/server/domain/listings";
import { validateReplyCreate, validateStatusChange } from "@/server/domain/information-request-reply";
import { AppError, type FieldError } from "@/server/errors";
import { uuidPattern } from "./managed-listings";
import { assertProvider } from "./role-revocation";
import type { Db } from "./types";

// F032: el prestador atiende las solicitudes de información de su negocio (HU-026; D-010, D-011, D-044, D-189). Todo se verifica
// aquí contra la base en cada llamada: aviso vigente, rol de prestador y que la solicitud sea de un negocio suyo (invariantes 1 y 2).
// Una solicitud ajena, inexistente o con un identificador mal formado responde igual (403), para no revelar si existe.
export type InformationRequest = components["schemas"]["InformationRequest"];
export type InformationRequestPage = components["schemas"]["InformationRequestPage"];
export type InformationRequestReply = components["schemas"]["InformationRequestReply"];
export type InformationRequestStatus = components["schemas"]["InformationRequestStatus"];

// Plantilla de la respuesta al visitante (B20) en `notification_outbox`. El payload solo lleva el id de la respuesta y la ficha:
// el texto escrito por el prestador se lee de `information_request_replies` al enviar.
export const TEMPLATE_INFORMATION_REQUEST_REPLY = "information_request_reply";

const forbidden = () => new AppError("forbidden", 403, "Sin permiso para esta solicitud");
const closed = () =>
  new AppError("invalid_state_transition", 409, "Solicitud cerrada", undefined, { detail: "Esta solicitud ya está cerrada." });
const badTransition = () =>
  new AppError("invalid_state_transition", 409, "Cambio de estado no permitido", undefined, {
    detail: "El estado solo avanza de nueva a atendida y de atendida a cerrada.",
  });
const reasonOf = (error: unknown): string | null =>
  (error as { code?: unknown } | null)?.code === "P0001" ? String((error as { message?: unknown }).message ?? "") : null;

const STATUSES: readonly string[] = ["new", "attended", "closed"];
const MAX_PAGE_SIZE = 50;

async function loadRequests(db: Db, accountId: string, where: { id?: string; status?: InformationRequestStatus; page?: { page: number; pageSize: number } }) {
  let query = db
    .selectFrom("information_requests as r")
    .innerJoin("businesses as b", "b.id", "r.business_id")
    .where("b.provider_account_id", "=", accountId)
    .select((eb) => [
      "r.id", "r.listing_id", "r.business_id", "r.requester_name", "r.party_size", "r.message", "r.status", "r.created_at", "r.updated_at",
      sql<string>`to_char(r.interest_date, 'YYYY-MM-DD')`.as("interest_date"),
      // Nombre de la ficha: el de la versión publicada o, si no hay, el de la última versión.
      eb
        .selectFrom("listing_versions as v")
        .select("v.name")
        .whereRef("v.listing_id", "=", "r.listing_id")
        .orderBy(sql`(v.status = 'published')`, "desc")
        .orderBy("v.version_number", "desc")
        .limit(1)
        .as("listing_name"),
    ]);
  if (where.id) query = query.where("r.id", "=", where.id);
  if (where.status) query = query.where("r.status", "=", where.status);
  query = query.orderBy("r.created_at", "desc").orderBy("r.id", "desc");
  if (where.page) query = query.limit(where.page.pageSize).offset((where.page.page - 1) * where.page.pageSize);
  const rows = await query.execute();
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [replies, events] = await Promise.all([
    db
      .selectFrom("information_request_replies as p")
      .leftJoin("notification_outbox as o", (join) =>
        join.on(sql<boolean>`o.template = ${TEMPLATE_INFORMATION_REQUEST_REPLY} and o.payload->>'replyId' = p.id::text`),
      )
      .select(["p.id", "p.request_id", "p.body", "p.sent_at", "o.status as delivery"])
      .where("p.request_id", "in", ids)
      .orderBy("p.sent_at", "asc")
      .orderBy("p.id", "asc")
      .execute(),
    db
      .selectFrom("information_request_status_events as e")
      .leftJoin("accounts as a", "a.id", "e.actor_account_id")
      .select(["e.id", "e.request_id", "e.from_status", "e.to_status", "e.occurred_at", "a.telegram_display_name as actor_name"])
      .where("e.request_id", "in", ids)
      .orderBy("e.occurred_at", "asc")
      .orderBy("e.id", "asc")
      .execute(),
  ]);

  return rows.map((row): InformationRequest => ({
    id: row.id,
    listingId: row.listing_id,
    listingName: row.listing_name ?? "",
    requesterName: row.requester_name,
    interestDate: row.interest_date,
    partySize: row.party_size,
    message: row.message,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    replies: replies
      .filter((reply) => reply.request_id === row.id)
      .map((reply) => ({
        id: reply.id,
        body: reply.body,
        sentAt: reply.sent_at.toISOString(),
        deliveryStatus: reply.delivery === "sent" ? "sent" : reply.delivery === "failed" ? "failed" : "queued",
      })),
    statusHistory: events
      .filter((event) => event.request_id === row.id)
      .map((event) => ({
        occurredAt: event.occurred_at.toISOString(),
        fromStatus: event.from_status,
        toStatus: event.to_status,
        actor: { displayName: event.actor_name, role: "provider" as const },
      })),
  }));
}

// GET /api/v1/information-requests (listMyBusinessInformationRequests): `status`, `page` >= 1 y `pageSize` de 1 a 50.
export async function listMyBusinessInformationRequests(db: Db, actor: Actor, params: URLSearchParams): Promise<InformationRequestPage> {
  const provider = await assertProvider(db, actor);
  const errors: FieldError[] = [];
  const integer = (field: "page" | "pageSize", max: number, fallback: number) => {
    const raw = params.get(field);
    if (raw === null) return fallback;
    const n = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(n) || n < 1 || n > max) {
      errors.push({ field, code: "invalid", message: PARAM_INVALID_TEXT });
      return fallback;
    }
    return n;
  };
  const page = integer("page", Number.MAX_SAFE_INTEGER, 1);
  const pageSize = integer("pageSize", MAX_PAGE_SIZE, 20);
  const status = params.get("status");
  if (status !== null && !STATUSES.includes(status)) errors.push({ field: "status", code: "invalid", message: PARAM_INVALID_TEXT });
  if (errors.length > 0) throw new AppError("validation_failed", 422, "Datos inválidos", errors);

  const filter = status === null ? undefined : (status as InformationRequestStatus);
  let count = db
    .selectFrom("information_requests as r")
    .innerJoin("businesses as b", "b.id", "r.business_id")
    .where("b.provider_account_id", "=", provider.id)
    .select((eb) => eb.fn.countAll<string>().as("total"));
  if (filter) count = count.where("r.status", "=", filter);
  const [{ total }, items] = await Promise.all([count.executeTakeFirstOrThrow(), loadRequests(db, provider.id, { status: filter, page: { page, pageSize } })]);
  return { items, page, pageSize, total: Number(total) };
}

// Solicitud de un negocio del prestador; cualquier otra (ajena, inexistente o con id mal formado) es 403.
async function loadOwned(db: Db, accountId: string, requestId: string): Promise<InformationRequest> {
  if (!uuidPattern.test(requestId)) throw forbidden();
  const [request] = await loadRequests(db, accountId, { id: requestId });
  if (!request) throw forbidden();
  return request;
}

// GET /api/v1/information-requests/{requestId} (getInformationRequest).
export async function getInformationRequest(db: Db, actor: Actor, requestId: string): Promise<InformationRequest> {
  const provider = await assertProvider(db, actor);
  return loadOwned(db, provider.id, requestId);
}

// POST .../replies (replyToInformationRequest). La respuesta y la fila de la bandeja para el visitante se escriben en la misma
// transacción (ADR 0007); `onQueued` recibe el id para enviarla con `after()`. No cambia el estado (D-189). Orden: 401, 403, 422, 409.
export async function replyToInformationRequest(
  db: Db,
  actor: Actor,
  requestId: string,
  rawInput: unknown,
  now: Date = new Date(),
  onQueued?: (notificationIds: string[]) => void,
): Promise<InformationRequestReply> {
  const provider = await assertProvider(db, actor);
  const request = await loadOwned(db, provider.id, requestId);
  const { errors, value } = validateReplyCreate(rawInput);
  if (!value) throw new AppError("validation_failed", 422, "Datos inválidos", errors);
  if (request.status === "closed") throw closed();

  const visitor = await db
    .selectFrom("information_requests as r")
    .innerJoin("accounts as v", "v.id", "r.visitor_account_id")
    .select("v.telegram_user_id")
    .where("r.id", "=", request.id)
    .executeTakeFirst();
  if (!visitor) throw forbidden();

  try {
    const created = await db.transaction().execute(async (trx) => {
      const reply = await trx
        .insertInto("information_request_replies")
        .values({ request_id: request.id, body: value.body, sent_by_account_id: provider.id, sent_at: now })
        .returning(["id", "body", "sent_at"])
        .executeTakeFirstOrThrow();
      const notice = await trx
        .insertInto("notification_outbox")
        .values({
          recipient_telegram_user_id: String(visitor.telegram_user_id),
          template: TEMPLATE_INFORMATION_REQUEST_REPLY,
          // Sin el texto de la respuesta ni datos de nadie: el envío lo lee de la respuesta (sección 3.15).
          payload: JSON.stringify({ replyId: reply.id, listingName: request.listingName }),
          created_at: now,
          next_attempt_at: null,
          sent_at: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { reply, noticeId: notice.id };
    });
    onQueued?.([created.noticeId]);
    return { id: created.reply.id, body: created.reply.body, sentAt: created.reply.sent_at.toISOString(), deliveryStatus: "queued" };
  } catch (error) {
    // Carrera: la solicitud se cerró entre la lectura y la inserción; el disparador es la última defensa.
    const reason = reasonOf(error);
    if (reason === "request_closed") throw closed();
    if (reason === "not_request_owner") throw forbidden();
    throw error;
  }
}

// POST .../status-changes (changeInformationRequestStatus): solo new, attended, closed y sin saltos (D-044, D-189). El servicio
// fija el actor en la transacción y el disparador de la base lo verifica y escribe el evento. Orden: 401, 403, 422, 409.
export async function changeInformationRequestStatus(
  db: Db,
  actor: Actor,
  requestId: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<InformationRequest> {
  const provider = await assertProvider(db, actor);
  await loadOwned(db, provider.id, requestId);
  const { errors, value } = validateStatusChange(rawInput);
  if (!value) throw new AppError("validation_failed", 422, "Datos inválidos", errors);

  try {
    await db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom("information_requests").select("status").where("id", "=", requestId).forUpdate().executeTakeFirstOrThrow();
      const allowed = (current.status === "new" && value.status === "attended") || (current.status === "attended" && value.status === "closed");
      if (!allowed) throw badTransition();
      await sql`select set_config('app.actor_account_id', ${provider.id}, true)`.execute(trx);
      await trx.updateTable("information_requests").set({ status: value.status, updated_at: now }).where("id", "=", requestId).execute();
    });
  } catch (error) {
    const reason = reasonOf(error);
    if (reason === "invalid_state_transition") throw badTransition();
    if (reason === "not_request_owner") throw forbidden();
    throw error;
  }
  return loadOwned(db, provider.id, requestId);
}
