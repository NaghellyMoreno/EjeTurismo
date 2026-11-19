/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { photoTexts as t } from "@/lib/photo-texts";
import { ownerPool, resetDb } from "../helpers/db";
import { A6, ADMIN, createBody, draftBody, ESTABLISHMENT_ONE, seedWorld, SUBMIT_BODY, type World } from "../helpers/listing-http";
import { flush } from "../helpers/review-listing";
import { jpegBytes, makePhotoApi } from "../helpers/photo-http";
import { validateSchema } from "../helpers/openapi";

// F020, criterios 5, 8, 9a a 9d, 10a y 10b: concurrencia, cuota global y límites de la versión (servicio y disparador).
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let world: World;
const api = makePhotoApi({ BLOB_STORAGE_QUOTA_BYTES: "3000" });
const wide = makePhotoApi({ BLOB_STORAGE_QUOTA_BYTES: "10000000000" });
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string, where = "true", params: unknown[] = []) => Number((await rows(`select count(*) from app.${table} where ${where}`, params))[0].count);
const json = async (res: Response) => (await res.clone().json()) as Record<string, any>;
const request = (size: number) => ({ fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: size });
const GB2 = 2_147_483_648;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
  await wide.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  await resetDb(owner);
  world = await seedWorld(owner);
  api.storage.reset();
});

async function draft(name = ESTABLISHMENT_ONE) {
  const created = await json(await api.create(A6, createBody(world, { name })));
  return { listingId: created.id as string, versionId: created.working.id as string };
}
async function problem(res: Response, status: number, code: string, detail?: string) {
  expect(res.status).toBe(status);
  const body = await json(res);
  expect(body.code).toBe(code);
  expect(validateSchema("Problem", body)).toEqual([]);
  if (detail !== undefined) expect(body.detail).toBe(detail);
}
// Filas sintéticas de `listing_photos` (criterio 10): `rowsCount` filas cuya suma es `total`, cada una de menos de 2^31 bytes.
async function synthetic(versionId: string, rowsCount: number, total: number) {
  const each = Math.floor(total / rowsCount);
  for (let i = 0; i < rowsCount; i++) {
    const size = i === rowsCount - 1 ? total - each * (rowsCount - 1) : each;
    await owner.query("insert into app.listing_photos (version_id, blob_pathname, content_type, size_bytes, position) values ($1, $2, 'image/jpeg', $3, $4)", [versionId, `listings/sintetica/${versionId}-${i}.jpg`, size, i + 1]);
  }
}

describe("criterio 5: dos registros simultáneos con 9 fotos", () => {
  it("una queda en 201 y la otra en 409; la versión termina con 10 y el archivo rechazado se borra", async () => {
    const wideDraft = await json(await wide.create(A6, createBody(world)));
    const listingId = wideDraft.id as string;
    const versionId = wideDraft.working.id as string;
    await wide.many(A6, listingId, versionId, 9);
    const tickets: any[] = [];
    for (let i = 0; i < 2; i++) {
      const ticket = await json(await wide.upload(A6, listingId, versionId, request(125)));
      wide.storage.put(await wide.pathnameOf(ticket.uploadId), jpegBytes(), "image/jpeg");
      tickets.push(ticket);
    }
    const results = await Promise.all(tickets.map((ticket) => wide.register(A6, listingId, versionId, { uploadId: ticket.uploadId })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.findIndex((r) => r.status === 409);
    expect((await json(results[loser]!)).code).toBe("photo_limit_exceeded");
    expect(await count("listing_photos", "version_id = $1", [versionId])).toBe(10);
    expect(wide.storage.deletedPathnames()).toEqual([await wide.pathnameOf(tickets[loser].uploadId)]);
  });
});

describe("criterio 8: cuota global exacta", () => {
  it("3 fotos de 1 000 bytes con cuota 3 000 se aceptan; la cuarta solicitud da 409 storage_quota_exceeded sin fila nueva", async () => {
    const { listingId, versionId } = await draft();
    await api.many(A6, listingId, versionId, 3, jpegBytes(1000));
    const uploads = await count("photo_uploads");
    await problem(await api.upload(A6, listingId, versionId, request(1000)), 409, "storage_quota_exceeded", t.quotaExceeded);
    expect(await count("photo_uploads")).toBe(uploads);
  });

  it("el registro también comprueba la cuota con el tamaño real y borra el archivo", async () => {
    const { listingId, versionId } = await draft();
    await api.many(A6, listingId, versionId, 2, jpegBytes(1000));
    const ticket = await json(await api.upload(A6, listingId, versionId, request(500)));
    api.storage.put(await api.pathnameOf(ticket.uploadId), jpegBytes(1500), "image/jpeg");
    await problem(await api.register(A6, listingId, versionId, { uploadId: ticket.uploadId }), 409, "storage_quota_exceeded", t.quotaExceeded);
    expect(api.storage.deletedPathnames()).toEqual([await api.pathnameOf(ticket.uploadId)]);
  });
});

describe("criterios 9a a 9d: qué cuenta para la cuota (3 000 bytes)", () => {
  it("9a: un archivo compartido entre la publicada y el borrador se cuenta una sola vez", async () => {
    const { listingId, versionId } = await draft();
    await api.many(A6, listingId, versionId, 2, jpegBytes(1000));
    expect((await api.submit(A6, listingId, SUBMIT_BODY)).status).toBe(200);
    expect((await api.approve(ADMIN, versionId)).status).toBe(200);
    await flush(afterTasks);
    const saved = await json(await api.save(A6, listingId, draftBody(world)));
    expect(await count("listing_photos")).toBe(4);
    expect((await rows("select distinct blob_pathname from app.listing_photos")).length).toBe(2);
    expect((await api.upload(A6, listingId, saved.working.id, request(1000))).status).toBe(201);
  });

  it("9b: una subida emitida y sin registrar reserva su tamaño", async () => {
    const { listingId, versionId } = await draft();
    await api.many(A6, listingId, versionId, 2, jpegBytes(1000));
    expect((await api.upload(A6, listingId, versionId, request(1000))).status).toBe(201);
    await problem(await api.upload(A6, listingId, versionId, request(1)), 409, "storage_quota_exceeded");
  });

  it("9c: una subida vencida deja de reservar", async () => {
    const { listingId, versionId } = await draft();
    await api.many(A6, listingId, versionId, 2, jpegBytes(1000));
    const ticket = await json(await api.upload(A6, listingId, versionId, request(1000)));
    await problem(await api.upload(A6, listingId, versionId, request(1)), 409, "storage_quota_exceeded");
    await owner.query("update app.photo_uploads set expires_at = now() - interval '1 minute' where id = $1", [ticket.uploadId]);
    expect((await api.upload(A6, listingId, versionId, request(1000))).status).toBe(201);
  });

  it("9d: la suma igual a la cuota acepta y un byte más rechaza", async () => {
    const { listingId, versionId } = await draft();
    await api.many(A6, listingId, versionId, 2, jpegBytes(1000));
    await problem(await api.upload(A6, listingId, versionId, request(1001)), 409, "storage_quota_exceeded");
    expect((await api.upload(A6, listingId, versionId, request(1000))).status).toBe(201);
  });
});

describe("criterios 10a y 10b: 2 GB por versión", () => {
  async function wideDraft() {
    const created = await json(await wide.create(A6, createBody(world)));
    return { listingId: created.id as string, versionId: created.working.id as string };
  }

  it("10a: con 9 filas que suman 2 GB menos 1 000, pedir 2 000 bytes da 409 photo_total_size_exceeded", async () => {
    const { listingId, versionId } = await wideDraft();
    await synthetic(versionId, 9, GB2 - 1000);
    await problem(await wide.upload(A6, listingId, versionId, request(2000)), 409, "photo_total_size_exceeded", t.totalExceeded);
    expect(await count("photo_uploads")).toBe(0);
  });

  it("10b: la suma exacta de 2 GB se acepta (llega a 10 fotos) y luego da 409 photo_limit_exceeded", async () => {
    const { listingId, versionId } = await wideDraft();
    await synthetic(versionId, 9, GB2 - 1000);
    const { created, registered } = await wide.flow(A6, listingId, versionId, { bytes: jpegBytes(1000) });
    expect(created.status).toBe(201);
    expect(registered!.status).toBe(201);
    expect(Number((await rows("select sum(size_bytes) as total from app.listing_photos where version_id = $1", [versionId]))[0].total)).toBe(GB2);
    await problem(await wide.upload(A6, listingId, versionId, request(1)), 409, "photo_limit_exceeded");
  });

  it("10b: con 8 filas, 1 001 bytes da 409 en el servicio y el INSERT directo que suma 2 GB + 1 lo rechaza el disparador", async () => {
    const { listingId, versionId } = await wideDraft();
    await synthetic(versionId, 8, GB2 - 1000);
    await problem(await wide.upload(A6, listingId, versionId, request(1001)), 409, "photo_total_size_exceeded");
    const insert = (size: number) =>
      owner.query("insert into app.listing_photos (version_id, blob_pathname, content_type, size_bytes, position) values ($1, 'listings/directa.jpg', 'image/jpeg', $2, 9)", [versionId, size]);
    await expect(insert(1001)).rejects.toMatchObject({ code: "23514", constraint: "listing_photos_total_size" });
    expect(await count("listing_photos", "version_id = $1", [versionId])).toBe(8);
    await insert(1000);
    expect(await count("listing_photos", "version_id = $1", [versionId])).toBe(9);
  });
});

describe("migración f020: el disparador aplica las mismas reglas que el servicio", () => {
  it("rechaza la foto 11 y las fotos en versiones no editables (publicada de prestador y pendiente)", async () => {
    const { versionId } = await draft();
    await synthetic(versionId, 10, 10_000);
    await expect(owner.query("insert into app.listing_photos (version_id, blob_pathname, content_type, size_bytes, position) values ($1, 'x.jpg', 'image/jpeg', 1, 11)", [versionId])).rejects.toMatchObject({ code: "23514", constraint: "listing_photos_limit" });
    await owner.query("update app.listing_versions set status = 'pending', submitted_at = now() where id = $1", [versionId]);
    await expect(owner.query("delete from app.listing_photos where version_id = $1", [versionId])).rejects.toMatchObject({ code: "23514", constraint: "listing_photos_editable_version" });
    await expect(owner.query("insert into app.listing_photos (version_id, blob_pathname, content_type, size_bytes, position) values ($1, 'y.jpg', 'image/jpeg', 1, 1)", [versionId])).rejects.toMatchObject({ constraint: "listing_photos_editable_version" });
  });
});
