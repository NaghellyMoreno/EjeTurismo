import { describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";

// F017, criterio 26: textos de B18 en español, aprobados letra por letra en D-177.
const FORBIDDEN = ["Submit", "Save", "Cancel", "Required", "Error", "Experience type", "Guide", "Type", "Loading", "Route"];
const texts = [es.explore.gastronomicButton, es.explore.gastronomicHeader("Manizales"), es.explore.gastronomicEmpty];

describe("criterio 26: textos de B18", () => {
  it("coinciden letra por letra con los aprobados en D-177", () => {
    expect(es.explore.gastronomicButton).toBe("Directorio gastronómico");
    expect(es.explore.gastronomicHeader("Manizales")).toBe("Directorio gastronómico de Manizales");
    expect(es.explore.gastronomicEmpty).toBe("Aún no hay restaurantes, cafés ni experiencias gastronómicas publicadas en este municipio.");
  });

  it("no están vacíos, no llevan el símbolo de párrafo ni palabras en inglés", () => {
    for (const text of texts) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toContain("§");
      for (const word of FORBIDDEN) expect(text, word).not.toContain(word);
    }
  });
});
