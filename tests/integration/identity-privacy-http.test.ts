/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { getMyProviderRegistrationHandler, getPublishedListingHandler, listPublishedListingsHandler, listProviderRegistrationsHandler, getMeHandler } from "@/server/http/handlers";
import { ownerPool } from "../helpers/db";
import { makeHistoryApi } from "../helpers/history";
import { expectNoIdentity, IDS, N1_NUMBER, schemaKeys, seedIdentityWorld, watchConsole, type IdentityWorld } from "../helpers/identity-leak";
import { makeReviewListingApi } from "../helpers/review-listing";
import { listRequest } from "../helpers/review-http";
import { signInitData, tma } from "../helpers/telegram";

// F027, criterios 2 a 10 y 15 (HTTP): el número de identidad no sale por la API hacia el visitante ni hacia otro prestador.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

const spec = parse(readFileSync("api/openapi.yaml", "utf8")) as { components: { schemas: Record<string, any> } };
let owner: Pool;
let w: IdentityWorld;
let consoleWatch: ReturnType<typeof watchConsole>;
const api = makeReviewListingApi();
const history = makeHistoryApi(api.deps);
const detail = getPublishedListingHandler(api.deps);
const listing = listPublishedListingsHandler(api.deps);
const listRegistrations = listProviderRegistrationsHandler(api.deps);
const me = getMeHandler(api.deps);

const as = (userId: number) => tma(signInitData({ userId }));
const getDetail = (headers: Record<string, string>, id: string) =>
  detail(new Request(`http://localhost/api/v1/public/listings/${id}`, { headers }), { params: Promise.resolve({ listingId: id }) });
const getList = (headers: Record<string, string>, query = "") => listing(new Request(`http://localhost/api/v1/public/listings${query ? `?${query}` : ""}`, { headers }));
const SESSIONLESS: Record<string, Record<string, string>> = {
  "sin initData": {},
  "initData alterado": tma(signInitData({ userId: IDS.v, tamperUserId: IDS.p2 })),
  "initData vencido": tma(signInitData({ userId: IDS.v, authDate: Math.floor(Date.now() / 1000) - 86401 - 60 })),
};

async function bodyOf(res: Response, label: string): Promise<any> {
  const text = await res.text();
  expectNoIdentity(text, w.secrets, label);
  return JSON.parse(text);
}
function expectKeys(item: Record<string, unknown>, schema: string) {
  const { properties, required } = schemaKeys(spec, schema);
  for (const key of Object.keys(item)) expect(properties.has(key), `${schema}: clave ${key} fuera del esquema`).toBe(true);
  for (const key of required) expect(Object.keys(item), `${schema}: falta ${key}`).toContain(key);
}

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  w = await seedIdentityWorld(owner, api, afterTasks);
  consoleWatch = watchConsole();
});
afterEach(() => {
  consoleWatch.expectClean(w.secrets);
  vi.restoreAllMocks();
});

describe("preparación", () => {
  it("el número se guardó cifrado y sellado y las claves se leen de la base", () => {
    expect(w.secrets.length).toBeGreaterThanOrEqual(8);
  });
});

describe("criterio 2: getPublishedListing como visitante", () => {
  it("200 sin identidad y con las claves del esquema PublicListingDetail", async () => {
    const res = await getDetail(as(IDS.v), w.l1.listingId);
    expect(res.status).toBe(200);
    const body = await bodyOf(res, "detalle L1");
    expect(body.name).toBe("Café Mirador de Prueba");
    expectKeys(body, "PublicListingDetail");
  });
});

describe("criterio 3: listPublishedListings como visitante", () => {
  it.each([["sin filtros", ""], ["municipalityId", "MUNICIPALITY"], ["kind", "kind=establishment"]])("%s: sin identidad y L1 entre los resultados", async (_label, query) => {
    const q = query === "MUNICIPALITY" ? `municipalityId=${w.world.municipalityOne}` : query;
    const res = await getList(as(IDS.v), q);
    expect(res.status).toBe(200);
    const body = await bodyOf(res, `lista ${q}`);
    expect(body.items.map((i: any) => i.id)).toContain(w.l1.listingId);
    for (const item of body.items) expectKeys(item, "PublicListingSummary");
  });
});

describe("criterio 4: otro prestador (P2) ante las fichas publicadas", () => {
  it("getPublishedListing de L1 y listPublishedListings: sin identidad", async () => {
    const one = await getDetail(as(IDS.p2), w.l1.listingId);
    expect(one.status).toBe(200);
    await bodyOf(one, "P2 detalle");
    const all = await getList(as(IDS.p2));
    expect(all.status).toBe(200);
    expect((await bodyOf(all, "P2 lista")).items.map((i: any) => i.id)).toContain(w.l1.listingId);
  });
});

describe("criterio 5: P2 no ve lo gestionado de P1", () => {
  it("getManagedListing y getListingStatusHistory de L1 responden 403 forbidden (F016) sin identidad; listManagedListings no incluye L1", async () => {
    const managed = await api.get(IDS.p2, w.l1.listingId);
    expect(managed.status).toBe(403);
    expect((await bodyOf(managed, "P2 getManagedListing")).code).toBe("forbidden");
    const events = await history(IDS.p2, w.l1.listingId);
    expect(events.status).toBe(403);
    expect((await bodyOf(events, "P2 historial")).code).toBe("forbidden");
    const list = await api.list(IDS.p2);
    expect(list.status).toBe(200);
    const body = await bodyOf(list, "P2 listManagedListings");
    expect(body.items.map((i: any) => i.id)).not.toContain(w.l1.listingId);
    expect(body.items.map((i: any) => i.id)).toContain(w.l2.listingId);
  });
});

describe("criterio 6: P1 ante lo suyo", () => {
  it("getMyProviderRegistration, getManagedListing y listManagedListings no traen número ni tipo de documento", async () => {
    const mine = await getMyProviderRegistrationHandler(api.deps)(
      new Request("http://localhost/api/v1/provider-registrations/me", { headers: as(IDS.p1) }),
    );
    expect(mine.status).toBe(200);
    const registration = await bodyOf(mine, "P1 registro propio");
    expectKeys(registration, "OwnProviderRegistration");
    const managed = await api.get(IDS.p1, w.l1.listingId);
    expect(managed.status).toBe(200);
    expectKeys(await bodyOf(managed, "P1 getManagedListing"), "ManagedListing");
    const list = await api.list(IDS.p1);
    expect(list.status).toBe(200);
    expect((await bodyOf(list, "P1 listManagedListings")).items.map((i: any) => i.id)).toContain(w.l1.listingId);
    const status = await me(new Request("http://localhost/api/v1/me", { headers: as(IDS.p1) }));
    expect(status.status).toBe(200);
    expectKeys(await bodyOf(status, "P1 getMe"), "Me");
  });
});

describe("criterios 7 y 8: listProviderRegistrations", () => {
  it("P2 y V reciben 403 forbidden; sin sesión o con initData alterado, 401; todos sin identidad", async () => {
    for (const [label, headers] of [["P2", as(IDS.p2)], ["V", as(IDS.v)]] as const) {
      const res = await listRegistrations(new Request("http://localhost/api/v1/provider-registrations", { headers }));
      expect(res.status, label).toBe(403);
      expect((await bodyOf(res, label)).code).toBe("forbidden");
    }
    for (const label of ["sin initData", "initData alterado"]) {
      const res = await listRegistrations(new Request("http://localhost/api/v1/provider-registrations", { headers: SESSIONLESS[label] }));
      expect(res.status, label).toBe(401);
      await bodyOf(res, label);
    }
  });

  it("el administrador sigue viendo el tipo y el número descifrado de P1 (D-011)", async () => {
    const res = await listRegistrations(listRequest(IDS.admin));
    expect(res.status).toBe(200);
    const page = (await res.json()) as { items: Array<Record<string, unknown>> };
    const p1 = page.items.find((i) => i.identityNumber === N1_NUMBER);
    expect(p1).toMatchObject({ identityDocumentType: "CC", identityNumber: N1_NUMBER });
  });
});

describe("criterio 9: sin sesión válida ante la consulta pública", () => {
  it.each(Object.keys(SESSIONLESS))("%s: 401 sin identidad", async (label) => {
    const one = await getDetail(SESSIONLESS[label], w.l1.listingId);
    expect(one.status).toBe(401);
    await bodyOf(one, `${label} detalle`);
    const all = await getList(SESSIONLESS[label]);
    expect(all.status).toBe(401);
    await bodyOf(all, `${label} lista`);
  });
});

describe("criterio 10: cuenta que no aceptó el aviso (V0)", () => {
  it("403 consent_required sin identidad en el detalle y en la lista", async () => {
    for (const res of [await getDetail(as(IDS.v0), w.l1.listingId), await getList(as(IDS.v0))]) {
      expect(res.status).toBe(403);
      expect((await bodyOf(res, "V0")).code).toBe("consent_required");
    }
  });
});
