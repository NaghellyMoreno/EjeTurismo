import { revokeMyAuthorizationHandler } from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { testConfig } from "./config";
import { appDb } from "./db";
import { signInitData, tma } from "./telegram";

// Manejador real de F034 con la base de prueba (rol eje_app). Reloj real: el initData firmado usa la hora actual.
export function makeSelfRevokeApi(db = appDb(), now: () => Date = () => new Date()) {
  const deps: Deps = { config: () => testConfig(), db: () => db, now };
  const handler = revokeMyAuthorizationHandler(deps);
  const revoke = (userId: number | null, body: unknown = { confirmed: true }, headers?: Record<string, string>) =>
    handler(
      new Request("http://localhost/api/v1/consents/revocations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(headers ?? (userId === null ? {} : tma(signInitData({ userId })))) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  return { db, deps, revoke };
}
