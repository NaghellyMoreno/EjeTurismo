/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listingErrorMessage } from "@/server/domain/listings";
import { ownerPool, resetDb } from "../helpers/db";
import {
  A6, createBody, draftBody, ESTABLISHMENT_ONE, ESTABLISHMENT_TWO, makeListingApi, seedListing, seedWorld, SUBMIT_BODY, UNKNOWN_ID, type World,
} from "../helpers/listing-http";
import { validateSchema } from "../helpers/openapi";
import { changedTables, snapshotAll } from "../helpers/role-denial";

// F013, criterios 16 y 18: guardar el borrador y la ficha pendiente que no se edita.
let owner: Pool;
let world: World;
let listingId: string;
const api = makeListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld(owner);
  listingId = (await body(await api.create(A6, createBody(world, {})))).id;
});

describe("criterio 18: guardar el borrador", () => {
  it("responde 200 con el mismo ID y la misma versión, reemplaza el contenido y no suma eventos", async () => {
    const created = (await rows("select updated_at from app.listing_versions"))[0].updated_at as Date;
    const events = (await rows("select count(*)::int as n from app.listing_status_events"))[0].n;
    const audits = (await rows("select count(*)::int as n from app.audit_events"))[0].n;
    await new Promise((r) => setTimeout(r, 60));
    const res = await api.save(A6, listingId, draftBody(world, { description: "Otra descripción.", contact: undefined, establishmentTypeId: undefined }));
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(validateSchema("ManagedListing", json)).toEqual([]);
    expect(json.id).toBe(listingId);
    expect(json).toMatchObject({ displayStatus: "draft", working: { versionNumber: 1, status: "draft", content: { description: "Otra descripción.", contact: null, establishmentType: null } } });
    const version = (await rows("select updated_at, id from app.listing_versions"))[0];
    expect(new Date(json.working.updatedAt).getTime()).toBeGreaterThan(created.getTime());
    expect(version.id).toBe(json.working.id);
    expect(await rows("select 1 from app.listing_versions")).toHaveLength(1);
    expect(await rows("select 1 from app.listings")).toHaveLength(1);
    expect((await rows("select count(*)::int as n from app.listing_status_events"))[0].n).toBe(events);
    expect((await rows("select count(*)::int as n from app.audit_events"))[0].n).toBe(audits);
  });

  it("las mismas validaciones del criterio 4 responden 422 sin cambios, y guardar con el mismo nombre propio da 200", async () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, string, string]> = [
      ["name vacío", { name: "" }, {}, "name", "required"],
      ["name 101", { name: "n".repeat(101) }, {}, "name", "too_long"],
      ["description 1501", { description: "d".repeat(1501) }, {}, "description", "too_long"],
      ["municipio inexistente", { municipalityId: UNKNOWN_ID }, {}, "municipalityId", "not_found"],
      ["categoría no-uuid", { categoryId: "no-uuid" }, {}, "categoryId", "invalid"],
      ["tipo inexistente", { establishmentTypeId: UNKNOWN_ID }, {}, "establishmentTypeId", "not_found"],
      ["maps inválido", { mapsUrl: "https://ejemplo.invalid/mapa" }, {}, "mapsUrl", "invalid_maps_url"],
      ["experienceTypeId", { experienceTypeId: UNKNOWN_ID }, {}, "experienceTypeId", "not_allowed"],
      ["guidesInfo", { guidesInfo: "x" }, {}, "guidesInfo", "not_allowed"],
      ["propiedad desconocida", { otro: 1 }, {}, "otro", "unknown_field"],
      ["raíz desconocida", {}, { kind: "establishment" }, "kind", "unknown_field"],
      ...[undefined, false, "true", null].map((v): [string, Record<string, unknown>, Record<string, unknown>, string, string] => [`confirmed ${String(v)}`, {}, { confirmed: v }, "confirmed", "confirmation_required"]),
    ];
    for (const [label, content, root, field, code] of cases) {
      const before = await snapshotAll(owner);
      const res = await api.save(A6, listingId, draftBody(world, content, root));
      const json = await body(res);
      expect(res.status, label).toBe(422);
      expect(json.errors, label).toContainEqual({ field, code, message: listingErrorMessage(field, code, "establishment") });
      expect(changedTables(before, await snapshotAll(owner)), label).toEqual([]);
    }
    const noContent = await api.save(A6, listingId, { confirmed: true });
    expect(noContent.status).toBe(422);
    expect((await api.save(A6, listingId, draftBody(world, { name: ESTABLISHMENT_ONE }))).status).toBe(200);
  });
});

describe("criterio 16: la ficha pendiente no se edita", () => {
  it("PUT sobre la pendiente responde 409 invalid_state_transition y no cambia nada", async () => {
    expect((await api.submit(A6, listingId, SUBMIT_BODY)).status).toBe(200);
    const before = await snapshotAll(owner);
    const res = await api.save(A6, listingId, draftBody(world, { name: ESTABLISHMENT_TWO }));
    const json = await body(res);
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(json.code).toBe("invalid_state_transition");
    expect(json.detail).toBe("La ficha está pendiente de revisión y no se puede editar.");
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect((await rows("select status, name from app.listing_versions"))[0]).toMatchObject({ status: "pending", name: ESTABLISHMENT_ONE });
  });

  it("una ficha que no está en draft ni pending (sembrada publicada) también responde 409", async () => {
    const other = await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Ficha Publicada Sembrada", status: "published" });
    const res = await api.save(A6, other.listingId, draftBody(world, { name: "Otro nombre ficticio" }));
    expect([res.status, (await body(res)).code]).toEqual([409, "invalid_state_transition"]);
  });
});
