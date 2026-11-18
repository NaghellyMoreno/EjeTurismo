import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// F014, criterio 27 (independencia, invariante 6, y ADR 0013): los módulos nuevos solo hablan con Telegram y la base,
// y la Mini App no importa código de src/server.
const ROOT = process.cwd();
const NEW_MODULES = [
  "src/server/services/listing-review.ts",
  "src/server/domain/review.ts",
  "src/bot/review.ts",
  "src/app/api/v1/reviews/route.ts",
  "src/app/api/v1/reviews/[versionId]/route.ts",
  "src/app/api/v1/reviews/[versionId]/approval/route.ts",
  "src/app/api/v1/reviews/[versionId]/rejection/route.ts",
];
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

describe("criterio 27: estructura", () => {
  it("ningún módulo nuevo importa un cliente HTTP de terceros ni llama a servicios externos", () => {
    for (const file of NEW_MODULES) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
      expect(source, file).not.toMatch(/from\s+["'](axios|got|node-fetch|undici|superagent|ky|node:https?|https?)["']/);
      expect(source, file).not.toMatch(/https?:\/\//);
    }
  });

  it("la Mini App no importa código de src/server", () => {
    for (const file of walk(join(ROOT, "src/miniapp")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/from\s+["']@\/server\//);
    }
  });
});
