/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revokeRoleHandler } from "@/server/http/handlers";
import { ownerPool, resetDb } from "../helpers/db";
import { seedListing } from "../helpers/listing-data";
import { A6, ADMIN, makeReviewListingApi, NAME_ONE, NAME_TWO, REASON, seedWorld, UNKNOWN_ID, type World } from "../helpers/review-listing";
import { changedTables, snapshotAll } from "../helpers/role-denial";
import { signInitData, tma } from "../helpers/telegram";

// F014, criterios 17 y 20: reglas de estado, concurrencia y prestador revocado.
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
  await resetDb(owner);
  world = await seedWorld(owner);
});
afterEach(() => vi.restoreAllMocks());

describe("criterio 17: solo una versión pending se decide", () => {
  let n = 0;
  const seedAs = (status: "draft" | "published" | "rejected") =>
    seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: `Ficha ${status} Ficticia ${++n}`, status });

  it("una draft, una published, una rejected y una superseded responden 409 en las dos operaciones, sin cambios", async () => {
    const draft = await seedAs("draft");
    const published = await seedAs("published");
    const rejected = await seedAs("rejected");
    const superseded = await seedAs("published");
    await owner.query("update app.listing_versions set status = 'superseded' where id = $1", [superseded.versionId]);
    for (const [label, version] of [["draft", draft], ["published", published], ["rejected", rejected], ["superseded", superseded]] as const) {
      for (const kind of ["approve", "reject"] as const) {
        const before = await snapshotAll(owner);
        const res = kind === "approve" ? await api.approve(ADMIN, version.versionId) : await api.reject(ADMIN, version.versionId);
        expect(res.status, `${kind} ${label}`).toBe(409);
        expect(res.headers.get("content-type")).toContain("application/problem+json");
        const json = await body(res);
        expect(json.code).toBe("invalid_state_transition");
        expect(json.detail).toBe("La ficha ya no está pendiente de revisión.");
        expect(changedTables(before, await snapshotAll(owner)), `${kind} ${label}`).toEqual([]);
      }
    }
  });

  it("aprobar dos veces da 409 la segunda; rechazar tras aprobar da 409; queda una sola fila listing.approved", async () => {
    const fp = await api.pending(world, NAME_ONE);
    expect((await api.approve(ADMIN, fp.versionId)).status).toBe(200);
    const before = await snapshotAll(owner);
    expect((await api.approve(ADMIN, fp.versionId)).status).toBe(409);
    expect((await api.reject(ADMIN, fp.versionId)).status).toBe(409);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect(await rows("select count(*)::int as n from app.audit_events where action = 'listing.approved'")).toEqual([{ n: 1 }]);
  });

  it("dos aprobaciones simultáneas dan un 200 y un 409, y una sola fila en listing_status_events y notification_outbox", async () => {
    const fp = await api.pending(world, NAME_ONE);
    const outboxBefore = (await rows("select count(*)::int as n from app.notification_outbox"))[0].n;
    const results = await Promise.all([api.approve(ADMIN, fp.versionId), api.approve(ADMIN, fp.versionId)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await rows("select count(*)::int as n from app.listing_status_events where version_id = $1 and to_status = 'published'", [fp.versionId])).toEqual([{ n: 1 }]);
    expect((await rows("select count(*)::int as n from app.notification_outbox"))[0].n - outboxBefore).toBe(1);
  });

  it("un UUID inexistente o mal formado da 404 en las dos operaciones, antes que el 422 del cuerpo", async () => {
    await api.pending(world, NAME_ONE);
    for (const id of [UNKNOWN_ID, "no-uuid"]) {
      for (const [label, call] of [
        ["approve", () => api.approve(ADMIN, id)],
        ["reject", () => api.reject(ADMIN, id)],
        ["approve con cuerpo inválido", () => api.approve(ADMIN, id, {})],
        ["reject con cuerpo inválido", () => api.reject(ADMIN, id, {})],
      ] as const) {
        const before = await snapshotAll(owner);
        const res = await call();
        expect(res.status, `${label} ${id}`).toBe(404);
        const json = await body(res);
        expect(json.code).toBe("not_found");
        expect(json.detail).toBe("No encontramos la ficha por revisar.");
        expect(changedTables(before, await snapshotAll(owner)), `${label} ${id}`).toEqual([]);
      }
    }
  });

  it("un cuerpo inválido da 422 antes que el 409 de una versión ya decidida", async () => {
    const fp = await api.pending(world, NAME_ONE);
    expect((await api.approve(ADMIN, fp.versionId)).status).toBe(200);
    expect((await api.approve(ADMIN, fp.versionId, {})).status).toBe(422);
    expect((await api.reject(ADMIN, fp.versionId, {})).status).toBe(422);
  });
});

describe("criterio 20: ficha de un prestador al que se le quitó el permiso (D-029, P11)", () => {
  async function revokeA6() {
    const grant = (await rows("select id from app.role_grants where telegram_user_id = $1 and role = 'provider'", [A6]))[0].id;
    const res = await revokeRoleHandler(api.deps)(
      new Request(`http://localhost/api/v1/role-grants/${grant}/revocation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tma(signInitData({ userId: ADMIN })) },
        body: JSON.stringify({ confirmed: true }),
      }),
      { params: Promise.resolve({ grantId: grant }) },
    );
    expect(res.status).toBe(200);
  }

  it("aprobar da 409, no se hace visible ni se envía mensaje; la lista de pendientes sigue mostrándola", async () => {
    const fp = await api.pending(world, NAME_ONE);
    await revokeA6();
    const before = await snapshotAll(owner);
    const res = await api.approve(ADMIN, fp.versionId);
    expect(res.status).toBe(409);
    expect((await body(res)).code).toBe("invalid_state_transition");
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect(afterTasks).toHaveLength(0);
    expect((await body(await api.reviews(ADMIN))).items.map((i: any) => i.versionId)).toEqual([fp.versionId]);
    const visitor = await body(await api.published(900007012));
    expect(JSON.stringify(visitor)).not.toContain(NAME_ONE);
  });

  it("rechazar da 200 sin crear fila de notification_outbox; solo cambian listing_versions, listing_status_events y audit_events", async () => {
    const fp = await api.pending(world, NAME_TWO);
    await revokeA6();
    const before = await snapshotAll(owner);
    const res = await api.reject(ADMIN, fp.versionId, { confirmed: true, reason: REASON });
    expect(res.status).toBe(200);
    expect(changedTables(before, await snapshotAll(owner))).toEqual(["audit_events", "listing_status_events", "listing_versions"]);
    expect(afterTasks).toHaveLength(0);
    expect(api.sent).toEqual([]);
  });
});
