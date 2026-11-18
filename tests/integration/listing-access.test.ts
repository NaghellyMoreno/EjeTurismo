/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_PRINCIPAL_ADMIN_ID } from "../helpers/config";
import { ownerPool, resetDb } from "../helpers/db";
import {
  A6, ADMIN, createBody, draftBody, ESTABLISHMENT_ONE, makeListingApi, P2P, seedListing, seedWorld, SUBMIT_BODY, UNKNOWN_ID, type World,
} from "../helpers/listing-http";
import { validateSchema } from "../helpers/openapi";
import {
  changedTables, PERSON_IDS, PERSON_KEYS, roleCaseOf, seedRoleDenial, snapshotAll, EXPECTED_DENIAL, type RoleFixtures,
} from "../helpers/role-denial";
import { createAccount } from "../factories/accounts";

// F013, criterios 5, 24 a 27 y 32: control de acceso y separación entre negocios.
let owner: Pool;
const api = makeListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});

describe("criterio 5: createListing con establecimiento por A1 a A5", () => {
  let fx: RoleFixtures;
  beforeEach(async () => {
    await resetDb(owner);
    fx = await seedRoleDenial(owner);
  });
  it("10 casos (5 personas x cuerpo válido y vacío): mismo código y la instantánea no cambia", async () => {
    const rc = roleCaseOf("createListing", "establishment");
    const table: Array<{ persona: string; variante: string; codigo: string }> = [];
    for (const person of PERSON_KEYS) {
      for (const variant of ["valid", "empty"] as const) {
        const before = await snapshotAll(owner);
        const res = await api.create(PERSON_IDS[person], variant === "valid" ? rc.bodyFor!(fx) : {});
        const text = await res.text();
        const json = JSON.parse(text);
        expect({ status: res.status, code: json.code }, `${person} / ${variant}`).toEqual(EXPECTED_DENIAL[person]);
        expect(res.headers.get("content-type")).toContain("application/problem+json");
        expect(changedTables(before, await snapshotAll(owner)), `${person} / ${variant}`).toEqual([]);
        expect(text).not.toContain("Establecimiento Ficticio Uno");
        expect(text).not.toContain("Municipio Ficticio Secreto");
        table.push({ persona: person, variante: variant, codigo: `${res.status} ${json.code}` });
      }
    }
    console.table(table);
    expect(table).toHaveLength(10);
  });
});

describe("criterios 24 a 27: separación y administrador", () => {
  let world: World;
  let a6Draft: string;
  beforeEach(async () => {
    await resetDb(owner);
    world = await seedWorld(owner);
    a6Draft = (await body(await api.create(A6, createBody(world)))).id;
  });

  it("24: P2p recibe 403 forbidden en las 3 operaciones, con la ficha de A6 y con un ID inexistente, sin ver su contenido", async () => {
    for (const id of [a6Draft, UNKNOWN_ID]) {
      const calls: Array<[string, () => Promise<Response>]> = [
        ["get", () => api.get(P2P, id)],
        ["save", () => api.save(P2P, id, draftBody(world))],
        ["submit", () => api.submit(P2P, id, SUBMIT_BODY)],
      ];
      for (const [name, call] of calls) {
        const before = await snapshotAll(owner);
        const res = await call();
        const text = await res.text();
        expect(res.status, `${name} ${id}`).toBe(403);
        expect(JSON.parse(text).code).toBe("forbidden");
        expect(text).not.toContain(ESTABLISHMENT_ONE);
        expect(changedTables(before, await snapshotAll(owner)), `${name} ${id}`).toEqual([]);
      }
    }
    await api.create(P2P, createBody(world, { name: "Ficha de P2p" }));
    expect((await body(await api.list(P2P))).items.map((i: any) => i.name)).toEqual(["Ficha de P2p"]);
    expect((await body(await api.list(A6))).items.map((i: any) => i.name)).toEqual([ESTABLISHMENT_ONE]);
    const malformed = await api.get(A6, "no-es-uuid");
    expect(malformed.status).toBe(403);
  });

  it("25: A6 ve el detalle de su ficha y recibe 403 con una ficha publicada de otro negocio", async () => {
    const res = await api.get(A6, a6Draft);
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(validateSchema("ManagedListing", json)).toEqual([]);
    expect(json.working.status).toBe("draft");
    expect(json.businessId).toBeTruthy();
    const other = await seedListing(owner, { accountId: world.p2pAccount, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Ficha Publicada Ajena", status: "published" });
    expect((await api.get(A6, other.listingId)).status).toBe(403);
  });

  it("26: lista del administrador: por defecto las pendientes, y cada filtro", async () => {
    const admin = (await owner.query("select id from app.accounts where telegram_user_id = $1", [ADMIN])).rows[0].id;
    await seedListing(owner, { kind: "attraction", accountId: admin, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Atractivo Ficticio Uno", status: "published" });
    await seedListing(owner, { accountId: world.a6Account, municipalityId: world.municipalityOne, categoryId: world.categoryOne, name: "Rechazada Ficticia", status: "rejected" });
    await api.submit(A6, a6Draft, SUBMIT_BODY);
    await api.create(A6, createBody(world, { name: "Borrador Ficticio" }));
    const names = async (query: string) => (await body(await api.list(ADMIN, query))).items.map((i: any) => i.name).sort();
    expect(await names("")).toEqual([ESTABLISHMENT_ONE]);
    expect(await names("displayStatus=published")).toEqual(["Atractivo Ficticio Uno"]);
    expect(await names("displayStatus=draft")).toEqual([]);
    expect(await names("displayStatus=rejected")).toEqual(["Rechazada Ficticia"]);
    expect(await names("kind=attraction")).toEqual([]);
    const published = await body(await api.list(ADMIN, "displayStatus=published"));
    const attraction = published.items[0].id;
    expect((await api.get(ADMIN, attraction)).status).toBe(200);
    const draftId = (await body(await api.list(A6, "displayStatus=draft"))).items[0].id;
    expect((await api.get(ADMIN, draftId)).status).toBe(403);
  });

  it("27: los dos administradores no editan ni envían fichas de prestador, ni crean establecimientos", async () => {
    await createAccount(owner, Number(TEST_PRINCIPAL_ADMIN_ID), "Administrador Principal");
    await api.submit(A6, (await body(await api.create(A6, createBody(world, { name: "Ficha Pendiente" })))).id, SUBMIT_BODY);
    const pending = (await rows("select listing_id from app.listing_versions where status = 'pending'"))[0].listing_id as string;
    const table: string[] = [];
    for (const admin of [ADMIN, Number(TEST_PRINCIPAL_ADMIN_ID)]) {
      const calls: Array<[string, string, () => Promise<Response>]> = [
        ["save válido borrador", "draft", () => api.save(admin, a6Draft, draftBody(world))],
        ["save vacío borrador", "draft", () => api.save(admin, a6Draft, {})],
        ["submit válido borrador", "draft", () => api.submit(admin, a6Draft, SUBMIT_BODY)],
        ["submit vacío borrador", "draft", () => api.submit(admin, a6Draft, {})],
        ["save válido pendiente", "pending", () => api.save(admin, pending, draftBody(world))],
        ["submit válido pendiente", "pending", () => api.submit(admin, pending, SUBMIT_BODY)],
        ["create establishment", "-", () => api.create(admin, createBody(world, { name: "Otra ficha" }))],
        ["create route_experience", "-", () => api.create(admin, { ...createBody(world, { name: "Otra ruta" }), kind: "route_experience" })],
      ];
      for (const [label, , call] of calls) {
        const before = await snapshotAll(owner);
        const res = await call();
        expect([res.status, (await body(res)).code], label).toEqual([403, "forbidden"]);
        expect(changedTables(before, await snapshotAll(owner)), label).toEqual([]);
        table.push(`${admin} | ${label} | ${res.status}`);
      }
    }
    process.stdout.write(`${table.join("\n")}\n`);
    expect(table).toHaveLength(16);
    expect((await rows("select status from app.listing_versions where listing_id = $1", [a6Draft]))[0].status).toBe("draft");
  });
});
