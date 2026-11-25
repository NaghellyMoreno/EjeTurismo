import { expect, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createAccount, createOldVersionAccount, grantAdmin } from "../factories/accounts";
import { makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { CONTACT, MAPS_URL } from "../helpers/listing-data";
import { signInitData, tma } from "../helpers/telegram";
import { toStep } from "./wizard";

// F018, criterios 9, 10, 12, 31 y 32: la ruta o experiencia en M05, M07, M04 y M08 de la Mini App.
const A6 = 900007031;
const ADMIN = 900007001;
const API = "/api/v1/managed-listings";
const GUIDE = "Guía ficticia: Ana Prueba, 3000000000";
const ROUTE = "Ruta del café ficticia";

let owner: Pool;
let municipalityOne: string;
let categoryOne: string;
test.beforeAll(async ({ request }) => {
  owner = ownerPool();
  for (const path of ["/", "/fichas", "/fichas/nueva", "/api/v1/me", "/api/v1/municipalities"]) await request.get(path, { timeout: 60_000 });
});
test.afterAll(() => owner.end());
test.beforeEach(async () => {
  await resetDb(owner);
  await createAccount(owner, ADMIN, "Administrador Ficticio");
  await grantAdmin(owner, ADMIN);
  await createOldVersionAccount(owner, 900007013);
  await makeProvider(owner, A6, "9000070310");
  const one = async (sql: string) => (await owner.query(sql)).rows[0].id as string;
  municipalityOne = await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Uno', 'municipio ficticio uno', 'Caldas') returning id");
  categoryOne = await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Uno', 'categoria ficticia uno') returning id");
});

async function open(page: Page, path: string) {
  const initData = signInitData({ userId: A6 });
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto(path);
}

async function fillRoute(page: Page, withType = true) {
  await toStep(page, 1);
  await page.getByTestId("listing-kind-route_experience").click();
  await toStep(page, 2);
  await toStep(page, 2);
  await page.getByLabel("Nombre", { exact: true }).fill(ROUTE);
  await page.getByLabel("Municipio", { exact: true }).selectOption(municipalityOne);
  await page.getByLabel("Categoría", { exact: true }).selectOption(categoryOne);
  if (withType) await page.getByLabel("Tipo de experiencia", { exact: true }).selectOption({ label: "Sabores de Caldas" });
  await page.getByLabel("Descripción", { exact: true }).fill("Descripción ficticia.");
  await page.getByLabel("Horarios", { exact: true }).fill("Sábados de 8:00 a 12:00");
  await page.getByLabel("Contacto", { exact: true }).fill(CONTACT);
  await page.getByLabel("Enlace de Google Maps", { exact: true }).fill(MAPS_URL);
  await page.getByLabel("Datos del guía (opcional)", { exact: true }).fill(GUIDE);
}

test("9: crear una ruta con tipo y guía; aparece en M04 como borrador y M08 muestra tipo y guía", async ({ page }) => {
  await open(page, "/fichas/nueva");
  await toStep(page, 2);
  await expect(page.getByTestId("listing-name")).toBeVisible();
  await fillRoute(page);
  await expect(page.getByTestId("listing-title")).toHaveText("Nueva ficha de ruta o experiencia");
  const options = await page.getByTestId("listing-experience-type").locator("option").allTextContents();
  expect(options[0]).toBe("Elige un tipo de experiencia");
  expect(options).toContain("Sabores de Caldas");
  await page.getByTestId("listing-save").click();
  await page.getByTestId("listing-confirm-yes").click();
  await expect(page.getByTestId("listing-saved")).toHaveText("Borrador guardado.");
  const id = (await owner.query("select id from app.listings where kind = 'route_experience'")).rows[0].id as string;

  await open(page, "/fichas");
  await expect(page.getByTestId(`listing-row-${id}`)).toContainText(ROUTE);
  await expect(page.getByTestId(`listing-status-${id}`)).toHaveText("Borrador");
  await open(page, `/fichas/${id}`);
  await expect(page.getByTestId("listing-experience-type")).toHaveText("Sabores de Caldas");
  await expect(page.getByTestId("listing-guides-info")).toHaveText(GUIDE);
});

test("10: enviar desde el formulario con la declaración deja la ficha pendiente; sin declaración no se envía", async ({ page }) => {
  let submissions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/submission")) submissions++;
  });
  await open(page, "/fichas/nueva");
  await toStep(page, 2);
  await expect(page.getByTestId("listing-name")).toBeVisible();
  await fillRoute(page);
  await toStep(page, 5);
  await page.getByTestId("listing-submit").click();
  await page.getByTestId("listing-submit-yes").click();
  await expect(page.getByTestId("listing-error-thirdPartyAuthorizationDeclared")).toHaveText("Debes declarar que tienes la autorización de los guías y contactos.");
  expect(submissions).toBe(0);
  // D-206: el borrador se guarda en el paso 3, antes de las fotos; sin la declaración no pasa a revisión.
  expect((await owner.query("select status from app.listing_versions")).rows).toEqual([{ status: "draft" }]);

  await page.getByTestId("listing-declaration").check();
  await page.getByTestId("listing-submit-yes").click();
  await expect(page.getByTestId("listing-submitted")).toHaveText("Ficha enviada a revisión. El administrador la revisará.");
  expect(submissions).toBe(1);
  const id = (await owner.query("select id from app.listings where kind = 'route_experience'")).rows[0].id as string;
  expect((await owner.query("select status from app.listing_versions")).rows).toEqual([{ status: "pending" }]);
  await open(page, `/fichas/${id}`);
  await expect(page.getByTestId("listing-status")).toHaveText("Pendiente de revisión");
});

test("12: enviar una ruta sin tipo muestra el error junto al selector y la ficha sigue en borrador", async ({ page }) => {
  await open(page, "/fichas/nueva");
  await toStep(page, 2);
  await expect(page.getByTestId("listing-name")).toBeVisible();
  await fillRoute(page, false);
  await toStep(page, 5);
  await page.getByTestId("listing-submit").click();
  const error = page.getByTestId("listing-error-experienceTypeId");
  await expect(error).toHaveText("Elige un tipo de experiencia.");
  await expect(error).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("listing-experience-type")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("listing-submit-dialog")).toHaveCount(0);

  // La ficha se guarda como borrador (el tipo no es obligatorio en el borrador) y sigue en borrador en M04.
  await page.getByTestId("listing-save").click();
  await page.getByTestId("listing-confirm-yes").click();
  await expect(page.getByTestId("listing-saved")).toBeVisible();
  await open(page, "/fichas");
  await expect(page.locator("[data-testid^='listing-status-']")).toHaveText("Borrador");
});

test("31: la elección de clase aparece solo al crear y el tipo y la guía solo con la ruta; al editar la clase queda fija", async ({ page, request }) => {
  await open(page, "/fichas/nueva");
  await expect(page.getByTestId("listing-kind-establishment")).toBeVisible();
  await expect(page.getByTestId("listing-kind-route_experience")).toBeVisible();
  await expect(page.getByTestId("listing-experience-type")).toHaveCount(0);
  await expect(page.getByTestId("listing-guides-info")).toHaveCount(0);
  await toStep(page, 1);
  await page.getByTestId("listing-kind-route_experience").click();
  await toStep(page, 2);
  await expect(page.getByTestId("listing-experience-type")).toBeVisible();
  await expect(page.getByTestId("listing-guides-info")).toBeVisible();
  await toStep(page, 1);
  await page.getByTestId("listing-kind-establishment").click();
  await toStep(page, 2);
  await expect(page.getByTestId("listing-experience-type")).toHaveCount(0);
  await expect(page.getByTestId("listing-guides-info")).toHaveCount(0);

  const typeId = (await owner.query("select id from app.experience_types where name = 'Sabores de Caldas'")).rows[0].id as string;
  const created = await request.post(API, {
    headers: tma(signInitData({ userId: A6 })),
    data: { kind: "route_experience", content: { name: ROUTE, municipalityId: municipalityOne, experienceTypeId: typeId, guidesInfo: GUIDE }, confirmed: true },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as string;
  await open(page, `/fichas/${id}/editar`);
  await expect(page.getByTestId("listing-name")).toHaveValue(ROUTE);
  await expect(page.getByTestId("listing-kind-establishment")).toHaveCount(0);
  await expect(page.getByTestId("listing-kind-route_experience")).toHaveCount(0);
  await expect(page.getByTestId("listing-experience-type")).toHaveValue(typeId);
  await expect(page.getByTestId("listing-guides-info")).toHaveValue(GUIDE);
});

test("32: el selector y el campo de guías tienen etiqueta asociada y el error del selector está enlazado con aria-describedby", async ({ page }) => {
  await open(page, "/fichas/nueva");
  await toStep(page, 2);
  await expect(page.getByTestId("listing-name")).toBeVisible();
  await toStep(page, 1);
  await page.getByTestId("listing-kind-route_experience").click();
  await toStep(page, 2);
  await expect(page.getByLabel("Tipo de experiencia", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Datos del guía (opcional)", { exact: true })).toBeVisible();
  for (const testId of ["listing-experience-type", "listing-guides-info"]) {
    const labelText = await page.getByTestId(testId).evaluate((el) => (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent ?? "" : ""));
    expect(labelText.trim().length, testId).toBeGreaterThan(0);
  }
  // D-206: para llegar a «Revisar» el borrador se guarda, y eso pide nombre y municipio.
  await page.getByLabel("Nombre", { exact: true }).fill(ROUTE);
  await page.getByLabel("Municipio", { exact: true }).selectOption(municipalityOne);
  await toStep(page, 5);
  await page.getByTestId("listing-submit").click();
  const error = page.getByTestId("listing-error-experienceTypeId");
  await expect(error).toBeVisible();
  const select = page.getByTestId("listing-experience-type");
  const describedBy = await select.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  expect(describedBy!.split(" ")).toContain(await error.getAttribute("id"));
});
