import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";

// F022, criterios 14, 15, 16 y 17: textos en es.ts, sin estado de módulo, sin integraciones y menús existentes.
const source = readFileSync(resolve(process.cwd(), "src/bot/explore.ts"), "utf8");
const code = source
  .split("\n")
  .filter((line) => !/^\s*(\/\/|import\b)/.test(line))
  .map((line) => line.replace(/\s\/\/.*$/, ""))
  .join("\n");

describe("criterio 14: textos en es.ts", () => {
  it("existen y no están vacíos", () => {
    expect(es.explore.chooseMunicipality).toBeTruthy();
    expect(es.explore.chooseCategory("Municipio")).toContain("Municipio");
    expect(es.explore.listHeader("Municipio", "Categoría")).toContain("Categoría");
    expect(es.explore.empty("Municipio", "Categoría")).toContain("Municipio");
    expect(es.explore.noMunicipalities).toBeTruthy();
    expect(es.explore.more).toBeTruthy();
    expect(es.explore.stale).toBeTruthy();
    expect(es.explore.back).toBeTruthy();
    expect(es.menu.exploreButton).toBe("Explorar");
  });

  it("explore.ts no tiene cadenas con acentos, ñ ni frases (salvo el prefijo exp:)", () => {
    const literals = code.match(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g) ?? [];
    const visible = literals.filter((literal) => !/^["'`]exp:/.test(literal));
    for (const literal of visible) {
      expect(literal, literal).not.toMatch(/[áéíóúüñÁÉÍÓÚÜÑ]/);
      expect(literal, literal).not.toMatch(/\p{L}+\s+\p{L}+/u);
    }
  });
});

describe("criterio 15: sin estado en memoria", () => {
  it("explore.ts no declara let, var ni colecciones mutables a nivel de módulo", () => {
    expect(code).not.toMatch(/^(let|var)\s/m);
    expect(code).not.toMatch(/^(export\s+)?const\s+\w+\s*(:[^=]+)?=\s*(new\s+(Map|Set)\(|\[\s*\]|\{\s*\})/m);
  });
});

describe("criterio 16: sin integración", () => {
  it("explore.ts solo importa grammY y el repositorio y no usa fetch ni cadenas de Google", () => {
    const imports = [...source.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
    for (const spec of imports) expect(spec, spec).toMatch(/^(grammy|@\/server\/|\.\/)/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code.toLowerCase()).not.toMatch(/google|maps\.app|axios|http:\/\/|https:\/\//);
  });
});

describe("criterio 17: menús existentes", () => {
  const START = "f2f41afbf63f96e2611c6c19c71f524d6f1569da";
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const ALLOWED = new Set(
    ["menu-by-role", "provider-registration", "provider-review", "authorize-admin", "form-cancel-errors", "revoke-role", "privacy-notice", "review", "self-revoke", "self-revoke-roles"].map((name) => `tests/bot/${name}.test.ts`),
  );
  ALLOWED.add("tests/helpers/bot.ts");
  // D-168: archivos de prueba modificados por 94647bb y 8bf8192
  ALLOWED.add("tests/e2e/listings.spec.ts");
  ALLOWED.add("tests/unit/webhook.test.ts");
  // D-172: archivos de prueba modificados por F018
  ALLOWED.add("tests/integration/listing-create.test.ts");
  ALLOWED.add("tests/unit/miniapp-listing-texts.test.ts");
  // D-173 y D-175: pruebas ajustadas por F018 y F020
  ALLOWED.add("tests/integration/review-database.test.ts");
  ALLOWED.add("tests/integration/listing-history.test.ts");
  ALLOWED.add("tests/bot/listing-history.test.ts");
  // F030: B16 muestra "Solicitar información" y acceptsRequests se calcula; la operación nueva entra a la matriz y el reinicio vacía la tabla nueva.
  for (const file of ["tests/bot/explore-detail.test.ts", "tests/unit/listing-detail.test.ts", "tests/helpers/explore.ts", "tests/helpers/db.ts", "tests/helpers/protected-operations.ts", "tests/unit/init-data-coverage.test.ts", "tests/unit/f013-matrix.test.ts"]) ALLOWED.add(file);

  // F032 (D-189): la migración nueva y las 4 rutas nuevas rompen estas guardas (orden de migraciones, conteos de la matriz de operaciones
  // protegidas y de acceso denegado, TRUNCATE y el criterio 20 de F024).
  for (const file of ["tests/helpers/role-denial.ts", "tests/unit/role-routes-structure.test.ts", "tests/integration/role-access-denied.test.ts", "tests/integration/provider-no-admin.test.ts", "tests/integration/experience-type-filter.test.ts"]) ALLOWED.add(file);

  // D-204: pruebas que exigían menu.providerAvailable.
  for (const file of ["tests/bot/provider-requests.test.ts", "tests/bot/provider-no-admin.test.ts", "tests/bot/listing-isolation.test.ts", "tests/unit/listing-isolation-texts.test.ts", "tests/unit/miniapp-home.test.ts", "tests/e2e/home.spec.ts", "tests/e2e/provider-no-admin.spec.ts"]) ALLOWED.add(file);

  // D-206 (autorizado por la usuaria): pruebas e2e de la Mini App ajustadas a la barra inferior, la pestaña Cuenta, el inicio del
  // prototipo y el formulario por pasos. Se permite borrar líneas en ellas, pero no bajar el número de it( o test(.
  const D206 = new Set(["attraction", "catalog", "consent-miniapp", "home", "listing-edit-published", "listings", "maps-location", "municipalities", "provider-no-admin", "review"].map((name) => `tests/e2e/${name}.spec.ts`));
  for (const file of D206) ALLOWED.add(file);

  const F032_GUARDS = new Set(["tests/helpers/protected-operations.ts", "tests/helpers/role-denial.ts", "tests/integration/review-database.test.ts", "tests/unit/f013-matrix.test.ts", "tests/unit/init-data-coverage.test.ts", "tests/unit/role-routes-structure.test.ts", "tests/integration/role-access-denied.test.ts", "tests/integration/provider-no-admin.test.ts", "tests/integration/experience-type-filter.test.ts"]);
  const F032_REMOVED = [
    "registrationId: (ID|id), grantId", "Operaciones de rol con ruta", "ADMIN_OPERATION_IDS, \"createListing\"", "UNROUTED_OPERATION_IDS", "listMyBusinessInformationRequests", "^-\\];",
    "draftVersionId", "PHOTO_OPERATION_IDS", "existe y es posterior a 20261118100000", "files\\.", "la matriz de F009 tiene 38", "toHaveLength\\(\\d+\\)", "ROLE_DENIAL_OPERATIONS tiene 31",
    "las operaciones de rol", "el conjunto de operaciones protegidas", "los casos de ROLE_CASES", "las 27 con ruta", "27 operaciones", "toBe\\(81\\)", "280 casos", "28 filas", "4 a 6 y 8",
    "F012, F013 y F014", "PROTECTED_OPERATIONS\\.filter", "const expected", "Las 4 operaciones de rol sin",
  ].join("|");

  const exists = () => {
    try {
      git("cat-file", "-e", `${START}^{commit}`);
      return true;
    } catch {
      return false; // copia sin historial: no hay contra qué comparar
    }
  };

  it("solo se modifican los archivos permitidos y solo para sumar Explorar", () => {
    if (!exists()) return;
    const changed = git("diff", "--name-status", START, "--", "tests/").split("\n").filter(Boolean);
    for (const line of changed) {
      const [status, file] = line.split("\t");
      if (status === "A") continue;
      expect(status, line).toBe("M");
      expect(ALLOWED.has(file), `archivo no permitido: ${file}`).toBe(true);
      const count = (text: string) => (text.match(/\b(it|test)\(/g) ?? []).length;
      expect(count(readFileSync(resolve(process.cwd(), file), "utf8")), file).toBeGreaterThanOrEqual(count(git("show", `${START}:${file}`)));
      const removed = git("diff", "-U0", START, "--", file).split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
      // D-172: líneas que F018 reemplaza en las pruebas de crear ficha (la clase ruta o experiencia ya es válida)
      const f018 = file === "tests/integration/listing-create.test.ts" || file === "tests/unit/miniapp-listing-texts.test.ts" ? "|parseEstablishmentCreate|field: \"kind\", code: \"invalid\"" : "";
      // D-173 y D-175: el it( reescrito de review-database y las fechas fijas de listing-history
      const d175 = file === "tests/integration/review-database.test.ts" ? "|existe y es posterior a 20261118100000|files\\.length|files\\.indexOf\\(NAME\\)" : file.endsWith("listing-history.test.ts") ? "|2026-11-21T0" : "";
      // F030: los dos TRUNCATE de tests/helpers/db.ts ganan `app.information_requests` (referencia fichas, negocios y cuentas).
      const f030 = file === "tests/helpers/db.ts" ? "|truncate app\\.listing_photos" : "";
      // D-185: el conteo de operaciones protegidas pasa de 38 a 39 en las dos pruebas de la matriz
      const f185 = file === "tests/unit/f013-matrix.test.ts" || file === "tests/unit/init-data-coverage.test.ts" ? "|operaciones protegidas es exactamente el de las 38|la matriz de F009 tiene 38|toHaveLength\\(38\\)" : "";
      // F032 (D-189): líneas que cambian por los conteos de la matriz, el orden de migraciones y el criterio 20 de F024.
      const f032 = F032_GUARDS.has(file) ? `|${F032_REMOVED}` : "";
      // D-204: el bot ya no envía menu.providerAvailable después del menú del prestador; se retiran sus aserciones.
      const d204 = "|providerAvailable|Ya tienes el rol de prestador|providerMenu = \\[noRoleMenu|reply_markup\\).toBeUndefined";
      const d206 = D206.has(file) ? "|." : "";
      const allowedRemoved = new RegExp(`Revocar mi autorización|registerButton|selfRevoke\\.button|myListings|revoke\\.button|MENU_BUTTONS|buttons|keyboardOf${f018}${d175}${f030}${f185}${f032}${d204}${d206}`, "i");
      for (const l of removed) expect(l, `${file}: ${l}`).toMatch(allowedRemoved);
    }
  });
});
