/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ownerPool, resetDb } from "../helpers/db";
import {
  A6, createBody, draftBody, ESTABLISHMENT_ONE, ESTABLISHMENT_TWO, makeListingApi, P2P, seedListing, seedWorld, SUBMIT_BODY, type World,
} from "../helpers/listing-http";
import { changedTables, snapshotAll } from "../helpers/role-denial";

// F013, criterios 19 a 23: duplicados por municipio y nombre normalizado (D-003, D-118, D-146).
let owner: Pool;
let world: World;
const api = makeListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string) => Number((await rows(`select count(*) from app.${table}`))[0].count);
const DUPLICATE_DETAIL = "Ya existe una ficha con ese nombre en ese municipio.";

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld(owner);
});

const seed = (kind: "attraction" | "establishment", account: string, status: "draft" | "pending" | "published" | "rejected", name = ESTABLISHMENT_ONE, municipalityId = world.municipalityOne) =>
  seedListing(owner, { kind, accountId: account, municipalityId, categoryId: world.categoryOne, name, status });

describe("criterio 19: duplicado según el estado de la otra ficha", () => {
  const OTHER: Array<[string, () => Promise<unknown>]> = [
    ["(a) borrador del mismo prestador", () => seed("establishment", world.a6Account, "draft")],
    ["(b) borrador de P2p", () => seed("establishment", world.p2pAccount, "draft")],
    ["(c) pending de P2p", () => seed("establishment", world.p2pAccount, "pending")],
    ["(d) atractivo publicado del administrador", () => seed("attraction", world.a6Account, "published")],
    ["(e) versión rejected de otra ficha", () => seed("establishment", world.p2pAccount, "rejected")],
  ];
  it.each(OTHER)("%s responde 409 duplicate, también con espacios, mayúsculas y tildes, sin crear negocio", async (_label, plant) => {
    await plant();
    for (const name of [ESTABLISHMENT_ONE, "  establecimiento   ficticio uno ", "ESTABLECIMIENTO FICTICIO UNO", "Establecimientó Fíctício Uno"]) {
      const before = await snapshotAll(owner);
      const res = await api.create(A6, createBody(world, { name }));
      const json = await body(res);
      expect(res.status, name).toBe(409);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect(json.code).toBe("duplicate");
      expect(json.detail).toBe(DUPLICATE_DETAIL);
      expect(changedTables(before, await snapshotAll(owner)), name).toEqual([]);
    }
  });
});

describe("criterio 20: duplicado al guardar", () => {
  it.each(["draft", "pending", "published", "rejected"] as const)("cambiar el nombre al de otra ficha %s da 409 y cambiar el municipio da 200", async (status) => {
    await seed("establishment", world.p2pAccount, status, ESTABLISHMENT_TWO);
    const id = (await body(await api.create(A6, createBody(world)))).id;
    const before = await snapshotAll(owner);
    const res = await api.save(A6, id, draftBody(world, { name: ESTABLISHMENT_TWO }));
    expect([res.status, (await body(res)).code]).toEqual([409, "duplicate"]);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect((await api.save(A6, id, draftBody(world, { name: ESTABLISHMENT_TWO, municipalityId: world.municipalityTwo }))).status).toBe(200);
    expect((await api.save(A6, id, draftBody(world, { name: "Nombre libre ficticio" }))).status).toBe(200);
  });
});

describe("criterio 21: mismo nombre en otro municipio", () => {
  it("responde 201 con negocio y ficha nuevos; con otro prestador en M2 responde 409", async () => {
    expect((await api.create(A6, createBody(world))).status).toBe(201);
    const second = await api.create(A6, createBody(world, { municipalityId: world.municipalityTwo }));
    expect(second.status).toBe(201);
    expect(await count("businesses")).toBe(2);
    const list = (await body(await api.list(A6))).items;
    expect(list.map((i: any) => i.municipality.name).sort()).toEqual(["Municipio Ficticio Dos", "Municipio Ficticio Uno"]);
    const other = await api.create(P2P, createBody(world, { municipalityId: world.municipalityTwo }));
    expect([other.status, (await body(other)).code]).toEqual([409, "duplicate"]);
  });
});

describe("criterio 22: concurrencia", () => {
  it("dos createListing simultáneos con el mismo nombre producen un 201 y un 409 y ningún negocio huérfano", async () => {
    const results = await Promise.all([api.create(A6, createBody(world)), api.create(P2P, createBody(world))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect((await body(loser)).code).toBe("duplicate");
    expect(await count("businesses")).toBe(1);
    expect(await count("listings")).toBe(1);
    expect(await count("listing_versions")).toBe(1);
  });
});

describe("criterio 23: versiones de la misma ficha", () => {
  it("una segunda versión rejected de la misma ficha no choca; un draft con ese nombre en otra ficha sí (23P01)", async () => {
    const id = (await body(await api.create(A6, createBody(world)))).id;
    await api.submit(A6, id, SUBMIT_BODY);
    await owner.query(
      `insert into app.listing_versions (listing_id, version_number, status, name, name_normalized, municipality_id, rejection_reason)
       values ($1, 2, 'rejected', $2, 'establecimiento ficticio uno', $3, 'Motivo ficticio')`,
      [id, ESTABLISHMENT_ONE, world.municipalityOne],
    );
    const business = (await owner.query("insert into app.businesses (provider_account_id) values ($1) returning id", [world.p2pAccount])).rows[0].id;
    const otherListing = (await owner.query("insert into app.listings (kind, business_id) values ('establishment', $1) returning id", [business])).rows[0].id;
    await expect(
      owner.query(
        "insert into app.listing_versions (listing_id, version_number, status, name, name_normalized, municipality_id) values ($1, 1, 'draft', $2, 'establecimiento ficticio uno', $3)",
        [otherListing, ESTABLISHMENT_ONE, world.municipalityOne],
      ),
    ).rejects.toMatchObject({ code: "23P01" });
  });
});
