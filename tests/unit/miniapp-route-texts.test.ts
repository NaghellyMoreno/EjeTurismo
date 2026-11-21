import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listingTexts as t } from "@/miniapp/texts";

// F018, criterio 26: textos de la Mini App para la ruta o experiencia (D-170) y colores de los estilos.
const NEW_TEXTS: Record<string, string> = {
  "form.kindLegend": "¿Qué vas a registrar?",
  "form.kindEstablishment": "Establecimiento",
  "form.kindRoute": "Ruta o experiencia",
  "form.titleNewRoute": "Nueva ficha de ruta o experiencia",
  "form.experienceTypeLabel": "Tipo de experiencia",
  "form.experienceTypePlaceholder": "Elige un tipo de experiencia",
  "form.guidesInfoLabel": "Datos del guía (opcional)",
  "form.guidesInfoHint": "Escribe el nombre y el contacto del guía, si lo hay.",
  "required.experienceTypeId": "Elige un tipo de experiencia.",
};
const FORBIDDEN = ["Submit", "Save", "Cancel", "Required", "Error", "Experience type", "Guide", "Type", "Loading", "Route"];
const get = (path: string) => path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], t);
const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("textos de F018", () => {
  it("(a) cada texto nuevo existe como cadena no vacía", () => {
    for (const path of Object.keys(NEW_TEXTS)) {
      const value = get(path);
      expect(typeof value, path).toBe("string");
      expect((value as string).trim().length, path).toBeGreaterThan(0);
    }
  });

  it("(b) ninguno contiene el símbolo de párrafo ni una cadena prohibida como palabra completa", () => {
    for (const path of Object.keys(NEW_TEXTS)) {
      const value = get(path) as string;
      expect(value, path).not.toContain("§");
      for (const word of FORBIDDEN) expect(value, `${path} ${word}`).not.toMatch(new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, "iu"));
    }
  });

  it("(c) los valores coinciden letra por letra con la lista aprobada en D-170", () => {
    for (const [path, expected] of Object.entries(NEW_TEXTS)) expect(get(path), path).toBe(expected);
  });
});

describe("estilos de F018", () => {
  it("(d) todos los colores hexadecimales de src están en la lista de siete colores de CLAUDE.md (más el blanco)", () => {
    const allowed = new Set(["659287", "3f6b5f", "88bda4", "b1d3b9", "e6f2dd", "c1ff72", "1f3a33", "fff", "ffffff"]);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(css|tsx?)$/.test(name)) files.push(path);
      }
    };
    walk("src/miniapp");
    walk("src/app");
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const hexes = readFileSync(file, "utf8").match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      for (const hex of hexes) expect(allowed.has(hex.slice(1).toLowerCase()), `${file} ${hex}`).toBe(true);
    }
  });
});
