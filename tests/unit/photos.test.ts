import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as readRoute } from "@/app/api/test-storage/read/[token]/route";
import { PUT as uploadRoute } from "@/app/api/test-storage/upload/[token]/route";
import { photoTexts as t } from "@/lib/photo-texts";
import { miniappTexts } from "@/miniapp/texts";
import { detectImageType, parsePhotoRegistration, parsePhotoUpload } from "@/server/domain/photos";
import { BlobStorage, getStorage, MemoryStorage, memoryStorage } from "@/server/storage";
import { jpegBytes, pdfBytes, pngBytes, textBytes } from "../helpers/photo-data";
import { testConfig } from "../helpers/config";

// F020: textos aprobados (D-162), reglas del dominio, fábrica del almacén (criterio 39) y doble en memoria (criterio 41).
afterEach(() => {
  vi.unstubAllEnvs();
  memoryStorage().reset();
});

describe("textos photos.* (D-162): letra por letra", () => {
  it("coinciden con la tabla aprobada y la Mini App usa los mismos", () => {
    expect(miniappTexts.title).toBe("Eje Turismo");
    expect(t.title).toBe("Fotos de la ficha");
    expect(t.counter(0)).toBe("Fotos: 0 de 10");
    expect(t.counter(10)).toBe("Fotos: 10 de 10");
    expect(t.upload).toBe("Agregar foto");
    expect(t.formats).toBe("Formatos permitidos: JPEG o PNG. Máximo 5 MB por foto.");
    expect(t.invalidType).toBe("El archivo no es una imagen. Elige una foto en formato JPEG o PNG.");
    expect(t.tooLarge).toBe("La foto pesa más de 5 MB. Elige una foto más liviana.");
    expect(t.limitReached).toBe("La ficha ya tiene 10 fotos. Quita una para agregar otra.");
    expect(t.totalExceeded).toBe("Las fotos de la ficha superan el espacio máximo permitido. Quita alguna para agregar otra.");
    expect(t.quotaExceeded).toBe("Por ahora no se pueden guardar más fotos. Inténtalo más tarde o avisa al administrador.");
    expect(t.remove(2)).toBe("Quitar foto 2");
    expect(t.removeConfirm).toBe("¿Quitar esta foto de la ficha?");
    expect([t.removeYes, t.removeNo]).toEqual(["Sí, quitar", "No, conservar"]);
    expect(t.removed).toBe("La foto se quitó de la ficha.");
    expect(t.uploadFailed).toBe("No se pudo guardar la foto. Inténtalo de nuevo.");
    expect(t.rateLimited).toBe("Has intentado subir muchas fotos. Espera un rato e inténtalo de nuevo.");
    expect(t.publishedNote).toBe("Los visitantes siguen viendo las fotos publicadas hasta que el administrador apruebe tu cambio.");
    expect(t.attractionNote).toBe("Los cambios en las fotos de un atractivo se publican de inmediato.");
    expect(t.alt(3)).toBe("Foto 3 de la ficha");
  });
});

describe("dominio: firma, tipo y tamaño", () => {
  it("detecta JPEG y PNG por los primeros bytes y rechaza texto y PDF", () => {
    expect(detectImageType(jpegBytes())).toBe("image/jpeg");
    expect(detectImageType(pngBytes())).toBe("image/png");
    expect(detectImageType(textBytes())).toBeNull();
    expect(detectImageType(pdfBytes())).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });

  it("el tamaño máximo es inclusivo (5 000 000) y el tipo debe ser JPEG o PNG", () => {
    const base = { fileName: "a.jpg", contentType: "image/jpeg" };
    expect(parsePhotoUpload({ ...base, sizeBytes: 5_000_000 }, 5_000_000).ok).toBe(true);
    const big = parsePhotoUpload({ ...base, sizeBytes: 5_000_001 }, 5_000_000);
    expect(big.ok ? null : [big.detail, big.errors.map((e) => e.field)]).toEqual([t.tooLarge, ["sizeBytes"]]);
    const pdf = parsePhotoUpload({ ...base, contentType: "application/pdf", sizeBytes: 10 }, 5_000_000);
    expect(pdf.ok ? null : [pdf.detail, pdf.errors.map((e) => e.field)]).toEqual([t.invalidType, ["contentType"]]);
    for (const sizeBytes of [0, -1, 1.5, "10", undefined]) expect(parsePhotoUpload({ ...base, sizeBytes }, 5_000_000).ok, String(sizeBytes)).toBe(false);
    expect(parsePhotoUpload(undefined, 5_000_000).ok).toBe(false);
  });

  it("el registro exige un uploadId UUID y no admite otros campos", () => {
    expect(parsePhotoRegistration({ uploadId: "6f9c2f0e-1111-4222-8333-444455556666" }).ok).toBe(true);
    for (const body of [{}, { uploadId: "x" }, { uploadId: "6f9c2f0e-1111-4222-8333-444455556666", extra: 1 }, null]) expect(parsePhotoRegistration(body).ok).toBe(false);
  });

  it("la configuración trae 5 000 000 bytes por foto y 900 000 000 de cuota por defecto, y los toma del entorno", () => {
    const config = testConfig();
    expect([config.photoMaxBytes, config.blobStorageQuotaBytes]).toEqual([5_000_000, 900_000_000]);
    expect(config.rateLimits.photo_upload).toEqual({ limit: 30, windowSeconds: 3600 });
    const custom = testConfig({ PHOTO_MAX_BYTES: "1000", BLOB_STORAGE_QUOTA_BYTES: "3000" });
    expect([custom.photoMaxBytes, custom.blobStorageQuotaBytes]).toEqual([1000, 3000]);
  });
});

describe("criterio 39: el doble no se activa en producción", () => {
  it("con NODE_ENV=production y STORAGE_DRIVER=memory la fábrica devuelve Vercel Blob", () => {
    expect(getStorage({ NODE_ENV: "production", STORAGE_DRIVER: "memory" })).toBeInstanceOf(BlobStorage);
    expect(getStorage({ NODE_ENV: "production" })).toBeInstanceOf(BlobStorage);
    expect(getStorage({ NODE_ENV: "test", STORAGE_DRIVER: "memory" })).toBeInstanceOf(MemoryStorage);
    expect(getStorage({ NODE_ENV: "test" })).toBeInstanceOf(BlobStorage);
  });

  it("las rutas /api/test-storage responden 404 en producción, con otro driver y sin la variable", async () => {
    const ctx = { params: Promise.resolve({ token: "x" }) };
    const put = () => uploadRoute(new Request("http://localhost/x", { method: "PUT", body: "a" }), ctx);
    const get = () => readRoute(new Request("http://localhost/x"), ctx);
    for (const [nodeEnv, driver] of [["production", "memory"], ["test", ""], ["production", ""]] as const) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("STORAGE_DRIVER", driver);
      expect([(await put()).status, (await get()).status], `${nodeEnv}/${driver}`).toEqual([404, 404]);
    }
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("STORAGE_DRIVER", "memory");
    expect((await put()).status).toBe(403); // token desconocido: la ruta sí existe con el doble activo
  });
});

describe("criterio 41: el doble sirve la subida y la lectura", () => {
  it("la URL de subida acepta el PUT y la de lectura devuelve los mismos bytes con su Content-Type", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("STORAGE_DRIVER", "memory");
    const storage = getStorage();
    const uploadUrl = new URL(await storage.createUploadUrl({ pathname: "listings/a/b.png", contentType: "image/png", maxSizeBytes: 100, expiresAt: new Date(Date.now() + 60_000) }));
    expect(uploadUrl.pathname).toMatch(/^\/api\/test-storage\/upload\/[0-9a-f-]{36}$/);
    const token = uploadUrl.pathname.split("/").pop()!;
    const ctx = { params: Promise.resolve({ token }) };
    const wrongType = await uploadRoute(new Request(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: pngBytes() as BodyInit }), ctx);
    expect(wrongType.status).toBe(400);
    const bytes = pngBytes(50);
    expect((await uploadRoute(new Request(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: bytes as BodyInit }), ctx)).status).toBe(200);
    expect(await storage.inspect("listings/a/b.png")).toMatchObject({ size: 50, contentType: "image/png" });
    const readUrl = new URL(await storage.createReadUrl("listings/a/b.png", new Date()));
    const read = await readRoute(new Request(readUrl), { params: Promise.resolve({ token: readUrl.pathname.split("/").pop()! }) });
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
    await storage.delete("listings/a/b.png");
    expect(await storage.inspect("listings/a/b.png")).toBeNull();
  });
});

describe("criterio 35: .env.example solo trae nombres", () => {
  it("incluye STORAGE_DRIVER sin valor y ninguna variable con valor", () => {
    const lines = readFileSync(resolve(process.cwd(), ".env.example"), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(lines).toContain("STORAGE_DRIVER=");
    expect(lines.filter((l) => !/^[A-Z0-9_]+=$/.test(l))).toEqual([]);
  });
});
