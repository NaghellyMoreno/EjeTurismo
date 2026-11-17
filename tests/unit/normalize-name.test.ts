import { describe, expect, it } from "vitest";
import { normalizeName } from "@/server/domain/normalize-name";

// F010, criterio 12a (D-118).
describe("normalizeName", () => {
  it.each(["  manizales ", "MANIZALES", "Manizáles", "Manizales"])("%j da manizales", (input) => {
    expect(normalizeName(input)).toBe("manizales");
  });

  it.each(["Supía", "Supia", " SUPÍA "])("%j da supia", (input) => {
    expect(normalizeName(input)).toBe("supia");
  });

  it("junta los espacios internos repetidos", () => {
    expect(normalizeName("Municipio   de  Prueba")).toBe("municipio de prueba");
    expect(normalizeName("  municipio de prueba ")).toBe("municipio de prueba");
  });

  it("no confunde nombres distintos", () => {
    expect(normalizeName("Manizales Centro")).not.toBe(normalizeName("Manizales"));
  });
});
