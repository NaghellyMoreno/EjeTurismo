/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deps } from "@/server/http/deps";
import { testConfig } from "../helpers/config";
import { appDb, ownerPool, resetDb } from "../helpers/db";
import { ADMIN, L1_NAME, V, V2 } from "../helpers/information-request";
import { CANARIES, FIXED_CLOCK, REQUEST_MESSAGE, REPLY, requestsApi, statusOf, UNKNOWN_ID, eventRows, outboxRows, replyRows } from "../helpers/provider-requests";
import { A, ADM2, B, seedAccessWorld, snapshot, type AccessWorld } from "../helpers/request-access";
import { signInitData, tma } from "../helpers/telegram";
import { createHandlersForTamperedHeaders } from "../helpers/request-access-raw";

// F033, criterios 1 a 13 y 18 (HTTP): solo el prestador dueño del negocio ve y cambia sus solicitudes.
vi.mock("next/server", () => ({ after: () => undefined }));

let owner: Pool;
let w: AccessWorld;
let before: string;
const db = appDb();
const deps: Deps = { config: () => testConfig(), db: () => db, now: () => FIXED_CLOCK, send: async () => undefined };
const api = requestsApi(deps);
const logs = { log: vi.spyOn(console, "log"), warn: vi.spyOn(console, "warn"), error: vi.spyOn(console, "error") };
const logLines = () => [...logs.log.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls].map((a) => a.map(String).join(" "));
// Datos de RA que ningún cuerpo de error puede contener (invariante 7).
const needles = () => [...CANARIES, REQUEST_MESSAGE, String(V), "2026-11-25", L1_NAME];
const body = REPLY;
const attended = { status: "attended", confirmed: true };
const noLeak = (text: string, label: string) => {
  for (const n of needles()) expect(text, `${label}: ${n}`).not.toContain(n);
};

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await db.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  w = await seedAccessWorld(owner);
  before = await snapshot(owner);
  for (const spy of Object.values(logs)) spy.mockClear().mockImplementation(() => undefined);
});

describe("criterio 1: B no lee RA", () => {
  it("403 con el mismo cuerpo que una solicitud inexistente y sin datos de RA", async () => {
    const foreign = await api.get(B, w.ra);
    const missing = await api.get(B, UNKNOWN_ID);
    expect(foreign.status).toBe(403);
    expect(missing.status).toBe(403);
    const text = await foreign.text();
    expect(text).toBe(await missing.text());
    noLeak(text, "get B");
  });
});

describe("criterio 2: la lista de B", () => {
  it("200 con items exactamente [RB] y total 1", async () => {
    const res = await api.list(B);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items.map((i: any) => i.id)).toEqual([w.rb]);
    expect(json.total).toBe(1);
    noLeak(JSON.stringify(json), "lista B");
  });
});

describe("criterios 3 y 4: administrador", () => {
  it("ADM: 403 en el detalle y 403 en la lista, sin datos", async () => {
    for (const res of [await api.get(ADMIN, w.ra), await api.list(ADMIN)]) {
      expect(res.status).toBe(403);
      noLeak(await res.text(), "ADM");
    }
  });
  it("ADM2 (administrador y prestador de LC): 403 sobre RA; su lista es exactamente [RC]", async () => {
    const detail = await api.get(ADM2, w.ra);
    expect(detail.status).toBe(403);
    noLeak(await detail.text(), "ADM2 get");
    const res = await api.list(ADM2);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items.map((i: any) => i.id)).toEqual([w.rc]);
    expect(json.total).toBe(1);
    noLeak(JSON.stringify(json), "lista ADM2");
  });
});

describe("criterios 5, 6 y 10: B y ADM no escriben sobre RA", () => {
  it("B: cambiar el estado y responder dan 403 sin datos", async () => {
    const change = await api.change(B, w.ra, attended);
    expect(change.status).toBe(403);
    noLeak(await change.text(), "change B");
    const reply = await api.reply(B, w.ra, { body, confirmed: true });
    expect(reply.status).toBe(403);
    noLeak(await reply.text(), "reply B");
    expect(await replyRows(owner)).toHaveLength(0);
    expect(await outboxRows(owner)).toHaveLength(0);
  });
  it("ADM: responder da 403 sin respuesta ni bandeja", async () => {
    const reply = await api.reply(ADMIN, w.ra, { body, confirmed: true });
    expect(reply.status).toBe(403);
    noLeak(await reply.text(), "reply ADM");
    expect(await replyRows(owner)).toHaveLength(0);
    expect(await outboxRows(owner)).toHaveLength(0);
  });
});

describe("criterios 7 y 8: el visitante autor", () => {
  it("V: cambiar el estado, leer y listar dan 403", async () => {
    for (const res of [await api.change(V, w.ra, attended), await api.get(V, w.ra), await api.list(V)]) {
      expect(res.status).toBe(403);
      noLeak(await res.text(), "V");
    }
  });
  it("V2 (autor de su solicitud y prestador de LD): 403 al cambiar y leer, y tampoco toca RA", async () => {
    for (const id of [w.ra2, w.ra]) {
      for (const res of [await api.change(V2, id, attended), await api.get(V2, id)]) {
        expect(res.status).toBe(403);
        noLeak(await res.text(), "V2");
      }
    }
  });
});

describe("criterio 9: ADM y ADM2 no cambian el estado", () => {
  it("403 en ambos", async () => {
    for (const user of [ADMIN, ADM2]) {
      const res = await api.change(user, w.ra, attended);
      expect(res.status).toBe(403);
      noLeak(await res.text(), `change ${user}`);
    }
  });
});

describe("criterio 11: sin sesión, initData alterado y vencido", () => {
  it("401 en las cuatro operaciones y en los tres casos, sin cambios", async () => {
    const now = Math.floor(FIXED_CLOCK.getTime() / 1000);
    const cases: Record<string, Record<string, string>> = {
      "sin sesión": {},
      alterado: tma(signInitData({ userId: A, authDate: now, tamperUserId: ADMIN })),
      vencido: tma(signInitData({ userId: A, authDate: now - 86401 - 60 })),
    };
    for (const [label, headers] of Object.entries(cases)) {
      const raw = createHandlersForTamperedHeaders(deps, headers);
      for (const [op, res] of Object.entries({
        list: await raw.list(),
        get: await raw.get(w.ra),
        reply: await raw.reply(w.ra, { body, confirmed: true }),
        change: await raw.change(w.ra, attended),
      })) {
        expect(res.status, `${label} ${op}`).toBe(401);
        noLeak(await res.text(), `${label} ${op}`);
      }
    }
  });
});

describe("criterio 12 y 13: nada cambió y el dueño sí puede", () => {
  it("tras los intentos negativos el estado de los datos es idéntico; con A, leer y cambiar funcionan", async () => {
    for (const user of [B, ADMIN, ADM2, V, V2]) {
      await api.get(user, w.ra);
      await api.change(user, w.ra, attended);
      await api.reply(user, w.ra, { body, confirmed: true });
    }
    await api.reply(null, w.ra, { body, confirmed: true });
    expect(await snapshot(owner)).toBe(before);
    expect(await statusOf(owner, w.ra)).toBe("new");
    // Control positivo, después de la comparación.
    const detail = await api.get(A, w.ra);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: w.ra, requesterName: "Ana de Prueba", status: "new" });
    const change = await api.change(A, w.ra, attended);
    expect(change.status).toBe(200);
    expect(await statusOf(owner, w.ra)).toBe("attended");
    expect(await eventRows(owner)).toMatchObject([{ request_id: w.ra, to_status: "attended", actor_account_id: w.world.accounts[A] }]);
  });
});

describe("criterio 18: registros del servidor", () => {
  it("los intentos rechazados no imprimen datos de RA", async () => {
    for (const user of [B, ADMIN, ADM2, V, V2]) {
      await api.get(user, w.ra);
      await api.change(user, w.ra, attended);
      await api.reply(user, w.ra, { body, confirmed: true });
    }
    for (const line of logLines()) noLeak(line, "console");
  });
});
