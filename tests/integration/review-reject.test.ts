/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/bot/texts/es";
import { RETRY_DELAY_MS } from "@/server/notifications";
import { ownerPool, resetDb } from "../helpers/db";
import { validateSchema } from "../helpers/openapi";
import { flush, makeReviewListingApi, NAME_ONE, NAME_TWO, REASON, seedWorld, A6, ADMIN, type World } from "../helpers/review-listing";
import { changedTables, snapshotAll } from "../helpers/role-denial";

// F014, criterios 5, 7 y 8: rechazar una ficha pendiente con motivo (pasos 2 y 3).
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let world: World;
const api = makeReviewListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  api.sent.length = 0;
  api.state.mode = "ok";
  api.state.now = () => new Date();
  await resetDb(owner);
  world = await seedWorld(owner);
});
afterEach(() => vi.restoreAllMocks());

describe("criterio 5: rechazar sin motivo exige el motivo", () => {
  const cases: [string, unknown, Array<[string, string]>][] = [
    ["sin reason", { confirmed: true }, [["reason", "required"]]],
    ["reason vacío", { confirmed: true, reason: "" }, [["reason", "required"]]],
    ["reason solo espacios", { confirmed: true, reason: "   " }, [["reason", "required"]]],
    ["reason de 4097 caracteres", { confirmed: true, reason: "a".repeat(4097) }, [["reason", "too_long"]]],
    ["sin confirmed", { reason: "Motivo ficticio." }, [["confirmed", "confirmation_required"]]],
    ["confirmed false", { confirmed: false, reason: "Motivo ficticio." }, [["confirmed", "confirmation_required"]]],
    ["campo extra", { confirmed: true, reason: "Motivo ficticio.", extra: 1 }, [["extra", "unknown_field"]]],
    ["cuerpo no JSON", "esto no es json", [["body", "invalid_json"]]],
    ["cuerpo vacío", {}, [["reason", "required"], ["confirmed", "confirmation_required"]]],
  ];
  it.each(cases)("%s da 422, FP sigue pending y la instantánea no cambia", async (label, payload, expected) => {
    const fp = await api.pending(world);
    const before = await snapshotAll(owner);
    const res = await api.reject(ADMIN, fp.versionId, payload);
    const json = await body(res);
    expect(res.status, label).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(json.code).toBe("validation_failed");
    expect(json.errors.map((e: any) => [e.field, e.code])).toEqual(expected);
    expect(changedTables(before, await snapshotAll(owner)), label).toEqual([]);
    expect((await rows("select status from app.listing_versions where id = $1", [fp.versionId]))[0].status).toBe("pending");
  });

  it("un motivo de exactamente 4096 caracteres se acepta (200, sobre una ficha pendiente aparte)", async () => {
    const fp2 = await api.pending(world, NAME_TWO);
    const res = await api.reject(ADMIN, fp2.versionId, { confirmed: true, reason: "a".repeat(4096) });
    expect(res.status).toBe(200);
    expect((await rows("select rejection_reason from app.listing_versions where id = $1", [fp2.versionId]))[0].rejection_reason).toHaveLength(4096);
  });
});

describe("criterio 7: rechazar con motivo y confirmar", () => {
  it("deja la versión rechazada con fecha y responsable, el evento, la auditoría y el aviso pendiente", async () => {
    const fp = await api.pending(world);
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const res = await api.reject(ADMIN, fp.versionId, { confirmed: true, reason: "  Falta el horario real.  " });
    const json = await body(res);
    expect(res.status).toBe(200);
    expect(validateSchema("ManagedListing", json)).toEqual([]);
    expect(json).toMatchObject({ displayStatus: "rejected", hasPublishedVersion: false, lastRejection: { reason: REASON } });
    expect(typeof json.lastRejection.rejectedAt).toBe("string");

    const [version] = await rows("select status, rejection_reason, decided_by, decided_at from app.listing_versions where id = $1", [fp.versionId]);
    const admin = (await rows("select id from app.accounts where telegram_user_id = $1", [ADMIN]))[0].id;
    expect(version).toMatchObject({ status: "rejected", rejection_reason: REASON, decided_by: admin });
    expect(version.decided_at).not.toBeNull();
    const events = await rows("select from_status, to_status, actor_account_id, actor_role, reason from app.listing_status_events where version_id = $1 order by id", [fp.versionId]);
    expect(events.at(-1)).toEqual({ from_status: "pending", to_status: "rejected", actor_account_id: admin, actor_role: "admin", reason: REASON });
    const audit = await rows("select actor_account_id, actor_role, entity_type, entity_id, details from app.audit_events where action = 'listing.rejected'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_account_id: admin, actor_role: "admin", entity_type: "listing", entity_id: fp.listingId });
    expect(audit[0].details).toEqual({ kind: "establishment", listingId: fp.listingId, versionId: fp.versionId });
    expect(JSON.stringify(audit)).not.toContain(REASON);
    const outbox = await rows("select template, recipient_telegram_user_id, status, payload from app.notification_outbox");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ template: "listing_rejected", recipient_telegram_user_id: String(A6), status: "pending", payload: { listingName: NAME_ONE, reason: REASON } });
    expect(logs.join("\n")).not.toContain(REASON);
  });
});

describe("criterio 8: entrega del mensaje al prestador", () => {
  const fixed = new Date(Math.floor(Date.now() / 1000) * 1000); // cerca de la hora real: initData tiene vigencia

  it("sale una vez al chat de A6 con provider.listingRejected y la fila queda sent con attempts 1", async () => {
    const fp = await api.pending(world);
    api.state.now = () => fixed;
    expect((await api.reject(ADMIN, fp.versionId)).status).toBe(200);
    expect(api.sent).toEqual([]);
    await flush(afterTasks);
    expect(api.sent).toEqual([{ chatId: String(A6), text: es.provider.listingRejected(NAME_ONE, REASON) }]);
    expect(api.sent[0]!.text).toBe(`Tu ficha «${NAME_ONE}» fue rechazada. Motivo: ${REASON}. Puedes corregirla y volver a enviarla desde la Mini App.`);
    const [row] = await rows("select status, attempts, sent_at, next_attempt_at from app.notification_outbox");
    expect(row).toMatchObject({ status: "sent", attempts: 1 });
    expect(new Date(row.sent_at)).toEqual(fixed);
  });

  it("un error de red no deshace el rechazo: la fila queda pending con attempts 1 y next_attempt_at a una hora", async () => {
    const fp = await api.pending(world);
    api.state.now = () => fixed;
    api.state.mode = "error500";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await api.reject(ADMIN, fp.versionId)).status).toBe(200);
    await flush(afterTasks);
    expect((await rows("select status from app.listing_versions where id = $1", [fp.versionId]))[0].status).toBe("rejected");
    const [row] = await rows("select status, attempts, next_attempt_at from app.notification_outbox");
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(new Date(row.next_attempt_at)).toEqual(new Date(fixed.getTime() + RETRY_DELAY_MS));
  });

  it("con 403 de Telegram (bot bloqueado) la fila queda failed con attempts 1 y sin next_attempt_at", async () => {
    const fp = await api.pending(world);
    api.state.now = () => fixed;
    api.state.mode = "error403";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await api.reject(ADMIN, fp.versionId)).status).toBe(200);
    await flush(afterTasks);
    expect((await rows("select status, attempts, next_attempt_at from app.notification_outbox"))[0]).toEqual({ status: "failed", attempts: 1, next_attempt_at: null });
    expect((await rows("select status from app.listing_versions where id = $1", [fp.versionId]))[0].status).toBe("rejected");
  });
});
