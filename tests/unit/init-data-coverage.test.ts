import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_OPERATION_IDS, PROTECTED_OPERATIONS, UNKNOWN_ID, specOperations } from "../helpers/protected-operations";

// F009, criterios 18 y 23: ninguna ruta de /api/v1 queda fuera de la matriz de initData, y las reglas de importación.
const ROOT = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

// Excepciones explícitas: públicas o con otro secreto (`/api/health` está fuera de /api/v1).
const EXCEPTIONS = new Set(["GET /api/v1/privacy-notices/current", "POST /api/v1/telegram/webhook"]);

const templated = (path: string) => path.replace(/\/\{\w+\}/g, `/${UNKNOWN_ID}`);
const routeFiles = walk(join(ROOT, "src/app/api/v1")).filter((f) => f.endsWith(`${sep}route.ts`));
const routes = routeFiles.flatMap((file) => {
  const path = "/api/" + relative(join(ROOT, "src/app/api"), file).split(sep).slice(0, -1).join("/").replace(/\[(\w+)\]/g, "{$1}");
  const methods = [...readFileSync(file, "utf8").matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  return methods.map((method) => ({ key: `${method} ${path}`, method, path }));
});
const matrixKeys = new Set(PROTECTED_OPERATIONS.map((o) => `${o.method} ${o.path}`));

describe("F009 criterio 18: cobertura estructural de rutas", () => {
  it("el conjunto de operaciones protegidas es exactamente el de las 29 del contrato (23 de F009, 2 de F012 y 4 de F013)", () => {
    expect(PROTECTED_OPERATIONS).toHaveLength(29);
    expect(PROTECTED_OPERATIONS.map((o) => o.operationId).sort()).toEqual([...EXPECTED_OPERATION_IDS].sort());
  });

  it("cada ruta con route.ts está en la matriz o en la lista de excepciones (falla con el nombre de la ruta)", () => {
    const missing = routes.filter((r) => !EXCEPTIONS.has(r.key) && !matrixKeys.has(`${r.method} ${templated(r.path)}`)).map((r) => r.key);
    expect(missing, `Rutas sin probar con initData: ${missing.join(", ")}`).toEqual([]);
  });

  it("cada operación del openapi con rol protegido y ruta existente está en la matriz", () => {
    const routeKeys = new Set(routes.map((r) => r.key));
    const NOT_INITDATA = new Set(["public", "telegram_platform", "vercel_cron"]);
    const expected = specOperations
      .filter((o) => !o.roles.every((r) => NOT_INITDATA.has(r)) && routeKeys.has(`${o.method} ${o.path}`))
      .map((o) => o.operationId);
    expect(expected.sort()).toEqual(PROTECTED_OPERATIONS.map((o) => o.operationId).sort());
  });

  it("cada entrada de la matriz corresponde a una operación del openapi con su método y ruta", () => {
    for (const op of PROTECTED_OPERATIONS) {
      const found = specOperations.find((s) => s.operationId === op.operationId);
      expect(found, op.operationId).toBeDefined();
      expect(`${found!.method} ${templated(found!.path)}`).toBe(`${op.method} ${op.path}`);
    }
  });

  it("las excepciones existen como ruta y /api/health es público en el openapi", () => {
    for (const key of EXCEPTIONS) expect(routes.map((r) => r.key)).toContain(key);
    expect(specOperations.find((o) => o.path === "/api/health")?.roles).toEqual(["public"]);
  });
});

describe("F009 criterio 23: reglas sobre el código fuente", () => {
  const sources = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
  const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
  const text = new Map(sources.map((f) => [rel(f), readFileSync(f, "utf8")]));
  const moduleRef = /from\s+["'](?:@\/server\/auth\/init-data|(?:\.{1,2}\/)+(?:server\/)?auth\/init-data|\.\/init-data)["']/;

  it("(a) initDataUnsafe no aparece en src", () => {
    expect([...text].filter(([, t]) => t.includes("initDataUnsafe")).map(([f]) => f)).toEqual([]);
  });

  it("(b) solo handlers.ts y bot.ts importan el módulo de initData; el bot solo toma displayNameOf", () => {
    const files = [...text].filter(([f, t]) => f !== "src/server/auth/init-data.ts" && moduleRef.test(t)).map(([f]) => f).sort();
    expect(files).toEqual(["src/bot/bot.ts", "src/server/http/handlers.ts"]);
    const bot = text.get("src/bot/bot.ts")!;
    const botImports = [...bot.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/server\/auth\/init-data["']/g)].flatMap((m) =>
      m[1].split(",").map((s) => s.trim()).filter(Boolean),
    );
    expect(botImports).toEqual(["displayNameOf"]);
    expect([...text].filter(([f, t]) => f.startsWith("src/miniapp/") && moduleRef.test(t))).toEqual([]);
  });

  it("el token del bot solo se lee de la configuración (TELEGRAM_BOT_TOKEN solo en config/index.ts)", () => {
    expect([...text].filter(([, t]) => t.includes("TELEGRAM_BOT_TOKEN")).map(([f]) => f)).toEqual(["src/server/config/index.ts"]);
  });
});
