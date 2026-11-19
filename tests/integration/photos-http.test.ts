/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuesta sin tipar */
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { photoTexts as t } from "@/lib/photo-texts";
import { createAccount } from "../factories/accounts";
import { createRegistration } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { A6, A6B, ADMIN, createBody, draftBody, ESTABLISHMENT_ONE, ESTABLISHMENT_TWO, P2P, seedWorld, SUBMIT_BODY, UNKNOWN_ID, VISITOR, type World } from "../helpers/listing-http";
import { flush } from "../helpers/review-listing";
import { jpegBytes, makePhotoApi, pngBytes, textBytes, pdfBytes } from "../helpers/photo-http";
import { validateSchema } from "../helpers/openapi";
import { changedTables, PERSON_IDS, snapshotAll } from "../helpers/role-denial";
import { failingDb } from "../helpers/failing-db";

// F020, criterios 1 a 4, 6, 7, 11 a 24, 36 a 38, 40 y 47 (HTTP): fotografías de una ficha y sus límites con el doble en memoria del almacén.
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", () => ({ after: (task: () => unknown) => void afterTasks.push(task) }));

let owner: Pool;
let world: World;
const api = makePhotoApi();
const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const count = async (table: string, where = "true", params: unknown[] = []) => Number((await rows(`select count(*) from app.${table} where ${where}`, params))[0].count);
const json = async (res: Response) => (await res.clone().json()) as Record<string, any>;

beforeAll(() => void (owner = ownerPool()));
afterAll(async () => {
  await owner.end();
  await api.destroy();
});
beforeEach(async () => {
  afterTasks.length = 0;
  await resetDb(owner);
  world = await seedWorld(owner);
  api.storage.reset();
});
afterEach(() => vi.restoreAllMocks());

// Valida un 4xx contra el esquema Problem y devuelve su cuerpo.
async function problem(res: Response, status: number, code: string, detail?: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  const body = await json(res);
  expect(body.code).toBe(code);
  expect(validateSchema("Problem", body)).toEqual([]);
  if (detail !== undefined) expect(body.detail).toBe(detail);
  return body;
}
async function ok(res: Response, status: number, schema: string) {
  expect(res.status).toBe(status);
  const body = await json(res);
  expect(validateSchema(schema, body)).toEqual([]);
  return body;
}

async function draft(name = ESTABLISHMENT_ONE, userId = A6, w = world) {
  const created = await json(await api.create(userId, createBody(w, { name })));
  return { listingId: created.id as string, versionId: created.working.id as string };
}
async function publish(listingId: string, versionId: string, userId = A6) {
  expect((await api.submit(userId, listingId, SUBMIT_BODY)).status).toBe(200);
  expect((await api.approve(ADMIN, versionId)).status).toBe(200);
  await flush(afterTasks);
}
async function attraction(name = "Atractivo Ficticio Uno") {
  const content = { name, municipalityId: world.municipalityOne, categoryId: world.categoryOne, description: "Descripción ficticia.", schedule: "Todos los días de 8:00 a 17:00", contact: "contacto@ejemplo.invalid", mapsUrl: "https://maps.app.goo.gl/AbCdEf123" };
  const created = await json(await api.create(ADMIN, { kind: "attraction", content, confirmed: true }));
  return { listingId: created.id as string, versionId: created.published.id as string };
}
const photosOf = async (userId: number, listingId: string) => {
  const managed = await json(await api.get(userId, listingId));
  return { managed, working: managed.working?.photos ?? [], published: managed.published?.photos ?? [] };
};
const bigFile = (size: number, base: Uint8Array = jpegBytes()) => {
  const bytes = new Uint8Array(size);
  bytes.set(base.slice(0, 16));
  return bytes;
};

describe("criterios 1, 37 y 36: subir fotos válidas", () => {
  it("1: JPEG sube con los tres pasos y aparece en getManagedListing", async () => {
    const { listingId, versionId } = await draft();
    const bytes = jpegBytes(777);
    const created = await api.upload(A6, listingId, versionId, { fileName: "foto.jpg", contentType: "image/jpeg", sizeBytes: bytes.length });
    const ticket = await ok(created, 201, "PhotoUploadTicket");
    expect(ticket).toMatchObject({ method: "PUT", maxSizeBytes: 5_000_000, remainingPhotos: 9, contentType: "image/jpeg" });
    expect(new URL(ticket.uploadUrl).pathname).toMatch(/^\/api\/test-storage\/upload\//);
    api.storage.put(await api.pathnameOf(ticket.uploadId), bytes, "image/jpeg");
    const photo = await ok(await api.register(A6, listingId, versionId, { uploadId: ticket.uploadId }), 201, "Photo");
    expect(photo).toMatchObject({ position: 1, contentType: "image/jpeg", sizeBytes: 777 });
    const { managed, working } = await photosOf(A6, listingId);
    expect(validateSchema("ManagedListing", managed)).toEqual([]);
    expect(working).toHaveLength(1);
    expect(working[0].id).toBe(photo.id);
    expect(managed.working.photosTotalBytes).toBe(777);
    expect(await count("listing_photos", "version_id = $1", [versionId])).toBe(1);
  });

  it("37: PNG válida", async () => {
    const { listingId, versionId } = await draft();
    const { created, registered } = await api.flow(A6, listingId, versionId, { bytes: pngBytes(), contentType: "image/png", fileName: "foto.png" });
    await ok(created, 201, "PhotoUploadTicket");
    expect(await ok(registered!, 201, "Photo")).toMatchObject({ contentType: "image/png", sizeBytes: 90 });
  });

  it("36: la foto de borde de 5 000 000 bytes se acepta; 5 000 001 declarado como 5 000 000 se rechaza en el registro", async () => {
    const { listingId, versionId } = await draft();
    const edge = await api.flow(A6, listingId, versionId, { bytes: bigFile(5_000_000) });
    expect(edge.created.status).toBe(201);
    expect((await ok(edge.registered!, 201, "Photo")).sizeBytes).toBe(5_000_000);
    const over = await api.flow(A6, listingId, versionId, { bytes: bigFile(5_000_001), declared: 5_000_000 });
    expect(over.created.status).toBe(201);
    await problem(over.registered!, 422, "photo_too_large", t.tooLarge);
  });
});

describe("criterios 2, 3, 6, 7 y 38: tipo, tamaño y firma", () => {
  it("2: un PDF se rechaza al pedir la URL, con el texto aprobado y sin fila en photo_uploads", async () => {
    const { listingId, versionId } = await draft();
    const before = await snapshotAll(owner);
    const res = await api.upload(A6, listingId, versionId, { fileName: "a.pdf", contentType: "application/pdf", sizeBytes: pdfBytes().length });
    const body = await problem(res, 422, "validation_failed", t.invalidType);
    expect(body.errors.map((e: any) => e.field)).toContain("contentType");
    // La subida cuenta como intento (429): solo cambia el contador, ninguna otra tabla.
    expect(changedTables(before, await snapshotAll(owner))).toEqual(["rate_limit_counters"]);
    expect(await count("photo_uploads")).toBe(0);
  });

  it("3: un texto declarado image/jpeg falla por firma en el registro, con photos.uploadFailed y el archivo borrado", async () => {
    const { listingId, versionId } = await draft();
    const { registered, ticket } = await api.flow(A6, listingId, versionId, { bytes: textBytes() });
    const body = await problem(registered!, 422, "validation_failed", t.uploadFailed);
    expect(body.errors[0].field).toBe("uploadId");
    expect(await count("listing_photos")).toBe(0);
    expect(api.storage.deletedPathnames()).toContain(await api.pathnameOf(ticket!.uploadId));
  });

  it("38: firma cruzada (PNG como JPEG y JPEG como PNG) se rechaza y borra el archivo", async () => {
    const { listingId, versionId } = await draft();
    for (const [bytes, contentType] of [[pngBytes(), "image/jpeg"], [jpegBytes(), "image/png"]] as const) {
      const { registered, ticket } = await api.flow(A6, listingId, versionId, { bytes, contentType });
      const body = await problem(registered!, 422, "validation_failed", t.uploadFailed);
      expect(body.errors[0].field).toBe("uploadId");
      expect(api.storage.deletedPathnames()).toContain(await api.pathnameOf(ticket!.uploadId));
    }
    expect(await count("listing_photos")).toBe(0);
  });

  it("6: sizeBytes 5 000 001 da 422 en sizeBytes con photos.tooLarge", async () => {
    const { listingId, versionId } = await draft();
    const res = await api.upload(A6, listingId, versionId, { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 5_000_001 });
    const body = await problem(res, 422, "validation_failed", t.tooLarge);
    expect(body.errors.map((e: any) => e.field)).toContain("sizeBytes");
    expect(await count("photo_uploads")).toBe(0);
  });

  it("7: se declaran 1 000 bytes y el archivo real pesa 5 000 001: 422 photo_too_large y se borra", async () => {
    const { listingId, versionId } = await draft();
    const { registered, ticket } = await api.flow(A6, listingId, versionId, { bytes: bigFile(5_000_001), declared: 1000 });
    await problem(registered!, 422, "photo_too_large", t.tooLarge);
    expect(await count("listing_photos")).toBe(0);
    expect(api.storage.deletedPathnames()).toContain(await api.pathnameOf(ticket!.uploadId));
  });
});

describe("criterios 4 y 12: límite de 10 fotos y quitar", () => {
  it("4: con 10 fotos, la siguiente solicitud da 409 photo_limit_exceeded sin fila nueva", async () => {
    const { listingId, versionId } = await draft();
    await api.many(A6, listingId, versionId, 10);
    const uploads = await count("photo_uploads");
    await problem(await api.upload(A6, listingId, versionId, { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 100 }), 409, "photo_limit_exceeded", t.limitReached);
    expect(await count("listing_photos", "version_id = $1", [versionId])).toBe(10);
    expect(await count("photo_uploads")).toBe(uploads);
  });

  it("12: quitar renumera en orden y libera espacio hasta volver a 10; la foto 11 da 409", async () => {
    const { listingId, versionId } = await draft();
    const [f1, f2, f3] = await api.many(A6, listingId, versionId, 3);
    const res = await api.remove(A6, listingId, versionId, f2!.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const { working, managed } = await photosOf(A6, listingId);
    expect(working.map((p: any) => [p.id, p.position])).toEqual([[f1!.id, 1], [f3!.id, 2]]);
    expect(validateSchema("ManagedListing", managed)).toEqual([]);
    await api.many(A6, listingId, versionId, 8);
    expect((await photosOf(A6, listingId)).working).toHaveLength(10);
    await problem(await api.upload(A6, listingId, versionId, { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 100 }), 409, "photo_limit_exceeded");
  });

  it("D-162: quitar una foto inexistente o de otra versión da 404 not_found; versión ajena, 403", async () => {
    const { listingId, versionId } = await draft();
    const other = await draft(ESTABLISHMENT_TWO);
    const [mine] = await api.many(A6, other.listingId, other.versionId, 1);
    await problem(await api.remove(A6, listingId, versionId, UNKNOWN_ID), 404, "not_found");
    await problem(await api.remove(A6, listingId, versionId, "no-es-uuid"), 404, "not_found");
    await problem(await api.remove(A6, listingId, versionId, mine!.id), 404, "not_found");
    await problem(await api.remove(A6, listingId, other.versionId, mine!.id, "?confirmed=true", undefined), 403, "forbidden");
    expect(await count("listing_photos")).toBe(1);
  });
});

describe("criterio 11, 40 y 24: confirmación, borrado del archivo y auditoría", () => {
  it("11: sin confirmed o con confirmed=false da 422 y no quita nada ni borra archivos", async () => {
    const { listingId, versionId } = await draft();
    const photos = await api.many(A6, listingId, versionId, 2);
    for (const query of ["", "?confirmed=false"]) {
      const body = await problem(await api.remove(A6, listingId, versionId, photos[0]!.id, query), 422, "validation_failed");
      expect(body.errors.map((e: any) => e.field)).toEqual(["confirmed"]);
    }
    expect(await count("listing_photos")).toBe(2);
    expect(api.storage.deletedPathnames()).toEqual([]);
  });

  it("40: al quitar, el archivo se borra solo cuando ninguna versión lo usa", async () => {
    const { listingId, versionId } = await draft();
    const [only] = await api.many(A6, listingId, versionId, 1);
    const pathname = (await rows("select blob_pathname from app.listing_photos where id = $1", [only!.id]))[0].blob_pathname as string;
    expect((await api.remove(A6, listingId, versionId, only!.id)).status).toBe(204);
    expect(api.storage.deletedPathnames()).toEqual([pathname]);

    // Foto compartida entre la publicada y el borrador (criterio 13).
    const two = await draft(ESTABLISHMENT_TWO);
    const [shared] = await api.many(A6, two.listingId, two.versionId, 1);
    await publish(two.listingId, two.versionId);
    api.storage.calls.length = 0;
    const saved = await json(await api.save(A6, two.listingId, draftBody(world, { name: ESTABLISHMENT_TWO })));
    const draftPhoto = saved.working.photos[0];
    expect((await api.remove(A6, two.listingId, saved.working.id, draftPhoto.id)).status).toBe(204);
    expect(api.storage.deletedPathnames()).toEqual([]);
    expect((await json(await api.detail(VISITOR, two.listingId))).photos[0].id).toBe(shared!.id);
  });

  it("24a y 24b: registrar y quitar escriben su evento sin URL ni ruta; lo rechazado y emitir la URL no escriben eventos", async () => {
    const { listingId, versionId } = await draft();
    const events = async () => rows("select * from app.audit_events where action like 'listing.photo_%' order by id");
    await problem(await api.upload(A6, listingId, versionId, { fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 5 }), 422, "validation_failed");
    await api.upload(A6, listingId, versionId, { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 100 });
    await problem(await api.upload(A6, listingId, versionId, { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 5_000_001 }), 422, "validation_failed");
    await problem(await api.upload(VISITOR, listingId, versionId, { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 100 }), 403, "forbidden");
    await problem(await api.upload(null, listingId, versionId, {}), 401, "unauthenticated");
    expect(await events()).toEqual([]);
    const [photo] = await api.many(A6, listingId, versionId, 1);
    expect((await api.remove(A6, listingId, versionId, photo!.id)).status).toBe(204);
    const written = await events();
    expect(written.map((e) => e.action)).toEqual(["listing.photo_added", "listing.photo_removed"]);
    for (const event of written) {
      expect(event.entity_id).toBe(listingId);
      expect(event.actor_account_id).toBe(world.a6Account);
      const text = JSON.stringify(event);
      expect(text).not.toMatch(/http|blob_pathname|listings\/|\.jpg/);
    }
  });
});

describe("criterios 13 a 17 y 14: versiones, publicación y visibilidad", () => {
  it("13 y 14: el borrador copia las fotos (mismos archivos y orden); quitar en el borrador no afecta la publicada", async () => {
    const { listingId, versionId } = await draft();
    await api.many(A6, listingId, versionId, 4);
    await publish(listingId, versionId);
    const saved = await json(await api.save(A6, listingId, draftBody(world)));
    const publishedPaths = (await rows("select blob_pathname, position from app.listing_photos where version_id = $1 order by position", [versionId])).map((r) => r.blob_pathname);
    const draftPaths = (await rows("select blob_pathname, position from app.listing_photos where version_id = $1 order by position", [saved.working.id])).map((r) => r.blob_pathname);
    expect(draftPaths).toEqual(publishedPaths);
    expect(saved.working.photos).toHaveLength(4);
    expect(saved.published.photos).toHaveLength(4);
    expect((await api.remove(A6, listingId, saved.working.id, saved.working.photos[0].id)).status).toBe(204);
    expect((await json(await api.detail(VISITOR, listingId))).photos).toHaveLength(4);
  });

  it("15: una quinta foto en el borrador no se ve hasta aprobar; luego se ven 5", async () => {
    const { listingId, versionId } = await draft();
    await api.many(A6, listingId, versionId, 4);
    await publish(listingId, versionId);
    const saved = await json(await api.save(A6, listingId, draftBody(world)));
    const { registered } = await api.flow(A6, listingId, saved.working.id);
    expect(registered!.status).toBe(201);
    expect((await json(await api.detail(VISITOR, listingId))).photos).toHaveLength(4);
    expect((await api.submit(A6, listingId, SUBMIT_BODY)).status).toBe(200);
    expect((await api.approve(ADMIN, saved.working.id)).status).toBe(200);
    await flush(afterTasks);
    expect((await json(await api.detail(VISITOR, listingId))).photos).toHaveLength(5);
  });

  it("16: sin versión publicada, 404; con la aprobación, 200 con 10 fotos y URLs de lectura vigentes", async () => {
    const { listingId, versionId } = await draft();
    await api.many(A6, listingId, versionId, 10);
    await problem(await api.detail(VISITOR, listingId), 404, "not_found");
    expect((await json(await api.published(VISITOR))).items.map((i: any) => i.id)).not.toContain(listingId);
    expect((await api.submit(A6, listingId, SUBMIT_BODY)).status).toBe(200);
    await problem(await api.detail(VISITOR, listingId), 404, "not_found");
    expect((await api.approve(ADMIN, versionId)).status).toBe(200);
    await flush(afterTasks);
    const detail = await ok(await api.detail(VISITOR, listingId), 200, "PublicListingDetail");
    expect(detail.photos).toHaveLength(10);
    for (const photo of detail.photos) {
      expect(new Date(photo.urlExpiresAt).getTime()).toBeGreaterThan(Date.now());
      const read = new URL(photo.url);
      expect(read.pathname).toMatch(/^\/api\/test-storage\/read\//);
    }
  });

  it("17: el visitante solo ve las fotos publicadas y nunca rutas, prestador ni identidad", async () => {
    const one = await draft();
    await api.many(A6, one.listingId, one.versionId, 2);
    await publish(one.listingId, one.versionId);
    const savedOne = await json(await api.save(A6, one.listingId, draftBody(world)));
    const [own] = await api.many(A6, one.listingId, savedOne.working.id, 1);
    const pending = await draft(ESTABLISHMENT_TWO);
    await api.many(A6, pending.listingId, pending.versionId, 2);
    expect((await api.submit(A6, pending.listingId, SUBMIT_BODY)).status).toBe(200);
    const rejected = await draft("Establecimiento Ficticio Tres");
    await api.many(A6, rejected.listingId, rejected.versionId, 2);
    expect((await api.submit(A6, rejected.listingId, SUBMIT_BODY)).status).toBe(200);
    expect((await api.reject(ADMIN, rejected.versionId)).status).toBe(200);
    const fourth = await draft("Establecimiento Ficticio Cuatro");
    await api.many(A6, fourth.listingId, fourth.versionId, 1);
    await publish(fourth.listingId, fourth.versionId);

    const owned = (await rows("select blob_pathname from app.listing_photos where id = $1", [own!.id]))[0].blob_pathname as string;
    const first = await api.detail(VISITOR, one.listingId);
    const text = await first.clone().text();
    expect((await ok(first, 200, "PublicListingDetail")).photos).toHaveLength(2);
    expect(text).not.toContain(owned);
    for (const listingId of [pending.listingId, rejected.listingId]) {
      const res = await api.detail(VISITOR, listingId);
      await problem(res, 404, "not_found");
      expect(await res.clone().text()).not.toMatch(/listings\/|blob_pathname/);
    }
    const list = await api.published(VISITOR);
    const listText = await list.clone().text();
    expect(validateSchema("PublicListingSummaryPage", await json(list))).toEqual([]);
    expect(listText).not.toMatch(/photos|blob_pathname|listings\//);
    for (const listingId of [one.listingId, fourth.listingId]) {
      const bodyText = await (await api.detail(VISITOR, listingId)).text();
      expect(bodyText).not.toContain("blob_pathname");
      expect(bodyText).not.toContain("9000070310");
      expect(bodyText).not.toContain(String(A6));
    }
  });
});

describe("criterios 18 y 19: atractivos y administrador", () => {
  it("18: el administrador sube a un atractivo publicado (se ve de inmediato) y con 10 recibe 409", async () => {
    const { listingId, versionId } = await attraction();
    const { registered } = await api.flow(ADMIN, listingId, versionId);
    expect(registered!.status).toBe(201);
    expect((await json(await api.detail(VISITOR, listingId))).photos).toHaveLength(1);
    await api.many(ADMIN, listingId, versionId, 9);
    await problem(await api.upload(ADMIN, listingId, versionId, { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 100 }), 409, "photo_limit_exceeded");
  });

  it("19: el administrador quita una foto de AT; A6 sobre AT y el administrador sobre BA6 reciben 403 sin cambios", async () => {
    const at = await attraction();
    const [photo] = await api.many(ADMIN, at.listingId, at.versionId, 1);
    const ba6 = await draft();
    const before = await snapshotAll(owner);
    const body = { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 100 };
    for (const res of [
      await api.upload(A6, at.listingId, at.versionId, body),
      await api.register(A6, at.listingId, at.versionId, { uploadId: UNKNOWN_ID }),
      await api.remove(A6, at.listingId, at.versionId, photo!.id),
      await api.upload(ADMIN, ba6.listingId, ba6.versionId, body),
      await api.register(ADMIN, ba6.listingId, ba6.versionId, { uploadId: UNKNOWN_ID }),
      await api.remove(ADMIN, ba6.listingId, ba6.versionId, UNKNOWN_ID),
    ]) await problem(res, 403, "forbidden");
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
    expect((await api.remove(ADMIN, at.listingId, at.versionId, photo!.id)).status).toBe(204);
  });
});

describe("criterio 20: persona x operación x código", () => {
  it("imprime la tabla y ninguna celda difiere ni cambia datos", async () => {
    const a4 = await createAccount(owner, PERSON_IDS.A4, "Pendiente Ficticio");
    await createRegistration(owner, a4, { status: "pending", number: "9000070140" });
    const a5 = await createAccount(owner, PERSON_IDS.A5, "Rechazada Ficticia");
    await createRegistration(owner, a5, { status: "rejected", number: "9000070150" });
    const ba6 = await draft();
    const fpub = await draft(ESTABLISHMENT_TWO);
    await publish(fpub.listingId, fpub.versionId);
    const at = await attraction();
    const cases: Array<[string, number, string, string, string, string]> = [
      // persona, id, upload, register, remove, getPublishedListing
      ["A1", PERSON_IDS.A1, "403 consent_required", "403 consent_required", "403 consent_required", "403 consent_required"],
      ["A2", PERSON_IDS.A2, "403 forbidden", "403 forbidden", "403 forbidden", "200"],
      ["A3", PERSON_IDS.A3, "403 consent_required", "403 consent_required", "403 consent_required", "403 consent_required"],
      ["A4", PERSON_IDS.A4, "403 forbidden", "403 forbidden", "403 forbidden", "200"],
      ["A5", PERSON_IDS.A5, "403 forbidden", "403 forbidden", "403 forbidden", "200"],
      ["A6b", A6B, "403 consent_required", "403 consent_required", "403 consent_required", "403 consent_required"],
      ["P2p", P2P, "403 forbidden", "403 forbidden", "403 forbidden", "200"],
    ];
    const table: string[] = [];
    const code = async (res: Response) => (res.status === 200 || res.status === 204 ? `${res.status}` : `${res.status} ${(await json(res)).code}`);
    const body = { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 100 };
    for (const [name, id, ...expected] of cases) {
      const before = await snapshotAll(owner);
      const got = [
        await code(await api.upload(id, ba6.listingId, ba6.versionId, body)),
        await code(await api.register(id, ba6.listingId, ba6.versionId, { uploadId: UNKNOWN_ID })),
        await code(await api.remove(id, ba6.listingId, ba6.versionId, UNKNOWN_ID)),
        await code(await api.detail(id, fpub.listingId)),
      ];
      table.push(`${name} | ${got.join(" | ")}`);
      expect(got, name).toEqual(expected);
      expect(changedTables(before, await snapshotAll(owner)), name).toEqual([]);
    }
    const extra: Array<[string, string[], string[]]> = [
      ["A6 sobre AT", [await code(await api.upload(A6, at.listingId, at.versionId, body)), await code(await api.register(A6, at.listingId, at.versionId, { uploadId: UNKNOWN_ID })), await code(await api.remove(A6, at.listingId, at.versionId, UNKNOWN_ID)), await code(await api.detail(A6, at.listingId))], ["403 forbidden", "403 forbidden", "403 forbidden", "200"]],
      ["Administrador sobre BA6", [await code(await api.upload(ADMIN, ba6.listingId, ba6.versionId, body)), await code(await api.register(ADMIN, ba6.listingId, ba6.versionId, { uploadId: UNKNOWN_ID })), await code(await api.remove(ADMIN, ba6.listingId, ba6.versionId, UNKNOWN_ID)), await code(await api.detail(ADMIN, ba6.listingId))], ["403 forbidden", "403 forbidden", "403 forbidden", "404 not_found"]],
    ];
    for (const [name, got, expected] of extra) {
      table.push(`${name} | ${got.join(" | ")}`);
      expect(got, name).toEqual(expected);
    }
    process.stdout.write(`\nF020 criterio 20 (persona | createPhotoUpload | registerPhoto | removePhoto | getPublishedListing)\n${table.join("\n")}\n`);
  });

  it("sin sesión (sin cabecera, firma ajena, user.id cambiado) las 4 operaciones dan 401 con 0 consultas (12 casos)", async () => {
    const failing = failingDb();
    const bad = makePhotoApi();
    const { signInitData, tma } = await import("../helpers/telegram");
    const headers = [{}, tma(signInitData({ userId: A6, token: "9:otro" })), tma(signInitData({ userId: VISITOR, tamperUserId: A6 }))];
    const { createPhotoUploadHandler, registerPhotoHandler, removePhotoHandler, getPublishedListingHandler } = await import("@/server/http/handlers");
    const deps = { config: () => bad.config, db: () => failing.db, now: () => new Date() };
    const ctx = { params: Promise.resolve({ listingId: UNKNOWN_ID, versionId: UNKNOWN_ID, photoId: UNKNOWN_ID }) };
    let cases = 0;
    for (const h of headers) {
      const calls = [
        createPhotoUploadHandler(deps)(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: "{}" }), ctx),
        registerPhotoHandler(deps)(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: "{}" }), ctx),
        removePhotoHandler(deps)(new Request("http://localhost/x?confirmed=true", { method: "DELETE", headers: h }), ctx),
        getPublishedListingHandler(deps)(new Request("http://localhost/x", { headers: h }), ctx),
      ];
      for (const res of await Promise.all(calls)) {
        await problem(res, 401, "unauthenticated");
        cases++;
      }
    }
    expect(cases).toBe(12);
    expect(failing.queries).toHaveLength(0);
    await bad.destroy();
  });
});

describe("criterio 21: versiones no editables", () => {
  it("pendiente, publicada de prestador sin borrador y rechazada dan 409; una versión ajena, 403; sin cambios", async () => {
    const pending = await draft();
    await api.many(A6, pending.listingId, pending.versionId, 1);
    expect((await api.submit(A6, pending.listingId, SUBMIT_BODY)).status).toBe(200);
    const published = await draft(ESTABLISHMENT_TWO);
    await publish(published.listingId, published.versionId);
    const rejected = await draft("Establecimiento Ficticio Tres");
    expect((await api.submit(A6, rejected.listingId, SUBMIT_BODY)).status).toBe(200);
    expect((await api.reject(ADMIN, rejected.versionId)).status).toBe(200);
    const [photo] = await rows("select id from app.listing_photos where version_id = $1", [pending.versionId]);
    const before = await snapshotAll(owner);
    const body = { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 100 };
    for (const target of [pending, published, rejected]) {
      await problem(await api.upload(A6, target.listingId, target.versionId, body), 409, "invalid_state_transition");
      await problem(await api.register(A6, target.listingId, target.versionId, { uploadId: UNKNOWN_ID }), 409, "invalid_state_transition");
      await problem(await api.remove(A6, target.listingId, target.versionId, photo.id), 409, "invalid_state_transition");
    }
    await problem(await api.upload(A6, pending.listingId, published.versionId, body), 403, "forbidden");
    expect(changedTables(before, await snapshotAll(owner))).toEqual([]);
  });
});

describe("criterios 22a a 22e: la subida pertenece a quien la pidió y a su versión", () => {
  it("22a: P2p emite una subida en su ficha; A6 la registra contra BA6 y recibe 409 upload_not_found", async () => {
    const mine = await draft();
    const theirs = await json(await api.create(P2P, createBody(world, { name: ESTABLISHMENT_TWO })));
    const ticket = await json(await api.upload(P2P, theirs.id, theirs.working.id, { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 125 }));
    api.storage.put(await api.pathnameOf(ticket.uploadId), jpegBytes(), "image/jpeg");
    await problem(await api.register(A6, mine.listingId, mine.versionId, { uploadId: ticket.uploadId }), 409, "upload_not_found");
    expect(await count("listing_photos")).toBe(0);
  });

  it("22b: la subida emitida para BA6 no sirve contra BA6b y sigue registrable contra BA6", async () => {
    const one = await draft();
    const two = await draft(ESTABLISHMENT_TWO);
    const ticket = await json(await api.upload(A6, one.listingId, one.versionId, { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 125 }));
    api.storage.put(await api.pathnameOf(ticket.uploadId), jpegBytes(), "image/jpeg");
    await problem(await api.register(A6, two.listingId, two.versionId, { uploadId: ticket.uploadId }), 409, "upload_not_found");
    expect(await count("listing_photos", "version_id = $1", [two.versionId])).toBe(0);
    expect((await api.register(A6, one.listingId, one.versionId, { uploadId: ticket.uploadId })).status).toBe(201);
  });

  it("22c y 22d: un UUID inexistente y una subida vencida dan 409 upload_not_found", async () => {
    const { listingId, versionId } = await draft();
    await problem(await api.register(A6, listingId, versionId, { uploadId: "6f9c2f0e-1111-4222-8333-444455556666" }), 409, "upload_not_found");
    const ticket = await json(await api.upload(A6, listingId, versionId, { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 125 }));
    api.storage.put(await api.pathnameOf(ticket.uploadId), jpegBytes(), "image/jpeg");
    await owner.query("update app.photo_uploads set expires_at = now() - interval '1 minute' where id = $1", [ticket.uploadId]);
    await problem(await api.register(A6, listingId, versionId, { uploadId: ticket.uploadId }), 409, "upload_not_found");
    expect(await count("listing_photos")).toBe(0);
  });

  it("22e: registrar dos veces el mismo uploadId da 201 y luego 409; no duplica la foto", async () => {
    const { listingId, versionId } = await draft();
    const { ticket, registered } = await api.flow(A6, listingId, versionId);
    expect(registered!.status).toBe(201);
    await problem(await api.register(A6, listingId, versionId, { uploadId: ticket!.uploadId }), 409, "upload_not_found");
    expect(await count("listing_photos", "version_id = $1", [versionId])).toBe(1);
    expect(api.storage.deletedPathnames()).toEqual([]);
  });

  it("un uploadId que no es UUID da 422 validation_failed", async () => {
    const { listingId, versionId } = await draft();
    const body = await problem(await api.register(A6, listingId, versionId, { uploadId: "no-es-uuid" }), 422, "validation_failed");
    expect(body.errors[0].field).toBe("uploadId");
  });
});

describe("criterio 23: límite de 30 intentos por hora", () => {
  it("los 30 intentos con PDF cuentan; el 31 da 429 con photos.rateLimited sin emitir URL ni exponer el ID o la IP", async () => {
    const { listingId, versionId } = await draft();
    for (let i = 0; i < 30; i++) {
      await problem(await api.upload(A6, listingId, versionId, { fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }), 422, "validation_failed");
    }
    const res = await api.upload(A6, listingId, versionId, { fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 1000 });
    await problem(res, 429, "rate_limited", t.rateLimited);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(await count("photo_uploads")).toBe(0);
    const counters = await rows("select * from app.rate_limit_counters where action = 'photo_upload'");
    expect(counters).toHaveLength(1);
    expect(counters[0].count).toBe(30);
    const text = JSON.stringify(counters);
    for (const secret of ["900007031", "127.0.0.1", "::1"]) expect(text).not.toContain(secret);
  });

  it("los 401 y 403 no cuentan como intentos", async () => {
    const { listingId, versionId } = await draft();
    await api.upload(null, listingId, versionId, {});
    await api.upload(VISITOR, listingId, versionId, {});
    expect(await count("rate_limit_counters", "action = 'photo_upload'")).toBe(0);
  });
});

describe("criterio 47: getPublishedListing exige el aviso vigente", () => {
  it("A2, A4 y A5 reciben 200; A1, A3 y A6b, 403 consent_required; sin versión publicada, 404", async () => {
    const a4 = await createAccount(owner, PERSON_IDS.A4, "Pendiente Ficticio");
    await createRegistration(owner, a4, { status: "pending", number: "9000070140" });
    const a5 = await createAccount(owner, PERSON_IDS.A5, "Rechazada Ficticia");
    await createRegistration(owner, a5, { status: "rejected", number: "9000070150" });
    const fpub = await draft();
    await publish(fpub.listingId, fpub.versionId);
    const unpublished = await draft(ESTABLISHMENT_TWO);
    for (const id of [PERSON_IDS.A2, PERSON_IDS.A4, PERSON_IDS.A5]) await ok(await api.detail(id, fpub.listingId), 200, "PublicListingDetail");
    for (const id of [PERSON_IDS.A1, PERSON_IDS.A3, A6B]) await problem(await api.detail(id, fpub.listingId), 403, "consent_required");
    await problem(await api.detail(PERSON_IDS.A2, unpublished.listingId), 404, "not_found");
    await problem(await api.detail(PERSON_IDS.A2, "no-es-uuid"), 404, "not_found");
  });
});
