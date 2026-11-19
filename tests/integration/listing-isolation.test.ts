/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revokeRoleHandler } from "@/server/http/handlers";
import { ownerPool, resetDb } from "../helpers/db";
import { failingDb } from "../helpers/failing-db";
import { A6B, createBody, draftBody, makeListingApi, SUBMIT_BODY, UNKNOWN_ID } from "../helpers/listing-http";
import {
  A_NAMES, ATTACK_NAME, B_NAMES, B_REASON, foreignStrings, rowDigest, seedIsolation, type IsolationFixtures,
} from "../helpers/listing-isolation";
import { validateSchema } from "../helpers/openapi";
import { A6, ADMIN, makeReviewListingApi, P2P, seedWorld, VISITOR, type World } from "../helpers/review-listing";
import { changedTables, snapshotAll } from "../helpers/role-denial";
import { signInitData, tma } from "../helpers/telegram";

// F016, criterios 1 a 16: separación de fichas entre prestadores (A frente a B) con los manejadores reales y la base de prueba.
vi.mock("next/server", () => ({ after: (task: () => unknown) => void task }));

const MALFORMED = "no-es-uuid";
const PROBLEM = "application/problem+json";
let owner: Pool;
let world: World;
let fx: IsolationFixtures;
const api = makeReviewListingApi();
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;

// Acumula cada cuerpo recibido por A (criterio 16) con los datos que no pueden salir en ese momento.
const received: Array<{ criterion: string; text: string; secrets: string[] }> = [];
let secrets: string[] = [];
async function read(criterion: string, res: Response): Promise<string> {
  const text = await res.clone().text();
  received.push({ criterion, text, secrets });
  return text;
}
const foreign = () => foreignStrings(fx);
const expectNoForeign = (text: string, label: string) => {
  for (const needle of foreign()) expect(text, `${label}: contiene «${needle}»`).not.toContain(needle);
};
const ids = (items: any[]) => items.map((i) => i.id as string);
const aIds = () => Object.values(fx.a).map((s) => s.listingId);
const bIds = () => Object.values(fx.b).map((s) => s.listingId);
const bStates = () => Object.entries(fx.b) as Array<[keyof typeof B_NAMES, (typeof fx.b)["borrador"]]>;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  await resetDb(owner);
  world = await seedWorld(owner);
  fx = await seedIsolation(owner, { aAccountId: world.a6Account, bAccountId: world.p2pAccount, municipalityId: world.municipalityOne, categoryId: world.categoryOne });
  const b = (await rows("select telegram_user_id from app.accounts where id = $1", [world.p2pAccount]))[0];
  secrets = ["9000130010", String(b.telegram_user_id), world.p2pAccount];
});

describe("criterio 1: dos prestadores, cada uno con una ficha en borrador (por la API)", () => {
  it("crean 201 en borrador y la base queda con negocios, fichas y versiones distintos", async () => {
    await resetDb(owner);
    world = await seedWorld(owner);
    const made: Record<string, any> = {};
    for (const [who, user, name] of [["A", A6, "Ficha de A Borrador"], ["B", P2P, "Ficha de B Borrador"]] as const) {
      const res = await api.create(user, createBody(world, { name }));
      made[who] = await body(res);
      expect(res.status).toBe(201);
      expect(made[who].displayStatus).toBe("draft");
    }
    const businesses = await rows("select id, provider_account_id from app.businesses order by provider_account_id");
    const listings = await rows("select id, business_id from app.listings");
    const versions = await rows("select id, status from app.listing_versions");
    expect(businesses).toHaveLength(2);
    expect(new Set(businesses.map((r) => r.provider_account_id))).toEqual(new Set([world.a6Account, world.p2pAccount]));
    expect(listings).toHaveLength(2);
    expect(new Set(listings.map((r) => r.business_id)).size).toBe(2);
    expect(versions).toHaveLength(2);
    expect(versions.every((v) => v.status === "draft")).toBe(true);
    const printed = {
      cuentaA: world.a6Account, negocioA: businesses.find((r) => r.provider_account_id === world.a6Account).id, fichaA: made.A.id,
      cuentaB: world.p2pAccount, negocioB: businesses.find((r) => r.provider_account_id === world.p2pAccount).id, fichaB: made.B.id,
    };
    console.table(printed);
    expect(new Set(Object.values(printed)).size).toBe(6);
  });
});

describe("criterio 2: la lista de A no muestra la ficha de B", () => {
  const queries = ["", "displayStatus=draft", "displayStatus=pending", "displayStatus=published", "displayStatus=rejected", "kind=establishment", "pageSize=50", "page=2&pageSize=1", "pageSize=1"];
  it("9 casos: solo fichas de A, sin contenido ni IDs de B", async () => {
    const table: Array<{ caso: string; total: number; nombres: string }> = [];
    for (const query of queries) {
      const res = await api.list(A6, query);
      const text = await read("2", res);
      const json = JSON.parse(text);
      expect(res.status, query).toBe(200);
      expect(validateSchema("ManagedListingSummaryPage", json), query).toEqual([]);
      for (const id of ids(json.items)) expect(aIds(), query).toContain(id);
      expectNoForeign(text, query || "sin parámetros");
      expect(text).not.toMatch(/"(identity|telegram|accountId)/i);
      table.push({ caso: query || "(sin parámetros)", total: json.total, nombres: json.items.map((i: any) => i.name).join(", ") });
      if (query === "") {
        expect(json.items.map((i: any) => i.name).sort()).toEqual(Object.values(A_NAMES).sort());
        expect(json.total).toBe(3);
      }
    }
    console.table(table);
    expect(table).toHaveLength(9);
  });
});

describe("criterio 3: dirección inversa y paginación completa", () => {
  const walk = async (user: number, pageSize: number) => {
    const pages: any[] = [];
    for (let page = 1; page <= 4; page++) pages.push(await body(await api.list(user, `page=${page}&pageSize=${pageSize}`)));
    return pages;
  };
  it("B ve sus 5 en páginas de 2, 2 y 1 sin ninguna de A; A ve 3", async () => {
    const pages = await walk(P2P, 2);
    expect(pages.map((p) => p.items.length)).toEqual([2, 2, 1, 0]);
    expect(pages.every((p) => p.total === 5)).toBe(true);
    const all = pages.flatMap((p) => ids(p.items));
    expect(new Set(all).size).toBe(5);
    expect(new Set(all)).toEqual(new Set(bIds()));
    const a = await walk(A6, 2);
    expect(a.map((p) => p.items.length)).toEqual([2, 1, 0, 0]);
    expect(new Set(a.flatMap((p) => ids(p.items)))).toEqual(new Set(aIds()));
    expect(a[0].total).toBe(3);
  });
});

describe("criterio 4: el mismo resultado tras cambios", () => {
  it("los conjuntos de IDs siguen disjuntos con los estados nuevos", async () => {
    expect((await api.submit(A6, fx.a.borrador.listingId, SUBMIT_BODY)).status).toBe(200);
    expect((await api.save(P2P, fx.b.borrador.listingId, draftBody(world, { name: "Ficha de B Borrador Renombrada" }))).status).toBe(200);
    const created = await body(await api.create(P2P, createBody(world, { name: "Ficha de B Nueva" })));
    const a = await body(await api.list(A6, "pageSize=50"));
    const b = await body(await api.list(P2P, "pageSize=50"));
    expect(new Set(ids(a.items))).toEqual(new Set(aIds()));
    expect(new Set(ids(b.items))).toEqual(new Set([...bIds(), created.id]));
    expect(ids(a.items).filter((id) => ids(b.items).includes(id))).toEqual([]);
    expect(a.items.find((i: any) => i.id === fx.a.borrador.listingId).displayStatus).toBe("pending");
    expect(b.items.find((i: any) => i.id === fx.b.borrador.listingId).name).toBe("Ficha de B Borrador Renombrada");
  });
});

describe("criterio 5: lectura directa de una ficha de B", () => {
  it("5 casos, uno por estado: 403 forbidden sin contenido ajeno y sin cambios; B y A leen lo propio", async () => {
    const table: Array<{ estado: string; codigo: number; longitud: number }> = [];
    for (const [state, listing] of bStates()) {
      const before = await snapshotAll(owner);
      const res = await api.get(A6, listing.listingId);
      const text = await read("5", res);
      expect(res.status, state).toBe(403);
      expect(res.headers.get("content-type")).toContain(PROBLEM);
      const json = JSON.parse(text);
      expect(json.code).toBe("forbidden");
      expect(json.errors).toBeUndefined();
      expectNoForeign(text, state);
      expect(changedTables(before, await snapshotAll(owner)), state).toEqual([]);
      table.push({ estado: state, codigo: res.status, longitud: text.length });
      const own = await api.get(P2P, listing.listingId);
      expect(own.status).toBe(200);
      const ownJson = await body(own);
      expect((ownJson.working ?? ownJson.published).content.name).toBe(listing.name);
    }
    console.table(table);
    expect((await api.get(A6, fx.a.borrador.listingId)).status).toBe(200);
  });
});

describe("criterio 6: ajena indistinguible de inexistente y de mal formada", () => {
  it("3 operaciones x 3 identificadores: 403 forbidden y respuestas idénticas por operación", async () => {
    const operations: Array<[string, (id: string) => Promise<Response>]> = [
      ["getManagedListing", (id) => api.get(A6, id)],
      ["saveListingDraft", (id) => api.save(A6, id, draftBody(world))],
      ["submitListingForReview", (id) => api.submit(A6, id, SUBMIT_BODY)],
    ];
    const table: Array<{ operacion: string; id: string; codigo: string }> = [];
    for (const [name, call] of operations) {
      const seen: Array<{ status: number; type: string | null; text: string }> = [];
      for (const [label, id] of [["ficha de B", fx.b.borrador.listingId], ["UNKNOWN_ID", UNKNOWN_ID], [MALFORMED, MALFORMED]] as const) {
        const res = await call(id);
        const text = await read("6", res);
        expect(res.status, `${name} ${label}`).toBe(403);
        expect(JSON.parse(text).code).toBe("forbidden");
        seen.push({ status: res.status, type: res.headers.get("content-type"), text });
        table.push({ operacion: name, id: label, codigo: `${res.status} forbidden` });
      }
      expect(seen[0]!.type).toContain(PROBLEM);
      expect(seen[1], name).toEqual(seen[0]);
      expect(seen[2], name).toEqual(seen[0]);
    }
    console.table(table);
    expect(table).toHaveLength(9);
  });
});

describe("criterio 7: el acceso de cada prestador a lo propio no se rompe", () => {
  it("5 de B y 3 de A leen 200 válido con su businessId; A guarda sus dos negocios (D-006)", async () => {
    for (const [user, set] of [[P2P, Object.values(fx.b)], [A6, Object.values(fx.a)]] as const) {
      for (const s of set) {
        const res = await api.get(user, s.listingId);
        const json = await body(res);
        expect(res.status).toBe(200);
        expect(validateSchema("ManagedListing", json)).toEqual([]);
        expect(json.businessId).toBe(s.businessId);
      }
    }
    for (const s of [fx.a.borrador, fx.a.borrador2]) {
      expect((await api.save(A6, s.listingId, draftBody(world, { name: s.name, schedule: "Horario propio de A" }))).status).toBe(200);
    }
  });
});

describe("criterio 8: edición ajena", () => {
  it("5 casos, uno por estado: 403 forbidden, sin cambios y lo publicado de B intacto", async () => {
    for (const [state, listing] of bStates()) {
      const before = await snapshotAll(owner);
      const digest = await rowDigest(owner, listing.listingId);
      const detail = await body(await api.get(P2P, listing.listingId));
      const res = await api.save(A6, listing.listingId, draftBody(world, { name: ATTACK_NAME }));
      const text = await read("8", res);
      expect(res.status, state).toBe(403);
      expect(JSON.parse(text).code).toBe("forbidden");
      expect(changedTables(before, await snapshotAll(owner)), state).toEqual([]);
      expect(await rowDigest(owner, listing.listingId), state).toEqual(digest);
      const after = await body(await api.get(P2P, listing.listingId));
      expect(after.working?.content ?? null).toEqual(detail.working?.content ?? null);
      expect(after.updatedAt ?? after.working?.updatedAt).toEqual(detail.updatedAt ?? detail.working?.updatedAt);
    }
    const publicNames = ((await body(await api.published(VISITOR))).items as any[]).map((i) => i.name);
    expect(publicNames).toContain(B_NAMES.publicada);
    expect(publicNames).toContain(B_NAMES.edicion);
    expect(publicNames).not.toContain(ATTACK_NAME);
  });
});

describe("criterio 9: envío ajeno", () => {
  it("5 casos, uno por estado: 403 forbidden, sin cambios, sin eventos, auditoría ni avisos nuevos", async () => {
    for (const [state, listing] of bStates()) {
      const before = await snapshotAll(owner);
      const digest = await rowDigest(owner, listing.listingId);
      const res = await api.submit(A6, listing.listingId, SUBMIT_BODY);
      const text = await read("9", res);
      expect(res.status, state).toBe(403);
      expect(JSON.parse(text).code).toBe("forbidden");
      const after = await snapshotAll(owner);
      expect(changedTables(before, after), state).toEqual([]);
      for (const t of ["listing_status_events", "audit_events", "notification_outbox"]) expect(after[t]!.count).toBe(before[t]!.count);
      expect(await rowDigest(owner, listing.listingId), state).toEqual(digest);
    }
    expect((await rows("select status from app.listing_versions where id = $1", [fx.b.borrador.versionId]))[0].status).toBe("draft");
    expect((await rows("select status from app.listing_versions where id = $1", [fx.b.edicion.versionId]))[0].status).toBe("draft");
  });
});

describe("criterio 10: cuerpo malicioso o inválido sobre ficha ajena", () => {
  const variants = (op: "save" | "submit", b: { businessId: string; listingId: string }): Array<[string, unknown]> => {
    const valid = (): Record<string, any> => (op === "save" ? draftBody(world) : { ...SUBMIT_BODY });
    const inContent = (extra: Record<string, unknown>) => (op === "save" ? draftBody(world, extra) : { ...SUBMIT_BODY, content: extra });
    const withRoot = (extra: Record<string, unknown>) => ({ ...valid(), ...extra });
    const noConfirmed = valid();
    delete noConfirmed.confirmed;
    return [
      ["V1 cuerpo vacío", {}], ["V2 JSON inválido", "{"], ["V3 sin confirmed", noConfirmed],
      ["V4 campo desconocido", withRoot({ campoDesconocido: 1 })], ["V5 businessId en la raíz", withRoot({ businessId: b.businessId })],
      ["V6 listingId en la raíz", withRoot({ listingId: b.listingId })], ["V7 kind en la raíz", withRoot({ kind: "establishment" })],
      ["V8 businessId en content", inContent({ businessId: b.businessId })], ["V9 listingId en content", inContent({ listingId: b.listingId })],
      ["V10 kind en content", inContent({ kind: "establishment" })],
    ];
  };
  it("10 variantes x 2 operaciones x 2 IDs = 40 casos, todos 403 forbidden sin cambios", async () => {
    const table: Array<{ variante: string; operacion: string; id: string; codigo: string }> = [];
    for (const [idLabel, id] of [["ficha de B", fx.b.borrador.listingId], ["UNKNOWN_ID", UNKNOWN_ID]] as const) {
      for (const op of ["save", "submit"] as const) {
        for (const [label, payload] of variants(op, fx.b.borrador)) {
          const before = await snapshotAll(owner);
          const res = op === "save" ? await api.save(A6, id, payload) : await api.submit(A6, id, payload);
          const text = await read("10", res);
          expect(res.status, `${label} ${op} ${idLabel}`).toBe(403);
          const json = JSON.parse(text);
          expect(json.code).toBe("forbidden");
          expect(json.errors).toBeUndefined();
          expect(changedTables(before, await snapshotAll(owner)), `${label} ${op} ${idLabel}`).toEqual([]);
          table.push({ variante: label, operacion: op, id: idLabel, codigo: `${res.status} ${json.code}` });
        }
      }
    }
    console.table(table);
    expect(table).toHaveLength(40);
  });
});

describe("criterio 11: no se puede crear ficha sobre el negocio de otro", () => {
  it("businessId en la raíz o en content da 422 unknown_field sin cambios; sin él crea un negocio nuevo de A", async () => {
    const expected = [{ field: "businessId", code: "unknown_field", message: "Este dato no se reconoce." }];
    for (const payload of [createBody(world, {}, { businessId: fx.b.borrador.businessId }), createBody(world, { businessId: fx.b.borrador.businessId })]) {
      const before = await snapshotAll(owner);
      const res = await api.create(A6, payload);
      const json = JSON.parse(await read("11", res));
      expect(res.status).toBe(422);
      expect(json.code).toBe("validation_failed");
      expect(json.errors).toEqual(expected);
      expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    }
    const bBefore = await rows("select id, provider_account_id from app.businesses where provider_account_id = $1 order by id", [world.p2pAccount]);
    const total = (await rows("select count(*)::int as n from app.businesses"))[0].n;
    const res = await api.create(A6, createBody(world, { name: "Ficha de A Nueva" }));
    expect(res.status).toBe(201);
    expect((await rows("select count(*)::int as n from app.businesses"))[0].n).toBe(total + 1);
    expect((await rows("select count(*)::int as n from app.businesses where provider_account_id = $1", [world.a6Account]))[0].n).toBe(4);
    expect(await rows("select id, provider_account_id from app.businesses where provider_account_id = $1 order by id", [world.p2pAccount])).toEqual(bBefore);
  });
});

describe("criterio 12: A ataca mientras B trabaja", () => {
  it("línea base d = 0 y, con 20 carreras, B siempre 200, A siempre 403 y 1 sola versión", async () => {
    const control = await body(await api.create(P2P, createBody(world, { name: "Ficha de B Control" })));
    const count = async () => (await rows("select count(*)::int as n from app.listing_versions where listing_id = $1", [control.id]))[0].n as number;
    const before = await count();
    expect(before).toBe(1);
    for (let i = 0; i < 20; i++) expect((await api.save(P2P, control.id, draftBody(world, { name: "Ficha de B Control", schedule: `Horario ${i}` }))).status).toBe(200);
    const d = (await count()) - before;
    console.log(`línea base: d = ${d}`);
    expect(d).toBe(0);
    for (let i = 0; i < 20; i++) {
      const [mine, attack] = await Promise.all([
        api.save(P2P, control.id, draftBody(world, { name: "Ficha de B Control", schedule: `Horario de B ${i}` })),
        api.save(A6, control.id, draftBody(world, { name: ATTACK_NAME })),
      ]);
      expect(mine.status).toBe(200);
      expect(attack.status).toBe(403);
    }
    const final = await rows("select name, schedule from app.listing_versions where listing_id = $1", [control.id]);
    console.log(`conteo final de versiones: ${final.length}`);
    expect(final).toHaveLength(1);
    expect(final[0]).toEqual({ name: "Ficha de B Control", schedule: "Horario de B 19" });
    expect((await rows("select count(*)::int as n from app.listing_versions where name = $1", [ATTACK_NAME]))[0].n).toBe(0);
  });
});

describe("criterio 13: sin identidad o con identidad ajena", () => {
  it("3 operaciones x 3 variantes = 9 casos: 401 sin consultar la base; con la firma de B, 200", async () => {
    const failing = failingDb();
    const noDb = makeListingApi(failing.db);
    const id = fx.b.borrador.listingId;
    const variants: Array<[string, number | null, Record<string, string> | undefined]> = [
      ["sin cabecera", null, undefined],
      ["firma de otro token", P2P, tma(signInitData({ userId: P2P, token: "9:otro" }))],
      ["user.id cambiado por el de A", P2P, tma(signInitData({ userId: P2P, tamperUserId: A6 }))],
    ];
    const before = await snapshotAll(owner);
    let cases = 0;
    for (const [label, user, headers] of variants) {
      for (const [name, call] of [
        ["get", () => noDb.get(user, id, headers)],
        ["save", () => noDb.save(user, id, draftBody(world), headers)],
        ["submit", () => noDb.submit(user, id, SUBMIT_BODY, headers)],
      ] as Array<[string, () => Promise<Response>]>) {
        const res = await call();
        expect(res.status, `${name} ${label}`).toBe(401);
        expect((await res.json()).code).toBe("unauthenticated");
        cases++;
      }
    }
    expect(cases).toBe(9);
    expect(failing.queries).toHaveLength(0);
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    await noDb.destroy();
    expect((await api.get(P2P, id)).status).toBe(200);
  });
});

describe("criterio 14: prestador sin permiso vigente y visitante sin rol", () => {
  const four = (user: number, id: string): Array<[string, () => Promise<Response>]> => [
    ["list", () => api.list(user)],
    ["get", () => api.get(user, id)],
    ["save", () => api.save(user, id, draftBody(world))],
    ["submit", () => api.submit(user, id, SUBMIT_BODY)],
  ];
  it("A sin permiso provider y A2 reciben 403 forbidden en las 4 operaciones sin cambios; B sigue; A6b recibe consent_required", async () => {
    const grant = (await rows("select id from app.role_grants where telegram_user_id = $1 and role = 'provider'", [A6]))[0].id as string;
    const revoked = await revokeRoleHandler(api.deps)(
      new Request(`http://localhost/api/v1/role-grants/${grant}/revocation`, { method: "POST", headers: { "Content-Type": "application/json", ...tma(signInitData({ userId: ADMIN })) }, body: JSON.stringify({ confirmed: true }) }),
      { params: Promise.resolve({ grantId: grant }) },
    );
    expect(revoked.status).toBe(200);
    const before = await snapshotAll(owner);
    for (const [name, call] of four(A6, fx.a.borrador.listingId)) {
      const res = await call();
      expect(res.status, `A ${name}`).toBe(403);
      expect(JSON.parse(await read("14", res)).code).toBe("forbidden");
    }
    for (const [name, call] of four(VISITOR, fx.b.borrador.listingId)) {
      const res = await call();
      expect(res.status, `A2 ${name}`).toBe(403);
      expect(JSON.parse(await read("14", res)).code).toBe("forbidden");
    }
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect((await rows("select count(*)::int as n from app.listings where id = $1", [fx.a.borrador.listingId]))[0].n).toBe(1);
    expect((await api.list(P2P)).status).toBe(200);
    expect((await api.save(P2P, fx.b.borrador.listingId, draftBody(world, { name: B_NAMES.borrador }))).status).toBe(200);
    const snapshot = await snapshotAll(owner);
    for (const [name, call] of four(A6B, fx.b.borrador.listingId).slice(1)) {
      const res = await call();
      expect(res.status, `A6b ${name}`).toBe(403);
      expect(JSON.parse(await read("14", res)).code).toBe("consent_required");
    }
    expect(changedTables(snapshot, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterio 15: las operaciones de revisión no entregan fichas ajenas", () => {
  it("A recibe 403 forbidden en las 4; la ficha de B sigue pendiente y no hay cambios", async () => {
    const before = await snapshotAll(owner);
    const { listingId, versionId } = fx.b.pendiente;
    const calls: Array<[string, () => Promise<Response>]> = [
      ["getReview", () => api.review(A6, versionId)],
      ["listPendingReviews", () => api.reviews(A6)],
      ["approveListingVersion", () => api.approve(A6, versionId, { confirmed: true })],
      ["rejectListingVersion", () => api.reject(A6, versionId, { confirmed: true, reason: B_REASON })],
    ];
    for (const [name, call] of calls) {
      const res = await call();
      const text = await read("15", res);
      expect(res.status, name).toBe(403);
      expect(JSON.parse(text).code).toBe("forbidden");
      for (const needle of foreign().filter((n) => n !== B_REASON)) expect(text, name).not.toContain(needle);
    }
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect((await rows("select status from app.listing_versions where listing_id = $1", [listingId]))[0].status).toBe("pending");
  });
});

describe("criterio 16: ninguna respuesta filtra datos personales ni internos", () => {
  it("el conjunto de cuerpos de los criterios 2 a 15 no contiene identidad, ID de Telegram, cuenta ajena ni trazas", () => {
    expect(received.length).toBeGreaterThanOrEqual(90);
    const criteria = new Set(received.map((r) => r.criterion));
    for (const c of ["2", "5", "6", "8", "9", "10", "11", "14", "15"]) expect(criteria, `faltan cuerpos del criterio ${c}`).toContain(c);
    for (const { criterion, text, secrets: forbiddenValues } of received) {
      for (const value of forbiddenValues) expect(text, `criterio ${criterion}: contiene «${value}»`).not.toContain(value);
      expect(text, `criterio ${criterion}`).not.toMatch(/\b(undefined|stack|pg_|SQLSTATE)\b/i);
    }
  });
});
