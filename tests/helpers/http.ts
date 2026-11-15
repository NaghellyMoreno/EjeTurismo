import { createProviderRegistrationHandler, getMyProviderRegistrationHandler } from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { testConfig } from "./config";
import { appDb } from "./db";
import { signInitData, tma } from "./telegram";

// Manejadores reales de F002 con la base de prueba (rol eje_app) y una configuración que cada prueba puede ajustar.
export function makeApi(env: Record<string, string | undefined> = {}, now: () => Date = () => new Date()) {
  const db = appDb();
  const deps: Deps = { config: () => testConfig(env), db: () => db, now };
  return {
    db,
    deps,
    create: createProviderRegistrationHandler(deps),
    me: getMyProviderRegistrationHandler(deps),
    destroy: () => db.destroy(),
  };
}

export const createRequest = (userId: number, body: unknown, headers?: Record<string, string>) =>
  new Request("http://localhost/api/v1/provider-registrations", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? tma(signInitData({ userId }))) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

export const meRequest = (userId: number, headers?: Record<string, string>) =>
  new Request("http://localhost/api/v1/provider-registrations/me", { headers: headers ?? tma(signInitData({ userId })) });

export const registration = (type: unknown, number: unknown, confirmed: unknown = true) => ({
  identityDocumentType: type,
  identityNumber: number,
  confirmed,
});

export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
