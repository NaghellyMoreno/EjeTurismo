import { GrammyError } from "grammy";
import {
  approveProviderRegistrationHandler,
  listProviderRegistrationsHandler,
  rejectProviderRegistrationHandler,
} from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { testConfig } from "./config";
import { appDb } from "./db";
import { signInitData, tma } from "./telegram";

export interface SentMessage {
  chatId: string;
  text: string;
}

// Qué hace el remitente simulado de Telegram: responde bien, con 500 o con 403 (la persona bloqueó el bot).
export type TelegramMode = "ok" | "error500" | "error403";

export function telegramError(code: number) {
  return new GrammyError("Llamada a sendMessage falló", { ok: false, error_code: code, description: "simulado" }, "sendMessage", {});
}

// Manejadores reales de F003 con la base de prueba (rol eje_app) y un remitente simulado.
export function makeReviewApi(now: () => Date = () => new Date()) {
  const db = appDb();
  const sent: SentMessage[] = [];
  const state = { mode: "ok" as TelegramMode };
  const deps: Deps = {
    config: () => testConfig(),
    db: () => db,
    now,
    send: async (chatId, text) => {
      if (state.mode === "error500") throw telegramError(500);
      if (state.mode === "error403") throw telegramError(403);
      sent.push({ chatId, text });
    },
  };
  return {
    db,
    deps,
    sent,
    state,
    list: listProviderRegistrationsHandler(deps),
    approve: approveProviderRegistrationHandler(deps),
    reject: rejectProviderRegistrationHandler(deps),
    destroy: () => db.destroy(),
  };
}

export const listRequest = (userId: number, query = "", headers?: Record<string, string>) =>
  new Request(`http://localhost/api/v1/provider-registrations${query}`, { headers: headers ?? tma(signInitData({ userId })) });

export const decisionRequest = (kind: "approval" | "rejection", registrationId: string, userId: number, body: unknown, headers?: Record<string, string>) =>
  new Request(`http://localhost/api/v1/provider-registrations/${registrationId}/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? tma(signInitData({ userId }))) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

export const route = (registrationId: string) => ({ params: Promise.resolve({ registrationId }) });

export const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
