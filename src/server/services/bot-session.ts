import type { Db } from "./types";

// Almacenamiento de la sesión del bot sobre `bot_sessions` (ADR 0015). Solo existe para cuentas con el aviso vigente aceptado.
export interface StoredSession {
  data: unknown;
  updatedAt: Date;
}

export async function loadBotSession(db: Db, accountId: string): Promise<StoredSession | null> {
  const row = await db.selectFrom("bot_sessions").select(["data", "updated_at"]).where("account_id", "=", accountId).executeTakeFirst();
  return row ? { data: row.data, updatedAt: row.updated_at } : null;
}

// Bloqueo optimista: guarda solo si `updated_at` sigue siendo el que se leyó. Devuelve false si otra actualización se adelantó.
export async function saveBotSession(db: Db, accountId: string, data: unknown, expected: Date | null, now: Date): Promise<boolean> {
  const json = JSON.stringify(data);
  if (expected === null) {
    const row = await db
      .insertInto("bot_sessions")
      .values({ account_id: accountId, data: json, updated_at: now })
      .onConflict((oc) => oc.column("account_id").doNothing())
      .returning("account_id")
      .executeTakeFirst();
    return !!row;
  }
  const row = await db
    .updateTable("bot_sessions")
    .set({ data: json, updated_at: now })
    .where("account_id", "=", accountId)
    .where("updated_at", "=", expected)
    .returning("account_id")
    .executeTakeFirst();
  return !!row;
}

// Vacía el borrador (cancelar, duplicado). Sin bloqueo: borrar un número sellado nunca debe fallar por una carrera.
export async function clearBotSession(db: Db, accountId: string, now: Date): Promise<void> {
  await db.updateTable("bot_sessions").set({ data: "{}", updated_at: now }).where("account_id", "=", accountId).execute();
}
