/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { revokeRoleHandler } from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";
import { attractionBody, makeAttractionApi, NAME_ONE, type Seed } from "../helpers/attraction-http";
import { testConfig } from "../helpers/config";
import { ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { ADMIN_OTHER, ADMIN_TEST, changedTables, EXPECTED_DENIAL, PERSON_IDS, PERSON_KEYS, PROVIDER_CONTROL, seedRoleDenial, snapshotAll, type RoleFixtures } from "../helpers/role-denial";
import { signInitData, tma } from "../helpers/telegram";
import { createListingHandler } from "@/server/http/handlers";

// F012, criterios 12 a 14 y 16 (D-136 y D-137): control de acceso literal de `createListing` con `kind: attraction`.
let owner: Pool;
let fx: RoleFixtures;
const api = makeAttractionApi();
const failing = failingDb();
const failingApi = createListingHandler({ config: () => testConfig(), db: () => failing.db, now: () => new Date() } satisfies Deps);
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const seedOf = (): Seed => ({ municipalityOne: fx.ids.municipalityId, municipalityTwo: fx.ids.municipalityId, categoryOne: fx.ids.categoryId, categoryTwo: fx.ids.categoryId });

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  failing.queries.length = 0;
  await resetDb(owner);
  fx = await seedRoleDenial(owner);
});

describe("criterio 12: A1 a A5, cuerpo válido y vacío, con la instantánea sin cambios", () => {
  it("10 casos con el código esperado y sin filtrar datos", async () => {
    const table: Array<{ persona: string; variante: string; esperado: string; obtenido: string }> = [];
    for (const person of PERSON_KEYS) {
      for (const [variant, raw] of [["valido", attractionBody(seedOf())], ["vacio", {}]] as const) {
        const before = await snapshotAll(owner);
        const res = await api.createAs(PERSON_IDS[person], raw);
        const text = await res.text();
        const json = JSON.parse(text);
        expect(res.headers.get("content-type")).toContain("application/problem+json");
        expect(changedTables(before, await snapshotAll(owner)), `${person} / ${variant}`).toEqual([]);
        for (const leak of [NAME_ONE, "Municipio Ficticio Secreto", "Registro Ficticio Secreto"]) expect(text).not.toContain(leak);
        table.push({ persona: person, variante: variant, esperado: `403 ${EXPECTED_DENIAL[person].code}`, obtenido: `${res.status} ${json.code}` });
      }
    }
    console.table(table);
    expect(table).toHaveLength(10);
    expect(table.filter((r) => r.esperado !== r.obtenido)).toEqual([]);
  });
});

describe("criterio 13: sin identidad", () => {
  it("sin cabecera, firma de otro token y user.id cambiado dan 401 sin consultar la base ni cambiar nada", async () => {
    const valid = JSON.stringify(attractionBody(seedOf()));
    const variants: Record<string, Record<string, string>> = {
      "sin cabecera": {},
      "firma de otro token": tma(signInitData({ userId: ADMIN_TEST, token: "9:otro" })),
      "user.id cambiado": tma(signInitData({ userId: PERSON_IDS.A2, tamperUserId: ADMIN_TEST })),
    };
    for (const [name, headers] of Object.entries(variants)) {
      const before = await snapshotAll(owner);
      const res = await failingApi(new Request("http://localhost/api/v1/managed-listings", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: valid }));
      expect(res.status, name).toBe(401);
      expect((await body(res)).code, name).toBe("unauthenticated");
      expect(changedTables(before, await snapshotAll(owner)), name).toEqual([]);
    }
    expect(failing.queries).toHaveLength(0);
  });
});

describe("criterio 14: orden de las comprobaciones", () => {
  it("A3 con cuerpo vacío da 403 consent_required (no 422); el administrador con cuerpo vacío da 422 (no 403)", async () => {
    const a3 = await api.createAs(PERSON_IDS.A3, {});
    expect([a3.status, (await body(a3)).code]).toEqual([403, "consent_required"]);
    const admin = await api.createAs(ADMIN_TEST, {});
    expect(admin.status).toBe(422);
  });

  it("el administrador revocado por revokeRole recibe 403 en la llamada siguiente y la instantánea no cambia", async () => {
    expect((await api.createAs(ADMIN_OTHER, attractionBody(seedOf()))).status).toBe(201);
    const grantId = fx.ids.grantId;
    const revoke = await revokeRoleHandler(api.deps)(
      new Request(`http://localhost/api/v1/role-grants/${grantId}/revocation`, { method: "POST", headers: { "Content-Type": "application/json", ...tma(signInitData({ userId: ADMIN_TEST })) }, body: JSON.stringify({ confirmed: true }) }),
      { params: Promise.resolve({ grantId }) },
    );
    expect(revoke.status).toBe(200);
    const before = await snapshotAll(owner);
    const res = await api.createAs(ADMIN_OTHER, attractionBody(seedOf(), { name: "Atractivo Ficticio Dos" }));
    expect([res.status, (await body(res)).code]).toEqual([403, "forbidden"]);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterio 16: combinaciones no permitidas", () => {
  it("el administrador con establishment o route_experience y el prestador con attraction reciben 403 forbidden sin cambios", async () => {
    const minimal = (kind: string) => ({ kind, content: { name: "Ficha Ficticia", municipalityId: fx.ids.municipalityId }, confirmed: true });
    const cases: Array<[string, number, unknown]> = [
      ["admin / establishment", ADMIN_TEST, minimal("establishment")],
      ["admin / route_experience", ADMIN_TEST, minimal("route_experience")],
      ["A6 prestador / attraction", PROVIDER_CONTROL, attractionBody(seedOf())],
    ];
    for (const [name, user, raw] of cases) {
      const before = await snapshotAll(owner);
      const res = await api.createAs(user, raw);
      expect([res.status, (await body(res)).code], name).toEqual([403, "forbidden"]);
      expect(changedTables(before, await snapshotAll(owner)), name).toEqual([]);
    }
    expect((await owner.query("select count(*) from app.businesses")).rows[0].count).toBe("0");
  });
});
