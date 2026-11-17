import { expect, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { es } from "@/bot/texts/es";
import { makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { signInitData } from "../helpers/telegram";

// Cuenta ficticia propia del e2e (no se importa el helper de integración: arrastra next/server).
const PROVIDER_E2E = 900008011;

// F008, criterios 18 a 20: la Mini App no ofrece opciones de administrador al prestador y no pide datos de administración.
let owner: Pool;
test.beforeAll(async ({ request }) => {
  owner = ownerPool();
  // `next dev` compila cada ruta en su primera visita; se calientan antes.
  for (const path of ["/", "/municipios", "/catalogos", "/api/v1/me"]) await request.get(path, { timeout: 60_000 });
});
test.afterAll(() => owner.end());
test.beforeEach(async () => {
  await resetDb(owner);
  await makeProvider(owner, PROVIDER_E2E);
});

// Abre la ruta y devuelve las peticiones a la API hechas desde la página.
async function open(page: Page, path: string) {
  const requests: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/api/")) requests.push(`${r.method()} ${url.pathname}`);
  });
  const initData = signInitData({ userId: PROVIDER_E2E });
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto(path);
  return requests;
}

const absent = async (page: Page, ids: string[]) => {
  for (const id of ids) await expect(page.getByTestId(id), id).toHaveCount(0);
};

test("18: en / el prestador ve solo role-provider, sin enlaces ni botones", async ({ page }) => {
  await open(page, "/");
  const home = page.getByTestId("miniapp-home");
  await expect(page.getByTestId("role-provider")).toHaveText("Ya tienes el rol de prestador. Las opciones de prestador estarán disponibles pronto.");
  await expect(home.getByRole("link")).toHaveCount(0);
  // F036 (criterio 40): M02 trae el botón de revocar; no hay otro botón.
  await expect(home.getByRole("button")).toHaveText([es.selfRevoke.button]);
  await absent(page, ["role-admin", "municipalities-link", "catalog-link", "register-hint", "registration-pending", "role-revoked", "consent-required", "session-error"]);
  const text = await page.locator("body").innerText();
  for (const word of ["Administrar municipios", "Categorías y tipos", "Registros pendientes"]) expect(text).not.toContain(word);
});

test("19: /municipios muestra municipalities-forbidden y no pide municipios", async ({ page }) => {
  const requests = await open(page, "/municipios");
  await expect(page.getByTestId("municipalities-forbidden")).toHaveText("No tienes permiso para administrar municipios.");
  await absent(page, [
    "municipalities-screen", "municipality-list", "municipality-item", "municipality-new", "municipality-edit", "municipality-form",
    "municipality-name", "municipality-save", "municipality-confirm", "municipality-confirm-accept",
  ]);
  expect(requests.filter((r) => r.includes("/api/v1/municipalities"))).toEqual([]);
  expect(requests).toEqual(["GET /api/v1/me"]);
});

test("20: /catalogos muestra catalog-forbidden y no pide las listas", async ({ page }) => {
  const requests = await open(page, "/catalogos");
  await expect(page.getByTestId("catalog-forbidden")).toHaveText("No tienes permiso para administrar estas listas.");
  await absent(page, [
    "catalog-name", "catalog-item", "catalog-save", "catalog-confirm", "catalog-list-categories", "catalog-list-experience-types",
    "catalog-list-establishment-types", "catalog-categories", "catalog-experience-types", "catalog-establishment-types",
  ]);
  expect(requests.filter((r) => /\/api\/v1\/(categories|experience-types|establishment-types)/.test(r))).toEqual([]);
});
