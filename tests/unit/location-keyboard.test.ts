import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLocationKeyboard } from "@/bot/location-keyboard";
import { es } from "@/bot/texts/es";

// F021, criterios 10, 12 y 14.
const URL_OK = "https://maps.app.goo.gl/AbCdEf123";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("criterio 10: botón de ubicación", () => {
  it("un solo botón de tipo url con el texto y el enlace exactos", () => {
    expect(buildLocationKeyboard(URL_OK).inline_keyboard).toEqual([[{ text: "Ver ubicación", url: URL_OK }]]);
  });
  for (const [name, value] of [["vacío", ""], ["solo espacios", "   "], ["otro sitio", "https://ejemplo.invalid/mapa"], ["número", 123], ["null", null]] as const)
    it(`lanza Error con un enlace ${name}`, () => expect(() => buildLocationKeyboard(value)).toThrow(Error));
});

describe("criterio 12: el texto vive en es.ts", () => {
  it("es.location.button es «Ver ubicación» y el teclado lo toma de ahí", () => {
    expect(es.location.button).toBe("Ver ubicación");
    expect(buildLocationKeyboard(URL_OK).inline_keyboard[0][0].text).toBe(es.location.button);
    expect(read("src/bot/location-keyboard.ts")).not.toContain("Ver ubicación");
  });
});

describe("criterio 14: el teclado no llama a Google (invariante 6)", () => {
  const code = read("src/bot/location-keyboard.ts").replace(/\/\/.*$/gm, "");
  it("no contiene cadenas prohibidas", () => {
    for (const banned of ["fetch", "node:http", "node:https", "axios", "undici", "googleapis", "XMLHttpRequest", "got", "node-fetch", "https://"])
      expect(code, banned).not.toMatch(new RegExp(`(?<![\\w.])${banned.replace(/[:/]/g, "\\$&")}(?![\\w])`));
    expect(code).not.toContain("process.env");
  });
});
