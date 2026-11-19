import { expect, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createAccount, grantAdmin } from "../factories/accounts";
import { makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { ATTACK_NAME, A_NAMES, B_NAMES, foreignStrings, rowDigest, seedIsolation, type IsolationFixtures } from "../helpers/listing-isolation";
import { signInitData, tma } from "../helpers/telegram";

// F016, criterios 19 a 22 y 23b: M04, M05 y M08 con el prestador A frente a las fichas de B; el criterio 21 es una petición
// HTTP directa (sin pantalla) con el token de A.
const A6 = 900007031;
const P2P = 900013001;
const NEW_PROVIDER = 900013002;
const ADMIN = 900007001;
const API = "/api/v1/managed-listings";
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const FORBIDDEN = "No tienes permiso para gestionar fichas.";
const LIST_ERROR = "No pudimos cargar tus fichas. Inténtalo de nuevo.";
const SESSION_EXPIRED = "Tu sesión venció o no se pudo verificar. Cierra la Mini App y ábrela de nuevo desde el bot.";

let owner: Pool;
let fx: IsolationFixtures;
test.beforeAll(async ({ request }) => {
  owner = ownerPool();
  for (const path of ["/", "/fichas", "/fichas/nueva", "/api/v1/me"]) await request.get(path, { timeout: 60_000 });
});
test.afterAll(() => owner.end());
test.beforeEach(async () => {
  await resetDb(owner);
  await createAccount(owner, ADMIN, "Administrador Ficticio");
  await grantAdmin(owner, ADMIN);
  const aAccountId = await makeProvider(owner, A6, "9000070310");
  const bAccountId = await makeProvider(owner, P2P, "9000130010");
  const one = async (sql: string) => (await owner.query(sql)).rows[0].id as string;
  const municipalityId = await one("insert into app.municipalities (name, name_normalized, department) values ('Municipio Ficticio Uno', 'municipio ficticio uno', 'Caldas') returning id");
  const categoryId = await one("insert into app.categories (name, name_normalized) values ('Categoria Ficticia Uno', 'categoria ficticia uno') returning id");
  fx = await seedIsolation(owner, { aAccountId, bAccountId, municipalityId, categoryId });
});

const as = (userId: number) => signInitData({ userId });
async function open(page: Page, initData: string, path = "/fichas") {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto(path);
}
const rowsOnPage = (page: Page) => page.locator('[data-testid^="listing-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("listing-row-", "")));
const testIds = (page: Page) => page.locator("[data-testid]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
function writes(page: Page) {
  const seen = { put: 0, post: 0 };
  page.on("request", (request) => {
    if (!new URL(request.url()).pathname.startsWith(API)) return;
    if (request.method() === "PUT") seen.put++;
    if (request.method() === "POST") seen.post++;
  });
  return seen;
}
const expectNoForeign = (text: string, label: string) => {
  for (const needle of foreignStrings(fx)) expect(text, `${label}: contiene «${needle}»`).not.toContain(needle);
};

test.describe("criterio 19: M04 de A no muestra la ficha de B", () => {
  test("A ve 3 filas en el orden de la API, B ve 5 y un prestador nuevo ve listing-empty", async ({ page, request }) => {
    const bodies: string[] = [];
    page.on("response", async (response) => {
      if (new URL(response.url()).pathname === API) bodies.push(await response.text());
    });
    const api = await (await request.get(`${API}?pageSize=50`, { headers: tma(as(A6)) })).json();
    await open(page, as(A6));
    await expect(page.getByTestId("listing-title")).toBeVisible();
    await expect(page.locator('[data-testid^="listing-row-"]')).toHaveCount(3);
    expect(await rowsOnPage(page)).toEqual((api.items as { id: string }[]).map((i) => i.id));
    const html = await page.content();
    expectNoForeign(html, "M04 de A");
    expect(bodies.length).toBeGreaterThan(0);
    for (const text of bodies) expectNoForeign(text, "respuesta de la lista de A");
    for (const name of Object.values(A_NAMES)) expect(html).toContain(name);

    await open(page, as(P2P));
    await expect(page.locator('[data-testid^="listing-row-"]')).toHaveCount(5);
    const bHtml = await page.content();
    for (const name of Object.values(A_NAMES)) expect(bHtml).not.toContain(name);
    for (const s of Object.values(fx.a)) expect(bHtml).not.toContain(s.listingId);

    await makeProvider(owner, NEW_PROVIDER, "9000130020");
    await open(page, as(NEW_PROVIDER));
    await expect(page.getByTestId("listing-empty")).toBeVisible();
    await expect(page.locator('[data-testid^="listing-row-"]')).toHaveCount(0);
  });
});

test.describe("criterio 20: ruta directa a una ficha ajena", () => {
  test("M08 y M05 con una ficha de B muestran solo el acceso denegado, sin formulario ni escrituras", async ({ page }) => {
    const seen = writes(page);
    const targets = [`/fichas/${fx.b.borrador.listingId}`, `/fichas/${fx.b.pendiente.listingId}`, `/fichas/${fx.b.publicada.listingId}`, `/fichas/${fx.b.borrador.listingId}/editar`];
    const screens: Array<{ text: string; ids: Array<string | null> }> = [];
    for (const path of [...targets, `/fichas/${UNKNOWN}`, "/fichas/no-es-uuid", `/fichas/${UNKNOWN}/editar`, "/fichas/no-es-uuid/editar"]) {
      await open(page, as(A6), path);
      await expect(page.getByTestId("listing-forbidden"), path).toHaveText(FORBIDDEN);
      for (const id of ["listing-edit", "listing-save", "listing-submit", "listing-name", "listing-working"]) await expect(page.getByTestId(id), `${path} ${id}`).toHaveCount(0);
      expect(await page.locator("form").count(), path).toBe(0);
      expectNoForeign(await page.locator("main").innerHTML(), path);
      screens.push({ text: (await page.locator("main").innerText()).trim(), ids: await testIds(page) });
    }
    // M08 de ficha ajena = inexistente = mal formada; lo mismo en M05.
    expect(screens[4]).toEqual(screens[0]);
    expect(screens[5]).toEqual(screens[0]);
    expect(screens[6]).toEqual(screens[3]);
    expect(screens[7]).toEqual(screens[3]);
    expect(seen).toEqual({ put: 0, post: 0 });

    await open(page, as(P2P), `/fichas/${fx.b.borrador.listingId}`);
    await expect(page.getByTestId("listing-working")).toContainText(B_NAMES.borrador);
  });
});

test.describe("criterio 21: el backend niega aunque la pantalla no lo impida", () => {
  test("PUT y POST manuales con el token de A sobre B-borrador responden 403 y la ficha de B no cambia", async ({ request }) => {
    const id = fx.b.borrador.listingId;
    const before = await rowDigest(owner, id);
    const put = await request.put(`${API}/${id}/draft`, { headers: tma(as(A6)), data: { content: { name: ATTACK_NAME, municipalityId: (await owner.query("select id from app.municipalities limit 1")).rows[0].id }, confirmed: true } });
    expect(put.status()).toBe(403);
    expect((await put.json()).code).toBe("forbidden");
    const post = await request.post(`${API}/${id}/submission`, { headers: tma(as(A6)), data: { confirmed: true, thirdPartyAuthorizationDeclared: true } });
    expect(post.status()).toBe(403);
    expect((await post.json()).code).toBe("forbidden");
    expect(await rowDigest(owner, id)).toEqual(before);
    expect((await owner.query("select count(*)::int as n from app.listing_versions where name = $1", [ATTACK_NAME])).rows[0].n).toBe(0);
  });
});

test.describe("criterio 22: sesión vencida y errores", () => {
  test("con initData vencido las 4 pantallas muestran session-error sin revelar si el ID existe", async ({ page }) => {
    const expired = signInitData({ userId: A6, authDate: Math.floor(Date.now() / 1000) - 3 * 86400 });
    const screens: string[] = [];
    for (const path of ["/fichas", `/fichas/${fx.b.borrador.listingId}`, `/fichas/${UNKNOWN}`, `/fichas/${fx.b.borrador.listingId}/editar`]) {
      await open(page, expired, path);
      await expect(page.getByTestId("session-error"), path).toHaveText(SESSION_EXPIRED);
      await expect(page.getByTestId("listing-forbidden"), path).toHaveCount(0);
      expectNoForeign(await page.locator("main").innerHTML(), path);
      screens.push((await page.getByTestId("session-error").innerText()).trim());
    }
    expect(new Set(screens).size).toBe(1);
  });

  test("con la lectura de la ficha de B interceptada como 500 se muestra listError, no el acceso denegado ni el detalle técnico", async ({ page }) => {
    await page.route(`**${API}/${fx.b.borrador.listingId}`, (route) =>
      route.fulfill({ status: 500, contentType: "application/problem+json", body: JSON.stringify({ type: "about:blank", title: "Error", status: 500, code: "internal", detail: "detalle técnico secreto" }) }),
    );
    await open(page, as(A6), `/fichas/${fx.b.borrador.listingId}`);
    await expect(page.getByTestId("listing-load-error")).toHaveText(LIST_ERROR);
    await expect(page.getByTestId("listing-forbidden")).toHaveCount(0);
    expect(await page.content()).not.toContain("detalle técnico secreto");
  });
});

test.describe("criterio 23b: colores y accesibilidad", () => {
  test("M04 y las pantallas de acceso denegado usan solo la paleta; el aviso es role alert con #1F3A33 sobre fondo claro", async ({ page }) => {
    const palette = new Set(["#659287", "#3F6B5F", "#88BDA4", "#B1D3B9", "#E6F2DD", "#C1FF72", "#1F3A33", "#FFFFFF", "transparent"]);
    const light = new Set(["#E6F2DD", "#B1D3B9", "#88BDA4", "#C1FF72", "#FFFFFF"]);
    const hex = (css: string) => {
      const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return css;
      if (m[4] !== undefined && Number(m[4]) === 0) return "transparent";
      return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
    };
    const audit = async (label: string) => {
      const colors = await page.locator("body *").evaluateAll((elements) => {
        const out: { tag: string; prop: string; value: string }[] = [];
        for (const el of elements) {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          if (style.display === "none" || style.visibility === "hidden" || (rect.width === 0 && rect.height === 0)) continue;
          for (const prop of ["color", "backgroundColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"] as const) {
            out.push({ tag: el.tagName.toLowerCase() + (el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""), prop, value: style[prop] });
          }
        }
        return out;
      });
      expect(colors.filter((c) => !palette.has(hex(c.value))).map((c) => `${label} ${c.tag} ${c.prop} ${c.value}`)).toEqual([]);
    };
    await open(page, as(A6));
    await expect(page.locator('[data-testid^="listing-row-"]')).toHaveCount(3);
    await audit("M04");
    for (const path of [`/fichas/${fx.b.borrador.listingId}`, `/fichas/${fx.b.borrador.listingId}/editar`]) {
      await open(page, as(A6), path);
      const notice = page.getByTestId("listing-forbidden");
      await expect(notice).toHaveText(FORBIDDEN);
      await expect(notice).toHaveAttribute("role", "alert");
      await audit(path);
      const style = await notice.evaluate((el) => {
        let node: Element | null = el;
        let background = "rgba(0, 0, 0, 0)";
        while (node && /rgba\(0, 0, 0, 0\)|transparent/.test((background = getComputedStyle(node).backgroundColor))) node = node.parentElement;
        return { color: getComputedStyle(el).color, background };
      });
      expect(hex(style.color), path).toBe("#1F3A33");
      expect(light.has(hex(style.background)), `${path} fondo ${style.background}`).toBe(true);
    }
  });
});
