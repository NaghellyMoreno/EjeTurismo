/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import { execFileSync } from "node:child_process";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listPublishedListingsHandler } from "@/server/http/handlers";
import { testConfig } from "../helpers/config";
import { ownerPool, resetDb } from "../helpers/db";
import { type ExperienceWorld, NEW_NAME, SABORES_ID, seedExperienceWorld } from "../helpers/experience-filter";
import { failingDb } from "../helpers/failing-db";
import { A6, ADMIN, flush, makeReviewListingApi, P2P, VISITOR } from "../helpers/review-listing";
import { changedTables, PERSON_IDS, snapshotAll } from "../helpers/role-denial";
import { signInitData, tma } from "../helpers/telegram";

// F024, criterios 3, 4, 5, 9, 12, 14, 15, 17b, 18 y 20: filtro por tipo de experiencia en la API, con base real.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let w: ExperienceWorld;
const api = makeReviewListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const names = (json: Record<string, any>) => (json.items as Array<{ name: string }>).map((item) => item.name);
const list = async (query: string, user = VISITOR) => body(await api.published(user, query));

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  await resetDb(owner);
  w = await seedExperienceWorld(owner, api, afterTasks);
});

const T1_M1 = ["Ruta Aventura 01", "Ruta Aventura 02", "Ruta Cambio Publicada"];

describe("criterio 3: filtro por tipo y municipio", () => {
  it("devuelve exactamente las tres rutas de T1 en M1, en orden, con su tipo", async () => {
    const res = await api.published(VISITOR, `kind=route_experience&municipalityId=${w.municipalityOne}&experienceTypeId=${w.t1}`);
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(names(json)).toEqual(T1_M1);
    expect(json).toMatchObject({ total: 3, page: 1 });
    for (const item of json.items) expect(item).toMatchObject({ kind: "route_experience", municipality: { id: w.municipalityOne, name: "Municipio Ficticio Uno" }, category: { id: w.categoryOne } });
    const detail = await list(`kind=route_experience&municipalityId=${w.municipalityOne}&experienceTypeId=${w.t1}&pageSize=2&page=2`);
    expect(names(detail)).toEqual(["Ruta Cambio Publicada"]);
    expect(detail).toMatchObject({ total: 3, page: 2, pageSize: 2 });
  });
});

describe("criterio 4: combinaciones y línea base", () => {
  it("a, b, c y d", async () => {
    expect(names(await list(`municipalityId=${w.municipalityOne}&experienceTypeId=${w.t1}`))).toEqual(T1_M1);
    const establishment = await list(`kind=establishment&experienceTypeId=${w.t1}`);
    expect([establishment.total, names(establishment)]).toEqual([0, []]);
    const all = await list(`experienceTypeId=${w.t1}`);
    expect(names(all)).toEqual(["Ruta Aventura 01", "Ruta Aventura 02", "Ruta Aventura M2", "Ruta Cambio Publicada"]);
    expect(all.total).toBe(4);
    const base = ["Hotel Prueba", "Ruta Aventura 01", "Ruta Aventura 02", "Ruta Cambio Publicada", "Ruta Cultural 01", "Sabores de prueba"];
    const m1 = await list(`municipalityId=${w.municipalityOne}`);
    expect([names(m1), m1.total]).toEqual([base, 6]);
    const routes = await list(`municipalityId=${w.municipalityOne}&kind=route_experience`);
    expect([names(routes), routes.total]).toEqual([base.filter((n) => n !== "Hotel Prueba"), 5]);
    expect(names(await list(`municipalityId=${w.municipalityOne}&kind=establishment`))).toEqual(["Hotel Prueba"]);
  });
});

describe("criterio 5: parámetro inválido", () => {
  it.each(["abc", "", "00000000-0000-4000-8000-00000000000", "0000000g-0000-4000-8000-000000000000"])("%j responde 422 igual que municipalityId", async (value) => {
    const res = await api.published(VISITOR, `experienceTypeId=${value}`);
    expect(res.status).toBe(422);
    const json = await body(res);
    const reference = await body(await api.published(VISITOR, `municipalityId=${value}`));
    expect(json.errors).toEqual([{ field: "experienceTypeId", code: "invalid", message: reference.errors[0].message }]);
    expect(Object.keys(json).sort()).toEqual(Object.keys(reference).sort());
  });

  it("el UUID en mayúsculas se comporta igual que en municipalityId y uno inexistente da lista vacía", async () => {
    const upper = await list(`municipalityId=${w.municipalityOne.toUpperCase()}&experienceTypeId=${w.t1.toUpperCase()}`);
    expect(names(upper)).toEqual(T1_M1);
    expect((await api.published(VISITOR, `municipalityId=${w.municipalityOne.toUpperCase()}`)).status).toBe(200);
    const missing = await list("experienceTypeId=00000000-0000-4000-8000-000000000000");
    expect([missing.total, names(missing)]).toEqual([0, []]);
  });
});

describe("criterio 9: solo publicadas", () => {
  it("las no publicadas no salen, la nueva versión pendiente no cambia la lista y al aprobar la ficha pasa a T2", async () => {
    const query = (type: string) => `kind=route_experience&municipalityId=${w.municipalityOne}&experienceTypeId=${type}`;
    expect(names(await list(query(w.t1)))).toEqual(T1_M1);
    expect(names(await list(query(w.t2)))).toEqual(["Ruta Cultural 01"]);
    for (const id of Object.values(w.unpublished)) {
      const { getPublishedListingHandler } = await import("@/server/http/handlers");
      const res = await getPublishedListingHandler(api.deps)(new Request(`http://localhost/api/v1/public/listings/${id}`, { headers: tma(signInitData({ userId: VISITOR })) }), { params: Promise.resolve({ listingId: id }) });
      expect(res.status).toBe(404);
    }
    expect((await api.approve(ADMIN, w.cambio.versionId)).status).toBe(200);
    await flush(afterTasks);
    expect(names(await list(query(w.t1)))).toEqual(["Ruta Aventura 01", "Ruta Aventura 02"]);
    expect(names(await list(query(w.t2)))).toEqual([NEW_NAME, "Ruta Cultural 01"]);
  });
});

describe("criterios 12 y 14: tipo sin fichas y Sabores de Caldas", () => {
  it("12: T3 en M1 responde 200 vacío", async () => {
    const json = await list(`municipalityId=${w.municipalityOne}&experienceTypeId=${w.t3}`);
    expect([json.total, names(json)]).toEqual([0, []]);
  });

  it("14: Sabores de Caldas lista solo 'Sabores de prueba' y el directorio gastronómico no cambia", async () => {
    const json = await list(`municipalityId=${w.municipalityOne}&experienceTypeId=${SABORES_ID}`);
    expect([names(json), json.total]).toEqual([["Sabores de prueba"], 1]);
    expect(names(await list(`gastronomic=true&municipalityId=${w.municipalityOne}`))).toEqual(["Sabores de prueba"]);
  });
});

describe("criterio 15: acceso", () => {
  it("sin sesión o firma inválida 401 sin consultar la base; aviso anterior 403 consent_required", async () => {
    const failing = failingDb();
    const handler = listPublishedListingsHandler({ config: () => testConfig(), db: () => failing.db, now: () => new Date() });
    for (const headers of [{}, tma(signInitData({ userId: VISITOR, token: "9:otro" }))]) {
      expect((await handler(new Request(`http://localhost/api/v1/public/listings?experienceTypeId=${w.t1}`, { headers }))).status).toBe(401);
    }
    expect(failing.queries).toEqual([]);
    const res = await api.published(PERSON_IDS.A3, `experienceTypeId=${w.t1}`);
    const json = await body(res);
    expect([res.status, json.code, json.items]).toEqual([403, "consent_required", undefined]);
  });
});

describe("criterios 17b y 18: otros roles y datos personales", () => {
  it("P1, A1, P2 y V1 reciben la misma lista y no aparece ningún dato personal", async () => {
    const before = await snapshotAll(owner);
    for (const user of [A6, ADMIN, P2P, VISITOR]) {
      const res = await api.published(user, `kind=route_experience&municipalityId=${w.municipalityOne}&experienceTypeId=${w.t1}`);
      expect(res.status).toBe(200);
      const text = JSON.stringify(await res.clone().json());
      expect(names(await body(res))).toEqual(T1_M1);
      for (const secret of ["9000070310", String(A6), String(P2P), "Ruta Borrador", "Ruta Pendiente", "Ruta Rechazada", NEW_NAME, "documentType", "identity"]) expect(text, secret).not.toContain(secret);
    }
    expect(changedTables(before, await snapshotAll(owner)).filter((t) => t !== "rate_limit_counters")).toEqual([]);
  });
});

describe("criterio 20: sin cambios de contrato", () => {
  // D-186: F030 agrega una única migración nueva; todo lo demás sigue sin cambios.
  // D-189: F032 agrega la segunda migración nueva (respuestas, historial y disparador de estado).
  const F030_MIGRATION = "supabase/migrations/20261121100000_f030_information_requests.sql";
  const F032_MIGRATION = "supabase/migrations/20261121110000_f032_information_request_replies.sql";
  // D-195: F037 agrega la tercera migración nueva (DELETE de solicitudes para eje_app).
  const F037_MIGRATION = "supabase/migrations/20261121120000_f037_request_delete.sql";
  // D-197: F038 agrega la cuarta migración nueva (plazo de eliminación y función de borrado).
  const F038_MIGRATION = "supabase/migrations/20261121130000_f038_retention.sql";
  it("api/openapi.yaml y supabase/migrations no cambian respecto del commit de partida, salvo las migraciones de F030, F032, F037 y F038", () => {
    // D-201: el único cambio admitido en openapi.yaml es el commit 9cd8a4d (retiro de cron/outbox).
    expect(() => execFileSync("git", ["diff", "--exit-code", "2c4843d", "9cd8a4d~1", "--", "api/openapi.yaml"])).not.toThrow();
    expect(() => execFileSync("git", ["diff", "--exit-code", "9cd8a4d", "--", "api/openapi.yaml"])).not.toThrow();
    const changes = execFileSync("git", ["diff", "--name-status", "2c4843d", "--", "supabase/migrations"]).toString().trim().split("\n").filter(Boolean);
    expect(changes).toEqual([`A\t${F030_MIGRATION}`, `A\t${F032_MIGRATION}`, `A\t${F037_MIGRATION}`, `A\t${F038_MIGRATION}`]);
  });
});
