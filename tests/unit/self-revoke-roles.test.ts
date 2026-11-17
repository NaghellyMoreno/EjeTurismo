import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";

// F035: textos nuevos (criterio 37), código retirado (criterio 34) y literales `adm:` del bot (criterio 18).
const NEW_KEYS = ["confirmProvider", "confirmAdmin", "confirmProviderAdmin", "principalProtected", "lastAdminProtected"] as const;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
const root = process.cwd();

describe("textos nuevos de selfRevoke (criterio 37)", () => {
  it("ninguno lleva dígitos ni la palabra código; el del principal lo nombra; ninguno se llama Revocar rol", () => {
    for (const key of NEW_KEYS) {
      const text = es.selfRevoke[key];
      expect(text, key).not.toMatch(/\d/);
      expect(text.toLowerCase(), key).not.toContain("código");
      expect(text, key).not.toContain("Revocar rol");
      expect(key.toLowerCase()).not.toContain("revocarrol");
    }
    expect(es.selfRevoke.principalProtected).toContain("administrador principal");
    expect(es.selfRevoke.button).not.toBe(es.revoke.button);
  });

  it("cada confirmación dice qué se pierde", () => {
    expect(es.selfRevoke.confirmProvider).toContain("rol de prestador");
    expect(es.selfRevoke.confirmAdmin).toContain("rol de administrador");
    expect(es.selfRevoke.confirmProviderAdmin).toContain("dos roles");
    expect(es.selfRevoke.confirmAdmin).not.toContain("número de identidad");
  });
});

describe("código retirado (criterio 34)", () => {
  it("has_active_role, selfRevoke.blocked, selfRevoke.activeRole y hasActiveRole no se emiten en src/bot, services ni handlers", () => {
    const files = [
      ...sourceFiles(resolve(root, "src/bot")),
      ...sourceFiles(resolve(root, "src/server/services")),
      resolve(root, "src/server/http/handlers.ts"),
    ];
    const found = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return ["has_active_role", "selfRevoke.blocked", "selfRevoke.activeRole", "hasActiveRole"].filter((needle) => text.includes(needle)).map((needle) => `${file}: ${needle}`);
    });
    expect(found).toEqual([]);
    expect(Object.keys(es.selfRevoke)).not.toContain("blocked");
    expect(Object.keys(es.selfRevoke)).not.toContain("activeRole");
  });
});

describe("literales adm: del bot (criterio 18)", () => {
  // Cada literal `adm:` declarado en src/bot debe estar en esta lista, que la prueba de bot recorre con los botones antiguos.
  const KNOWN = ["adm:", "adm:v", "adm:vl", "adm:vp:", "adm:vs:", "adm:vc:", "adm:vx:", "adm:list", "adm:a:", "adm:r:", "adm:ca:", "adm:cr:", "adm:x:"];

  it("ningún literal adm: nuevo queda fuera de la lista probada", () => {
    const literals = sourceFiles(resolve(root, "src/bot")).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/"(adm:[a-z]*:?)"/g)].map((m) => m[1]));
    expect(literals.length).toBeGreaterThan(10);
    expect(literals.filter((literal) => !KNOWN.includes(literal))).toEqual([]);
  });
});
