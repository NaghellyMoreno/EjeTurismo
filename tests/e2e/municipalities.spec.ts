import { expect, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createAccount } from "../factories/accounts";
import { grantAdminRole, makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { signInitData } from "../helpers/telegram";
import { miniappTexts, municipalityTexts as t } from "@/miniapp/texts";

// F010, criterios 5, 6, 14, 21, 28, 29 y 30: pantalla M10 con Telegram.WebApp simulado.
const ADMIN = 900000078;
const PROVIDER = 900000079;
const NO_ROLE = 900000070;

let owner: Pool;
test.beforeAll(() => void (owner = ownerPool()));
test.afterAll(() => owner.end());
test.beforeEach(async () => {
  await resetDb(owner);
  await createAccount(owner, ADMIN);
  await grantAdminRole(owner, ADMIN);
});

async function open(page: Page, initData: string, path = "/municipios") {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto(path);
}

// Cuenta las llamadas de escritura a la API de municipios.
function countWrites(page: Page) {
  const calls = { POST: 0, PATCH: 0 };
  page.on("request", (request) => {
    if (!request.url().includes("/api/v1/municipalities")) return;
    if (request.method() === "POST") calls.POST++;
    if (request.method() === "PATCH") calls.PATCH++;
  });
  return calls;
}

const adminData = () => signInitData({ userId: ADMIN });
const fill = async (page: Page, v: { name?: string; department?: string; info?: string; zone?: string }) => {
  if (v.name !== undefined) await page.getByTestId("municipality-name").fill(v.name);
  if (v.department !== undefined) await page.getByTestId("municipality-department").fill(v.department);
  if (v.info !== undefined) await page.getByTestId("municipality-general-info").fill(v.info);
  if (v.zone !== undefined) await page.getByTestId("municipality-zone").fill(v.zone);
};

test("5: formulario de creación con confirmación; Cancelar no llama a la API", async ({ page }) => {
  const calls = countWrites(page);
  await open(page, adminData(), "/");
  await page.getByTestId("municipalities-link").click();
  await expect(page.getByTestId("municipalities-screen")).toBeVisible();
  await expect(page.getByTestId("municipality-list")).toContainText("Manizales");
  await page.getByTestId("municipality-new").click();
  await expect(page.getByTestId("municipality-form")).toContainText(t.createTitle);
  await expect(page.getByTestId("municipality-department")).toHaveValue("Caldas");
  await expect(page.getByLabel(t.nameLabel)).toBeVisible();
  await expect(page.getByLabel(t.departmentLabel)).toBeVisible();
  await expect(page.getByLabel(t.generalInfoLabel)).toBeVisible();
  await expect(page.getByLabel(t.zoneLabel)).toBeVisible();
  await fill(page, { name: "Municipio de Prueba", info: "Texto de prueba" });
  await page.getByTestId("municipality-save").click();
  await expect(page.getByTestId("municipality-confirm")).toHaveText(t.confirmCreate);
  expect(calls.POST).toBe(0);
  await page.getByTestId("municipality-confirm-cancel").click();
  expect(calls.POST).toBe(0);
  expect((await owner.query("select count(*)::int as n from app.municipalities")).rows[0].n).toBe(3);
});

test("6: crear un municipio muestra el mensaje, la lista y persiste tras recargar", async ({ page }) => {
  await open(page, adminData());
  await page.getByTestId("municipality-new").click();
  await fill(page, { name: "Municipio de Prueba", info: "Texto de prueba" });
  await page.getByTestId("municipality-save").click();
  await page.getByTestId("municipality-confirm-accept").click();
  await expect(page.getByTestId("municipality-message")).toHaveText(t.created);
  await expect(page.getByTestId("municipality-list")).toContainText("Municipio de Prueba");
  await page.reload();
  await expect(page.getByTestId("municipality-list")).toContainText("Municipio de Prueba");
});

test("14: un nombre repetido muestra el error y conserva lo escrito", async ({ page }) => {
  await open(page, adminData());
  await page.getByTestId("municipality-new").click();
  await fill(page, { name: "Manizales", department: "Caldas", info: "Texto", zone: "Zona X" });
  await page.getByTestId("municipality-save").click();
  await page.getByTestId("municipality-confirm-accept").click();
  await expect(page.getByTestId("municipality-error")).toHaveText(t.duplicate);
  await expect(page.getByTestId("municipality-name")).toHaveValue("Manizales");
  await expect(page.getByTestId("municipality-department")).toHaveValue("Caldas");
  await expect(page.getByTestId("municipality-general-info")).toHaveValue("Texto");
  await expect(page.getByTestId("municipality-zone")).toHaveValue("Zona X");
  expect((await owner.query("select count(*)::int as n from app.municipalities")).rows[0].n).toBe(3);
});

test("21: editar con confirmación actualiza la lista; Cancelar no llama a PATCH", async ({ page }) => {
  await owner.query("insert into app.municipalities (name, name_normalized, department) values ('Municipio de Prueba', 'municipio de prueba', 'Caldas')");
  const calls = countWrites(page);
  await open(page, adminData());
  await page.getByRole("button", { name: "Municipio de Prueba" }).click();
  await expect(page.getByTestId("municipality-form")).toContainText(t.editTitle);
  await fill(page, { info: "Información nueva", zone: "Zona de prueba" });
  await page.getByTestId("municipality-save").click();
  await expect(page.getByTestId("municipality-confirm")).toHaveText(t.confirmUpdate);
  await page.getByTestId("municipality-confirm-cancel").click();
  expect(calls.PATCH).toBe(0);
  await page.getByTestId("municipality-save").click();
  await page.getByTestId("municipality-confirm-accept").click();
  await expect(page.getByTestId("municipality-message")).toHaveText(t.updated);
  await expect(page.getByTestId("municipality-list")).toContainText("Información nueva");
  await expect(page.getByTestId("municipality-list")).toContainText("Zona de prueba");
  expect(calls.PATCH).toBe(1);
});

test("28: sin rol de administrador no hay enlace y /municipios muestra el aviso", async ({ page }) => {
  await createAccount(owner, NO_ROLE);
  await makeProvider(owner, PROVIDER);
  for (const user of [PROVIDER, NO_ROLE]) {
    const calls = countWrites(page);
    await open(page, signInitData({ userId: user }), "/");
    await expect(page.getByTestId("miniapp-home")).toBeVisible();
    await expect(page.getByTestId("municipalities-link")).toHaveCount(0);
    await page.goto("/municipios");
    await expect(page.getByTestId("municipalities-forbidden")).toHaveText(t.forbidden);
    await expect(page.getByTestId("municipality-list")).toHaveCount(0);
    await expect(page.getByTestId("municipality-form")).toHaveCount(0);
    expect(calls).toEqual({ POST: 0, PATCH: 0 });
  }
  await open(page, adminData(), "/");
  // D-206: tarjeta con los textos del prototipo; conserva el nombre accesible aprobado.
  await expect(page.getByTestId("municipalities-link")).toHaveAccessibleName(miniappTexts.adminMunicipalitiesLink);
  await page.goto("/municipios");
  await expect(page.getByTestId("municipalities-screen")).toBeVisible();
});

test("29: una respuesta 500 en M10 muestra el texto genérico sin detalles técnicos", async ({ page }) => {
  await page.route("**/api/v1/municipalities", (route) =>
    route.request().method() === "GET"
      ? route.continue()
      : route.fulfill({ status: 500, contentType: "application/problem+json", body: JSON.stringify({ type: "about:blank", title: "Error del sistema", status: 500, code: "internal_error", detail: "Ocurrió un error. Intenta de nuevo en unos minutos." }) }),
  );
  await open(page, adminData());
  await page.getByTestId("municipality-new").click();
  await fill(page, { name: "Otro Municipio" });
  await page.getByTestId("municipality-save").click();
  await page.getByTestId("municipality-confirm-accept").click();
  await expect(page.getByTestId("municipality-error")).toHaveText(t.error);
  await expect(page.getByTestId("municipality-error")).not.toContainText(/500|internal_error|exception|sql/i);
});

test.describe("30: sesión no verificable", () => {
  const cases: [string, () => string][] = [
    ["sin initData", () => ""],
    ["firma inválida", () => signInitData({ userId: ADMIN, token: "9:otro" })],
    ["auth_date vencido", () => signInitData({ userId: ADMIN, authDate: Math.floor(Date.now() / 1000) - 3 * 86400 })],
  ];
  for (const [name, initData] of cases) {
    test(name, async ({ page }) => {
      const calls = countWrites(page);
      await open(page, initData());
      await expect(page.getByTestId("session-error")).toHaveText(miniappTexts.sessionExpired);
      await expect(page.getByTestId("municipality-list")).toHaveCount(0);
      expect(calls).toEqual({ POST: 0, PATCH: 0 });
    });
  }
});
