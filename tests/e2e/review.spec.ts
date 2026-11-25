import { expect, type APIRequestContext, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createAccount, grantAdmin } from "../factories/accounts";
import { makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { CONTACT, ESTABLISHMENT_ONE, MAPS_URL } from "../helpers/listing-data";
import { signInitData, tma } from "../helpers/telegram";
import { toStep } from "./wizard";

// F014, criterios 10, 11 y 25 (Mini App): M04, M05 y M08 con una ficha rechazada, pendiente y publicada.
const A6 = 900007031;
const P2P = 900013001;
const ADMIN = 900007001;
const API = "/api/v1";
const REASON = "Falta el horario real.";

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
  description: "Descripción ficticia.", schedule: "Todos los días de 8:00 a 17:00", contact: CONTACT, mapsUrl: MAPS_URL, ...extra,
});
async function pending(request: APIRequestContext) {
  const created = await request.post(`${API}/managed-listings`, { headers: tma(as(A6)), data: { kind: "establishment", content: content(), confirmed: true } });
  const listingId = (await created.json()).id as string;
  const sent = await request.post(`${API}/managed-listings/${listingId}/submission`, { headers: tma(as(A6)), data: { confirmed: true, thirdPartyAuthorizationDeclared: true } });
  expect(sent.status(), await sent.text()).toBe(200);
  return { listingId, versionId: (await sent.json()).working.id as string };
}
const decide = async (request: APIRequestContext, kind: "approval" | "rejection", versionId: string, data: Record<string, unknown>) =>
  expect((await request.post(`${API}/reviews/${versionId}/${kind}`, { headers: tma(as(ADMIN)), data })).status()).toBe(200);

test.describe("criterios 10 y 25: ficha rechazada", () => {
  test("A6 ve en M04 y M08 el estado y el motivo con el botón para corregir; P2p no ve nada de ella", async ({ page, request }) => {
    const fp = await pending(request);
    await decide(request, "rejection", fp.versionId, { confirmed: true, reason: REASON });

    await open(page, as(A6));
    await expect(page.getByTestId(`listing-status-${fp.listingId}`)).toHaveText("Rechazada");
    await page.getByTestId(`listing-open-${fp.listingId}`).click();
    await expect(page.getByTestId("listing-status")).toHaveText("Rechazada");
    await expect(page.getByTestId("listing-rejection-reason")).toHaveText(REASON);
    await expect(page.getByTestId("listing-rejected-note")).toHaveText("El administrador rechazó esta ficha. Corrige lo señalado y envíala de nuevo.");
    await expect(page.getByTestId("listing-correct")).toHaveText("Corregir y reenviar");
    await expect(page.getByTestId("listing-edit")).toHaveCount(0);
    await expect(page.getByTestId("listing-pending-note")).toHaveCount(0);

    // Un prestador distinto: M04 sin la ficha ni el estado, y M08 de la ficha ajena con el estado de permiso.
    await open(page, as(P2P));
    await expect(page.getByTestId("listing-empty")).toBeVisible();
    const m04 = await page.content();
    expect(m04).not.toContain(ESTABLISHMENT_ONE);
    expect(m04).not.toContain("Rechazada");
    await open(page, as(P2P), `/fichas/${fp.listingId}`);
    await expect(page.getByTestId("listing-forbidden")).toHaveText("No tienes permiso para gestionar fichas.");
    const m08 = await page.content();
    expect(m08).not.toContain(REASON);
    expect(m08).not.toContain(ESTABLISHMENT_ONE);
  });

  test("con una versión de trabajo en borrador, M08 muestra el motivo anterior y «Editar borrador», no «Corregir y reenviar»", async ({ page, request }) => {
    const fp = await pending(request);
    await decide(request, "rejection", fp.versionId, { confirmed: true, reason: REASON });
    const saved = await request.put(`${API}/managed-listings/${fp.listingId}/draft`, { headers: tma(as(A6)), data: { content: content({ schedule: "Lunes a viernes" }), confirmed: true } });
    expect(saved.status()).toBe(200);
    await open(page, as(A6), `/fichas/${fp.listingId}`);
    await expect(page.getByTestId("listing-status")).toHaveText("Borrador");
    await expect(page.getByTestId("listing-rejection-reason")).toHaveText(REASON);
    await expect(page.getByTestId("listing-edit")).toHaveText("Editar borrador");
    await expect(page.getByTestId("listing-correct")).toHaveCount(0);
  });
});

test.describe("criterio 11: corregir y reenviar", () => {
  test("A6 corrige, guarda y envía con el diálogo M07; la ficha vuelve a pendiente y queda bloqueada", async ({ page, request }) => {
    const fp = await pending(request);
    await decide(request, "rejection", fp.versionId, { confirmed: true, reason: REASON });
    await open(page, as(A6), `/fichas/${fp.listingId}`);
    await page.getByTestId("listing-correct").click();
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(ESTABLISHMENT_ONE);
    await page.getByLabel("Horarios", { exact: true }).fill("Lunes a sábado de 9:00 a 18:00");
    await toStep(page, 5);
    await page.getByTestId("listing-submit").click();
    await page.getByTestId("listing-declaration").check();
    await page.getByTestId("listing-submit-yes").click();
    await expect(page.getByTestId("listing-submitted")).toBeVisible();

    await open(page, as(A6), `/fichas/${fp.listingId}`);
    await expect(page.getByTestId("listing-status")).toHaveText("Pendiente de revisión");
    await expect(page.getByTestId("listing-pending-note")).toHaveText("Tu ficha está pendiente de revisión.");
    await expect(page.getByTestId("listing-schedule")).toHaveText("Lunes a sábado de 9:00 a 18:00");
    await expect(page.getByTestId("listing-edit")).toHaveCount(0);
    await expect(page.getByTestId("listing-correct")).toHaveCount(0);
    await expect(page.getByTestId("listing-rejection-reason")).toHaveCount(0);
    await open(page, as(A6), `/fichas/${fp.listingId}/editar`);
    await expect(page.getByTestId("listing-locked")).toBeVisible();

    const versions = await owner.query("select version_number, status from app.listing_versions where listing_id = $1 order by version_number", [fp.listingId]);
    expect(versions.rows).toEqual([{ version_number: 1, status: "rejected" }, { version_number: 2, status: "pending" }]);
  });
});

test.describe("criterio 25: ficha publicada y ausencia de acciones de revisión", () => {
  test("M04 y M08 de una publicada muestran «Publicada» y su versión, sin botones de editar ni corregir", async ({ page, request }) => {
    const fp = await pending(request);
    await decide(request, "approval", fp.versionId, { confirmed: true });
    await open(page, as(A6));
    await expect(page.getByTestId(`listing-status-${fp.listingId}`)).toHaveText("Publicada");
    await page.getByTestId(`listing-open-${fp.listingId}`).click();
    await expect(page.getByTestId("listing-status")).toHaveText("Publicada");
    await expect(page.getByTestId("listing-published")).toBeVisible();
    await expect(page.getByTestId("listing-name")).toHaveText(ESTABLISHMENT_ONE);
    await expect(page.getByTestId("listing-edit")).toHaveCount(0);
    await expect(page.getByTestId("listing-correct")).toHaveCount(0);
    await expect(page.getByTestId("listing-pending-note")).toHaveCount(0);
  });

  test("la Mini App no ofrece aprobar ni rechazar, ni al prestador ni al administrador", async ({ page, request }) => {
    const fp = await pending(request);
    for (const user of [A6, ADMIN]) {
      for (const path of ["/", "/fichas", `/fichas/${fp.listingId}`]) {
        await open(page, as(user), path);
        await expect(page.locator("body")).toBeVisible();
        await page.waitForLoadState("networkidle");
        const text = await page.locator("body").innerText();
        expect(text, `${user} ${path}`).not.toMatch(/\b(Aprobar|Rechazar|Sí, aprobar|Sí, rechazar)\b/);
      }
    }
  });

  test("con sesión vencida M08 muestra M12", async ({ page, request }) => {
    const fp = await pending(request);
    await open(page, signInitData({ userId: A6, token: "9:otro" }), `/fichas/${fp.listingId}`);
    await expect(page.getByTestId("session-error")).toBeVisible();
  });
});
