/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revokeRoleHandler } from "@/server/http/handlers";
import { createAccount } from "../factories/accounts";
import { ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { A6, ADMIN, makeReviewListingApi, NAME_ONE, NAME_THREE, NAME_TWO, P2P, REASON, seedWorld, VISITOR, type World } from "../helpers/review-listing";
import { changedTables, PERSON_IDS, snapshotAll } from "../helpers/role-denial";
import { signInitData, tma } from "../helpers/telegram";
import { makeListingApi } from "../helpers/listing-http";
import { approveListingVersionHandler, getReviewHandler, listPendingReviewsHandler, rejectListingVersionHandler } from "@/server/http/handlers";
import { testConfig } from "../helpers/config";

// F014, criterios 14, 21 y 22: control de acceso de las 4 operaciones de revisión.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let world: World;
const api = makeReviewListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const A6B = 900008002;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  await resetDb(owner);
  world = await seedWorld(owner);
});
afterEach(() => vi.restoreAllMocks());

type Operation = "listPendingReviews" | "getReview" | "approveListingVersion" | "rejectListingVersion";
const OPERATIONS: Operation[] = ["listPendingReviews", "getReview", "approveListingVersion", "rejectListingVersion"];
const call = (operation: Operation, userId: number | null, versionId: string, extra?: Record<string, string>) => {
  switch (operation) {
    case "listPendingReviews": return api.reviews(userId, "", extra);
    case "getReview": return api.review(userId, versionId, extra);
    case "approveListingVersion": return api.approve(userId, versionId, { confirmed: true }, extra);
    case "rejectListingVersion": return api.reject(userId, versionId, { confirmed: true, reason: "Motivo ficticio." }, extra);
  }
};

describe("criterio 14: approveListingVersion con un prestador activo dueño de la ficha pendiente (D-138, paso 3 de F008)", () => {
  it("P2p sobre FP3 (propia), A6 sobre FP2 y A6b sobre FP: 403 y 0 cambios en las 4 operaciones", async () => {
    const fp = await api.pending(world, NAME_ONE);
    const fp2 = await api.pending(world, NAME_TWO);
    const fp3 = await api.pending(world, NAME_THREE, P2P);
    // A6b (aviso anterior) ya fue sembrado por seedWorld.
    const cases: [string, number, string, string][] = [
      ["P2p / FP3", P2P, fp3.versionId, "forbidden"],
      ["A6 / FP2", A6, fp2.versionId, "forbidden"],
      ["A6b / FP", A6B, fp.versionId, "consent_required"],
    ];
    let count = 0;
    for (const [label, user, versionId, code] of cases) {
      for (const operation of OPERATIONS) {
        const before = await snapshotAll(owner);
        const res = await call(operation, user, versionId);
        const json = await body(res);
        expect(res.status, `${label} ${operation}`).toBe(403);
        expect(res.headers.get("content-type")).toContain("application/problem+json");
        expect(json.code, `${label} ${operation}`).toBe(code);
        expect(changedTables(before, await snapshotAll(owner)), `${label} ${operation}`).toEqual([]);
        count++;
      }
    }
    expect(count).toBe(12);
    for (const v of [fp, fp2, fp3]) expect((await rows("select status from app.listing_versions where id = $1", [v.versionId]))[0].status).toBe("pending");
    expect(JSON.stringify(await body(await api.published(VISITOR)))).not.toContain(NAME_THREE);
    expect(afterTasks).toHaveLength(0);
  });
});

describe("criterio 21: sin identidad y orden de las comprobaciones", () => {
  it("sin cabecera, con firma de otro token y con user.id cambiado: 401 sin consultar la base (12 casos)", async () => {
    const failing = failingDb();
    const deps = { config: () => testConfig(), db: () => failing.db, now: () => new Date() };
    const handlers = {
      listPendingReviews: listPendingReviewsHandler(deps),
      getReview: getReviewHandler(deps),
      approveListingVersion: approveListingVersionHandler(deps),
      rejectListingVersion: rejectListingVersionHandler(deps),
    };
    const ctx = { params: Promise.resolve({ versionId: "00000000-0000-4000-8000-000000000000" }) };
    const causes: Record<string, Record<string, string>> = {
      "sin cabecera": {},
      "firma de otro token": tma(signInitData({ userId: ADMIN, token: "9:otro" })),
      "user.id cambiado": tma(signInitData({ userId: VISITOR, tamperUserId: ADMIN })),
    };
    let cases = 0;
    for (const [cause, headers] of Object.entries(causes)) {
      for (const operation of OPERATIONS) {
        const request = new Request("http://localhost/api/v1/reviews", { method: operation.startsWith("list") || operation === "getReview" ? "GET" : "POST", headers: { "Content-Type": "application/json", ...headers }, body: operation.startsWith("list") || operation === "getReview" ? undefined : JSON.stringify({ confirmed: true, reason: "x" }) });
        const res = await (handlers[operation] as (r: Request, c: typeof ctx) => Promise<Response>)(request, ctx);
        expect(res.status, `${operation} / ${cause}`).toBe(401);
        expect((await body(res)).code).toBe("unauthenticated");
        cases++;
      }
    }
    expect(cases).toBe(12);
    expect(failing.queries).toHaveLength(0);
  });

  it("A3 (sin cuenta de aviso vigente) y A1 con cuerpo vacío: 403 consent_required antes que el 422", async () => {
    const fp = await api.pending(world, NAME_ONE);
    for (const user of [PERSON_IDS.A3, PERSON_IDS.A1]) {
      const before = await snapshotAll(owner);
      for (const res of [await api.approve(user, fp.versionId, {}), await api.reject(user, fp.versionId, {})]) {
        expect(res.status).toBe(403);
        expect((await body(res)).code).toBe("consent_required");
      }
      expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    }
  });

  it("el administrador con cuerpo vacío recibe 422 antes que el 409", async () => {
    const fp = await api.pending(world, NAME_ONE);
    await api.approve(ADMIN, fp.versionId);
    expect((await api.approve(ADMIN, fp.versionId, {})).status).toBe(422);
  });

  it("el administrador revocado recibe 403 forbidden en la llamada siguiente y la ficha no cambia", async () => {
    await createAccount(owner, 900007002, "Administrador Ficticio Dos");
    await owner.query("insert into app.role_grants (telegram_user_id, role) values (900007002, 'admin')");
    const fp = await api.pending(world, NAME_ONE);
    expect((await api.reviews(ADMIN)).status).toBe(200);
    const grant = (await rows("select id from app.role_grants where telegram_user_id = $1 and role = 'admin'", [ADMIN]))[0].id;
    const revoked = await revokeRoleHandler(api.deps)(
      new Request(`http://localhost/api/v1/role-grants/${grant}/revocation`, { method: "POST", headers: { "Content-Type": "application/json", ...tma(signInitData({ userId: 900007002 })) }, body: JSON.stringify({ confirmed: true }) }),
      { params: Promise.resolve({ grantId: grant }) },
    );
    expect(revoked.status).toBe(200);
    const before = await snapshotAll(owner);
    for (const operation of OPERATIONS) {
      const res = await call(operation, ADMIN, fp.versionId);
      expect(res.status, operation).toBe(403);
      expect((await body(res)).code).toBe("forbidden");
    }
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterio 22: un prestador no cambia el estado de su ficha enviando la petición directamente", () => {
  it("A6 recibe 403 al decidir su propia FP y 422 unknown_field al enviar status, decidedBy o rejectionReason; FP no cambia", async () => {
    const fp = await api.pending(world, NAME_ONE);
    const draft = await api.pending(world, NAME_TWO);
    expect((await api.approve(A6, fp.versionId)).status).toBe(403);
    expect((await api.reject(A6, fp.versionId)).status).toBe(403);
    const listing = makeListingApi();
    try {
      // Una ficha en borrador propia, para que PUT y POST lleguen a la validación del cuerpo.
      const mine = (await (await listing.create(A6, { kind: "establishment", content: { name: "Borrador Propio Ficticio", municipalityId: world.municipalityOne }, confirmed: true })).json()) as { id: string };
      const afterCreate = await snapshotAll(owner);
      for (const extra of [{ status: "published" }, { status: "rejected" }, { decidedBy: "x" }, { rejectionReason: REASON }]) {
        const save = await listing.save(A6, mine.id, { content: { name: "Borrador Propio Ficticio", municipalityId: world.municipalityOne }, confirmed: true, ...extra });
        const submit = await listing.submit(A6, mine.id, { confirmed: true, thirdPartyAuthorizationDeclared: true, ...extra });
        for (const res of [save, submit]) {
          const json = await body(res);
          expect(res.status, JSON.stringify(extra)).toBe(422);
          expect(json.errors.map((e: any) => e.code)).toContain("unknown_field");
        }
      }
      expect(changedTables(afterCreate, await snapshotAll(owner))).toEqual([]);
    } finally {
      await listing.destroy();
    }
    expect((await rows("select status from app.listing_versions where id = $1", [fp.versionId]))[0].status).toBe("pending");
    expect((await rows("select status from app.listing_versions where id = $1", [draft.versionId]))[0].status).toBe("pending");
    // El administrador no envía ni edita fichas de prestador (F013).
    for (const res of [await api.save(ADMIN, fp.listingId, { content: { name: NAME_ONE, municipalityId: world.municipalityOne }, confirmed: true }), await api.submit(ADMIN, fp.listingId, { confirmed: true, thirdPartyAuthorizationDeclared: true })]) {
      expect(res.status).toBe(403);
      expect((await body(res)).code).toBe("forbidden");
    }
  });
});
