import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_NAME_MAX, normalizeName, parseCatalogName } from "@/server/domain/catalogs";
import { catalogTexts } from "@/miniapp/texts";

describe("normalizeName (D-118; F011 criterio 13)", () => {
  it("ignora mayúsculas, espacios de los extremos y tildes", () => {
    expect(normalizeName("  CÚLTURA  ")).toBe(normalizeName("cultura"));
    expect(normalizeName("Cultúra")).toBe("cultura");
  });
  it("junta los espacios repetidos en uno", () => {
    expect(normalizeName("Cul  tura")).toBe("cul tura");
    expect(normalizeName("Cul \t tura")).toBe("cul tura");
  });
  it("no mezcla nombres distintos", () => {
    expect(normalizeName("Cultura")).not.toBe(normalizeName("Cul tura"));
    expect(normalizeName("Café")).toBe("cafe");
  });
});

describe("parseCatalogName (D-118, D-119; F011 criterio 23)", () => {
  it("recorta los extremos y conserva el resto tal cual", () => {
    expect(parseCatalogName("  Naturaleza  ")).toEqual({ name: "Naturaleza" });
    expect(parseCatalogName("Cul  tura")).toEqual({ name: "Cul  tura" });
  });
  it.each([
    ["", "required"],
    ["   ", "required"],
    ["Cultura\u0007", "control_characters"],
    ["Cul\ntura", "control_characters"],
    [123, "invalid_type"],
    [undefined, "invalid_type"],
    [null, "invalid_type"],
    ["a".repeat(CATALOG_NAME_MAX + 1), "too_long"],
  ])("rechaza %j", (input, problem) => {
    expect(parseCatalogName(input)).toEqual({ problem });
  });
  it("admite exactamente 100 caracteres", () => {
    expect(parseCatalogName("a".repeat(100))).toEqual({ name: "a".repeat(100) });
  });
});

describe("contrato sin crear desde una ficha (criterio 11)", () => {
  it("api/openapi.yaml no tiene categoryName ni experienceTypeName", () => {
    const source = readFileSync(resolve(process.cwd(), "api/openapi.yaml"), "utf8");
    expect(source).not.toMatch(/categoryName|experienceTypeName/);
  });
});

describe("textos de M11 (criterios 6, 16, 22, 24, 29, 32, 34; D-130)", () => {
  it("coinciden con la tabla aprobada", () => {
    expect(catalogTexts.link).toBe("Categorías y tipos");
    expect(catalogTexts.title).toBe("Categorías y tipos");
    expect(catalogTexts.categories).toBe("Categorías");
    expect(catalogTexts.experienceTypes).toBe("Tipos de experiencia");
    expect(catalogTexts.establishmentTypes).toBe("Tipos de establecimiento");
    expect(catalogTexts.nameLabel).toBe("Nombre");
    expect(catalogTexts.save).toBe("Guardar");
    expect(catalogTexts.confirmCreate("Naturaleza")).toBe("Vas a crear «Naturaleza». ¿Confirmas?");
    expect(catalogTexts.confirmEdit("Naturaleza y aventura")).toBe(
      "Vas a cambiar el nombre a «Naturaleza y aventura». El cambio se verá en las fichas que lo usan. ¿Confirmas?",
    );
    expect(catalogTexts.confirm).toBe("Confirmar");
    expect(catalogTexts.cancel).toBe("Cancelar");
    expect(catalogTexts.nameRequired).toBe("Escribe un nombre.");
    expect(catalogTexts.duplicate).toBe("Ya existe un elemento con ese nombre.");
    expect(catalogTexts.forbidden).toBe("No tienes permiso para administrar estas listas.");
    expect(catalogTexts.genericError).toBe("No pudimos guardar el cambio. Inténtalo de nuevo.");
  });
  it("ninguno lleva identificadores de Telegram, códigos HTTP ni detalles técnicos", () => {
    for (const value of Object.values(catalogTexts)) {
      const text = typeof value === "function" ? value("Ejemplo") : value;
      expect(text).not.toMatch(/\b\d{6,}\b|telegram|\b(401|403|404|409|422|500)\b|error:/i);
    }
  });
});
