import type { Config } from "@/server/config";
import type { Db } from "./types";

// D-101: el administrador principal queda reflejado en `role_grants` (ADR 0003). Idempotente y sin error si ya hay una fila
// `is_principal` de otro ID (D-109): el guardián reconoce al principal por la configuración, no por esta fila.
export async function ensurePrincipalGrant(db: Db, config: Config, telegramUserId: string, now: Date = new Date()): Promise<void> {
  if (config.principalAdminTelegramId !== telegramUserId) return;
  await db
    .insertInto("role_grants")
    .values({
      telegram_user_id: telegramUserId,
      role: "admin",
      is_principal: true,
      provider_registration_id: null,
      granted_by_account_id: null,
      granted_at: now,
      revoked_at: null,
      revoked_by_account_id: null,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
}
