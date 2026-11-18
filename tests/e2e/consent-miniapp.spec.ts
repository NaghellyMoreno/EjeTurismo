import { expect, type Page, type Route, test } from "@playwright/test";
import type { Pool } from "pg";
import { es } from "@/bot/texts/es";
import { homeViewText } from "@/miniapp/home";
import { miniappTexts } from "@/miniapp/texts";
import { buildNoticeMessages } from "@/lib/notice";
import { createAccount, createOldVersionAccount, PERSON_PRINCIPAL } from "../factories/accounts";
import { grantAdminRole, makeProvider } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { signInitData } from "../helpers/telegram";

// F036: aviso (M01), inicio con revocar (M02) y confirmación (M03) en la Mini App, con `Telegram.WebApp` simulado.
// Cuentas ficticias propias del e2e (no se importan helpers de integración: arrastran next/server).
const NEW_PERSON = 900000371;
const NO_ROLE = 900000372;
const PROVIDER = 900000373;
const ADMIN = 900000374;
const OTHER_ADMIN = 900000375;
const BOTH = 900000376;
const OLD = 900000377;
const OLD_ADMIN = 900000378;
const NAME = "Persona Prueba";
const NUMBER = "7700036101";
const OLD_VERSION = "2026-10-v1";

let owner: Pool;
test.beforeAll(async ({ request }) => {
  owner = ownerPool();
  await request.get("/", { timeout: 60_000 });
});
test.afterAll(() => owner.end());
test.beforeEach(() => resetDb(owner));

const rows = async (sql: string, params: unknown[] = []) => (await owner.query(sql, params)).rows;
const accountOf = async (id: number) => (await rows("select id from app.accounts where telegram_user_id = $1", [id]))[0]?.id as string | undefined;

// Instantánea: contenido de todas las tablas del esquema `app`, ordenado.
async function snapshot(): Promise<Record<string, string>> {
  const tables = (await rows("select table_name from information_schema.tables where table_schema = 'app' and table_type = 'BASE TABLE' order by 1")).map((r) => r.table_name as string);
  const out: Record<string, string> = {};
  for (const table of tables) {
    out[table] = (await rows(`select coalesce(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text), '') as s from app."${table}" t`))[0].s;
  }
  return out;
}

// Número de filas del esquema `app` que mencionan el texto en cualquier columna (texto, bytea o jsonb).
async function mentions(needle: string): Promise<number> {
  const tables = (await rows("select table_name from information_schema.tables where table_schema = 'app' and table_type = 'BASE TABLE'")).map((r) => r.table_name as string);
  let total = 0;
  for (const table of tables) total += Number((await rows(`select count(*) from app."${table}" t where row_to_json(t)::text like $1`, [`%${needle}%`]))[0].count);
  return total;
}

async function makeOld(id: number, name = NAME) {
  await createOldVersionAccount(owner, id);
  await owner.query("update app.accounts set telegram_display_name = $2 where telegram_user_id = $1", [id, name]);
}

// Abre la Mini App con el `initData` dado y espera a que termine de cargar; devuelve las peticiones a la API hechas desde la página.
async function open(page: Page, initData: string) {
  const requests: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/api/")) requests.push(`${r.method()} ${url.pathname}`);
  });
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto("/");
  await settled(page);
  return requests;
}
const as = (id: number) => signInitData({ userId: id, firstName: NAME });
const settled = async (page: Page) => {
  await expect(page.getByTestId("miniapp-home")).toBeVisible();
  await expect(page.getByText(miniappTexts.loading)).toHaveCount(0);
};
const writes = (requests: string[]) => requests.filter((r) => !r.startsWith("GET "));

const body = (page: Page) => page.getByTestId("notice-body");
const accept = (page: Page) => page.getByRole("button", { name: es.notice.accept, exact: true });
const decline = (page: Page) => page.getByRole("button", { name: es.notice.decline, exact: true });
const revokeButton = (page: Page) => page.getByRole("button", { name: es.selfRevoke.button, exact: true });
const yes = (page: Page) => page.getByRole("button", { name: es.selfRevoke.confirmButton, exact: true });
const no = (page: Page) => page.getByRole("button", { name: es.selfRevoke.cancelButton, exact: true });
const homeText = (page: Page) => page.getByTestId("miniapp-home").innerText();

async function currentNoticeText(): Promise<string> {
  const row = (await rows("select body_markdown, declaration_text, published_at from app.privacy_notice_versions where is_current"))[0];
  return buildNoticeMessages({ bodyMarkdown: row.body_markdown, declarationText: row.declaration_text, publishedAt: row.published_at }).join("\n\n");
}

// Publica una segunda versión del aviso (copia del texto vigente) como la vigente.
async function publishNewVersion() {
  await owner.query("update app.privacy_notice_versions set is_current = false");
  await owner.query(
    "insert into app.privacy_notice_versions (version, body_markdown, declaration_text, revocation_note, is_current) select '2026-12-v1', body_markdown, declaration_text, revocation_note, true from app.privacy_notice_versions where version = '2026-11-v3'",
  );
}

const problem = (status: number, code: string) => ({
  status,
  contentType: "application/problem+json",
  body: JSON.stringify({ type: "about:blank", title: "Error", status, code }),
});

// ---- Paso 1: aviso antes de cualquier otro paso ------------------------------------------------------------------------
test.describe("paso 1: aviso antes de todo", () => {
  test("1 y 2: la persona sin cuenta ve solo M01 con el mismo texto del bot", async ({ page }) => {
    await open(page, as(NEW_PERSON));
    await expect(body(page)).toHaveText(await currentNoticeText());
    await expect(accept(page)).toBeVisible();
    await expect(decline(page)).toBeVisible();
    await expect(page.getByTestId("miniapp-home").getByRole("link")).toHaveCount(0);
    await expect(revokeButton(page)).toHaveCount(0);
    await expect(page.getByTestId("self-revoke-note")).toHaveCount(0);
    for (const id of ["register-hint", "role-admin", "role-provider", "registration-pending", "role-revoked"]) await expect(page.getByTestId(id)).toHaveCount(0);
    const text = await body(page).innerText();
    expect(text).toContain("2026-11-v3");
    expect(text).not.toMatch(/\[(Confirmado|Inferido|Pendiente)|\[fecha de publicación/);
  });

  test("2 y 4: la cuenta con versión anterior ve M01 con el botón y la frase debajo, sin opciones de rol", async ({ page }) => {
    await makeOld(OLD);
    await open(page, as(OLD));
    await expect(body(page)).toHaveText(await currentNoticeText());
    await expect(page.getByTestId("self-revoke-note")).toHaveText(es.selfRevoke.note);
    await expect(revokeButton(page)).toBeVisible();
    for (const id of ["register-hint", "role-admin", "role-provider", "registration-pending", "role-revoked", "municipalities-link"]) await expect(page.getByTestId(id)).toHaveCount(0);
    // La frase y el botón van después de la declaración en el DOM.
    const order = await page.evaluate(() => {
      const doc = document;
      const bodyEl = doc.querySelector('[data-testid="notice-body"]')!;
      const note = doc.querySelector('[data-testid="self-revoke-note"]')!;
      const button = doc.querySelector('[data-testid="self-revoke-button"]')!;
      return [bodyEl.compareDocumentPosition(note), note.compareDocumentPosition(button)].map((p) => Boolean(p & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(order).toEqual([true, true]);
  });

  test("3: abrir y recargar M01 no escribe nada; solo salen GET /me y GET del aviso", async ({ page }) => {
    const before = await snapshot();
    const requests = await open(page, as(NEW_PERSON));
    await page.reload();
    await settled(page);
    expect(new Set(requests)).toEqual(new Set(["GET /api/v1/me", "GET /api/v1/privacy-notices/current"]));
    expect(await snapshot()).toEqual(before);
  });

  test("5: si el aviso o getMe fallan se muestra noticeError, sin botones de aceptar y sin escribir", async ({ page }) => {
    const before = await snapshot();
    for (const [url, status] of [["**/api/v1/privacy-notices/current", 404], ["**/api/v1/privacy-notices/current", 500], ["**/api/v1/me", 500]] as const) {
      await page.route(url, (route) => route.fulfill(problem(status, status === 404 ? "not_found" : "internal_error")));
      await open(page, as(NEW_PERSON));
      await expect(page.getByTestId("notice-error")).toHaveText(miniappTexts.noticeError);
      await expect(accept(page)).toHaveCount(0);
      await expect(decline(page)).toHaveCount(0);
      await page.unroute(url);
    }
    expect(await snapshot()).toEqual(before);
  });
});

// ---- Paso 2: "No acepto" ----------------------------------------------------------------------------------------------
test.describe("paso 2: No acepto no guarda nada", () => {
  test("6 y 7: No acepto muestra declined sin peticiones que escriban; Volver a ver el aviso y recargar muestran M01", async ({ page }) => {
    const before = await snapshot();
    const requests = await open(page, as(NEW_PERSON));
    await decline(page).click();
    await expect(page.getByTestId("declined")).toHaveText(miniappTexts.declined);
    await expect(page.getByRole("button", { name: es.decline.showAgain, exact: true })).toBeVisible();
    expect(writes(requests)).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(await rows("select 1 from app.accounts where telegram_user_id = $1", [NEW_PERSON])).toEqual([]);
    await page.getByRole("button", { name: es.decline.showAgain, exact: true }).click();
    await expect(body(page)).toHaveText(await currentNoticeText());
    await page.reload();
    await settled(page);
    await expect(accept(page)).toBeVisible();
    expect(writes(requests)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  test("8: No acepto desde una cuenta con versión anterior no cambia nada", async ({ page }) => {
    await makeOld(OLD_ADMIN);
    await grantAdminRole(owner, OLD_ADMIN);
    const before = await snapshot();
    const requests = await open(page, as(OLD_ADMIN));
    await decline(page).click();
    await expect(page.getByTestId("declined")).toBeVisible();
    expect(writes(requests)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });
});

// ---- Paso 3: aceptar --------------------------------------------------------------------------------------------------
test.describe("paso 3: aceptar y dejar la constancia", () => {
  test("9: Acepto crea la cuenta, un evento accepted con canal mini_app y acceptedAt igual a occurred_at", async ({ page }) => {
    await open(page, as(NEW_PERSON));
    const started = Date.now();
    const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/v1/consents") && r.request().method() === "POST"), accept(page).click()]);
    expect(response.status()).toBe(201);
    const me = (await response.json()) as { consent: { acceptedAt: string } };
    await expect(page.getByTestId("register-hint")).toHaveText(homeViewText["register-hint"]);
    expect(await accountOf(NEW_PERSON)).toBeDefined();
    const events = await rows("select channel, notice_version, occurred_at from app.consent_events where event = 'accepted'");
    expect(events).toHaveLength(1);
    expect(events[0].channel).toBe("mini_app");
    expect(events[0].notice_version).toBe("2026-11-v3");
    expect(Math.abs(events[0].occurred_at.getTime() - started)).toBeLessThan(5000 + 1000);
    expect(new Date(me.consent.acceptedAt).getTime()).toBe(events[0].occurred_at.getTime());
  });

  test("11: doble clic envía una sola petición y deja una sola cuenta y un solo evento", async ({ page }) => {
    const requests = await open(page, as(NEW_PERSON));
    await accept(page).dblclick();
    await expect(page.getByTestId("register-hint")).toBeVisible();
    expect(requests.filter((r) => r === "POST /api/v1/consents")).toHaveLength(1);
    expect(await rows("select 1 from app.accounts where telegram_user_id = $1", [NEW_PERSON])).toHaveLength(1);
    expect(await rows("select 1 from app.consent_events where event = 'accepted'")).toHaveLength(1);
  });

  test("11: recargar mientras la respuesta está retenida deja una cuenta, un evento y M02", async ({ page }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let served: () => void = () => undefined;
    const serverResponded = new Promise<void>((resolve) => (served = resolve));
    await page.route("**/api/v1/consents", async (route: Route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      served();
      await gate;
      await route.fulfill({ response }).catch(() => undefined);
    });
    await open(page, as(NEW_PERSON));
    await accept(page).click();
    await serverResponded;
    await page.reload();
    release();
    await settled(page);
    await expect(page.getByTestId("register-hint")).toBeVisible();
    await expect(accept(page)).toHaveCount(0);
    expect(await rows("select 1 from app.accounts where telegram_user_id = $1", [NEW_PERSON])).toHaveLength(1);
    expect(await rows("select 1 from app.consent_events where event = 'accepted'")).toHaveLength(1);
  });

  test("12: Acepto en una cuenta con versión anterior actualiza la versión, conserva el rol y muestra la vista del rol", async ({ page }) => {
    await makeOld(OLD_ADMIN);
    await grantAdminRole(owner, OLD_ADMIN);
    await open(page, as(OLD_ADMIN));
    await accept(page).click();
    await expect(page.getByTestId("role-admin")).toHaveText(homeViewText["role-admin"]);
    expect(await rows("select consent_notice_version from app.accounts where telegram_user_id = $1", [OLD_ADMIN])).toEqual([{ consent_notice_version: "2026-11-v3" }]);
    expect(await rows("select channel, notice_version from app.consent_events where event = 'accepted'")).toEqual([{ channel: "mini_app", notice_version: "2026-11-v3" }]);
    expect(await rows("select role from app.role_grants where telegram_user_id = $1 and revoked_at is null", [OLD_ADMIN])).toEqual([{ role: "admin" }]);
  });

  test("13: si el aviso vigente cambia antes de pulsar Acepto, se vuelve a pedir y no se guarda nada", async ({ page }) => {
    const requests = await open(page, as(NEW_PERSON));
    await publishNewVersion();
    await accept(page).click();
    await expect(accept(page)).toBeVisible();
    await expect(accept(page)).toBeEnabled();
    expect(requests.filter((r) => r === "GET /api/v1/privacy-notices/current")).toHaveLength(2);
    expect(await rows("select 1 from app.accounts")).toEqual([]);
    expect(await rows("select 1 from app.consent_events")).toEqual([]);
    await accept(page).click();
    await expect(page.getByTestId("register-hint")).toBeVisible();
    expect(await rows("select consent_notice_version from app.accounts")).toEqual([{ consent_notice_version: "2026-12-v1" }]);
  });

  test("14: 401 al aceptar muestra la sesión vencida y 500 muestra acceptError sin dejar la cuenta a medias", async ({ page }) => {
    await open(page, as(NEW_PERSON));
    await page.route("**/api/v1/consents", (route) => (route.request().method() === "POST" ? route.fulfill(problem(401, "unauthenticated")) : route.continue()));
    await accept(page).click();
    await expect(page.getByTestId("session-error")).toHaveText(miniappTexts.sessionExpired);
    await expect(accept(page)).toHaveCount(0);
    expect(await rows("select 1 from app.accounts")).toEqual([]);
    await page.unroute("**/api/v1/consents");
    await page.reload();
    await settled(page);
    await page.route("**/api/v1/consents", (route) => (route.request().method() === "POST" ? route.fulfill(problem(500, "internal_error")) : route.continue()));
    await accept(page).click();
    await expect(page.getByTestId("flash")).toHaveText(miniappTexts.acceptError);
    await expect(accept(page)).toBeEnabled();
    expect(await rows("select 1 from app.accounts")).toEqual([]);
    expect(await rows("select 1 from app.consent_events")).toEqual([]);
    await page.unroute("**/api/v1/consents");
    await accept(page).click();
    await expect(page.getByTestId("register-hint")).toBeVisible();
  });

  test("16: quien aceptó en el bot ve M02 sin pasar por M01", async ({ page }) => {
    await createAccount(owner, NO_ROLE);
    await open(page, as(NO_ROLE));
    await expect(page.getByTestId("register-hint")).toBeVisible();
    await expect(accept(page)).toHaveCount(0);
    await expect(page.getByTestId("notice")).toHaveCount(0);
  });
});

// ---- Paso 5: revocar desde M02 ----------------------------------------------------------------------------------------
type Variant = { name: string; seed: () => Promise<void>; id: number; view: keyof typeof homeViewText; confirm: string };
const variants: Variant[] = [
  { name: "sin rol", id: NO_ROLE, view: "register-hint", confirm: es.selfRevoke.confirm, seed: async () => void (await createAccount(owner, NO_ROLE)) },
  { name: "prestador", id: PROVIDER, view: "role-provider", confirm: es.selfRevoke.confirmProvider, seed: async () => void (await makeProvider(owner, PROVIDER, NUMBER)) },
  {
    name: "administrador común",
    id: ADMIN,
    view: "role-admin",
    confirm: es.selfRevoke.confirmAdmin,
    seed: async () => {
      await createAccount(owner, ADMIN);
      await grantAdminRole(owner, ADMIN);
      await createAccount(owner, OTHER_ADMIN);
      await grantAdminRole(owner, OTHER_ADMIN);
    },
  },
  {
    name: "ambos roles",
    id: BOTH,
    view: "role-admin",
    confirm: es.selfRevoke.confirmProviderAdmin,
    seed: async () => {
      await makeProvider(owner, BOTH, "7700036102");
      await grantAdminRole(owner, BOTH);
      await createAccount(owner, OTHER_ADMIN);
      await grantAdminRole(owner, OTHER_ADMIN);
    },
  },
];

test.describe("paso 5: el botón y la frase en M02", () => {
  const protectedVariants = [
    { name: "administrador principal", id: PERSON_PRINCIPAL, seed: async () => void (await createAccount(owner, PERSON_PRINCIPAL)) },
    {
      name: "único administrador",
      id: ADMIN,
      seed: async () => {
        await createAccount(owner, ADMIN);
        await grantAdminRole(owner, ADMIN);
      },
    },
  ];
  for (const v of [...variants, ...protectedVariants]) {
    test(`17: ${v.name} ve el botón y la frase de D-023 junto a su vista`, async ({ page }) => {
      await v.seed();
      await open(page, as(v.id));
      const note = (await rows("select revocation_note from app.privacy_notice_versions where is_current"))[0].revocation_note as string;
      await expect(page.getByTestId("self-revoke-note")).toHaveText(es.selfRevoke.note);
      // D-143: la frase de D-023 se muestra con punto final, igual que revocation_note del aviso vigente.
      expect(note).toBe(es.selfRevoke.note);
      await expect(revokeButton(page)).toBeVisible();
      await expect(accept(page)).toHaveCount(0);
      if ("view" in v) {
        const view = v.view as keyof typeof homeViewText;
        await expect(page.getByTestId(view)).toHaveText(homeViewText[view]);
      }
    });
  }

  test("18: con sesión inválida se muestra M12 y ningún aviso ni botón; M01 de quien no tiene cuenta no muestra revocar", async ({ page }) => {
    const bad: [string, string][] = [
      ["sin initData", ""],
      ["firma inválida", signInitData({ userId: NO_ROLE, token: "9:otro" })],
      ["vencido", signInitData({ userId: NO_ROLE, authDate: Math.floor(Date.now() / 1000) - 3 * 86400 })],
    ];
    await createAccount(owner, NO_ROLE);
    for (const [name, initData] of bad) {
      await page.unroute("https://telegram.org/js/telegram-web-app.js").catch(() => undefined);
      await open(page, initData);
      await expect(page.getByTestId("session-error"), name).toHaveText(miniappTexts.sessionExpired);
      for (const id of ["notice", "notice-body", "self-revoke-note", "self-revoke-button"]) await expect(page.getByTestId(id), name).toHaveCount(0);
      await expect(accept(page)).toHaveCount(0);
      await expect(decline(page)).toHaveCount(0);
    }
  });

  test("19 y 38: colores, contraste, foco y teclado de los botones de revocar y de aceptar", async ({ page }) => {
    await createAccount(owner, NO_ROLE);
    await open(page, as(NO_ROLE));
    const style = (testId: string) =>
      page.getByTestId(testId).evaluate((el) => {
        const s = getComputedStyle(el);
        let bg: Element | null = el;
        while (bg && getComputedStyle(bg).backgroundColor === "rgba(0, 0, 0, 0)") bg = bg.parentElement;
        return { color: s.color, background: s.backgroundColor, behind: bg ? getComputedStyle(bg).backgroundColor : "", outlineStyle: s.outlineStyle };
      });
    const lum = (css: string) => {
      const [r, g, b] = (css.match(/\d+/g) ?? []).slice(0, 3).map((n) => {
        const c = Number(n) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const button = await style("self-revoke-button");
    expect([button.background, button.color]).toEqual(["rgb(63, 107, 95)", "rgb(255, 255, 255)"]);
    expect(contrast(button.background, button.color)).toBeGreaterThanOrEqual(4.5);
    const note = await style("self-revoke-note");
    expect(note.color).toBe("rgb(31, 58, 51)");
    expect(note.behind).toBe("rgb(177, 211, 185)");
    expect(contrast(note.color, note.behind)).toBeGreaterThanOrEqual(4.5);
    // Teclado: Tab hasta el botón (único control), foco visible y Enter lo activa.
    await page.keyboard.press("Tab");
    await expect(revokeButton(page)).toBeFocused();
    expect((await style("self-revoke-button")).outlineStyle).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("self-revoke-confirm")).toBeVisible();
  });

  test("38: los botones y el texto del aviso usan los colores de la identidad visual", async ({ page }) => {
    await open(page, as(NEW_PERSON));
    const colors = await page.evaluate(() => {
      const css = (id: string) => getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!);
      return { accept: [css("notice-accept").backgroundColor, css("notice-accept").color], text: css("notice-body").color };
    });
    expect(colors.accept).toEqual(["rgb(63, 107, 95)", "rgb(255, 255, 255)"]);
    expect(colors.text).toBe("rgb(31, 58, 51)");
  });

  test("39: accesibilidad: región con encabezado antes de los botones, aria-live y orden de foco", async ({ page }) => {
    await makeOld(OLD);
    await open(page, as(OLD));
    await expect(page.getByRole("region", { name: miniappTexts.title })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(miniappTexts.title);
    expect(await page.getByTestId("miniapp-home").getAttribute("aria-live")).toBe("polite");
    const headingFirst = await page.evaluate(() => {
      const h = document.querySelector("h1")!;
      const region = document.querySelector('[role="region"]')!;
      const buttons = [...document.querySelectorAll("button")];
      return Boolean(h.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING) && buttons.every((b) => Boolean(region.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(headingFirst).toBe(true);
    const focused: string[] = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Tab");
      focused.push(await page.evaluate(() => document.activeElement?.textContent ?? ""));
    }
    expect(focused).toEqual([es.notice.accept, es.notice.decline, es.selfRevoke.button]);
  });
});

// ---- Paso 6 y 7: cancelar y confirmar ---------------------------------------------------------------------------------
test.describe("paso 6: cancelar no cambia nada", () => {
  for (const v of variants) {
    test(`20 a 22: ${v.name}: la confirmación dice lo que se pierde y Cancelar vuelve al inicio sin cambios`, async ({ page }) => {
      await v.seed();
      const before = await snapshot();
      const requests = await open(page, as(v.id));
      await revokeButton(page).click();
      await expect(page.getByTestId("self-revoke-confirm")).toHaveText(v.confirm);
      await expect(yes(page)).toBeVisible();
      await expect(no(page)).toBeVisible();
      expect(writes(requests)).toEqual([]);
      expect(await snapshot()).toEqual(before);
      await no(page).click();
      await expect(page.getByTestId("flash")).toHaveText(es.selfRevoke.cancelled);
      await expect(page.getByTestId(v.view)).toBeVisible();
      await expect(revokeButton(page)).toBeVisible();
      expect(writes(requests)).toEqual([]);
      expect(await snapshot()).toEqual(before);
    });
  }
});

test.describe("paso 7: confirmar y mismos efectos que el bot", () => {
  const noTrace = async (id: number) => {
    expect(await accountOf(id)).toBeUndefined();
    for (const [table, column] of [["bot_sessions", "account_id"], ["role_grants", "telegram_user_id"], ["rate_limit_counters", "account_id"]] as const) {
      const value = column === "account_id" ? "(select id from app.accounts where telegram_user_id = $1)" : "$1";
      expect(await rows(`select 1 from app.${table} where ${column} = ${value}`, [id]), table).toEqual([]);
    }
  };

  test("23: cuenta sin rol: una sola petición, el message de la respuesta y ningún botón; queda la prueba revoked sin datos", async ({ page }) => {
    await createAccount(owner, NO_ROLE);
    await owner.query("insert into app.bot_sessions (account_id, data) select id, '{}' from app.accounts where telegram_user_id = $1", [NO_ROLE]);
    const requests = await open(page, as(NO_ROLE));
    await revokeButton(page).click();
    const started = Date.now();
    const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/v1/consents/revocations")), yes(page).click()]);
    expect(response.request().postDataJSON()).toEqual({ confirmed: true });
    const result = (await response.json()) as { message: string };
    await expect(page.getByTestId("self-revoke-done")).toHaveText(result.message);
    expect(result.message).toBe(es.selfRevoke.revoked);
    await expect(page.getByTestId("miniapp-home").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("miniapp-home").getByRole("link")).toHaveCount(0);
    expect(requests.filter((r) => r === "POST /api/v1/consents/revocations")).toHaveLength(1);
    await noTrace(NO_ROLE);
    const events = await rows("select channel, notice_version, occurred_at from app.consent_events where event = 'revoked'");
    expect(events).toHaveLength(1);
    expect(events[0].channel).toBe("mini_app");
    expect(events[0].notice_version).toBe("2026-11-v3");
    expect(Math.abs(events[0].occurred_at.getTime() - started)).toBeLessThan(5000);
    expect(JSON.stringify(await rows("select * from app.consent_events"))).not.toContain(String(NO_ROLE));
  });

  test("24: prestador aprobado: se borra el registro y el número, el cifrado y el sello no quedan en ninguna tabla ni se ven", async ({ page }) => {
    await makeProvider(owner, PROVIDER, NUMBER);
    const [stored] = await rows("select encode(identity_number_encrypted, 'hex') as enc, encode(identity_number_hash, 'hex') as hash from app.provider_registrations");
    const needles = [NUMBER, stored.enc as string, stored.hash as string];
    expect(await mentions(stored.enc as string)).toBeGreaterThan(0);
    await open(page, as(PROVIDER));
    expect(await homeText(page)).not.toMatch(new RegExp(`${NUMBER}|cédula|documento`, "i"));
    await revokeButton(page).click();
    expect(await homeText(page)).not.toContain(NUMBER);
    await yes(page).click();
    await expect(page.getByTestId("self-revoke-done")).toBeVisible();
    await noTrace(PROVIDER);
    expect(await rows("select 1 from app.provider_registrations")).toEqual([]);
    for (const needle of needles) expect(await mentions(needle), needle.slice(0, 12)).toBe(0);
    expect(await homeText(page)).not.toContain(NUMBER);
  });

  test("25: administrador común y cuenta con ambos roles: se borran todos sus permisos y no cambian los de los demás", async ({ page }) => {
    for (const v of variants.filter((x) => x.id === ADMIN || x.id === BOTH)) {
      await resetDb(owner);
      await v.seed();
      const others = await rows("select * from app.role_grants where telegram_user_id = $1", [OTHER_ADMIN]);
      await open(page, as(v.id));
      await revokeButton(page).click();
      await yes(page).click();
      await expect(page.getByTestId("self-revoke-done")).toHaveText(es.selfRevoke.revoked);
      await noTrace(v.id);
      expect(await rows("select * from app.role_grants where telegram_user_id = $1", [OTHER_ADMIN])).toEqual(others);
      expect(await rows("select 1 from app.accounts where telegram_user_id = $1", [OTHER_ADMIN])).toHaveLength(1);
    }
  });

  test("27: principal (con y sin fila), único administrador y principal único: se muestra el motivo, vuelve el inicio y no cambia nada", async ({ page }) => {
    const cases: { name: string; seed: () => Promise<void>; id: number; text: string; view: string }[] = [
      { name: "principal sin fila", id: PERSON_PRINCIPAL, text: es.selfRevoke.principalProtected, view: "role-admin", seed: async () => void (await createAccount(owner, PERSON_PRINCIPAL)) },
      {
        name: "principal con fila",
        id: PERSON_PRINCIPAL,
        text: es.selfRevoke.principalProtected,
        view: "role-admin",
        seed: async () => {
          await createAccount(owner, PERSON_PRINCIPAL);
          await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values ($1, 'admin', true)", [PERSON_PRINCIPAL]);
          await createAccount(owner, OTHER_ADMIN);
          await grantAdminRole(owner, OTHER_ADMIN);
        },
      },
      {
        name: "único administrador",
        id: ADMIN,
        text: es.selfRevoke.lastAdminProtected,
        view: "role-admin",
        seed: async () => {
          await createAccount(owner, ADMIN);
          await grantAdminRole(owner, ADMIN);
        },
      },
      {
        name: "principal y único",
        id: PERSON_PRINCIPAL,
        text: es.selfRevoke.principalProtected,
        view: "role-admin",
        seed: async () => {
          await createAccount(owner, PERSON_PRINCIPAL);
          await owner.query("insert into app.role_grants (telegram_user_id, role, is_principal) values ($1, 'admin', true)", [PERSON_PRINCIPAL]);
        },
      },
    ];
    for (const c of cases) {
      await resetDb(owner);
      await c.seed();
      const before = await snapshot();
      await open(page, as(c.id));
      await revokeButton(page).click();
      await yes(page).click();
      await expect(page.getByTestId("flash"), c.name).toHaveText(c.text);
      await expect(page.getByTestId(c.view), c.name).toBeVisible();
      await expect(revokeButton(page), c.name).toBeVisible();
      expect(await accountOf(c.id), c.name).toBeDefined();
      expect(await snapshot(), c.name).toEqual(before);
    }
  });

  test("28: 401 muestra la sesión vencida; 500 muestra selfRevoke.error, la cuenta queda intacta y se puede reintentar", async ({ page }) => {
    await createAccount(owner, NO_ROLE);
    await open(page, as(NO_ROLE));
    const before = await snapshot();
    await page.route("**/api/v1/consents/revocations", (route) => route.fulfill(problem(500, "internal_error")));
    await revokeButton(page).click();
    await yes(page).click();
    await expect(page.getByTestId("self-revoke-error")).toHaveText(es.selfRevoke.error);
    expect(await homeText(page)).not.toMatch(/500|internal|problem/i);
    expect(await snapshot()).toEqual(before);
    await expect(yes(page)).toBeEnabled();
    await page.unroute("**/api/v1/consents/revocations");
    await page.route("**/api/v1/consents/revocations", (route) => route.fulfill(problem(401, "unauthenticated")));
    await yes(page).click();
    await expect(page.getByTestId("session-error")).toHaveText(miniappTexts.sessionExpired);
    expect(await snapshot()).toEqual(before);
    await page.unroute("**/api/v1/consents/revocations");
    await page.reload();
    await settled(page);
    await revokeButton(page).click();
    await yes(page).click();
    await expect(page.getByTestId("self-revoke-done")).toBeVisible();
  });

  test("29: doble clic en Sí, revocar envía una sola petición y deja un solo evento revoked", async ({ page }) => {
    await createAccount(owner, NO_ROLE);
    const requests = await open(page, as(NO_ROLE));
    await revokeButton(page).click();
    await yes(page).dblclick();
    await expect(page.getByTestId("self-revoke-done")).toBeVisible();
    expect(requests.filter((r) => r === "POST /api/v1/consents/revocations")).toHaveLength(1);
    expect(await rows("select 1 from app.consent_events where event = 'revoked'")).toHaveLength(1);
  });
});

// ---- Paso 8: volver a abrir --------------------------------------------------------------------------------------------
test("30: tras revocar, volver a abrir muestra M01 sin el botón; Acepto crea una cuenta nueva sin rol", async ({ page }) => {
  await createAccount(owner, ADMIN);
  await grantAdminRole(owner, ADMIN);
  await createAccount(owner, OTHER_ADMIN);
  await grantAdminRole(owner, OTHER_ADMIN);
  await open(page, as(ADMIN));
  await revokeButton(page).click();
  await yes(page).click();
  await expect(page.getByTestId("self-revoke-done")).toBeVisible();
  const afterRevoke = await snapshot();
  await page.reload();
  await settled(page);
  await expect(body(page)).toHaveText(await currentNoticeText());
  await expect(revokeButton(page)).toHaveCount(0);
  await expect(page.getByTestId("self-revoke-note")).toHaveCount(0);
  expect(await snapshot()).toEqual(afterRevoke);
  await accept(page).click();
  await expect(page.getByTestId("register-hint")).toBeVisible();
  await expect(page.getByTestId("role-admin")).toHaveCount(0);
  expect(await rows("select 1 from app.role_grants where telegram_user_id = $1", [ADMIN])).toEqual([]);
  expect(await rows("select 1 from app.provider_registrations")).toEqual([]);
});

// ---- Cuenta con versión anterior que revoca ---------------------------------------------------------------------------
test.describe("43: cuenta con versión anterior que revoca en la Mini App", () => {
  test("sin rol: confirmar con el texto común, cancelar vuelve a M01 y confirmar revoca con la versión anterior", async ({ page }) => {
    await makeOld(OLD);
    const before = await snapshot();
    const requests = await open(page, as(OLD));
    await revokeButton(page).click();
    await expect(page.getByTestId("self-revoke-confirm")).toHaveText(es.selfRevoke.confirm);
    expect(writes(requests)).toEqual([]);
    await no(page).click();
    await expect(page.getByTestId("flash")).toHaveText(es.selfRevoke.cancelled);
    await expect(accept(page)).toBeVisible();
    await expect(page.getByTestId("register-hint")).toHaveCount(0);
    expect(await snapshot()).toEqual(before);
    await revokeButton(page).click();
    const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/v1/consents/revocations")), yes(page).click()]);
    expect(response.request().postDataJSON()).toEqual({ confirmed: true });
    await expect(page.getByTestId("self-revoke-done")).toHaveText(es.selfRevoke.revoked);
    await expect(page.getByTestId("miniapp-home").getByRole("button")).toHaveCount(0);
    expect(await accountOf(OLD)).toBeUndefined();
    expect(await rows("select channel, notice_version from app.consent_events where event = 'revoked'")).toEqual([{ channel: "mini_app", notice_version: OLD_VERSION }]);
  });

  test("principal y único administrador con versión anterior: se muestra el motivo, vuelve a M01 y no cambia nada", async ({ page }) => {
    for (const [id, text, seed] of [
      [PERSON_PRINCIPAL, es.selfRevoke.principalProtected, async () => void (await makeOld(PERSON_PRINCIPAL))],
      [OLD_ADMIN, es.selfRevoke.lastAdminProtected, async () => (await makeOld(OLD_ADMIN), await grantAdminRole(owner, OLD_ADMIN))],
    ] as const) {
      await resetDb(owner);
      await seed();
      const before = await snapshot();
      await open(page, as(id));
      await revokeButton(page).click();
      await yes(page).click();
      await expect(page.getByTestId("flash")).toHaveText(text);
      await expect(accept(page)).toBeVisible();
      await expect(revokeButton(page)).toBeVisible();
      expect(await snapshot()).toEqual(before);
    }
  });
});

// ---- Transversal: textos visibles sin códigos ni datos de la persona ---------------------------------------------------
test("32: ninguna pantalla pide un código ni muestra fecha, número, ID, nombre o documento (salvo el cuerpo del aviso)", async ({ page }) => {
  const forbidden = [/código/i, /\d{4,}/, /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/, /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i, new RegExp(String(OLD)), /Persona Prueba/, new RegExp(NUMBER)];
  const check = async (label: string) => {
    let text = await homeText(page);
    const notice = page.getByTestId("notice-body");
    if (await notice.count()) {
      // El cuerpo y la declaración del aviso se comparan con el bot; solo se revisa que no pidan un código ni traigan datos de la persona.
      const noticeText = await notice.innerText();
      expect(noticeText, `${label} (aviso)`).not.toMatch(/Persona Prueba|7700036101|900000377/);
      text = text.replace(noticeText, "");
    }
    for (const pattern of forbidden) expect(text, `${label}: ${pattern}`).not.toMatch(pattern);
  };
  await makeOld(OLD);
  await open(page, as(OLD));
  await check("M01 versión anterior");
  await decline(page).click();
  await check("declined");
  await page.getByRole("button", { name: es.decline.showAgain, exact: true }).click();
  await revokeButton(page).click();
  await check("confirmación");
  await no(page).click();
  await check("cancelada");
  await revokeButton(page).click();
  await yes(page).click();
  await check("revocada");
  await page.reload();
  await settled(page);
  await check("M01 sin cuenta");
  await accept(page).click();
  await check("M02");
  await revokeButton(page).click();
  await check("confirmación M02");
});
