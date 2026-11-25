import { expect, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createAccount, createOldVersionAccount, grantAdmin } from "../factories/accounts";
import { makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { CONTACT, ESTABLISHMENT_ONE, ESTABLISHMENT_TWO, MAPS_URL } from "../helpers/listing-data";
import { signInitData, tma } from "../helpers/telegram";
import { toStep } from "./wizard";

// F013, criterios 33 a 43: M04, M05, M07, M08 y M12 con los textos de la tabla "Textos nuevos", comparados por igualdad exacta.
const A6 = 900007031;
const P2P = 900013001;
const ADMIN = 900007001;
const VISITOR = 900007012;
const OLD_NOTICE = 900007013;
const API = "/api/v1/managed-listings";
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

interface World { municipalityOne: string; municipalityTwo: string; categoryOne: string; typeOne: string }
let owner: Pool;
let world: World;
test.beforeAll(async ({ request }) => {
  owner = ownerPool();
  for (const path of ["/", "/fichas", "/fichas/nueva", "/api/v1/me", "/api/v1/municipalities"]) await request.get(path, { timeout: 60_000 });
});
test.afterAll(() => owner.end());
test.beforeEach(async () => {
  await resetDb(owner);
  await createAccount(owner, ADMIN, "Administrador Ficticio");
  await grantAdmin(owner, ADMIN);
  await createAccount(owner, VISITOR, "Visitante Ficticio");
  await createOldVersionAccount(owner, OLD_NOTICE);
  await makeProvider(owner, A6, "9000070310");
  await makeProvider(owner, P2P, "9000130010");
  const one = async (sql: string) => (await owner.query(sql)).rows[0].id as string;
  world = {
    municipalityOne: await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Uno', 'municipio ficticio uno', 'Caldas') returning id"),
    municipalityTwo: await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Dos', 'municipio ficticio dos', 'Caldas') returning id"),
    categoryOne: await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Uno', 'categoria ficticia uno') returning id"),
    typeOne: await one("insert into app.establishment_types (name, name_normalized) values ('Establecimiento Ficticio', 'establecimiento ficticio') returning id"),
  };
});

async function open(page: Page, initData: string, path = "/fichas") {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto(path);
}
const as = (userId: number) => signInitData({ userId });

// Cuenta las peticiones de escritura (POST y PUT) a la API de fichas; `.../submission` se cuenta aparte.
function counter(page: Page) {
  const seen = { writes: 0, submissions: 0, put: 0 };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith(API)) return;
    if (request.method() === "POST" && path.endsWith("/submission")) seen.submissions++;
    else if (request.method() === "POST" || request.method() === "PUT") {
      seen.writes++;
      if (request.method() === "PUT") seen.put++;
    }
  });
  return seen;
}

const count = async (table: string) => Number((await owner.query(`select count(*) from app.${table}`)).rows[0].count);
const content = (name = ESTABLISHMENT_ONE, extra: Record<string, unknown> = {}) => ({
  name, municipalityId: world.municipalityOne, categoryId: world.categoryOne, establishmentTypeId: world.typeOne,
  description: "Descripción ficticia.", schedule: "Todos los días de 8:00 a 17:00", contact: CONTACT, mapsUrl: MAPS_URL, ...extra,
});
async function createViaApi(request: import("@playwright/test").APIRequestContext, userId: number, name: string, submit = false) {
  const res = await request.post(API, { headers: tma(as(userId)), data: { kind: "establishment", content: content(name), confirmed: true } });
  expect(res.status()).toBe(201);
  const id = (await res.json()).id as string;
  if (submit) {
    const sent = await request.post(`${API}/${id}/submission`, { headers: tma(as(userId)), data: { confirmed: true, thirdPartyAuthorizationDeclared: true } });
    expect(sent.status()).toBe(200);
  }
  return id;
}

async function fillAll(page: Page, name = ESTABLISHMENT_ONE, extra: Partial<Record<"contact" | "municipalityId", string>> = {}) {
  await toStep(page, 2);
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Municipio", { exact: true }).selectOption(extra.municipalityId ?? world.municipalityOne);
  await page.getByLabel("Categoría", { exact: true }).selectOption(world.categoryOne);
  await page.getByLabel("Tipo de establecimiento (opcional)", { exact: true }).selectOption(world.typeOne);
  await page.getByLabel("Descripción", { exact: true }).fill("Descripción ficticia.");
  await page.getByLabel("Horarios", { exact: true }).fill("Todos los días de 8:00 a 17:00");
  await page.getByLabel("Contacto", { exact: true }).fill(extra.contact ?? CONTACT);
  await page.getByLabel("Enlace de Google Maps", { exact: true }).fill(MAPS_URL);
}

const visitorList = async (request: import("@playwright/test").APIRequestContext, query = "") =>
  ((await (await request.get(`/api/v1/public/listings${query}`, { headers: tma(as(VISITOR)) })).json()).items as { name: string }[]).map((i) => i.name);

test.describe("33: acceso", () => {
  test("el prestador ve el enlace y abre M04", async ({ page }) => {
    await open(page, as(A6), "/");
    // D-206: en el inicio del prototipo el acceso a M04 es «Ver todas →», junto al título «Mis fichas».
    await expect(page.getByTestId("listings-link")).toHaveText("Ver todas →");
    await page.getByTestId("listings-link").click();
    await expect(page.getByTestId("listing-title")).toHaveText("Mis fichas");
  });

  test("administrador, visitante y aviso anterior: sin enlace y solo la frase de permiso, sin POST ni PUT", async ({ page }) => {
    for (const id of [ADMIN, VISITOR, OLD_NOTICE]) {
      await open(page, as(id), "/");
      await expect(page.getByTestId("miniapp-home")).toBeVisible();
      await expect(page.getByTestId("listings-link")).toHaveCount(0);
      const seen = counter(page);
      for (const path of ["/fichas", "/fichas/nueva", `/fichas/${UNKNOWN}`, `/fichas/${UNKNOWN}/editar`]) {
        await open(page, as(id), path);
        await expect(page.getByTestId("listing-forbidden")).toHaveText("No tienes permiso para gestionar fichas.");
        await expect(page.getByTestId("listing-name")).toHaveCount(0);
        await expect(page.getByTestId("listing-save")).toHaveCount(0);
      }
      expect(seen.writes + seen.submissions).toBe(0);
      page.removeAllListeners("request");
    }
  });

  test("sin initData válido muestra la pantalla de sesión vencida", async ({ page }) => {
    for (const initData of ["", signInitData({ userId: A6, token: "9:otro" })]) {
      for (const path of ["/fichas", "/fichas/nueva"]) {
        await open(page, initData, path);
        await expect(page.getByTestId("session-error")).toHaveText("Tu sesión venció o no se pudo verificar. Cierra la Mini App y ábrela de nuevo desde el bot.");
        await expect(page.getByTestId("listing-name")).toHaveCount(0);
      }
    }
  });
});

test.describe("34: mis fichas", () => {
  test("lista vacía, luego las fichas propias en el orden de la API y no las del otro prestador", async ({ page, request }) => {
    await open(page, as(A6));
    await expect(page.getByTestId("listing-empty")).toHaveText("Todavía no tienes fichas.");
    await expect(page.getByTestId("listing-new")).toHaveText("Nueva ficha");

    const first = await createViaApi(request, A6, ESTABLISHMENT_ONE);
    await new Promise((r) => setTimeout(r, 20));
    const second = await createViaApi(request, A6, ESTABLISHMENT_TWO);
    await createViaApi(request, P2P, "Ficha del otro prestador");
    await open(page, as(A6));
    await expect(page.getByTestId(`listing-row-${first}`)).toContainText(ESTABLISHMENT_ONE);
    await expect(page.getByTestId(`listing-row-${first}`)).toContainText("Municipio Ficticio Uno");
    await expect(page.getByTestId(`listing-status-${first}`)).toHaveText("Borrador");
    const ids = await page.locator("[data-testid^='listing-row-']").evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")!.replace("listing-row-", "")));
    expect(ids).toEqual([second, first]);
    await expect(page.getByText("Ficha del otro prestador")).toHaveCount(0);
  });
});

test.describe("35 y 36: crear el borrador y cancelar", () => {
  test("guardar abre el diálogo; Cancelar no envía; Confirmar envía un solo POST (doble clic) y el visitante no la ve", async ({ page, request }) => {
    const seen = counter(page);
    await open(page, as(A6), "/fichas/nueva");
    await toStep(page, 2);
    await expect(page.getByTestId("listing-name")).toBeVisible();
    await fillAll(page);
    await page.getByTestId("listing-save").click();
    await expect(page.getByTestId("listing-confirm")).toHaveText("Vas a guardar «Establecimiento Ficticio Uno» como borrador. No será visible para los visitantes. ¿Confirmas?");
    await expect(page.getByTestId("listing-confirm-yes")).toHaveText("Confirmar");
    await expect(page.getByTestId("listing-confirm-no")).toHaveText("Cancelar");
    await page.getByTestId("listing-confirm-no").click();
    expect(seen.writes).toBe(0);
    await expect(page.getByTestId("listing-confirm")).toHaveCount(0);
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(ESTABLISHMENT_ONE);
    expect(await count("listings")).toBe(0);

    await page.getByTestId("listing-save").click();
    await page.getByTestId("listing-confirm-yes").dblclick();
    await expect(page.getByTestId("listing-saved")).toHaveText("Borrador guardado.");
    expect(seen.writes).toBe(1);
    expect(await count("listings")).toBe(1);
    expect(await visitorList(request)).toEqual([]);

    await open(page, as(A6));
    await expect(page.locator("[data-testid^='listing-status-']")).toHaveText("Borrador");
  });

  test("los selectores ofrecen exactamente las opciones de las listas de la API y no hay texto libre para ellos", async ({ page, request }) => {
    const headers = tma(as(A6));
    const names = async (path: string) => ((await (await request.get(path, { headers })).json()) as { name: string }[]).map((i) => i.name);
    await open(page, as(A6), "/fichas/nueva");
    await toStep(page, 2);
    await expect(page.getByTestId("listing-name")).toBeVisible();
    const expected: Array<[string, string, string]> = [
      ["listing-municipality", "/api/v1/municipalities", "Elige una opción"],
      ["listing-category", "/api/v1/categories", "Elige una opción"],
      ["listing-establishment-type", "/api/v1/establishment-types", "Sin tipo"],
    ];
    for (const [testId, path, first] of expected) {
      const select = page.getByTestId(testId);
      expect(await select.evaluate((el) => el.tagName)).toBe("SELECT");
      const options = await select.locator("option").allTextContents();
      expect(options[0]).toBe(first);
      expect(options.slice(1)).toEqual(await names(path));
    }
    const testIds = await page.locator("input, textarea").evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    expect(testIds.sort()).toEqual(["listing-contact", "listing-description", "listing-maps-url", "listing-name", "listing-schedule"]);
  });

  test("36: Cancelar vuelve a M04 sin peticiones de escritura; lo mismo al cerrar el diálogo", async ({ page }) => {
    const seen = counter(page);
    await open(page, as(A6), "/fichas/nueva");
    await toStep(page, 2);
    await page.getByLabel("Nombre", { exact: true }).fill(ESTABLISHMENT_ONE);
    await page.getByTestId("listing-cancel").click();
    await expect(page.getByTestId("listing-empty")).toBeVisible();
    expect(seen.writes + seen.submissions).toBe(0);
    for (const table of ["listings", "businesses", "listing_versions"]) expect(await count(table), table).toBe(0);
  });
});

test.describe("37: campo vacío al enviar", () => {
  const REQUIRED: Array<[string, string, string]> = [
    ["Nombre", "name", "El nombre es obligatorio."],
    ["Municipio", "municipalityId", "Elige un municipio."],
    ["Categoría", "categoryId", "Elige una categoría."],
    ["Descripción", "description", "La descripción es obligatoria."],
    ["Horarios", "schedule", "Los horarios son obligatorios."],
    ["Contacto", "contact", "El contacto es obligatorio."],
    ["Enlace de Google Maps", "mapsUrl", "El enlace de Google Maps es obligatorio."],
  ];
  test("cada campo vacío muestra su texto junto al campo, sin diálogo y sin enviar", async ({ page }) => {
    const seen = counter(page);
    await open(page, as(A6), "/fichas/nueva");
    await toStep(page, 2);
    await expect(page.getByTestId("listing-name")).toBeVisible();
    for (const [label, field, message] of REQUIRED) {
      await fillAll(page);
      const control = page.getByLabel(label, { exact: true });
      if (label === "Municipio" || label === "Categoría") await control.selectOption("");
      else await control.fill("");
      if (field === "name" || field === "municipalityId") {
        // D-206: sin nombre ni municipio no se guarda el borrador que necesita el paso de fotos; el aviso sale al guardar.
        await page.getByTestId("listing-save").click();
      } else {
        await toStep(page, 5);
        await page.getByTestId("listing-submit").click();
      }
      const error = page.getByTestId(`listing-error-${field}`);
      await expect(error).toHaveText(message);
      await expect(error).toHaveAttribute("role", "alert");
      await expect(page.getByTestId("listing-submit-dialog")).toHaveCount(0);
      // Junto a los botones se ve el aviso aprobado, para que se note que el botón respondió.
      await expect(page.getByTestId("listing-error")).toHaveText("Revisa los campos marcados.");
    }
    // Lo mismo al guardar sin nombre.
    await page.getByLabel("Nombre", { exact: true }).fill("");
    await page.getByTestId("listing-save").click();
    await expect(page.getByTestId("listing-error-name")).toHaveText("El nombre es obligatorio.");
    await expect(page.getByTestId("listing-error")).toHaveText("Revisa los campos marcados.");
    expect(seen.submissions).toBe(0);
    // D-206: para llegar a «Revisar» el borrador se guarda antes (paso 3); no se envía a revisión.
    expect(await count("listings")).toBe(1);
  });

  test("un contacto de solo espacios llega al servidor, que responde 422 y la pantalla muestra su mensaje", async ({ page }) => {
    await open(page, as(A6), "/fichas/nueva");
    await fillAll(page, ESTABLISHMENT_ONE, { contact: "   " });
    await toStep(page, 5);
    await page.getByTestId("listing-submit").click();
    await page.getByLabel(/Declaro que tengo la autorización/).check();
    await page.getByTestId("listing-submit-yes").click();
    await expect(page.getByTestId("listing-error-contact")).toHaveText("El contacto es obligatorio.");
    await expect(page.getByTestId("listing-submitted")).toHaveCount(0);
  });
});

test.describe("38 y 39: declaración, envío y ficha pendiente", () => {
  test("sin marcar la casilla no se envía; marcada y confirmada envía una vez; la ficha queda pendiente y no editable", async ({ page, request }) => {
    const seen = counter(page);
    await open(page, as(A6), "/fichas/nueva");
    await fillAll(page);
    await toStep(page, 5);
    await page.getByTestId("listing-submit").click();
    await expect(page.getByTestId("listing-submit-dialog")).toBeVisible();
    await expect(page.getByTestId("listing-submit-dialog")).toContainText("Vas a enviar «Establecimiento Ficticio Uno» a revisión. Mientras esté pendiente no podrás editarla. ¿Confirmas?");
    const declaration = page.getByLabel("Declaro que tengo la autorización de los guías y contactos cuyos datos incluyo en esta ficha.");
    await expect(declaration).not.toBeChecked();
    await page.getByTestId("listing-submit-yes").click();
    const error = page.getByTestId("listing-error-thirdPartyAuthorizationDeclared");
    await expect(error).toHaveText("Debes declarar que tienes la autorización de los guías y contactos.");
    await expect(error).toHaveAttribute("role", "alert");
    expect(seen.submissions).toBe(0);

    await page.getByTestId("listing-submit-no").click();
    expect(seen.submissions).toBe(0);
    // D-206: el borrador ya se guardó en el paso 3; cancelar el envío no lo manda a revisión.
    expect(await count("listings")).toBe(1);

    await toStep(page, 5);
    await page.getByTestId("listing-submit").click();
    await declaration.check();
    await page.getByTestId("listing-submit-yes").dblclick();
    await expect(page.getByTestId("listing-submitted")).toHaveText("Ficha enviada a revisión. El administrador la revisará.");
    expect(seen.submissions).toBe(1);

    await open(page, as(A6));
    const id = (await owner.query("select id from app.listings")).rows[0].id as string;
    await expect(page.getByTestId(`listing-status-${id}`)).toHaveText("Pendiente de revisión");
    expect(await visitorList(request)).toEqual([]);

    await open(page, as(A6), `/fichas/${id}`);
    await expect(page.getByTestId("listing-status")).toHaveText("Pendiente de revisión");
    await expect(page.getByTestId("listing-working")).toContainText("Versión de trabajo");
    await expect(page.getByTestId("listing-not-published")).toHaveText("Todavía no está publicada.");
    await expect(page.getByTestId("listing-edit")).toHaveCount(0);
    await open(page, as(A6), `/fichas/${id}/editar`);
    await expect(page.getByTestId("listing-locked")).toHaveText("Esta ficha está pendiente de revisión y no se puede editar hasta que el administrador decida.");
    await expect(page.getByTestId("listing-name")).toHaveCount(0);
  });

  test("el detalle de un borrador permite editar y guardar de nuevo con un solo PUT", async ({ page, request }) => {
    const id = await createViaApi(request, A6, ESTABLISHMENT_ONE);
    await open(page, as(A6), `/fichas/${id}`);
    await expect(page.getByTestId("listing-edit")).toHaveText("Editar borrador");
    await expect(page.getByTestId("listing-back")).toHaveText("Volver a mis fichas");
    await page.getByTestId("listing-edit").click();
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(ESTABLISHMENT_ONE);
    await expect(page.getByLabel("Contacto", { exact: true })).toHaveValue(CONTACT);
    const seen = counter(page);
    await page.getByLabel("Descripción", { exact: true }).fill("Otra descripción ficticia.");
    await page.getByTestId("listing-save").click();
    await page.getByTestId("listing-confirm-yes").click();
    await expect(page.getByTestId("listing-saved")).toBeVisible();
    expect(seen.put).toBe(1);
    expect((await owner.query("select description from app.listing_versions")).rows[0].description).toBe("Otra descripción ficticia.");
  });
});

test.describe("40: duplicado y varias fichas", () => {
  test("el mismo nombre y municipio muestra el duplicado junto al nombre; con otro nombre se guarda", async ({ page, request }) => {
    await createViaApi(request, A6, ESTABLISHMENT_ONE);
    await open(page, as(A6), "/fichas/nueva");
    await fillAll(page);
    await page.getByTestId("listing-save").click();
    await page.getByTestId("listing-confirm-yes").click();
    const error = page.getByTestId("listing-error-name");
    await expect(error).toHaveText("Ya existe una ficha con ese nombre en ese municipio.");
    await expect(error).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("listing-saved")).toHaveCount(0);
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(ESTABLISHMENT_ONE);
    expect(await count("listings")).toBe(1);

    await page.getByLabel("Nombre", { exact: true }).fill(ESTABLISHMENT_TWO);
    await page.getByTestId("listing-save").click();
    await page.getByTestId("listing-confirm-yes").click();
    await expect(page.getByTestId("listing-saved")).toBeVisible();
    await open(page, as(A6));
    await expect(page.locator("[data-testid^='listing-row-']")).toHaveCount(2);
  });
});

test.describe("41: error del backend y sesión vencida", () => {
  const TECHNICAL = "Error: connection refused 10.0.0.1";
  const failWith500 = (page: Page, matcher: (url: string, method: string) => boolean) =>
    page.route("**/api/v1/managed-listings**", (route) =>
      matcher(route.request().url(), route.request().method())
        ? route.fulfill({ status: 500, contentType: "application/problem+json", body: JSON.stringify({ type: "about:blank", title: "Error", status: 500, code: "internal_error", detail: TECHNICAL }) })
        : route.continue(),
    );

  test("guardar con un 500 muestra el texto genérico sin el detalle y conserva lo escrito", async ({ page }) => {
    await failWith500(page, (_url, method) => method === "POST");
    await open(page, as(A6), "/fichas/nueva");
    await fillAll(page);
    await page.getByTestId("listing-save").click();
    await page.getByTestId("listing-confirm-yes").click();
    await expect(page.getByTestId("listing-error")).toHaveText("No pudimos guardar la ficha. Inténtalo de nuevo en unos minutos.");
    await expect(page.locator("body")).not.toContainText("connection refused");
    await expect(page.locator("body")).not.toContainText("10.0.0.1");
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(ESTABLISHMENT_ONE);
  });

  test("enviar con un 500 muestra el texto de envío", async ({ page, request }) => {
    const id = await createViaApi(request, A6, ESTABLISHMENT_ONE);
    await failWith500(page, (url) => url.endsWith("/submission"));
    await open(page, as(A6), `/fichas/${id}/editar`);
    await toStep(page, 2);
    await expect(page.getByTestId("listing-name")).toBeVisible();
    await toStep(page, 5);
    await page.getByTestId("listing-submit").click();
    await page.getByLabel(/Declaro que tengo la autorización/).check();
    await page.getByTestId("listing-submit-yes").click();
    await expect(page.getByTestId("listing-error")).toHaveText("No pudimos enviar la ficha a revisión. Inténtalo de nuevo en unos minutos.");
    expect((await owner.query("select status from app.listing_versions")).rows[0].status).toBe("draft");
    await expect(page.locator("body")).not.toContainText("connection refused");
  });

  test("la carga de M04 con un 500 muestra listError", async ({ page }) => {
    await failWith500(page, (_url, method) => method === "GET");
    await open(page, as(A6));
    await expect(page.getByTestId("listing-load-error")).toHaveText("No pudimos cargar tus fichas. Inténtalo de nuevo.");
    await expect(page.locator("body")).not.toContainText("connection refused");
  });

  test("con initData vencido toda pantalla muestra la sesión vencida, sin formulario", async ({ page }) => {
    const expired = signInitData({ userId: A6, authDate: Math.floor(Date.now() / 1000) - 3 * 86400 });
    for (const path of ["/fichas", "/fichas/nueva", `/fichas/${UNKNOWN}`, `/fichas/${UNKNOWN}/editar`]) {
      await open(page, expired, path);
      await expect(page.getByTestId("session-error")).toHaveText("Tu sesión venció o no se pudo verificar. Cierra la Mini App y ábrela de nuevo desde el bot.");
      await expect(page.getByTestId("listing-name")).toHaveCount(0);
    }
  });
});

test.describe("42 y 43: accesibilidad, identidad visual y textos", () => {
  test("controles con etiqueta, errores con role alert y solo colores de la paleta en M04, M05, M07 y M08", async ({ page, request }) => {
    const id = await createViaApi(request, A6, ESTABLISHMENT_ONE);
    const palette = new Set(["#659287", "#3F6B5F", "#88BDA4", "#B1D3B9", "#E6F2DD", "#C1FF72", "#1F3A33", "#FFFFFF", "transparent"]);
    const hex = (css: string) => {
      const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return css;
      if (m[4] !== undefined && Number(m[4]) === 0) return "transparent";
      return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
    };
    const audit = async (label: string) => {
      const colors = await page.locator("body *").evaluateAll((elements) => {
        const out: { tag: string; prop: string; value: string; bg: string }[] = [];
        for (const el of elements) {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          if (style.display === "none" || style.visibility === "hidden" || (rect.width === 0 && rect.height === 0)) continue;
          for (const prop of ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"] as const) {
            out.push({ tag: el.tagName.toLowerCase() + (el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""), prop, value: style[prop], bg: style.backgroundColor });
          }
        }
        return out;
      });
      expect(colors.filter((c) => !palette.has(hex(c.value))).map((c) => `${label} ${c.tag} ${c.prop} ${c.value}`)).toEqual([]);
      for (const c of colors.filter((c) => c.prop === "color" && hex(c.bg) === "#3F6B5F")) expect(hex(c.value), `${label} ${c.tag}`).toBe("#FFFFFF");
    };

    await open(page, as(A6));
    await expect(page.getByTestId(`listing-row-${id}`)).toBeVisible();
    await audit("M04");
    await open(page, as(A6), `/fichas/${id}`);
    await expect(page.getByTestId("listing-working")).toBeVisible();
    await audit("M08");
    await open(page, as(A6), "/fichas/nueva");
    await toStep(page, 2);
    for (const label of ["Nombre", "Municipio", "Categoría", "Tipo de establecimiento (opcional)", "Descripción", "Horarios", "Contacto", "Enlace de Google Maps"]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    // D-206: sin nombre ni municipio el aviso sale al guardar; los otros cinco campos, al enviar desde «Revisar».
    await page.getByTestId("listing-save").click();
    for (const field of ["name", "municipalityId"]) await expect(page.getByTestId(`listing-error-${field}`)).toHaveAttribute("role", "alert");
    await page.getByLabel("Nombre", { exact: true }).fill("Ficha con campos vacíos");
    await page.getByLabel("Municipio", { exact: true }).selectOption(world.municipalityOne);
    await toStep(page, 5);
    await page.getByTestId("listing-submit").click();
    for (const field of ["categoryId", "description", "schedule", "contact", "mapsUrl"]) {
      await expect(page.getByTestId(`listing-error-${field}`)).toHaveAttribute("role", "alert");
    }
    await audit("M05 con errores");
    await fillAll(page, "Ficha para la paleta");
    await page.getByTestId("listing-save").click();
    await expect(page.getByTestId("listing-confirm-yes")).toBeVisible();
    await audit("M05 diálogo de guardar");
    await page.getByTestId("listing-confirm-no").click();
    await toStep(page, 5);
    await page.getByTestId("listing-submit").click();
    await expect(page.getByLabel("Declaro que tengo la autorización de los guías y contactos cuyos datos incluyo en esta ficha.")).toBeVisible();
    await page.getByTestId("listing-submit-yes").click();
    await expect(page.getByTestId("listing-error-thirdPartyAuthorizationDeclared")).toHaveAttribute("role", "alert");
    await audit("M07");
  });

  test("los mensajes visibles no contienen UUID, números largos ni literales técnicos", async ({ page, request }) => {
    const id = await createViaApi(request, A6, ESTABLISHMENT_ONE);
    const forbidden = [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /\b\d{6,}\b/, /\b(undefined|null|kind|validation_failed)\b/i, /Error:/];
    for (const path of ["/fichas", `/fichas/${id}`, `/fichas/${id}/editar`, "/fichas/nueva"]) {
      await open(page, as(A6), path);
      await expect(page.locator("main section, main div").first()).toBeVisible();
      await page.waitForTimeout(300);
      const text = (await page.locator("main").innerText()).replaceAll(ESTABLISHMENT_ONE, "");
      for (const pattern of forbidden) expect(text, `${path} ${pattern}`).not.toMatch(pattern);
    }
  });
});
