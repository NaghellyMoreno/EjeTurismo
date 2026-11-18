/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ownerPool, resetDb } from "../helpers/db";
import { A6, ADMIN, NAME_ONE, NAME_TWO, makeReviewListingApi, seedWorld, UNKNOWN_ID, VISITOR, type World } from "../helpers/review-listing";
import { seedListing } from "../helpers/listing-data";
import { validateSchema } from "../helpers/openapi";
import { changedTables, snapshotAll } from "../helpers/role-denial";

// F014, criterios 1 y 2: la lista de pendientes y el detalle de una revisión (paso 1).
let owner: Pool;
let world: World;
const api = makeReviewListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld(owner);
});

describe("criterio 1: GET /api/v1/reviews", () => {
  it("trae exactamente FP y FP2 (la más antigua primero) y ni el borrador, ni la rechazada, ni un atractivo publicado", async () => {
    const fp = await api.pending(world, NAME_ONE);
    const fp2 = await api.pending(world, NAME_TWO);
    await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, name: "Borrador Ficticio" });
    await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Rechazada Ficticia", status: "rejected" });
    await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Atractivo Ficticio", kind: "attraction", status: "published" });

    const res = await api.reviews(ADMIN);
    const json = await body(res);
    const text = JSON.stringify(json);
    expect(res.status).toBe(200);
    expect(validateSchema("ReviewSummaryPage", json)).toEqual([]);
    expect(json.page).toBe(1);
    expect(json.pageSize).toBe(20);
    expect(json.total).toBe(2);
    expect(json.items.map((i: any) => i.versionId)).toEqual([fp.versionId, fp2.versionId]);
    expect(json.items[0]).toMatchObject({
      versionId: fp.versionId, listingId: fp.listingId, kind: "establishment", name: NAME_ONE, municipality: { id: world.municipalityOne, name: "Municipio Ficticio Uno" }, isEditOfPublished: false,
    });
    expect(Date.parse(json.items[0].submittedAt)).toBeLessThanOrEqual(Date.parse(json.items[1].submittedAt));
    for (const secret of ["900007031", "9000070310"]) expect(text).not.toContain(secret);
    expect(text).not.toContain("Borrador Ficticio");
    expect(text).not.toContain("Rechazada Ficticia");
    expect(text).not.toContain("Atractivo Ficticio");
  });

  it("pageSize=51, pageSize=0 y page=0 responden 422 con el campo y code invalid, sin cambios", async () => {
    await api.pending(world, NAME_ONE);
    for (const [query, field] of [["pageSize=51", "pageSize"], ["pageSize=0", "pageSize"], ["page=0", "page"]] as const) {
      const before = await snapshotAll(owner);
      const res = await api.reviews(ADMIN, query);
      const json = await body(res);
      expect(res.status, query).toBe(422);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect(json.code).toBe("validation_failed");
      expect(json.errors).toEqual([expect.objectContaining({ field, code: "invalid" })]);
      expect(changedTables(before, await snapshotAll(owner)), query).toEqual([]);
    }
  });

  it("pagina: pageSize=1 da una por página con el total completo", async () => {
    const fp = await api.pending(world, NAME_ONE);
    const fp2 = await api.pending(world, NAME_TWO);
    const first = await body(await api.reviews(ADMIN, "pageSize=1&page=1"));
    const second = await body(await api.reviews(ADMIN, "pageSize=1&page=2"));
    expect([first.items[0].versionId, second.items[0].versionId]).toEqual([fp.versionId, fp2.versionId]);
    expect(first.total).toBe(2);
  });
});

describe("criterio 2: GET /api/v1/reviews/{versionId}", () => {
  it("devuelve la propuesta, published en null y los campos con valor; 404 para un UUID inexistente y para un ID mal formado", async () => {
    const fp = await api.pending(world, NAME_ONE);
    const before = await snapshotAll(owner);
    const res = await api.review(ADMIN, fp.versionId);
    const json = await body(res);
    expect(res.status).toBe(200);
    expect(validateSchema("Review", json)).toEqual([]);
    expect(json).toMatchObject({ versionId: fp.versionId, listingId: fp.listingId, kind: "establishment" });
    expect(json.proposed.status).toBe("pending");
    expect(json.proposed.content).toMatchObject({
      name: NAME_ONE, municipality: { name: "Municipio Ficticio Uno" }, category: { name: "Categoria Ficticia Uno" },
      description: "Descripción ficticia.", schedule: "Todos los días de 8:00 a 17:00", contact: "contacto@ejemplo.invalid", mapsUrl: "https://maps.app.goo.gl/AbCdEf123",
    });
    expect("published" in json).toBe(true);
    expect(json.published).toBeNull();
    expect(json.changedFields.sort()).toEqual(["category", "contact", "description", "establishmentType", "mapsUrl", "municipality", "name", "schedule"]);

    for (const id of [UNKNOWN_ID, "no-uuid"]) {
      const missing = await api.review(ADMIN, id);
      expect(missing.status, id).toBe(404);
      expect((await body(missing)).code).toBe("not_found");
    }
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });

  it("con una versión publicada, changedFields trae solo los campos distintos y published trae la versión publicada", async () => {
    const fp = await api.pending(world, NAME_ONE);
    const published = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: NAME_TWO, status: "published" });
    await owner.query(
      `insert into app.listing_versions (listing_id, version_number, status, name, name_normalized, municipality_id, category_id, description, schedule, contact, maps_url)
       select listing_id, 2, 'pending', name, name_normalized, municipality_id, category_id, 'Descripción nueva.', schedule, contact, maps_url from app.listing_versions where id = $1`,
      [published.versionId],
    );
    const pendingId = (await owner.query("select id from app.listing_versions where listing_id = $1 and version_number = 2", [published.listingId])).rows[0].id;
    const json = await body(await api.review(ADMIN, pendingId));
    expect(json.published.id).toBe(published.versionId);
    expect(json.changedFields).toEqual(["description"]);
    const list = await body(await api.reviews(ADMIN));
    expect(list.items.find((i: any) => i.versionId === pendingId).isEditOfPublished).toBe(true);
    expect(list.items.find((i: any) => i.versionId === fp.versionId).isEditOfPublished).toBe(false);
  });

  it("un visitante recibe 403 en la lista y en el detalle (ver también el criterio 14)", async () => {
    const fp = await api.pending(world, NAME_ONE);
    expect((await api.reviews(VISITOR)).status).toBe(403);
    expect((await api.review(VISITOR, fp.versionId)).status).toBe(403);
    expect((await api.reviews(A6)).status).toBe(403);
  });
});
