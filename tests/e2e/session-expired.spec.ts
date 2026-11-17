import { expect, type Page, test } from "@playwright/test";
import type { Pool } from "pg";
import { createAccount } from "../factories/accounts";
import { grantAdminRole } from "../factories/review";
import { ownerPool, resetDb } from "../helpers/db";
import { signInitData } from "../helpers/telegram";
import { miniappTexts } from "@/miniapp/texts";

// F009, criterio 24: las tres rutas de la Mini App con initData vencido (más de 24 h) muestran solo session-error.
const ADMIN = 900000808;
const ROUTES = ["/", "/municipios", "/catalogos"] as const;
const FORBIDDEN_TEST_IDS = [
  "municipality-list", "municipalities-link", "catalog-link", "catalog-list-categories", "catalog-item",
  "role-admin", "role-provider", "register-hint", "role-revoked", "registration-pending", "consent-required",
];

let owner: Pool;
test.beforeAll(() => void (owner = ownerPool()));
test.afterAll(() => owner.end());
test.beforeEach(async () => {
  await resetDb(owner);
  await createAccount(owner, ADMIN);
  await grantAdminRole(owner, ADMIN);
});

async function open(page: Page, initData: string, path: string) {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: `window.Telegram = { WebApp: { initData: ${JSON.stringify(initData)}, ready() {} } };` }),
  );
  await page.goto(path);
}

for (const path of ROUTES) {
  test(`24: ${path} con initData vencido muestra solo session-error`, async ({ page }) => {
    await open(page, signInitData({ userId: ADMIN, authDate: Math.floor(Date.now() / 1000) - 2 * 86400 }), path);
    await expect(page.getByTestId("session-error")).toHaveText(miniappTexts.sessionExpired);
    for (const id of FORBIDDEN_TEST_IDS) await expect(page.getByTestId(id), id).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/401|unauthenticated|problem|error/i);
  });
}
