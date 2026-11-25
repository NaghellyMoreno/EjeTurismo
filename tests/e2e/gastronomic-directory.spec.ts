import { expect, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createAccount, createOldVersionAccount, grantAdmin } from "../factories/accounts";
import { makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { CONTACT, MAPS_URL } from "../helpers/listing-data";
import { signInitData } from "../helpers/telegram";
import { toStep } from "./wizard";

// F017, criterios 1, 2 y 13: restaurante, café y Sabores de Caldas en M05, M07, M04 y M08 de la Mini App.
const A6 = 900007031;
const ADMIN = 900007001;

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

async function fillCommon(page: Page, name: string) {
  await toStep(page, 2);
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Municipio", { exact: true }).selectOption(municipalityOne);
  await page.getByLabel("Categoría", { exact: true }).selectOption(categoryOne);
  await page.getByLabel("Descripción", { exact: true }).fill("Descripción ficticia.");
  await page.getByLabel("Horarios", { exact: true }).fill("Todos los días de 8:00 a 17:00");
  await page.getByLabel("Contacto", { exact: true }).fill(CONTACT);
  await page.getByLabel("Enlace de Google Maps", { exact: true }).fill(MAPS_URL);
}

async function saveDraft(page: Page) {
  await page.getByTestId("listing-save").click();
  await page.getByTestId("listing-confirm-yes").click();
  await expect(page.getByTestId("listing-saved")).toHaveText("Borrador guardado.");
}

test("1: crear un restaurante y un café con su tipo; aparecen en M04 como borrador y M08 muestra el tipo", async ({ page }) => {
  for (const [name, type] of [["Restaurante Prueba", "Restaurante"], ["Café Prueba", "Café"]]) {
    await open(page, "/fichas/nueva");
    await toStep(page, 2);
    await expect(page.getByTestId("listing-name")).toBeVisible();
    await toStep(page, 1);
    await page.getByTestId("listing-kind-establishment").click();
    await toStep(page, 2);
    await fillCommon(page, name);
    await page.getByTestId("listing-establishment-type").selectOption({ label: type });
    await saveDraft(page);
    const id = (await owner.query("select l.id from app.listings l join app.listing_versions v on v.listing_id = l.id where v.name = $1", [name])).rows[0].id as string;
    await open(page, "/fichas");
    await expect(page.getByTestId(`listing-row-${id}`)).toContainText(name);
    await expect(page.getByTestId(`listing-status-${id}`)).toHaveText("Borrador");
    await open(page, `/fichas/${id}`);
    await expect(page.getByTestId("listing-establishment-type")).toHaveText(type);
  }
});

test("2: el envío pide la declaración; sin marcarla no se envía y con ella la ficha queda pendiente", async ({ page }) => {
  let submissions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/submission")) submissions++;
  });
  await open(page, "/fichas/nueva");
  await toStep(page, 2);
  await expect(page.getByTestId("listing-name")).toBeVisible();
  await toStep(page, 1);
  await page.getByTestId("listing-kind-establishment").click();
  await toStep(page, 2);
  await fillCommon(page, "Restaurante Prueba");
  await page.getByTestId("listing-establishment-type").selectOption({ label: "Restaurante" });
  await toStep(page, 5);
  await page.getByTestId("listing-submit").click();
  await page.getByTestId("listing-submit-yes").click();
  await expect(page.getByTestId("listing-error-thirdPartyAuthorizationDeclared")).toBeVisible();
  expect(submissions).toBe(0);
  // D-206: el borrador se guarda en el paso 3, antes de las fotos; sin la declaración no pasa a revisión.
  expect((await owner.query("select status from app.listing_versions")).rows).toEqual([{ status: "draft" }]);

  await page.getByTestId("listing-declaration").check();
  await page.getByTestId("listing-submit-yes").click();
  await expect(page.getByTestId("listing-submitted")).toBeVisible();
  expect(submissions).toBe(1);
  const id = (await owner.query("select id from app.listings")).rows[0].id as string;
  expect((await owner.query("select status from app.listing_versions")).rows).toEqual([{ status: "pending" }]);
  await open(page, "/fichas");
  await expect(page.getByTestId(`listing-status-${id}`)).toHaveText("Pendiente de revisión");
});

test("13: la experiencia Sabores de Caldas se elige, se guarda, M08 muestra el tipo y el envío la deja pendiente", async ({ page }) => {
  await open(page, "/fichas/nueva");
  await toStep(page, 2);
  await expect(page.getByTestId("listing-name")).toBeVisible();
  await toStep(page, 1);
  await page.getByTestId("listing-kind-route_experience").click();
  await toStep(page, 2);
  await fillCommon(page, "Sabores de prueba");
  const options = await page.getByTestId("listing-experience-type").locator("option").allTextContents();
  expect(options).toContain("Sabores de Caldas");
  await page.getByLabel("Tipo de experiencia", { exact: true }).selectOption({ label: "Sabores de Caldas" });
  await saveDraft(page);
  const id = (await owner.query("select id from app.listings where kind = 'route_experience'")).rows[0].id as string;
  await open(page, `/fichas/${id}`);
  await expect(page.getByTestId("listing-experience-type")).toHaveText("Sabores de Caldas");

  await open(page, `/fichas/${id}/editar`);
  await toStep(page, 5);
  await page.getByTestId("listing-submit").click();
  await page.getByTestId("listing-declaration").check();
  await page.getByTestId("listing-submit-yes").click();
  await expect(page.getByTestId("listing-submitted")).toBeVisible();
  expect((await owner.query("select status from app.listing_versions")).rows).toEqual([{ status: "pending" }]);
});
