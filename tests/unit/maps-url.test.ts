import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isGoogleMapsUrl } from "@/server/domain/maps-url";

// F012, criterio 4: validador único del enlace de Google Maps (ADR 0016, D-044).
describe("isGoogleMapsUrl: aceptados", () => {
  for (const url of [
    "https://www.google.com/maps/place/X",
    "https://google.com/maps/x",
    "https://maps.google.com/?q=1",
    "https://maps.app.goo.gl/AbCdEf123",
    "https://goo.gl/maps/AbC",
  ]) {
    it(url, () => expect(isGoogleMapsUrl(url)).toBe(true));
  }
  it("2048 caracteres exactos con host válido", () => {
    const url = `https://maps.app.goo.gl/${"a".repeat(2048 - "https://maps.app.goo.gl/".length)}`;
    expect(url).toHaveLength(2048);
    expect(isGoogleMapsUrl(url)).toBe(true);
  });
});

describe("isGoogleMapsUrl: rechazados", () => {
  const cases: [string, string][] = [
    ["http en maps.google.com", "http://maps.google.com/maps"],
    ["http en google.com", "http://www.google.com/maps/place/X"],
    ["http en maps.app.goo.gl", "http://maps.app.goo.gl/AbC"],
    ["http en goo.gl", "http://goo.gl/maps/AbC"],
    ["búsqueda de google.com", "https://www.google.com/search?q=1"],
    ["raíz de google.com (ruta que no empieza por /maps)", "https://www.google.com/"],
    ["ruta /mapsfalso", "https://www.google.com/mapsfalso"],
    ["goo.gl con otra ruta", "https://goo.gl/otra"],
    ["host con sufijo engañoso", "https://maps.google.com.ejemplo.invalid/maps"],
    ["host con prefijo engañoso", "https://evilmaps.google.com.invalid/maps"],
    ["usuario y contraseña", "https://usuario:clave@maps.google.com/maps"],
    ["solo usuario", "https://usuario@maps.google.com/maps"],
    ["puerto", "https://maps.google.com:8443/maps"],
    ["javascript:", "javascript:alert(1)"],
    ["ftp:", "ftp://maps.google.com/maps"],
    ["texto que no es URL", "no es una url"],
    ["cadena vacía", ""],
    ["otro dominio", "https://ejemplo.invalid/mapa"],
    ["más de 2048 caracteres con host válido", `https://maps.app.goo.gl/${"a".repeat(2049 - "https://maps.app.goo.gl/".length)}`],
  ];
  for (const [name, url] of cases) it(name, () => expect(isGoogleMapsUrl(url)).toBe(false));
});

describe("el módulo no llama a ninguna API (invariante 6)", () => {
  const source = readFileSync(resolve(process.cwd(), "src/server/domain/maps-url.ts"), "utf8");
  const code = source.replace(/\/\/.*$/gm, "");
  it("no importa clientes HTTP", () => {
    expect(code).not.toMatch(/^\s*import\b/m);
    for (const banned of ["fetch", "node:http", "node:https", "axios", "undici", "googleapis", "XMLHttpRequest", "got", "node-fetch"]) {
      expect(code, banned).not.toMatch(new RegExp(`(?<![\\w.])${banned.replace(/[:/]/g, "\\$&")}(?![\\w])`));
    }
  });
  it("no referencia process.env", () => expect(code).not.toContain("process.env"));
});
