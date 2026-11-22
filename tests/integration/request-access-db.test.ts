import { sql } from "kysely";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { ADMIN, V } from "../helpers/information-request";
import { eventRows, statusOf } from "../helpers/provider-requests";
import { A, B, seedAccessWorld, snapshot, type AccessWorld } from "../helpers/request-access";

// F033, criterio 14: defensa en la base. Con `eje_app` y sin pasar por el servicio, solo la cuenta del dueño del negocio cambia
// el estado de una solicitud; el disparador `information_requests_check_update` lo exige.
let owner: Pool;
let w: AccessWorld;
const db = appDb();

// Transacción directa con `eje_app` que declara la cuenta que actúa (local a la transacción) y intenta el cambio.
async function updateAs(accountId: string, id: string) {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.actor_account_id', ${accountId}, true)`.execute(trx);
    return sql`update app.information_requests set status = 'attended', updated_at = now() where id = ${id}`.execute(trx);
  });
}

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  w = await seedAccessWorld(owner);
});

describe("criterio 14: el disparador de estado", () => {
  it("B, ADM y V reciben not_request_owner (P0001) y el estado sigue new", async () => {
    const before = await snapshot(owner);
    for (const user of [B, ADMIN, V]) {
      await expect(updateAs(w.world.accounts[user], w.ra)).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("not_request_owner") });
      expect(await statusOf(owner, w.ra)).toBe("new");
    }
    expect(await snapshot(owner)).toBe(before);
  });
  it("A (dueño) modifica exactamente una fila y el estado queda attended con su evento", async () => {
    const result = await updateAs(w.world.accounts[A], w.ra);
    expect(Number(result.numAffectedRows)).toBe(1);
    expect(await statusOf(owner, w.ra)).toBe("attended");
    expect(await eventRows(owner)).toMatchObject([{ request_id: w.ra, to_status: "attended", actor_account_id: w.world.accounts[A] }]);
  });
});
