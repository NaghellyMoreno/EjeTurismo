import { expect, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createOldVersionAccount } from "../factories/accounts";
import { makeProvider } from "../factories/review";
import { ADMIN, MAPS_URL, NAME_ONE, seedAttractions, VISITOR, type Seed } from "../helpers/attraction-data";
import { ownerPool, resetDb } from "../helpers/db";
import { signInitData, tma } from "../helpers/telegram";

// F012, criterios 5, 11, 22b, 23, 25 y 30: M09 con los textos aprobados (D-147), comparados por igualdad exacta.
const PROVIDER = 900012031;
const OLD_NOTICE = 900012032;
const API = "/api/v1/managed-listings";

let owner: Pool;
let seed: Seed;
test.beforeAll(async ({ request }) => {
  owner = ownerPool();
  for (const path of ["/", "/atractivos", "/api/v1/me", "/api/v1/municipalities", "/api/v1/categories"]) await request.get(path, { timeout: 60_000 });
});
test.afterAll(() => owner.end());
test.beforeEach(async () => {
  await resetDb(owner);
  seed = await seedAttractions(owner);
});

async function open(page: Page, initData: string, path = "/atractivos") {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto(path);
}

const adminData = () => signInitData({ userId: ADMIN });
async function openForm(page: Page) {
  await open(page, adminData());
  await expect(page.getByTestId("attraction-name")).toBeVisible();
}

// Cuenta las peticiones POST a la API de fichas.
function countPosts(page: Page): { count: () => number } {
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === API) posts++;
  });
  return { count: () => posts };
}

const count = async (table: string) => Number((await owner.query(`select count(*) from app.${table}`)).rows[0].count);

async function fillAll(page: Page, name = NAME_ONE, municipalityId = seed.municipalityOne) {
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Municipio").selectOption(municipalityId);
  await page.getByLabel("Categoría").selectOption(seed.categoryOne);
  await page.getByLabel("Descripción").fill("Descripción ficticia.");
  await page.getByLabel("Horarios").fill("Todos los días de 8:00 a 17:00");
  await page.getByLabel("Contacto").fill("contacto@ejemplo.invalid");
  await page.getByLabel("Enlace de Google Maps").fill(MAPS_URL);
}

const REQUIRED: [string, string, string][] = [
  ["Nombre", "name", "El nombre es obligatorio."],
  ["Municipio", "municipalityId", "Elige un municipio."],
  ["Categoría", "categoryId", "Elige una categoría."],
  ["Descripción", "description", "La descripción es obligatoria."],
  ["Horarios", "schedule", "Los horarios son obligatorios."],
  ["Contacto", "contact", "El contacto es obligatorio."],
  ["Enlace de Google Maps", "mapsUrl", "El enlace de Google Maps es obligatorio."],
];

async function clear(page: Page, label: string) {
  const control = page.getByLabel(label, { exact: true });
  if (label === "Municipio" || label === "Categoría") await control.selectOption("");
  else await control.fill("");
}

test.describe("5: campo vacío en el cliente", () => {
  test("cada uno de los 7 campos vacíos muestra su texto junto al campo, sin diálogo ni POST", async ({ page }) => {
    const posts = countPosts(page);
    await openForm(page);
    for (const [label, field, message] of REQUIRED) {
      await fillAll(page);
      await clear(page, label);
      await page.getByTestId("attraction-save").click();
      await expect(page.getByTestId(`attraction-error-${field}`)).toHaveText(message);
      await expect(page.getByTestId(`attraction-error-${field}`)).toHaveAttribute("role", "alert");
      await expect(page.getByTestId("attraction-confirm")).toHaveCount(0);
    }
    expect(posts.count()).toBe(0);
    expect(await count("listings")).toBe(0);
  });

  test("solo espacios llega al servidor, que responde 422 required y la pantalla muestra su mensaje", async ({ page }) => {
    const posts = countPosts(page);
    await openForm(page);
    await fillAll(page, "     ");
    await page.getByTestId("attraction-save").click();
    await page.getByTestId("attraction-confirm-yes").click();
    await expect(page.getByTestId("attraction-error-name")).toHaveText("El nombre es obligatorio.");
    expect(posts.count()).toBe(1);
    expect(await count("listings")).toBe(0);
  });

  test("un 422 del servidor (enlace inválido) se muestra junto a su campo con el mensaje del servidor", async ({ page }) => {
    await openForm(page);
    await fillAll(page);
    await page.getByLabel("Enlace de Google Maps").fill("https://ejemplo.invalid/mapa");
    await page.getByTestId("attraction-save").click();
    await page.getByTestId("attraction-confirm-yes").click();
    await expect(page.getByTestId("attraction-error-mapsUrl")).toHaveText("Escribe un enlace de Google Maps (por ejemplo, maps.app.goo.gl o google.com/maps).");
    await expect(page.getByTestId("attraction-error")).toHaveText("Revisa los campos marcados.");
    await expect(page.getByTestId("attraction-created")).toHaveCount(0);
    expect(await count("listings")).toBe(0);
  });
});

test.describe("11: camino completo", () => {
  test("guardar, cancelar conserva lo escrito, confirmar (con doble clic) envía un solo POST y publica", async ({ page, request }) => {
    const posts = countPosts(page);
    await openForm(page);
    await fillAll(page);
    await page.getByTestId("attraction-save").click();
    await expect(page.getByTestId("attraction-confirm")).toHaveText("Vas a publicar «Atractivo Ficticio Uno». Será visible para los visitantes de inmediato, sin revisión. ¿Confirmas?");
    await expect(page.getByTestId("attraction-confirm-yes")).toHaveText("Confirmar");
    await expect(page.getByTestId("attraction-confirm-no")).toHaveText("Cancelar");
    await page.getByTestId("attraction-confirm-no").click();
    expect(posts.count()).toBe(0);
    await expect(page.getByTestId("attraction-confirm")).toHaveCount(0);
    await expect(page.getByLabel("Nombre")).toHaveValue(NAME_ONE);
    await expect(page.getByLabel("Horarios")).toHaveValue("Todos los días de 8:00 a 17:00");

    await page.getByTestId("attraction-save").click();
    // Dos clics seguidos sobre Confirmar: el segundo no envía nada.
    await page.getByTestId("attraction-confirm-yes").dblclick();
    await expect(page.getByTestId("attraction-created")).toHaveText("Atractivo registrado y publicado.");
    expect(posts.count()).toBe(1);
    expect(await count("listings")).toBe(1);
    await expect(page.getByLabel("Nombre")).toHaveValue("");
    await expect(page.getByLabel("Municipio")).toHaveValue("");
    await expect(page.getByLabel("Descripción")).toHaveValue("");

    const visitor = { headers: tma(signInitData({ userId: VISITOR })) };
    const forMunicipality = async (id: string) =>
      (await (await request.get(`/api/v1/public/listings?municipalityId=${id}&categoryId=${seed.categoryOne}`, visitor)).json()).items.map((i: { name: string }) => i.name);
    expect(await forMunicipality(seed.municipalityOne)).toEqual([NAME_ONE]);
    expect(await forMunicipality(seed.municipalityTwo)).toEqual([]);
  });
});

test.describe("22b: mismo nombre", () => {
  test("en el mismo municipio muestra el duplicado junto al nombre; en otro municipio se registra", async ({ page }) => {
    await openForm(page);
    await fillAll(page);
    await page.getByTestId("attraction-save").click();
    await page.getByTestId("attraction-confirm-yes").click();
    await expect(page.getByTestId("attraction-created")).toBeVisible();

    await fillAll(page);
    await page.getByTestId("attraction-save").click();
    await page.getByTestId("attraction-confirm-yes").click();
    const error = page.getByTestId("attraction-error-name");
    await expect(error).toHaveText("Ya existe un atractivo con ese nombre en ese municipio.");
    await expect(error).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("attraction-created")).toHaveCount(0);
    await expect(page.getByLabel("Nombre")).toHaveValue(NAME_ONE);
    expect(await count("listings")).toBe(1);

    await page.getByLabel("Municipio").selectOption(seed.municipalityTwo);
    await page.getByTestId("attraction-save").click();
    await page.getByTestId("attraction-confirm-yes").click();
    await expect(page.getByTestId("attraction-created")).toBeVisible();
    expect(await count("listings")).toBe(2);
  });
});

test.describe("23: solo las listas del servidor", () => {
  test("los selectores tienen exactamente las opciones de las listas y no hay campos de texto para municipio o categoría", async ({ page, request }) => {
    const headers = tma(adminData());
    const names = async (path: string) => ((await (await request.get(path, { headers })).json()) as { name: string }[]).map((i) => i.name);
    await openForm(page);
    for (const [testId, path] of [["attraction-municipality", "/api/v1/municipalities"], ["attraction-category", "/api/v1/categories"]] as const) {
      const select = page.getByTestId(testId);
      expect(await select.evaluate((el) => el.tagName)).toBe("SELECT");
      const options = await select.locator("option").allTextContents();
      expect(options[0]).toBe("Elige una opción");
      expect(options.slice(1)).toEqual(await names(path));
    }
    await expect(page.locator("input[type=text], input:not([type]), textarea")).toHaveCount(5);
    const testIds = await page.locator("input, textarea").evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    expect(testIds.sort()).toEqual(["attraction-contact", "attraction-description", "attraction-maps-url", "attraction-name", "attraction-schedule"]);
    await expect(page.getByLabel(/tipo de establecimiento|experiencia/i)).toHaveCount(0);
  });
});

test.describe("25: acceso", () => {
  test("el administrador ve el enlace y abre M09 desde el inicio", async ({ page }) => {
    await open(page, adminData(), "/");
    await expect(page.getByTestId("attractions-link")).toHaveText("Registrar atractivo");
    await page.getByTestId("attractions-link").click();
    await expect(page.getByTestId("attraction-title")).toHaveText("Registrar atractivo");
    await expect(page.getByTestId("attraction-name")).toBeVisible();
  });

  test("prestador, persona con aviso sin rol y aviso anterior: sin enlace y solo la frase de permiso, sin POST", async ({ page }) => {
    await makeProvider(owner, PROVIDER);
    await createOldVersionAccount(owner, OLD_NOTICE);
    for (const id of [PROVIDER, VISITOR, OLD_NOTICE]) {
      await open(page, signInitData({ userId: id }), "/");
      await expect(page.getByTestId("miniapp-home")).toBeVisible();
      await expect(page.getByTestId("attractions-link")).toHaveCount(0);
      const posts = countPosts(page);
      await open(page, signInitData({ userId: id }));
      await expect(page.getByTestId("attraction-forbidden")).toHaveText("No tienes permiso para registrar atractivos.");
      await expect(page.getByTestId("attraction-name")).toHaveCount(0);
      await expect(page.getByTestId("attraction-save")).toHaveCount(0);
      expect(posts.count()).toBe(0);
      page.removeAllListeners("request");
    }
  });

  test("sin initData válido muestra la pantalla de sesión vencida", async ({ page }) => {
    for (const initData of ["", signInitData({ userId: ADMIN, token: "9:otro" }), signInitData({ userId: ADMIN, authDate: Math.floor(Date.now() / 1000) - 3 * 86400 })]) {
      await open(page, initData);
      await expect(page.getByTestId("session-error")).toHaveText("Tu sesión venció o no se pudo verificar. Cierra la Mini App y ábrela de nuevo desde el bot.");
      await expect(page.getByTestId("attraction-name")).toHaveCount(0);
    }
  });
});

test.describe("30: accesibilidad e identidad visual", () => {
  test("controles con etiqueta, errores con role alert y solo colores de la paleta", async ({ page }) => {
    await openForm(page);
    for (const [label] of REQUIRED) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    await page.getByTestId("attraction-save").click();
    for (const [, field] of REQUIRED) await expect(page.getByTestId(`attraction-error-${field}`)).toHaveAttribute("role", "alert");
    await fillAll(page);
    await page.getByTestId("attraction-save").click();
    await expect(page.getByTestId("attraction-confirm-yes")).toBeVisible();

    const colors = await page.locator("body *").evaluateAll((elements) => {
      const out: { tag: string; prop: string; value: string; text: string }[] = [];
      for (const el of elements) {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || (rect.width === 0 && rect.height === 0)) continue;
        for (const prop of ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"] as const) {
          out.push({ tag: el.tagName.toLowerCase() + (el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""), prop, value: style[prop], text: style.backgroundColor });
        }
      }
      return out;
    });
    const hex = (css: string) => {
      const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return css;
      if (m[4] !== undefined && Number(m[4]) === 0) return "transparent";
      return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
    };
    const palette = new Set(["#659287", "#3F6B5F", "#88BDA4", "#B1D3B9", "#E6F2DD", "#C1FF72", "#1F3A33", "#FFFFFF", "transparent"]);
    const outside = colors.filter((c) => !palette.has(hex(c.value))).map((c) => `${c.tag} ${c.prop} ${c.value}`);
    expect(outside).toEqual([]);
    // El texto sobre #3F6B5F es blanco.
    const onDark = colors.filter((c) => c.prop === "color" && hex(c.text) === "#3F6B5F").map((c) => hex(c.value));
    expect(onDark.length).toBeGreaterThan(0);
    expect(new Set(onDark)).toEqual(new Set(["#FFFFFF"]));
  });
});
