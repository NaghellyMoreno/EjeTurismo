import { describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";

// F024, criterio 23: textos T1 a T5 de B17, idénticos letra por letra a los aprobados en D-180.
const FORBIDDEN = ["Submit", "Save", "Cancel", "Required", "Error", "Experience type", "Guide", "Type", "Loading", "Route"];
const texts = [
  es.explore.experienceButton,
  es.explore.chooseExperienceType("Manizales"),
  es.explore.experienceHeader("Ruta de aventura", "Manizales"),
  es.explore.experienceEmpty("Ruta de aventura", "Manizales"),
  es.explore.noExperienceTypes,
];

describe("criterio 23: textos de B17", () => {
  it("coinciden letra por letra con los aprobados en D-180", () => {
    expect(texts).toEqual([
      "Rutas y experiencias",
      "Elige un tipo de experiencia en Manizales.",
      "Rutas y experiencias de tipo Ruta de aventura en Manizales:",
      "Todavía no hay rutas ni experiencias publicadas de tipo Ruta de aventura en Manizales.",
      "Todavía no hay tipos de experiencia disponibles.",
    ]);
  });

  it("no están vacíos, no llevan el símbolo de párrafo ni palabras en inglés", () => {
    for (const text of texts) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).not.toContain("§");
      for (const word of FORBIDDEN) expect(text, word).not.toContain(word);
    }
  });
});
