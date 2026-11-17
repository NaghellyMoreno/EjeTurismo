import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { revokeMyAuthorization } from "@/server/services";
import { createOldVersionAccount } from "../factories/accounts";
import { provider } from "../factories/revocation";
import { testConfig } from "../helpers/config";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { buildRequest, PROTECTED_OPERATIONS, routeContext } from "../helpers/protected-operations";
import { makeSelfRevokeApi } from "../helpers/self-revoke-http";
import { signInitData, tma } from "../helpers/telegram";

// F036, criterios 10, 26 y 31: la prueba guardada no lleva datos de la persona, la revocación por la Mini App deja el mismo
// estado que por el bot (salvo el canal) y tras revocar las rutas protegidas responden 403.
const PERSON = 900000381;
const OLD = 900000382;
const NUMBER = "7700036101";

let owner: Pool;
const api = makeSelfRevokeApi();
const db = appDb();
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await db.destroy();
  await api.db.destroy();
});
beforeEach(() => resetDb(owner));

// Todo el contenido del esquema `app` sin identificadores, horas ni canal de los eventos: lo propio de cada ejecución.
async function normalizedState(): Promise<Record<string, string[]>> {
  const tables = (await rows("select table_name from information_schema.tables where table_schema = 'app' and table_type = 'BASE TABLE' order by 1")).map((r) => r.table_name as string);
  const out: Record<string, string[]> = {};
  for (const table of tables.filter((t) => t !== "processed_updates")) {
    const data = await rows(`select row_to_json(t)::text as j from app."${table}" t`);
    out[table] = data
      .map((r) => String(r.j).replace(/"(id|[a-z_]*_id)":("[^"]*"|\d+)/g, '"$1":"x"').replace(/"channel":"(bot|mini_app)"/g, '"channel":"x"').replace(/"[a-z_]*_at":"[^"]*"/g, '"t":"x"'))
      .sort();
  }
  return out;
}

describe("10: consent_events no lleva datos de la persona", () => {
  it("no tiene columnas de cuenta, ID de Telegram ni pseudónimo y el evento revoked no contiene nada de la persona", async () => {
    const columns = (await rows("select column_name from information_schema.columns where table_schema = 'app' and table_name = 'consent_events'")).map((r) => r.column_name);
    expect(columns.sort()).toEqual(["channel", "event", "id", "notice_version", "occurred_at"]);
    await provider(owner, PERSON);
    expect((await api.revoke(PERSON)).status).toBe(200);
    const text = JSON.stringify(await rows("select * from app.consent_events"));
    expect(text).not.toContain(String(PERSON));
    expect(text).not.toContain(NUMBER);
  });
});

describe("26: la revocación por la Mini App deja el mismo estado que por el bot", () => {
  async function seed() {
    await resetDb(owner);
    await provider(owner, PERSON);
  }

  it("las instantáneas coinciden salvo el canal del evento revoked y los datos de cada ejecución", async () => {
    await seed();
    await revokeMyAuthorization(db, testConfig(), { telegramUserId: String(PERSON), displayName: "x" }, { confirmed: true }, "bot", new Date());
    const viaBot = await normalizedState();
    const botChannel = (await rows("select channel from app.consent_events where event = 'revoked'"))[0].channel;
    await seed();
    expect((await api.revoke(PERSON)).status).toBe(200);
    const viaMiniApp = await normalizedState();
    const miniAppChannel = (await rows("select channel from app.consent_events where event = 'revoked'"))[0].channel;
    expect([botChannel, miniAppChannel]).toEqual(["bot", "mini_app"]);
    expect(viaMiniApp).toEqual(viaBot);
  });

  it("con una versión anterior, el evento guarda la versión aceptada y el canal mini_app", async () => {
    await createOldVersionAccount(owner, OLD);
    expect((await api.revoke(OLD)).status).toBe(200);
    expect(await rows("select channel, notice_version from app.consent_events where event = 'revoked'")).toEqual([{ channel: "mini_app", notice_version: "2026-10-v1" }]);
  });
});

describe("31: tras revocar, el mismo ID recibe 403 consent_required", () => {
  it("la matriz de rutas protegidas responde 403 (consent_required, o forbidden en las de cuenta)", async () => {
    await provider(owner, PERSON);
    const headers = tma(signInitData({ userId: PERSON }));
    expect((await api.revoke(PERSON)).status).toBe(200);
    const deps = api.deps;
    for (const op of PROTECTED_OPERATIONS.filter((o) => o.role !== "none")) {
      const res = await op.handler(deps)(buildRequest(op, headers, op.body), routeContext());
      const code = ((await res.json()) as { code: string }).code;
      expect([res.status, code], op.operationId).toEqual([403, op.role === "account" ? "forbidden" : "consent_required"]);
    }
  });
});
