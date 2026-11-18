/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listingErrorMessage } from "@/server/domain/listings";
import { ownerPool, resetDb } from "../helpers/db";
import {
  A6, A6B, ADMIN, createBody, ESTABLISHMENT_MIN, ESTABLISHMENT_ONE, ESTABLISHMENT_TWO, MAPS_URL, makeListingApi, minimalContent,
  P2P, seedWorld, UNKNOWN_ID, VISITOR, type World,
} from "../helpers/listing-http";
import { validateSchema } from "../helpers/openapi";
import { PERSON_IDS, changedTables, snapshotAll } from "../helpers/role-denial";
import { signInitData, tma } from "../helpers/telegram";
import { failingDb } from "../helpers/failing-db";
import { testConfig } from "../helpers/config";
import { createListingHandler } from "@/server/http/handlers";

// F013, criterios 1 a 4, 6 a 10: crear la ficha de establecimiento en borrador por HTTP, con base real e instantánea.
let owner: Pool;
let world: World;
const api = makeListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld(owner);
});

async function expect422(userId: number, raw: unknown, label: string) {
  const before = await snapshotAll(owner);
  const res = await api.create(userId, raw);
  const json = await body(res);
  expect(res.status, label).toBe(422);
  expect(res.headers.get("content-type"), label).toContain("application/problem+json");
  expect(json.code, label).toBe("validation_failed");
  expect(validateSchema("Problem", json), label).toEqual([]);
  expect(changedTables(before, await snapshotAll(owner)), `${label}: tablas que cambiaron`).toEqual([]);
  return json as { errors: { field: string; code: string; message: string }[]; detail: string };
}

describe("criterios 1 a 3: crear el borrador", () => {
  it("1 y 2: el cuerpo válido responde 201 válido contra ManagedListing y deja las filas esperadas", async () => {
    const res = await api.create(A6, createBody(world));
    expect(res.status).toBe(201);
    const json = await body(res);
    expect(validateSchema("ManagedListing", json)).toEqual([]);
    expect(json).toMatchObject({ kind: "establishment", displayStatus: "draft", hasPublishedVersion: false, acceptsRequests: false });
    expect(json.businessId).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.published ?? null).toBeNull();
    expect(json.lastRejection ?? null).toBeNull();
    expect(json.createdAt).toBeTruthy();
    expect(json.working).toMatchObject({
      status: "draft",
      versionNumber: 1,
      content: {
        name: ESTABLISHMENT_ONE, description: "Descripción ficticia.", schedule: "Todos los días de 8:00 a 17:00", mapsUrl: MAPS_URL,
        municipality: { id: world.municipalityOne, name: "Municipio Ficticio Uno" },
        category: { id: world.categoryOne, name: "Categoria Ficticia Uno" },
        establishmentType: { id: world.typeOne, name: "Establecimiento Ficticio" },
      },
    });

    const business = await rows("select * from app.businesses");
    expect(business).toHaveLength(1);
    expect(business[0]).toMatchObject({ provider_account_id: world.a6Account, owner_removed_at: null });
    const listing = await rows("select * from app.listings");
    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({ kind: "establishment", business_id: business[0].id, created_by_account_id: world.a6Account });
    const version = await rows("select * from app.listing_versions");
    expect(version).toHaveLength(1);
    expect(version[0]).toMatchObject({
      status: "draft", version_number: 1, name_normalized: "establecimiento ficticio uno",
      submitted_at: null, third_party_declared_at: null, decided_at: null, decided_by: null,
    });
    const events = await rows("select * from app.listing_status_events");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ from_status: null, to_status: "draft", actor_role: "provider", actor_account_id: world.a6Account });
    const audit = await rows("select * from app.audit_events where action = 'listing.created'");
    expect(audit).toHaveLength(1);
    expect(audit[0].details.kind).toBe("establishment");
    expect(JSON.stringify(audit[0].details)).not.toContain(String(A6));
    expect(await count("notification_outbox")).toBe(0);
  });

  it("3: borrador mínimo, vacíos opcionales y establishmentTypeId nulo", async () => {
    const res = await api.create(A6, { kind: "establishment", content: minimalContent(world, ESTABLISHMENT_MIN), confirmed: true });
    expect(res.status).toBe(201);
    const json = await body(res);
    expect(validateSchema("ManagedListing", json)).toEqual([]);
    for (const field of ["category", "description", "schedule", "contact", "mapsUrl"]) expect(json.working.content[field], field).toBeNull();
    expect(json.working.content.establishmentType).toBeNull();

    const blanks = await api.create(A6, createBody(world, { name: ESTABLISHMENT_TWO, categoryId: "", description: "  ", schedule: "", contact: "   ", mapsUrl: "", establishmentTypeId: null }));
    expect(blanks.status).toBe(201);
    const blanksJson = await body(blanks);
    for (const field of ["category", "description", "schedule", "contact", "mapsUrl", "establishmentType"]) expect(blanksJson.working.content[field], field).toBeNull();
    expect(validateSchema("ManagedListing", blanksJson)).toEqual([]);
  });
});

const long = (n: number, ch = "a") => ch.repeat(n);
const MAPS_2048 = `https://maps.app.goo.gl/${long(2048 - "https://maps.app.goo.gl/".length)}`;
const UNKNOWN = UNKNOWN_ID;

describe("criterio 4: casos inválidos", () => {
  const cases: Array<{ label: string; content?: (w: World) => Record<string, unknown>; root?: Record<string, unknown>; raw?: unknown; field: string; code: string }> = [
    ...["ausente", "vacío", "espacios"].map((form) => ({
      label: `name ${form}`, field: "name", code: "required",
      content: () => ({ name: form === "ausente" ? undefined : form === "vacío" ? "" : "   " }),
    })),
    { label: "name 101", field: "name", code: "too_long", content: () => ({ name: long(101) }) },
    { label: "description 1501", field: "description", code: "too_long", content: () => ({ description: long(1501) }) },
    { label: "schedule 301", field: "schedule", code: "too_long", content: () => ({ schedule: long(301) }) },
    { label: "contact 201", field: "contact", code: "too_long", content: () => ({ contact: long(201) }) },
    { label: "municipio ausente", field: "municipalityId", code: "required", content: () => ({ municipalityId: undefined }) },
    { label: "municipio vacío", field: "municipalityId", code: "required", content: () => ({ municipalityId: "" }) },
    { label: "municipio no-uuid", field: "municipalityId", code: "invalid", content: () => ({ municipalityId: "no-uuid" }) },
    { label: "municipio inexistente", field: "municipalityId", code: "not_found", content: () => ({ municipalityId: UNKNOWN }) },
    { label: "categoría no-uuid", field: "categoryId", code: "invalid", content: () => ({ categoryId: "no-uuid" }) },
    { label: "categoría inexistente", field: "categoryId", code: "not_found", content: () => ({ categoryId: UNKNOWN }) },
    { label: "tipo no-uuid", field: "establishmentTypeId", code: "invalid", content: () => ({ establishmentTypeId: "no-uuid" }) },
    { label: "tipo inexistente", field: "establishmentTypeId", code: "not_found", content: () => ({ establishmentTypeId: UNKNOWN }) },
    { label: "maps otro host", field: "mapsUrl", code: "invalid_maps_url", content: () => ({ mapsUrl: "https://ejemplo.invalid/mapa" }) },
    { label: "maps http", field: "mapsUrl", code: "invalid_maps_url", content: () => ({ mapsUrl: "http://maps.google.com/maps" }) },
    { label: "maps javascript", field: "mapsUrl", code: "invalid_maps_url", content: () => ({ mapsUrl: "javascript:alert(1)" }) },
    { label: "maps 2049", field: "mapsUrl", code: "invalid_maps_url", content: () => ({ mapsUrl: `${MAPS_2048}a` }) },
    { label: "experienceTypeId", field: "experienceTypeId", code: "not_allowed", content: () => ({ experienceTypeId: UNKNOWN }) },
    { label: "guidesInfo", field: "guidesInfo", code: "not_allowed", content: () => ({ guidesInfo: "x" }) },
    { label: "propiedad desconocida en content", field: "otro", code: "unknown_field", content: () => ({ otro: 1 }) },
    { label: "propiedad desconocida en la raíz", field: "otro", code: "unknown_field", root: { otro: 1 } },
    { label: "kind ausente", field: "kind", code: "required", root: { kind: undefined } },
    { label: "kind otro", field: "kind", code: "invalid", root: { kind: "otro" } },
    { label: "content ausente", field: "content", code: "required", root: { content: undefined } },
    { label: "no es JSON", field: "body", code: "invalid_json", raw: "{no-json" },
    ...[undefined, false, "true", null].map((value) => ({
      label: `confirmed ${String(value)}`, field: "confirmed", code: "confirmation_required", root: { confirmed: value },
    })),
  ];
  it.each(cases)("$label da 422 $field $code y no cambia ninguna tabla", async (c) => {
    const raw = c.raw ?? createBody(world, c.content?.(world) ?? {}, c.root ?? {});
    const json = await expect422(A6, raw, c.label);
    expect(json.errors).toContainEqual({ field: c.field, code: c.code, message: listingErrorMessage(c.field, c.code, "establishment") });
    process.stdout.write(`criterio 4 | ${c.label} | ${c.field} | ${c.code}\n`);
    if (c.field === "confirmed") expect(json.detail).toBe("Debes confirmar la operación para continuar.");
  });

  it("los límites exactos se aceptan con 201 y cada respuesta valida contra ManagedListing", async () => {
    const exact: Array<[string, Record<string, unknown>]> = [
      ["name", { name: long(100, "n") }],
      ["description", { name: "Límite descripción", description: long(1500) }],
      ["schedule", { name: "Límite horarios", schedule: long(300) }],
      ["contact", { name: "Límite contacto", contact: long(200) }],
      ["mapsUrl", { name: "Límite enlace", mapsUrl: MAPS_2048 }],
    ];
    for (const [label, content] of exact) {
      const res = await api.create(A6, createBody(world, content));
      expect(res.status, label).toBe(201);
      expect(validateSchema("ManagedListing", await body(res)), label).toEqual([]);
    }
  });
});

describe("criterio 5 (extracto) y criterios 6 y 7: control de acceso", () => {
  it("6: sin identidad 401 sin consultar la base; A6b da 403 consent_required; sin cambios", async () => {
    const failing = failingDb();
    const handler = createListingHandler({ config: () => testConfig(), db: () => failing.db, now: () => new Date() });
    const before = await snapshotAll(owner);
    const headers: Record<string, string>[] = [
      {},
      tma(signInitData({ userId: A6, token: "9:otro" })),
      tma(signInitData({ userId: VISITOR, tamperUserId: A6 })),
    ];
    for (const h of headers) {
      const res = await handler(new Request("http://localhost/api/v1/managed-listings", { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(createBody(world)) }));
      expect(res.status).toBe(401);
      expect((await body(res)).code).toBe("unauthenticated");
    }
    expect(failing.queries).toHaveLength(0);
    const a6b = await api.create(A6B, createBody(world));
    expect(a6b.status).toBe(403);
    expect((await body(a6b)).code).toBe("consent_required");
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });

  it("7: orden de las comprobaciones, revocación, attraction y route_experience", async () => {
    const before = await snapshotAll(owner);
    const a3 = await api.create(PERSON_IDS.A3, {});
    expect([a3.status, (await body(a3)).code]).toEqual([403, "consent_required"]);
    const a6 = await api.create(A6, {});
    expect(a6.status).toBe(422);
    const attraction = await api.create(A6, { ...createBody(world), kind: "attraction" });
    expect([attraction.status, (await body(attraction)).code]).toEqual([403, "forbidden"]);
    const route = await expect422(A6, { ...createBody(world), kind: "route_experience" }, "route_experience");
    expect(route.errors).toContainEqual(expect.objectContaining({ field: "kind", code: "invalid" }));
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);

    // Revocación inmediata: el permiso del prestador se revoca y la ficha existente no cambia.
    expect((await api.create(P2P, createBody(world))).status).toBe(201);
    await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1 and role = 'provider'", [P2P]);
    const snapshot = await snapshotAll(owner);
    const revoked = await api.create(P2P, createBody(world, { name: ESTABLISHMENT_TWO }));
    expect([revoked.status, (await body(revoked)).code]).toEqual([403, "forbidden"]);
    expect(changedTables(snapshot, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterios 8 a 10: lista del prestador, no visible al visitante y varios negocios", () => {
  it("8: la lista de A6 muestra el borrador, filtra por estado y tipo, pagina y valida parámetros", async () => {
    await api.create(A6, createBody(world));
    const res = await api.list(A6);
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(validateSchema("ManagedListingSummaryPage", json)).toEqual([]);
    expect(json).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(json.items[0]).toMatchObject({ kind: "establishment", name: ESTABLISHMENT_ONE, municipality: { id: world.municipalityOne, name: "Municipio Ficticio Uno" }, displayStatus: "draft", hasPublishedVersion: false });
    expect(json.items[0].updatedAt).toBeTruthy();
    expect(JSON.stringify(json)).not.toMatch(/identity|telegram/i);
    for (const secret of [String(A6), "9000070310"]) expect(JSON.stringify(json)).not.toContain(secret);

    expect((await body(await api.list(A6, "displayStatus=draft"))).items).toHaveLength(1);
    for (const query of ["displayStatus=pending", "displayStatus=published", "displayStatus=rejected", "kind=attraction"]) {
      expect((await body(await api.list(A6, query))).items, query).toHaveLength(0);
    }
    for (const [query, field] of [["pageSize=51", "pageSize"], ["pageSize=0", "pageSize"], ["page=0", "page"], ["kind=otro", "kind"], ["displayStatus=otro", "displayStatus"]]) {
      const before = await snapshotAll(owner);
      const bad = await api.list(A6, query);
      const json422 = await body(bad);
      expect(bad.status, query).toBe(422);
      expect(json422.errors, query).toContainEqual(expect.objectContaining({ field, code: "invalid" }));
      expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    }
    const beyond = await api.list(A6, "page=5");
    expect(beyond.status).toBe(200);
    expect((await body(beyond)).items).toEqual([]);
  });

  it("8: orden por updatedAt descendente y luego ID", async () => {
    for (const name of ["Ficha A", "Ficha B", "Ficha C"]) {
      await api.create(A6, createBody(world, { name }));
      await new Promise((r) => setTimeout(r, 15));
    }
    const names = (await body(await api.list(A6))).items.map((i: any) => i.name);
    expect(names).toEqual(["Ficha C", "Ficha B", "Ficha A"]);
  });

  it("9: la ficha en borrador no es visible al visitante", async () => {
    await api.create(A6, createBody(world));
    await api.create(P2P, createBody(world, { name: ESTABLISHMENT_TWO }));
    const queries = ["", `municipalityId=${world.municipalityOne}&categoryId=${world.categoryOne}`, "kind=establishment"];
    for (const query of queries) {
      const json = await body(await api.published(VISITOR, query));
      expect(json.items, query).toEqual([]);
    }
  });

  it("10: A6 crea una segunda ficha y obtiene un negocio nuevo por ficha", async () => {
    expect((await api.create(A6, createBody(world))).status).toBe(201);
    expect((await api.create(A6, createBody(world, { name: ESTABLISHMENT_TWO }))).status).toBe(201);
    const businesses = await rows("select provider_account_id from app.businesses");
    expect(businesses).toHaveLength(2);
    expect(businesses.every((b) => b.provider_account_id === world.a6Account)).toBe(true);
    const listings = await rows("select business_id from app.listings");
    expect(new Set(listings.map((l) => l.business_id)).size).toBe(2);
    expect((await body(await api.list(A6))).items).toHaveLength(2);
    const duplicate = await api.create(A6, createBody(world));
    expect([duplicate.status, (await body(duplicate)).code]).toEqual([409, "duplicate"]);
    expect(await count("businesses")).toBe(2);
  });

  it("el administrador de prueba también recibe 403 con establecimiento", async () => {
    const before = await snapshotAll(owner);
    const res = await api.create(ADMIN, createBody(world));
    expect([res.status, (await body(res)).code]).toEqual([403, "forbidden"]);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });
});
