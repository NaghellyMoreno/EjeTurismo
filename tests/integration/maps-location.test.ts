/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLocationKeyboard } from "@/bot/location-keyboard";
import { getPublishedListingHandler } from "@/server/http/handlers";
import { PERSON_IDS, changedTables, snapshotAll } from "../helpers/role-denial";
import { ownerPool, resetDb } from "../helpers/db";
import { createBody, draftBody, MAPS_URL, SUBMIT_BODY } from "../helpers/listing-http";
import { validateSchema } from "../helpers/openapi";
import { A6, ADMIN, flush, makeReviewListingApi, NAME_ONE, seedWorld, VISITOR, type World } from "../helpers/review-listing";
import { signInitData, tma } from "../helpers/telegram";

// F021, criterios 1, 2, 4 a 9, 11 y 15 (los pasos 1 y 2 con el prestador y los datos del paso 3). Criterios 3, 10, 12 y 14 en sus propios archivos.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

const NEW_URL = "https://www.google.com/maps/place/Lugar+Ficticio";
const INVALID = [
  "https://ejemplo.invalid/mapa",
  "http://maps.app.goo.gl/AbCdEf123",
  "https://www.google.com/",
  "https://maps.google.com.evil.invalid/x",
  "no es un enlace",
  `https://maps.app.goo.gl/${"a".repeat(2049 - "https://maps.app.goo.gl/".length)}`,
  123,
];
const CLEAR = { field: "mapsUrl", code: "invalid_maps_url", message: "Escribe un enlace de Google Maps (por ejemplo, maps.app.goo.gl o google.com/maps)." };

let owner: Pool;
let world: World;
const api = makeReviewListingApi();
const detailHandler = getPublishedListingHandler(api.deps);
const detail = (userId: number | null, id: string) =>
  detailHandler(new Request(`http://localhost/api/v1/public/listings/${id}`, { headers: userId === null ? {} : tma(signInitData({ userId })) }), { params: Promise.resolve({ listingId: id }) });
const body = async (res: Response) => (await res.json()) as Record<string, any>;
const mapsOf = async (versionId: string) => (await owner.query("select maps_url from app.listing_versions where id = $1", [versionId])).rows[0].maps_url as string | null;
const expectClear = async (res: Response) => {
  const json = await body(res);
  expect(res.status).toBe(422);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  expect(json.code).toBe("validation_failed");
  expect(json.errors).toEqual([CLEAR]);
};
const publish = async (name = NAME_ONE, content: Record<string, unknown> = {}) => {
  const p = await api.pending(world, name, A6, content);
  expect((await api.approve(ADMIN, p.versionId)).status).toBe(200);
  await flush(afterTasks);
  return p;
};

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

describe("criterio 1: creación con enlace inválido", () => {
  it("responde 422 con el rechazo claro y no cambia nada; null se trata como ausente", async () => {
    const before = await snapshotAll(owner);
    for (const value of INVALID) {
      await expectClear(await api.create(A6, createBody(world, { mapsUrl: value })));
      expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    }
    const res = await api.create(A6, createBody(world, { mapsUrl: null }));
    expect(res.status).toBe(201);
    expect((await body(res)).working.content.mapsUrl ?? null).toBeNull();
  });
});

describe("criterio 2: edición del borrador con enlace inválido", () => {
  it("responde 422 y el maps_url no cambia; null lo deja en null", async () => {
    const created = await body(await api.create(A6, createBody(world)));
    const before = await snapshotAll(owner);
    for (const value of INVALID) {
      await expectClear(await api.save(A6, created.id, draftBody(world, { mapsUrl: value })));
      expect(await mapsOf(created.working.id)).toBe(MAPS_URL);
    }
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect((await api.save(A6, created.id, draftBody(world, { mapsUrl: null }))).status).toBe(200);
    expect(await mapsOf(created.working.id)).toBeNull();
  });
});

describe("criterio 4: enlace vacío", () => {
  it("el borrador se acepta con null, pero el envío responde 422 required y sigue en draft", async () => {
    for (const value of ["", "   ", null]) {
      const res = await api.create(A6, createBody(world, { mapsUrl: value, name: `Ficha ${JSON.stringify(value)}` }));
      expect(res.status).toBe(201);
      const created = await body(res);
      expect(await mapsOf(created.working.id)).toBeNull();
      const submit = await api.submit(A6, created.id, SUBMIT_BODY);
      expect(submit.status).toBe(422);
      expect((await body(submit)).errors).toContainEqual({ field: "mapsUrl", code: "required", message: "El enlace de Google Maps es obligatorio." });
      expect((await body(await api.get(A6, created.id))).displayStatus).toBe("draft");
    }
  });
});

describe("criterio 5: enlace válido guardado", () => {
  it("se guarda igual; con espacios en los extremos se guarda recortado", async () => {
    const res = await api.create(A6, createBody(world));
    const created = await body(res);
    expect(res.status).toBe(201);
    expect(created.working.content.mapsUrl).toBe(MAPS_URL);
    expect(await mapsOf(created.working.id)).toBe(MAPS_URL);
    expect((await api.save(A6, created.id, draftBody(world, { mapsUrl: NEW_URL }))).status).toBe(200);
    expect((await body(await api.get(A6, created.id))).working.content.mapsUrl).toBe(NEW_URL);
    expect(await mapsOf(created.working.id)).toBe(NEW_URL);

    const padded = await api.create(A6, createBody(world, { name: "Ficha con espacios", mapsUrl: `  ${MAPS_URL}  ` }));
    expect(padded.status).toBe(201);
    const json = await body(padded);
    expect(json.working.content.mapsUrl).toBe(MAPS_URL);
    expect(await mapsOf(json.working.id)).toBe(MAPS_URL);
  });
});

describe("criterio 6: hasta publicada", () => {
  it("getPublishedListing devuelve el mapsUrl guardado y el botón lo usa", async () => {
    const p = await publish();
    expect((await body(await api.get(A6, p.listingId))).displayStatus).toBe("published");
    const res = await detail(VISITOR, p.listingId);
    const json = await body(res);
    expect(res.status).toBe(200);
    expect(validateSchema("PublicListingDetail", json)).toEqual([]);
    expect(json.mapsUrl).toBe(MAPS_URL);
    expect(buildLocationKeyboard(json.mapsUrl).inline_keyboard).toEqual([[{ text: "Ver ubicación", url: MAPS_URL }]]);
  });
});

describe("criterio 7: atractivo del administrador", () => {
  const attraction = (mapsUrl: unknown) => ({
    kind: "attraction",
    confirmed: true,
    content: { name: "Atractivo Ficticio Uno", municipalityId: world.municipalityOne, categoryId: world.categoryOne, description: "Descripción ficticia.", schedule: "Todos los días de 8:00 a 17:00", contact: "contacto@ejemplo.invalid", mapsUrl },
  });
  it("rechaza el enlace inválido y con el válido lo publica", async () => {
    await expectClear(await api.create(ADMIN, attraction("https://ejemplo.invalid/mapa")));
    const res = await api.create(ADMIN, attraction(NEW_URL));
    expect(res.status).toBe(201);
    const id = (await body(res)).id as string;
    const pub = await detail(VISITOR, id);
    expect(pub.status).toBe(200);
    expect((await body(pub)).mapsUrl).toBe(NEW_URL);
  });
});

describe("criterio 8: una sola validación", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  const root = resolve(process.cwd());
  const matching = files(join(root, "src")).filter((f) => /goo\.gl|google\.com/.test(readFileSync(f, "utf8"))).map((f) => relative(root, f)).sort();
  it("solo la lista blanca contiene goo.gl o google.com", () => {
    expect(matching).toEqual(["src/server/domain/listings.ts", "src/server/domain/maps-url.ts", "src/shared/api/schema.d.ts"]);
    expect(matching.filter((f) => f.startsWith("src/miniapp/"))).toEqual([]);
  });
  it("listings.ts usa isGoogleMapsUrl", () => expect(readFileSync(join(root, "src/server/domain/listings.ts"), "utf8")).toContain("isGoogleMapsUrl"));
});

describe("criterio 9: versión anterior visible", () => {
  it("la nueva no se ve hasta aprobarla y un enlace inválido no cambia la publicada", async () => {
    const p = await publish();
    expect((await api.save(A6, p.listingId, draftBody(world, { mapsUrl: NEW_URL }))).status).toBe(200);
    const sub = await api.submit(A6, p.listingId, SUBMIT_BODY);
    expect(sub.status).toBe(200);
    const pendingId = (await body(sub)).working.id as string;
    const pre = await detail(VISITOR, p.listingId);
    expect(validateSchema("PublicListingDetail", await body(pre))).toEqual([]);
    expect((await body(await detail(VISITOR, p.listingId))).mapsUrl).toBe(MAPS_URL);
    expect((await api.approve(ADMIN, pendingId)).status).toBe(200);
    await flush(afterTasks);
    expect((await body(await detail(VISITOR, p.listingId))).mapsUrl).toBe(NEW_URL);

    await expectClear(await api.save(A6, p.listingId, draftBody(world, { mapsUrl: "https://ejemplo.invalid/mapa" })));
    expect((await body(await detail(VISITOR, p.listingId))).mapsUrl).toBe(NEW_URL);
  });
});

describe("criterio 11: solo lo publicado y acceso", () => {
  const notFound = async (res: Response) => {
    const text = await res.text();
    expect(res.status).toBe(404);
    expect(JSON.parse(text).code).toBe("not_found");
    expect(text).not.toContain("mapsUrl");
  };
  it("borrador, pendiente sin publicada, rechazada, inexistente y mal formada dan 404", async () => {
    const draft = await body(await api.create(A6, createBody(world, { name: "Borrador Ficticio" })));
    const pend = await api.pending(world, "Pendiente Ficticia");
    const rej = await api.pending(world, "Rechazada Ficticia");
    expect((await api.reject(ADMIN, rej.versionId)).status).toBe(200);
    await flush(afterTasks);
    for (const id of [draft.id, pend.listingId, rej.listingId, "00000000-0000-4000-8000-000000000000", "no-es-uuid"]) await notFound(await detail(VISITOR, id));
  });
  it("publicada con edición pendiente devuelve solo el enlace publicado", async () => {
    const p = await publish();
    await api.save(A6, p.listingId, draftBody(world, { mapsUrl: NEW_URL }));
    await api.submit(A6, p.listingId, SUBMIT_BODY);
    const text = await (await detail(VISITOR, p.listingId)).text();
    expect(JSON.parse(text).mapsUrl).toBe(MAPS_URL);
    expect(text).not.toContain(NEW_URL);
  });
  it("sin sesión responde 401 sin mapsUrl y sin aviso vigente responde como otra ruta protegida", async () => {
    const p = await publish();
    const anon = await detail(null, p.listingId);
    expect(anon.status).toBe(401);
    expect(await anon.text()).not.toContain("mapsUrl");
    const noNotice = await detail(PERSON_IDS.A3, p.listingId);
    const other = await api.published(PERSON_IDS.A3);
    expect(noNotice.status).toBe(other.status);
    expect((await body(noNotice)).code).toBe((await body(other)).code);
    expect(JSON.stringify(await body(await detail(PERSON_IDS.A3, p.listingId)))).not.toContain("mapsUrl");
  });
});
