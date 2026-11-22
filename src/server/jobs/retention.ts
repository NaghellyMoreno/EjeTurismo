import { sql } from "kysely";
import type { components } from "@/shared/api/schema";
import type { Db } from "@/server/services";

export type JobResult = components["schemas"]["JobResult"];

interface PurgeOutcome {
  executed: boolean;
  skippedReason: string | null;
  deleted: Record<string, number>;
}

// Eliminación del 31 de enero de 2027 (D-043, ADR 0007). La fecha, el plazo y el "una sola vez" los decide la base de datos
// (`app.purge_personal_data()`), en una sola transacción; aquí solo se informa el resultado, sin datos personales.
export async function runRetentionJob(db: Db, now: Date = new Date()): Promise<JobResult> {
  const { rows } = await sql<{ result: PurgeOutcome }>`select app.purge_personal_data() as result`.execute(db);
  const outcome = rows[0].result;
  const processed = Object.values(outcome.deleted).reduce((total, count) => total + Number(count), 0);
  return { job: "retention", ranAt: now.toISOString(), processed, skippedReason: outcome.executed ? null : outcome.skippedReason };
}
