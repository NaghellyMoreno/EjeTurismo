import type { Pool } from "pg";
import {
  approveListingVersionHandler,
  getReviewHandler,
  listPendingReviewsHandler,
  rejectListingVersionHandler,
} from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { testConfig } from "./config";
import { appDb } from "./db";
import { A6, createBody, ESTABLISHMENT_ONE, makeListingApi, SUBMIT_BODY, type World } from "./listing-http";
import { signInitData, tma } from "./telegram";
import { telegramError, type SentMessage, type TelegramMode } from "./review-http";

export { A6, ADMIN, P2P, seedWorld, VISITOR, UNKNOWN_ID, type World } from "./listing-http";

export const NAME_ONE = ESTABLISHMENT_ONE; // "Establecimiento Ficticio Uno"
export const NAME_TWO = "Establecimiento Ficticio Dos";
export const NAME_THREE = "Establecimiento Ficticio Tres";
export const REASON = "Falta el horario real.";

// Manejadores reales de F014 con la base de prueba (rol eje_app), el reloj ajustable y un remitente simulado de Telegram.
export function makeReviewListingApi(db = appDb(), config = testConfig()) {
  const listing = makeListingApi(db);
  const sent: SentMessage[] = [];
  const state = { mode: "ok" as TelegramMode, now: () => new Date() };
  const deps: Deps = {
    config: () => config,
    db: () => db,
    now: () => state.now(),
    send: async (chatId, text) => {
      if (state.mode === "error500") throw telegramError(500);
      if (state.mode === "error403") throw telegramError(403);
      sent.push({ chatId, text });
    },
  };
  const list = listPendingReviewsHandler(deps);
  const get = getReviewHandler(deps);
  const approve = approveListingVersionHandler(deps);
  const reject = rejectListingVersionHandler(deps);
  const headersOf = (userId: number | null, extra?: Record<string, string>) => extra ?? (userId === null ? {} : tma(signInitData({ userId })));
  const ctx = (versionId: string) => ({ params: Promise.resolve({ versionId }) });
  const base = "http://localhost/api/v1/reviews";
  const post = (kind: "approval" | "rejection", userId: number | null, versionId: string, body: unknown, extra?: Record<string, string>) =>
    new Request(`${base}/${versionId}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headersOf(userId, extra) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return {
    ...listing,
    sent,
    state,
    deps,
    reviews: (userId: number | null, query = "", extra?: Record<string, string>) =>
      list(new Request(`${base}${query ? `?${query}` : ""}`, { headers: headersOf(userId, extra) })),
    review: (userId: number | null, versionId: string, extra?: Record<string, string>) =>
      get(new Request(`${base}/${versionId}`, { headers: headersOf(userId, extra) }), ctx(versionId)),
    approve: (userId: number | null, versionId: string, body: unknown = { confirmed: true }, extra?: Record<string, string>) =>
      approve(post("approval", userId, versionId, body, extra), ctx(versionId)),
    reject: (userId: number | null, versionId: string, body: unknown = { confirmed: true, reason: REASON }, extra?: Record<string, string>) =>
      reject(post("rejection", userId, versionId, body, extra), ctx(versionId)),
    // Una ficha de A6 (u otro prestador) enviada a revisión; devuelve la ficha y su versión pendiente.
    async pending(world: World, name = NAME_ONE, userId = A6, content: Record<string, unknown> = {}) {
      const created = (await (await listing.create(userId, createBody(world, { name, ...content }))).json()) as { id: string };
      const submitted = (await (await listing.submit(userId, created.id, SUBMIT_BODY)).json()) as { id: string; working: { id: string } };
      return { listingId: created.id, versionId: submitted.working.id };
    },
  };
}

// Vuelve a ejecutar los envíos que `after()` dejó pendientes.
export async function flush(tasks: Array<() => unknown>): Promise<void> {
  while (tasks.length > 0) await tasks.shift()!();
}

export const rowsOf = async (owner: Pool, sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
