import { expect, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { es } from "@/bot/texts/es";
import { createAccount, createOldVersionAccount, PERSON_PRINCIPAL } from "../factories/accounts";
import { grantAdminRole, makeProvider, pendingFor } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { signInitData } from "../helpers/telegram";

// F005, criterios 23 a 29: la Mini App muestra solo lo que informa getMe, comparado con los textos aprobados.
const PROVIDER = 900000061;
const ADMIN = 900000062;
const NO_ROLE = 900000063;
const PENDING = 900000064;
const REJECTED = 900000065;
const OLD_NOTICE = 900000067;

const TEXT = {
  "role-provider": "Ya tienes el rol de prestador. Las opciones de prestador estarán disponibles pronto.",
  "role-admin": "Eres administrador. Las opciones de administración se usan desde el bot de Telegram.",
  "register-hint": "Para registrarte como prestador, escribe /start en el bot de Telegram y pulsa «Registrarme como prestador».",
  "role-revoked": "Tu rol de prestador fue revocado y ya no tienes acceso a las opciones de prestador. Si tienes dudas, comunícate con el administrador.",
  "registration-pending": "Tu registro como prestador queda a la espera de autorización del administrador.",
  "session-error": "Tu sesión venció o no se pudo verificar. Cierra la Mini App y ábrela de nuevo desde el bot.",
} as const;
type Key = keyof typeof TEXT;

let owner: Pool;
test.beforeAll(() => void (owner = ownerPool()));
test.afterAll(() => owner.end());
test.beforeEach(() => resetDb(owner));

// Sustituye el script que entrega Telegram por un `Telegram.WebApp` simulado con el initData dado.
async function open(page: Page, initData: string) {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto("/");
  await expect(page.getByTestId("miniapp-home")).toBeVisible();
}

// Solo existe el elemento esperado, con su texto exacto; ninguno de los demás.
async function expectOnly(page: Page, key: Key) {
  await expect(page.getByTestId(key)).toHaveText(TEXT[key]);
  for (const other of Object.keys(TEXT) as Key[]) {
    if (other !== key) await expect(page.getByTestId(other)).toHaveCount(0);
  }
}

test("23: la cuenta de prestador ve solo role-provider", async ({ page }) => {
  await makeProvider(owner, PROVIDER);
  await open(page, signInitData({ userId: PROVIDER }));
  await expectOnly(page, "role-provider");
});

test("24: el administrador autorizado y el principal ven solo role-admin", async ({ page }) => {
  await createAccount(owner, ADMIN);
  await grantAdminRole(owner, ADMIN);
  await createAccount(owner, PERSON_PRINCIPAL);
  for (const id of [ADMIN, PERSON_PRINCIPAL]) {
    await open(page, signInitData({ userId: id }));
    await expectOnly(page, "role-admin");
    // F010 (D-120): el inicio del administrador agrega el enlace a M10 y conserva el texto de role-admin.
    await expect(page.getByTestId("municipalities-link")).toHaveText("Administrar municipios");
  }
});

test("25: sin rol y sin registro ve solo register-hint, sin botón ni enlace", async ({ page }) => {
  await createAccount(owner, NO_ROLE);
  await open(page, signInitData({ userId: NO_ROLE }));
  await expectOnly(page, "register-hint");
  // F036 (criterio 40): M02 trae el botón de revocar; no hay otro botón ni enlace.
  await expect(page.getByTestId("miniapp-home").getByRole("button")).toHaveText([es.selfRevoke.button]);
  await expect(page.getByTestId("miniapp-home").getByRole("link")).toHaveCount(0);
});

test("26: registro pendiente ve registration-pending; rechazado ve register-hint", async ({ page }) => {
  await pendingFor(owner, PENDING);
  await pendingFor(owner, REJECTED, { status: "rejected" });
  await open(page, signInitData({ userId: PENDING }));
  await expectOnly(page, "registration-pending");
  await open(page, signInitData({ userId: REJECTED }));
  await expectOnly(page, "register-hint");
});

test("27: decide solo por getMe en cada carga y no guarda datos de rol", async ({ page }) => {
  await makeProvider(owner, PROVIDER);
  const initData = signInitData({ userId: PROVIDER });
  await open(page, initData);
  await expectOnly(page, "role-provider");
  await owner.query("update app.role_grants set revoked_at = now() where telegram_user_id = $1", [PROVIDER]);
  await open(page, initData);
  // F006, criterio 20 (D-125): tras la revocación aparece role-revoked con su texto, y no role-provider, role-admin ni register-hint.
  await expectOnly(page, "role-revoked");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

// F036 (criterio 40): con el aviso pendiente se ve M01 (el aviso con "Acepto" y "No acepto"), sin ninguna vista de rol.
test("28: con el aviso pendiente solo se ve el aviso (M01)", async ({ page }) => {
  for (const id of [OLD_NOTICE, 900000068]) {
    if (id === OLD_NOTICE) await createOldVersionAccount(owner, OLD_NOTICE);
    await open(page, signInitData({ userId: id }));
    await expect(page.getByTestId("notice-body")).toBeVisible();
    await expect(page.getByRole("button", { name: es.notice.accept, exact: true })).toBeVisible();
    for (const other of Object.keys(TEXT) as Key[]) await expect(page.getByTestId(other)).toHaveCount(0);
  }
});

test.describe("29: sesión no verificable", () => {
  const cases: [string, () => string][] = [
    ["sin initData", () => ""],
    ["firma inválida", () => signInitData({ userId: PROVIDER, token: "9:otro" })],
    ["auth_date vencido", () => signInitData({ userId: PROVIDER, authDate: Math.floor(Date.now() / 1000) - 3 * 86400 })],
  ];
  for (const [name, initData] of cases) {
    test(name, async ({ page }) => {
      await makeProvider(owner, PROVIDER);
      await open(page, initData());
      await expectOnly(page, "session-error");
      await expect(page.getByTestId("miniapp-home")).not.toContainText(/401|unauthorized|error:/i);
    });
  }
});

// F009, criterio 17: apertura normal y alteración del ID de usuario después de firmar.
test.describe("F009-17: initData válido y alterado", () => {
  test("válido: muestra el inicio del rol y ningún error de sesión", async ({ page }) => {
    await makeProvider(owner, PROVIDER);
    await open(page, signInitData({ userId: PROVIDER }));
    await expectOnly(page, "role-provider");
    await expect(page.getByTestId("session-error")).toHaveCount(0);
  });

  test("ID de usuario cambiado después de firmar: solo session-error y ninguna opción de rol", async ({ page }) => {
    await makeProvider(owner, PROVIDER);
    await createAccount(owner, ADMIN);
    await grantAdminRole(owner, ADMIN);
    await open(page, signInitData({ userId: PROVIDER, tamperUserId: ADMIN }));
    await expectOnly(page, "session-error");
    await expect(page.getByTestId("municipalities-link")).toHaveCount(0);
    await expect(page.getByTestId("catalog-link")).toHaveCount(0);
  });
});
