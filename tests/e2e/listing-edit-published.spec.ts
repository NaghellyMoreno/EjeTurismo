import { expect, type APIRequestContext, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createAccount, grantAdmin } from "../factories/accounts";
import { makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { CONTACT, ESTABLISHMENT_ONE, MAPS_URL } from "../helpers/listing-data";
import { signInitData, tma } from "../helpers/telegram";

// F015, criterios 5, 9b, 10b y 13a (Mini App): editar una ficha publicada sin ocultarla.
const A6 = 900007031;
const P2P = 900013001;
const ADMIN = 900007001;
const API = "/api/v1";
const OLD = "Lunes a viernes de 8:00 a 17:00";
const NEW = "Todos los días de 7:00 a 19:00";
const REASON = "Falta el horario del domingo.";
const STILL_VISIBLE = "Los visitantes siguen viendo la versión publicada hasta que el administrador apruebe tu cambio.";
const REJECTED_EDIT_NOTE = "El administrador rechazó tu último cambio. Se conserva la versión publicada. Corrígelo y envíalo de nuevo.";

let owner: Pool;
let world: { municipalityOne: string; categoryOne: string; typeOne: string };
test.beforeAll(async ({ request }) => {
  owner = ownerPool();
  for (const path of ["/", "/fichas", "/api/v1/me"]) await request.get(path, { timeout: 60_000 });
});
test.afterAll(() => owner.end());
test.beforeEach(async () => {
  await resetDb(owner);
  await createAccount(owner, ADMIN, "Administrador Ficticio");
  await grantAdmin(owner, ADMIN);
  await makeProvider(owner, A6, "9000070310");
  await makeProvider(owner, P2P, "9000130010");
  const one = async (sql: string) => (await owner.query(sql)).rows[0].id as string;
  world = {
    municipalityOne: await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Uno', 'municipio ficticio uno', 'Caldas') returning id"),
    categoryOne: await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Uno', 'categoria ficticia uno') returning id"),
    typeOne: await one("insert into app.establishment_types (name, name_normalized) values ('Establecimiento Ficticio', 'establecimiento ficticio') returning id"),
  };
});

const as = (userId: number) => signInitData({ userId });
async function open(page: Page, initData: string, path = "/fichas") {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto(path);
}
const content = (extra: Record<string, unknown> = {}) => ({
  name: ESTABLISHMENT_ONE, municipalityId: world.municipalityOne, categoryId: world.categoryOne, establishmentTypeId: world.typeOne,
  description: "Descripción ficticia.", schedule: OLD, contact: CONTACT, mapsUrl: MAPS_URL, ...extra,
});
const decide = async (request: APIRequestContext, kind: "approval" | "rejection", versionId: string, data: Record<string, unknown>) =>
  expect((await request.post(`${API}/reviews/${versionId}/${kind}`, { headers: tma(as(ADMIN)), data })).status()).toBe(200);
async function published(request: APIRequestContext) {
  const created = await request.post(`${API}/managed-listings`, { headers: tma(as(A6)), data: { kind: "establishment", content: content(), confirmed: true } });
  const listingId = (await created.json()).id as string;
  const sent = await request.post(`${API}/managed-listings/${listingId}/submission`, { headers: tma(as(A6)), data: { confirmed: true, thirdPartyAuthorizationDeclared: true } });
  await decide(request, "approval", (await sent.json()).working.id, { confirmed: true });
  return listingId;
}
async function editAndSubmit(request: APIRequestContext, listingId: string) {
  const saved = await request.put(`${API}/managed-listings/${listingId}/draft`, { headers: tma(as(A6)), data: { content: content({ schedule: NEW }), confirmed: true } });
  expect(saved.status()).toBe(200);
  const sent = await request.post(`${API}/managed-listings/${listingId}/submission`, { headers: tma(as(A6)), data: { confirmed: true, thirdPartyAuthorizationDeclared: true } });
  expect(sent.status()).toBe(200);
  return (await sent.json()).working.id as string;
}

test.describe("criterio 5: editar el horario desde la Mini App", () => {
  test("M08 ofrece «Editar ficha», M05 se abre precargada, M07 se puede cancelar y al confirmar la ficha queda pendiente con la publicada visible", async ({ page, request }) => {
    const id = await published(request);
    await open(page, as(A6), `/fichas/${id}`);
    await expect(page.getByTestId("listing-status")).toHaveText("Publicada");
    await expect(page.getByTestId("listing-edit-published")).toHaveText("Editar ficha");
    await expect(page.getByTestId("listing-correct")).toHaveCount(0);
    await page.getByTestId("listing-edit-published").click();
    await expect(page.getByLabel("Horarios", { exact: true })).toHaveValue(OLD);
    await expect(page.getByTestId("listing-locked")).toHaveCount(0);

    await page.getByLabel("Horarios", { exact: true }).fill(NEW);
    await page.getByTestId("listing-save").click();
    await page.getByTestId("listing-confirm-yes").click();
    await expect(page.getByTestId("listing-saved")).toBeVisible();
    await page.getByTestId("listing-submit").click();
    await expect(page.getByTestId("listing-declaration")).toBeVisible();
    await page.getByTestId("listing-submit-no").click();
    await expect(page.getByTestId("listing-submit-dialog")).toHaveCount(0);
    await open(page, as(A6), `/fichas/${id}`);
    await expect(page.getByTestId("listing-pending-note")).toHaveCount(0);

    await open(page, as(A6), `/fichas/${id}/editar`);
    await page.getByTestId("listing-submit").click();
    await page.getByTestId("listing-declaration").check();
    await page.getByTestId("listing-submit-yes").click();
    await expect(page.getByTestId("listing-submitted")).toBeVisible();

    await open(page, as(A6), `/fichas/${id}`);
    await expect(page.getByTestId("listing-status")).toHaveText("Pendiente de revisión");
    await expect(page.getByTestId("listing-pending-note")).toBeVisible();
    await expect(page.getByTestId("listing-still-visible")).toHaveText(STILL_VISIBLE);
    await expect(page.getByTestId("listing-published").getByTestId("listing-published-schedule")).toHaveText(OLD);
    await expect(page.getByTestId("listing-working").getByTestId("listing-schedule")).toHaveText(NEW);
    await expect(page.getByTestId("listing-edit-published")).toHaveCount(0);
    await expect(page.getByTestId("listing-edit")).toHaveCount(0);
    await open(page, as(A6), `/fichas/${id}/editar`);
    await expect(page.getByTestId("listing-locked")).toBeVisible();
    await open(page, as(A6));
    await expect(page.getByTestId(`listing-status-${id}`)).toHaveText("Pendiente de revisión");
  });
});

test.describe("criterios 9b y 10b: edición rechazada", () => {
  test("M08 muestra el motivo, la nota, la publicada y «Corregir y reenviar»; P2p no ve nada; corregir reenvía desde el contenido rechazado", async ({ page, request }) => {
    const id = await published(request);
    const v2 = await editAndSubmit(request, id);
    await decide(request, "rejection", v2, { confirmed: true, reason: REASON });

    await open(page, as(A6), `/fichas/${id}`);
    await expect(page.getByTestId("listing-status")).toHaveText("Publicada");
    await expect(page.getByTestId("listing-rejection-reason")).toHaveText(REASON);
    await expect(page.getByTestId("listing-still-visible")).toHaveText(STILL_VISIBLE);
    await expect(page.getByTestId("listing-rejected-edit-note")).toHaveText(REJECTED_EDIT_NOTE);
    await expect(page.getByTestId("listing-published").getByTestId("listing-published-schedule")).toHaveText(OLD);
    await expect(page.getByTestId("listing-correct")).toHaveText("Corregir y reenviar");

    await open(page, as(P2P), `/fichas/${id}`);
    await expect(page.getByTestId("listing-forbidden")).toBeVisible();
    const other = await page.content();
    expect(other).not.toContain(REASON);
    expect(other).not.toContain(ESTABLISHMENT_ONE);

    await open(page, as(A6), `/fichas/${id}`);
    await page.getByTestId("listing-correct").click();
    await expect(page.getByLabel("Horarios", { exact: true })).toHaveValue(NEW); // parte del contenido rechazado (P2)
    await page.getByLabel("Horarios", { exact: true }).fill("Todos los días de 8:00 a 20:00");
    await page.getByTestId("listing-save").click();
    await page.getByTestId("listing-confirm-yes").click();
    await expect(page.getByTestId("listing-saved")).toBeVisible();
    await page.getByTestId("listing-submit").click();
    await page.getByTestId("listing-declaration").check();
    await page.getByTestId("listing-submit-yes").click();
    await expect(page.getByTestId("listing-submitted")).toBeVisible();
    const versions = await owner.query("select version_number, status from app.listing_versions where listing_id = $1 order by version_number", [id]);
    expect(versions.rows).toEqual([{ version_number: 1, status: "published" }, { version_number: 2, status: "rejected" }, { version_number: 3, status: "pending" }]);
  });
});

test.describe("criterio 13a: sin despublicar, eliminar ni retirar", () => {
  test("M04 y M08 en cada estado de la ficha no tienen esos controles ni esos textos", async ({ page, request }) => {
    const id = await published(request);
    const check = async (label: string) => {
      for (const path of ["/fichas", `/fichas/${id}`]) {
        await open(page, as(A6), path);
        await page.waitForLoadState("networkidle");
        await expect(page.getByTestId("listing-back").or(page.getByTestId(`listing-open-${id}`)).first()).toBeVisible();
        const html = await page.content();
        expect(html, `${label} ${path}`).not.toMatch(/data-testid="listing-(unpublish|delete|withdraw)/);
        expect(await page.locator("body").innerText(), `${label} ${path}`).not.toMatch(/despublicar|eliminar|retirar|borrar ficha/i);
      }
    };
    await check("publicada");
    await request.put(`${API}/managed-listings/${id}/draft`, { headers: tma(as(A6)), data: { content: content({ schedule: NEW }), confirmed: true } });
    await check("borrador");
    const sent = await request.post(`${API}/managed-listings/${id}/submission`, { headers: tma(as(A6)), data: { confirmed: true, thirdPartyAuthorizationDeclared: true } });
    await check("pendiente");
    await decide(request, "rejection", (await sent.json()).working.id, { confirmed: true, reason: REASON });
    await check("edición rechazada");
  });
});
