import { expect, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createAccount } from "../factories/accounts";
import { makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { CONTACT, ESTABLISHMENT_ONE, MAPS_URL } from "../helpers/listing-data";
import { signInitData, tma } from "../helpers/telegram";
import { toStep } from "./wizard";

// F021, criterio 3: el rechazo del enlace de Google Maps se ve junto al campo, en M05 (crear y editar).
const A6 = 900007031;
const BAD = "https://ejemplo.invalid/mapa";
const REJECTION = "Escribe un enlace de Google Maps (por ejemplo, maps.app.goo.gl o google.com/maps).";

let owner: Pool;
let world: { municipalityOne: string; categoryOne: string; typeOne: string };
test.beforeAll(async ({ request }) => {
  owner = ownerPool();
  for (const path of ["/fichas/nueva", "/api/v1/me"]) await request.get(path, { timeout: 60_000 });
});
test.afterAll(() => owner.end());
test.beforeEach(async () => {
  await resetDb(owner);
  await createAccount(owner, 900007001, "Administrador Ficticio");
  await makeProvider(owner, A6, "9000070310");
  const one = async (sql: string) => (await owner.query(sql)).rows[0].id as string;
  world = {
    municipalityOne: await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Uno', 'municipio ficticio uno', 'Caldas') returning id"),
    categoryOne: await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Uno', 'categoria ficticia uno') returning id"),
    typeOne: await one("insert into app.establishment_types (name, name_normalized) values ('Establecimiento Ficticio', 'establecimiento ficticio') returning id"),
  };
});

const count = async () => Number((await owner.query("select count(*) from app.listing_versions")).rows[0].count);
async function open(page: Page, path: string) {
  const initData = signInitData({ userId: A6 });
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto(path);
}
async function fillAll(page: Page) {
  await toStep(page, 2);
  await page.getByLabel("Nombre", { exact: true }).fill(ESTABLISHMENT_ONE);
  await page.getByLabel("Municipio", { exact: true }).selectOption(world.municipalityOne);
  await page.getByLabel("Categoría", { exact: true }).selectOption(world.categoryOne);
  await page.getByLabel("Tipo de establecimiento (opcional)", { exact: true }).selectOption(world.typeOne);
  await page.getByLabel("Descripción", { exact: true }).fill("Descripción ficticia.");
  await page.getByLabel("Horarios", { exact: true }).fill("Todos los días de 8:00 a 17:00");
  await page.getByLabel("Contacto", { exact: true }).fill(CONTACT);
  await page.getByLabel("Enlace de Google Maps", { exact: true }).fill(BAD);
}
async function saveAndExpectRejection(page: Page) {
  await page.getByTestId("listing-save").click();
  await page.getByTestId("listing-confirm-yes").click();
  const error = page.getByTestId("listing-error-mapsUrl");
  await expect(error).toHaveText(REJECTION);
  await expect(error).toHaveAttribute("role", "alert");
  await expect(page.getByLabel("Enlace de Google Maps", { exact: true })).toHaveValue(BAD);
}

test("crear: el enlace que no es de Google Maps se rechaza junto al campo y no crea la ficha", async ({ page }) => {
  await open(page, "/fichas/nueva");
  await toStep(page, 2);
  await expect(page.getByTestId("listing-name")).toBeVisible();
  await fillAll(page);
  await saveAndExpectRejection(page);
  expect(await count()).toBe(0);
});

test("editar: el mismo rechazo en /fichas/[id]/editar y la ficha conserva su enlace", async ({ page, request }) => {
  const res = await request.post("/api/v1/managed-listings", {
    headers: tma(signInitData({ userId: A6 })),
    data: {
      kind: "establishment", confirmed: true,
      content: { name: ESTABLISHMENT_ONE, municipalityId: world.municipalityOne, categoryId: world.categoryOne, establishmentTypeId: world.typeOne, description: "Descripción ficticia.", schedule: "Todos los días de 8:00 a 17:00", contact: CONTACT, mapsUrl: MAPS_URL },
    },
  });
  expect(res.status()).toBe(201);
  const id = (await res.json()).id as string;
  await open(page, `/fichas/${id}/editar`);
  await expect(page.getByTestId("listing-name")).toHaveValue(ESTABLISHMENT_ONE);
  await page.getByLabel("Enlace de Google Maps", { exact: true }).fill(BAD);
  await saveAndExpectRejection(page);
  expect((await owner.query("select maps_url from app.listing_versions")).rows).toEqual([{ maps_url: MAPS_URL }]);
  expect(await count()).toBe(1);
});
