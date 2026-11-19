import { expect, type APIRequestContext, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createAccount, grantAdmin } from "../factories/accounts";
import { makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { CONTACT, ESTABLISHMENT_ONE, MAPS_URL } from "../helpers/listing-data";
import { jpegBytes, pdfBytes, textBytes } from "../helpers/photo-data";
import { signInitData, tma } from "../helpers/telegram";
import { listingTexts, miniappTexts } from "@/miniapp/texts";
import { photoTexts as t } from "@/lib/photo-texts";

// F020, criterios 25 a 34 y 42 a 45: M06 (y M08) con el doble en memoria del almacén y los textos aprobados (D-162), por igualdad exacta.
const A6 = 900007031;
const ADMIN = 900007001;
const API = "/api/v1/managed-listings";
// PNG de 1x1 píxel (válido para decodificar en el navegador).
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.from(jpegBytes(300));

interface World { municipalityOne: string; categoryOne: string; typeOne: string }
let owner: Pool;
let world: World;
test.beforeAll(async ({ request }) => {
  owner = ownerPool();
  for (const path of ["/", "/fichas", "/fichas/x/fotos", "/api/v1/me", "/api/v1/managed-listings"]) await request.get(path, { timeout: 60_000 });
});
test.afterAll(() => owner.end());
test.beforeEach(async () => {
  await resetDb(owner);
  await createAccount(owner, ADMIN, "Administrador Ficticio");
  await grantAdmin(owner, ADMIN);
  await makeProvider(owner, A6, "9000070310");
  const one = async (sql: string) => (await owner.query(sql)).rows[0].id as string;
  world = {
    municipalityOne: await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Uno', 'municipio ficticio uno', 'Caldas') returning id"),
    categoryOne: await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Uno', 'categoria ficticia uno') returning id"),
    typeOne: await one("insert into app.establishment_types (name, name_normalized) values ('Establecimiento Ficticio', 'establecimiento ficticio') returning id"),
  };
});

const as = (userId: number) => signInitData({ userId });
async function open(page: Page, initData: string, path: string) {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto(path);
}
const content = (name = ESTABLISHMENT_ONE) => ({
  name, municipalityId: world.municipalityOne, categoryId: world.categoryOne, establishmentTypeId: world.typeOne,
  description: "Descripción ficticia.", schedule: "Todos los días de 8:00 a 17:00", contact: CONTACT, mapsUrl: MAPS_URL,
});

async function call(request: APIRequestContext, userId: number, method: "post" | "put" | "get", path: string, data?: unknown) {
  const res = await request[method](path, { headers: tma(as(userId)), ...(data === undefined ? {} : { data }) });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}
async function draft(request: APIRequestContext, name = ESTABLISHMENT_ONE) {
  const { body } = await call(request, A6, "post", API, { kind: "establishment", content: content(name), confirmed: true });
  return { listingId: body.id as string, versionId: body.working.id as string };
}
async function attraction(request: APIRequestContext) {
  const data = { kind: "attraction", content: { ...content("Atractivo Ficticio Uno"), establishmentTypeId: undefined }, confirmed: true };
  const { body } = await call(request, ADMIN, "post", API, data);
  return { listingId: body.id as string, versionId: body.published.id as string };
}
async function addPhotos(request: APIRequestContext, userId: number, listingId: string, versionId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const ticket = await call(request, userId, "post", `${API}/${listingId}/versions/${versionId}/photo-uploads`, { fileName: "foto.jpg", contentType: "image/jpeg", sizeBytes: JPEG.length });
    expect(ticket.status).toBe(201);
    expect((await request.put(ticket.body.uploadUrl, { headers: { "Content-Type": "image/jpeg" }, data: JPEG })).status()).toBe(200);
    expect((await call(request, userId, "post", `${API}/${listingId}/versions/${versionId}/photos`, { uploadId: ticket.body.uploadId })).status).toBe(201);
  }
}
const photoRows = async (versionId: string) => Number((await owner.query("select count(*) from app.listing_photos where version_id = $1", [versionId])).rows[0].count);

// Registra las peticiones a la subida (el POST de photo-uploads y el PUT al almacén).
function trackUploads(page: Page): { count: () => number } {
  let total = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/photo-uploads") || path.startsWith("/api/test-storage/upload/")) total++;
  });
  return { count: () => total };
}
const pick = (page: Page, file: { name: string; mimeType: string; buffer: Buffer | Uint8Array }) => page.getByTestId("photo-file").setInputFiles({ ...file, buffer: Buffer.from(file.buffer) });

test.describe("25 a 28: subir y límites", () => {
  test("25: M06 vacío muestra título, contador, ayuda y botón; subir un JPEG muestra la miniatura y persiste", async ({ page, request }) => {
    const { listingId, versionId } = await draft(request);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await expect(page.getByTestId("photos-title")).toHaveText(t.title);
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(0));
    await expect(page.getByTestId("photos-formats")).toHaveText(t.formats);
    await expect(page.getByTestId("photo-upload")).toHaveText(t.upload);
    await pick(page, { name: "foto.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(1));
    const image = page.getByRole("img", { name: t.alt(1) });
    await expect(image).toBeVisible();
    const src = (await image.getAttribute("src"))!;
    expect(new URL(src).pathname).toMatch(/^\/api\/test-storage\/read\//);
    const served = await page.request.get(src);
    expect([served.status(), served.headers()["content-type"]]).toEqual([200, "image/jpeg"]);
    expect(await photoRows(versionId)).toBe(1);
    await page.reload();
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(1));
    await expect(page.getByRole("img", { name: t.alt(1) })).toBeVisible();
  });

  test("25: una PNG real se decodifica en la miniatura", async ({ page, request }) => {
    const { listingId } = await draft(request);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await pick(page, { name: "foto.png", mimeType: "image/png", buffer: PNG_1X1 });
    const image = page.getByRole("img", { name: t.alt(1) });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  });

  test("26: un PDF o un .txt se detecta sin llamar al backend", async ({ page, request }) => {
    const { listingId } = await draft(request);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await expect(page.getByTestId("photos-counter")).toBeVisible();
    const uploads = trackUploads(page);
    await pick(page, { name: "a.pdf", mimeType: "application/pdf", buffer: pdfBytes() });
    await expect(page.getByTestId("photos-message")).toHaveText(t.invalidType);
    await pick(page, { name: "a.txt", mimeType: "text/plain", buffer: textBytes() });
    await expect(page.getByTestId("photos-message")).toHaveText(t.invalidType);
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(0));
    expect(uploads.count()).toBe(0);
  });

  test("27: un archivo de más de 5 000 000 bytes se detecta por su tamaño sin llamar al backend", async ({ page, request }) => {
    const { listingId } = await draft(request);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await expect(page.getByTestId("photos-counter")).toBeVisible();
    const uploads = trackUploads(page);
    await pick(page, { name: "grande.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(5_000_001) });
    await expect(page.getByTestId("photos-message")).toHaveText(t.tooLarge);
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(0));
    expect(uploads.count()).toBe(0);
  });

  test("28: con 10 fotos el botón queda deshabilitado y se muestra el límite", async ({ page, request }) => {
    const { listingId, versionId } = await draft(request);
    await addPhotos(request, A6, listingId, versionId, 10);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(10));
    await expect(page.getByTestId("photo-upload")).toBeDisabled();
    await expect(page.getByTestId("photos-limit")).toHaveText(t.limitReached);
  });

  test("29: con la cuota global agotada aparece el texto y no se agrega la foto", async ({ page, request }) => {
    const { listingId, versionId } = await draft(request);
    const other = await draft(request, "Establecimiento Ficticio Dos");
    // Cuota del servidor de prueba: 100 000 bytes; una fila sintética de otra ficha casi la agota.
    await owner.query("insert into app.listing_photos (version_id, blob_pathname, content_type, size_bytes, position) values ($1, 'listings/sintetica.jpg', 'image/jpeg', 99900, 1)", [other.versionId]);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await pick(page, { name: "foto.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await expect(page.getByTestId("photos-message")).toHaveText(t.quotaExceeded);
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(0));
    expect(await photoRows(versionId)).toBe(0);
  });

  test("42: un texto con extensión .jpg falla en la verificación y muestra photos.uploadFailed", async ({ page, request }) => {
    const { listingId, versionId } = await draft(request);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await pick(page, { name: "falsa.jpg", mimeType: "image/jpeg", buffer: textBytes() });
    await expect(page.getByTestId("photos-message")).toHaveText(t.uploadFailed);
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(0));
    expect(await photoRows(versionId)).toBe(0);
  });

  test("43: con 30 intentos en la última hora aparece photos.rateLimited y no se agrega la foto", async ({ page, request }) => {
    const { listingId, versionId } = await draft(request);
    for (let i = 0; i < 30; i++) expect((await call(request, A6, "post", `${API}/${listingId}/versions/${versionId}/photo-uploads`, { fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 })).status).toBe(422);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await pick(page, { name: "foto.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await expect(page.getByTestId("photos-message")).toHaveText(t.rateLimited);
    expect(await photoRows(versionId)).toBe(0);
  });
});

test.describe("30, 34 y 45: quitar y accesibilidad", () => {
  test("30 y 45: quitar pide confirmación; «No, conservar» la deja y «Sí, quitar» la quita", async ({ page, request }) => {
    const { listingId, versionId } = await draft(request);
    await addPhotos(request, A6, listingId, versionId, 1);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await page.getByRole("button", { name: t.remove(1) }).click();
    await expect(page.getByTestId("photo-confirm")).toHaveText(t.removeConfirm);
    await expect(page.getByTestId("photo-remove-yes")).toHaveText(t.removeYes);
    await page.getByTestId("photo-remove-no").click();
    await expect(page.getByTestId("photo-confirm")).toHaveCount(0);
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(1));
    expect(await photoRows(versionId)).toBe(1);
    await page.getByRole("button", { name: t.remove(1) }).click();
    await page.getByTestId("photo-remove-yes").click();
    await expect(page.getByTestId("photos-message")).toHaveText(t.removed);
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(0));
    expect(await photoRows(versionId)).toBe(0);
    await page.reload();
    await expect(page.getByTestId("photo-item")).toHaveCount(0);
  });

  test("34: botones y miniaturas con nombre accesible, uso con teclado y sin errores de consola", async ({ page, request }) => {
    const { listingId, versionId } = await draft(request);
    await addPhotos(request, A6, listingId, versionId, 2);
    const errors: string[] = [];
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await expect(page.getByRole("button", { name: t.upload })).toBeEnabled();
    for (const n of [1, 2]) {
      await expect(page.getByRole("button", { name: `Quitar foto ${n}` })).toBeVisible();
      await expect(page.getByRole("img", { name: `Foto ${n} de la ficha` })).toBeVisible();
    }
    await page.getByRole("button", { name: t.remove(2) }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: t.removeYes }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(1));
    await pick(page, { name: "foto.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(2));
    expect(errors).toEqual([]);
  });
});

test.describe("31 y 44: atractivos del administrador", () => {
  test("31 y 44: igual que el prestador, con la nota del atractivo y el límite de 10", async ({ page, request }) => {
    const { listingId, versionId } = await attraction(request);
    await open(page, as(ADMIN), `/fichas/${listingId}/fotos`);
    await expect(page.getByTestId("photos-title")).toHaveText(t.title);
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(0));
    await expect(page.getByTestId("photos-attraction-note")).toHaveText(t.attractionNote);
    await pick(page, { name: "foto.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(1));
    await addPhotos(request, ADMIN, listingId, versionId, 9);
    await page.reload();
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(10));
    await expect(page.getByTestId("photo-upload")).toBeDisabled();
    await expect(page.getByTestId("photos-limit")).toHaveText(t.limitReached);
  });

  test("44: la nota del atractivo no aparece en el borrador de un prestador", async ({ page, request }) => {
    const { listingId } = await draft(request);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await expect(page.getByTestId("photos-counter")).toBeVisible();
    await expect(page.getByTestId("photos-attraction-note")).toHaveCount(0);
  });

  test("el prestador no ve el atractivo: M06 responde con el texto de sin permiso", async ({ page, request }) => {
    const { listingId } = await attraction(request);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await expect(page.getByTestId("photos-forbidden")).toHaveText(listingTexts.forbidden);
  });

  test("el enlace de M09 lleva a M06 del atractivo recién creado", async ({ page }) => {
    await open(page, as(ADMIN), "/atractivos");
    await page.getByLabel("Nombre").fill("Atractivo Ficticio Enlace");
    await page.getByLabel("Municipio").selectOption(world.municipalityOne);
    await page.getByLabel("Categoría").selectOption(world.categoryOne);
    await page.getByLabel("Descripción").fill("Descripción ficticia.");
    await page.getByLabel("Horarios").fill("Todos los días de 8:00 a 17:00");
    await page.getByLabel("Contacto").fill(CONTACT);
    await page.getByLabel("Enlace de Google Maps").fill(MAPS_URL);
    await page.getByTestId("attraction-save").click();
    await page.getByTestId("attraction-confirm-yes").click();
    await page.getByTestId("attraction-photos-link").click();
    await expect(page.getByTestId("photos-title")).toHaveText(t.title);
    await expect(page.getByTestId("photos-attraction-note")).toBeVisible();
  });
});

test.describe("32 y 33: estados de la ficha y sesión", () => {
  test("32a y 32b: FPubB muestra la nota y M08 las fotos del borrador (incluida la propia), no solo las publicadas", async ({ page, request }) => {
    const { listingId, versionId } = await draft(request);
    await addPhotos(request, A6, listingId, versionId, 2);
    expect((await call(request, A6, "post", `${API}/${listingId}/submission`, { confirmed: true, thirdPartyAuthorizationDeclared: true })).status).toBe(200);
    expect((await call(request, ADMIN, "post", `/api/v1/reviews/${versionId}/approval`, { confirmed: true })).status).toBe(200);
    const saved = await call(request, A6, "put", `${API}/${listingId}/draft`, { content: content(), confirmed: true });
    expect(saved.status).toBe(200);
    await addPhotos(request, A6, listingId, saved.body.working.id, 1);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(3));
    await expect(page.getByTestId("photos-published-note")).toHaveText(t.publishedNote);
    await open(page, as(A6), `/fichas/${listingId}`);
    await expect(page.getByTestId("listing-photos").locator("li")).toHaveCount(3);
    await page.getByTestId("listing-photos-link").click();
    await expect(page.getByTestId("photos-title")).toHaveText(t.title);
  });

  test("32c: una ficha pendiente no ofrece subir ni quitar y muestra el texto de bloqueo", async ({ page, request }) => {
    const { listingId, versionId } = await draft(request);
    await addPhotos(request, A6, listingId, versionId, 2);
    expect((await call(request, A6, "post", `${API}/${listingId}/submission`, { confirmed: true, thirdPartyAuthorizationDeclared: true })).status).toBe(200);
    await open(page, as(A6), `/fichas/${listingId}/fotos`);
    await expect(page.getByTestId("photos-locked")).toHaveText(listingTexts.locked);
    await expect(page.getByTestId("photo-upload")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Quitar foto/ })).toHaveCount(0);
    await expect(page.getByTestId("photos-counter")).toHaveText(t.counter(2));
  });

  test("33: con sesión vencida se muestra solo la pantalla de sesión vencida", async ({ page, request }) => {
    const { listingId } = await draft(request);
    await open(page, signInitData({ userId: A6, authDate: Math.floor(Date.now() / 1000) - 2 * 86400 }), `/fichas/${listingId}/fotos`);
    await expect(page.getByTestId("session-error")).toHaveText(miniappTexts.sessionExpired);
    await expect(page.getByTestId("photos-counter")).toHaveCount(0);
    await expect(page.getByTestId("photo-upload")).toHaveCount(0);
  });
});
