import { expect, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createAccount, PERSON_PRINCIPAL } from "../factories/accounts";
import { grantAdminRole, makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { signInitData } from "../helpers/telegram";

// F011, criterios 6, 7, 16, 22, 24, 29, 30 y 32: M11 con los textos aprobados (D-130), comparados por igualdad exacta.
const ADMIN = 900000111;
const PROVIDER = 900000113;
const NO_ROLE = 900000114;

let owner: Pool;
test.beforeAll(async ({ request }) => {
  owner = ownerPool();
  // `next dev` compila cada ruta en su primera visita; se calientan antes para que ninguna prueba dependa de ese tiempo.
  for (const path of ["/", "/catalogos", "/api/v1/me", "/api/v1/categories", "/api/v1/experience-types", "/api/v1/establishment-types"]) {
    await request.get(path, { timeout: 60_000 });
  }
});
test.afterAll(() => owner.end());
test.beforeEach(async () => {
  await resetDb(owner);
  await createAccount(owner, ADMIN);
  await grantAdminRole(owner, ADMIN);
});

// Sustituye el script de Telegram por un `Telegram.WebApp` simulado con el initData dado y abre la ruta.
async function open(page: Page, initData: string, path = "/") {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto(path);
}

const adminData = () => signInitData({ userId: ADMIN });
const list = (page: Page, slug: string) => page.getByTestId(`catalog-list-${slug}`);
const count = async (table: string) => Number((await owner.query(`select count(*) from app.${table}`)).rows[0].count);

async function openCatalog(page: Page, initData = adminData()) {
  await open(page, initData, "/catalogos");
  await expect(page.getByTestId("catalog-list-categories")).toBeVisible();
}

test.describe("acceso desde el inicio (criterios 6 y 29)", () => {
  test("el administrador y el principal ven catalog-link y abren M11 desde el inicio", async ({ page }) => {
    await createAccount(owner, PERSON_PRINCIPAL);
    for (const id of [ADMIN, PERSON_PRINCIPAL]) {
      await open(page, signInitData({ userId: id }));
      await expect(page.getByTestId("role-admin")).toBeVisible();
      // D-206: tarjeta con los textos del prototipo; conserva el nombre accesible aprobado.
      await expect(page.getByTestId("catalog-link")).toHaveAccessibleName("Categorías y tipos");
    }
    await page.getByTestId("catalog-link").click();
    await expect(page.getByTestId("catalog-title")).toHaveText("Categorías y tipos");
    await expect(page.getByTestId("catalog-categories")).toHaveText("Categorías");
    await expect(page.getByTestId("catalog-experience-types")).toHaveText("Tipos de experiencia");
    await expect(page.getByTestId("catalog-establishment-types")).toHaveText("Tipos de establecimiento");
    await expect(list(page, "experience-types").getByTestId("catalog-item")).toHaveText(["Sabores de Caldas"]);
    await expect(list(page, "establishment-types").getByTestId("catalog-item")).toHaveCount(5);
  });

  test("un prestador y una cuenta sin rol no ven catalog-link", async ({ page }) => {
    await makeProvider(owner, PROVIDER);
    await createAccount(owner, NO_ROLE);
    for (const id of [PROVIDER, NO_ROLE]) {
      await open(page, signInitData({ userId: id }));
      await expect(page.getByTestId("miniapp-home")).toBeVisible();
      await expect(page.getByTestId("catalog-link")).toHaveCount(0);
    }
  });

  test("abrir M11 directamente con otro rol: solo catalog-forbidden y ninguna petición de listas", async ({ page }) => {
    await makeProvider(owner, PROVIDER);
    await createAccount(owner, NO_ROLE);
    for (const id of [PROVIDER, NO_ROLE]) {
      const listRequests: string[] = [];
      page.on("request", (request) => {
        if (/\/api\/v1\/(categories|experience-types|establishment-types)/.test(request.url())) listRequests.push(request.url());
      });
      await open(page, signInitData({ userId: id }), "/catalogos");
      await expect(page.getByTestId("catalog-forbidden")).toHaveText("No tienes permiso para administrar estas listas.");
      await expect(page.getByTestId("catalog-name")).toHaveCount(0);
      await expect(page.getByTestId("catalog-categories")).toHaveCount(0);
      await expect(page.getByTestId("catalog-experience-types")).toHaveCount(0);
      await expect(page.getByTestId("catalog-establishment-types")).toHaveCount(0);
      expect(listRequests).toEqual([]);
      page.removeAllListeners("request");
    }
  });

  test("si una lectura responde 403 se muestra el mismo catalog-forbidden", async ({ page }) => {
    await page.route("**/api/v1/experience-types", (route) => route.fulfill({ status: 403, contentType: "application/problem+json", body: "{}" }));
    await open(page, adminData(), "/catalogos");
    await expect(page.getByTestId("catalog-forbidden")).toBeVisible();
    await expect(page.getByTestId("catalog-name")).toHaveCount(0);
  });
});

test.describe("30: sesión no verificable", () => {
  const cases: [string, () => string][] = [
    ["sin initData", () => ""],
    ["firma inválida", () => signInitData({ userId: ADMIN, token: "9:otro" })],
    ["auth_date vencido", () => signInitData({ userId: ADMIN, authDate: Math.floor(Date.now() / 1000) - 3 * 86400 })],
  ];
  for (const [name, initData] of cases) {
    test(name, async ({ page }) => {
      await open(page, initData(), "/catalogos");
      await expect(page.getByTestId("session-error")).toHaveText("Tu sesión venció o no se pudo verificar. Cierra la Mini App y ábrela de nuevo desde el bot.");
      await expect(page.getByTestId("catalog-name")).toHaveCount(0);
      await expect(page.getByTestId("catalog-categories")).toHaveCount(0);
    });
  }
});

test.describe("crear (criterios 6, 7, 16, 24, 32)", () => {
  test("6: guardar, confirmar con el texto exacto y ver el nombre en categorías y en tipos de experiencia", async ({ page }) => {
    await openCatalog(page);
    for (const slug of ["categories", "experience-types"]) {
      const section = list(page, slug);
      await section.getByTestId("catalog-name").fill("Naturaleza");
      await section.getByTestId("catalog-save").click();
      await expect(section.getByTestId("catalog-confirm-text")).toHaveText("Vas a crear «Naturaleza». ¿Confirmas?");
      await section.getByTestId("catalog-confirm").click();
      await expect(section.getByTestId("catalog-item").filter({ hasText: "Naturaleza" })).toHaveCount(1);
      await expect(section.getByTestId("catalog-name")).toHaveValue("");
    }
    expect(await count("categories")).toBe(1);
  });

  test("7: cancelar el paso de confirmación no crea nada", async ({ page }) => {
    await openCatalog(page);
    const section = list(page, "categories");
    await section.getByTestId("catalog-name").fill("Naturaleza");
    await section.getByTestId("catalog-save").click();
    await expect(section.getByTestId("catalog-confirm-text")).toBeVisible();
    await section.getByTestId("catalog-cancel").click();
    await expect(section.getByTestId("catalog-confirm-text")).toHaveCount(0);
    await expect(section.getByTestId("catalog-item")).toHaveCount(0);
    expect(await count("categories")).toBe(0);
    expect(await count("audit_events")).toBe(0);
  });

  test("16: un nombre duplicado muestra el aviso junto al campo y no crea nada", async ({ page }) => {
    await owner.query("insert into app.categories (name, name_normalized) values ('Cultura', 'cultura')");
    await openCatalog(page);
    const section = list(page, "categories");
    await section.getByTestId("catalog-name").fill("cultúra");
    await section.getByTestId("catalog-save").click();
    await section.getByTestId("catalog-confirm").click();
    await expect(section.getByTestId("catalog-error")).toHaveText("Ya existe un elemento con ese nombre.");
    await expect(section.getByTestId("catalog-error")).not.toContainText(/409|conflict|problem/i);
    expect(await count("categories")).toBe(1);
  });

  test("24: nombre vacío no envía la petición y pide un nombre", async ({ page }) => {
    await openCatalog(page);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url());
    });
    const section = list(page, "categories");
    await section.getByTestId("catalog-name").fill("   ");
    await section.getByTestId("catalog-save").click();
    await expect(section.getByTestId("catalog-error")).toHaveText("Escribe un nombre.");
    expect(writes).toEqual([]);
  });

  test("32: un error 500 muestra el texto genérico y la pantalla sigue usable", async ({ page }) => {
    await openCatalog(page);
    await page.route("**/api/v1/categories", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/problem+json", body: JSON.stringify({ status: 500, code: "internal_error", detail: "boom interno" }) })
        : route.continue(),
    );
    const section = list(page, "categories");
    await section.getByTestId("catalog-name").fill("Naturaleza");
    await section.getByTestId("catalog-save").click();
    await section.getByTestId("catalog-confirm").click();
    await expect(section.getByTestId("catalog-error")).toHaveText("No pudimos guardar el cambio. Inténtalo de nuevo.");
    await expect(section.getByTestId("catalog-name")).toBeEditable();
    await expect(section.getByTestId("catalog-save")).toBeEnabled();
  });
});

test("22: editar muestra el texto de confirmación, guarda y el nombre sigue al recargar", async ({ page }) => {
  await owner.query("insert into app.categories (name, name_normalized) values ('Naturaleza', 'naturaleza')");
  await openCatalog(page);
  const section = list(page, "categories");
  await section.getByTestId("catalog-item").filter({ hasText: "Naturaleza" }).click();
  await expect(section.getByTestId("catalog-name")).toHaveValue("Naturaleza");
  await section.getByTestId("catalog-name").fill("Naturaleza y aventura");
  await section.getByTestId("catalog-save").click();
  await expect(section.getByTestId("catalog-confirm-text")).toHaveText(
    "Vas a cambiar el nombre a «Naturaleza y aventura». El cambio se verá en las fichas que lo usan. ¿Confirmas?",
  );
  await section.getByTestId("catalog-confirm").click();
  await expect(section.getByTestId("catalog-item")).toHaveText(["Naturaleza y aventura"]);
  await page.reload();
  await expect(list(page, "categories").getByTestId("catalog-item")).toHaveText(["Naturaleza y aventura"]);
  expect(await count("categories")).toBe(1);
});
