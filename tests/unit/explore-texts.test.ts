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
      for (const l of removed) expect(l, `${file}: ${l}`).toMatch(/Revocar mi autorización|registerButton|selfRevoke\.button|myListings|revoke\.button|MENU_BUTTONS|buttons|keyboardOf/i);
    }
  });
});
