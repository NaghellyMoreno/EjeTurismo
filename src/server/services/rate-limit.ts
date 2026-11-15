import type { RateLimitRule } from "@/server/config";
import { AppError } from "@/server/errors";
import type { Db } from "./types";

// Límite de intentos por cuenta, con ventana fija (ADR 0006). El incremento es atómico y solo ocurre si queda cupo:
// un intento rechazado (429) no suma. Se confirma en su propia sentencia, antes de la acción, para que un fallo posterior
// de la acción tampoco lo deshaga (D-082).
export async function consumeRateLimit(db: Db, accountId: string, action: string, rule: RateLimitRule, now: Date): Promise<void> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const row = await db
    .insertInto("rate_limit_counters")
    .values({ account_id: accountId, action, window_start: windowStart, count: 1 })
    .onConflict((oc) =>
      oc
        .columns(["account_id", "action", "window_start"])
        .doUpdateSet((eb) => ({ count: eb("rate_limit_counters.count", "+", 1) }))
        .where("rate_limit_counters.count", "<", rule.limit),
    )
    .returning("count")
    .executeTakeFirst();
  if (row) return;
  const retryAfter = Math.min(rule.windowSeconds, Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000)));
  throw new AppError("rate_limited", 429, "Demasiados intentos", undefined, { retryAfterSeconds: retryAfter });
}
