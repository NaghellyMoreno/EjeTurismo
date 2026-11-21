import { describe, expect, it } from "vitest";
import { renderInformationRequestAlert, TELEGRAM_TEXT_LIMIT } from "@/server/domain/information-request-alert";

// F031, criterio 12: texto de la alerta y regla de recorte (D-188).
const base = { listingName: "Café Mirador de Prueba", requesterName: "Ana de Prueba", interestDate: "2026-11-25", partySize: 3, message: "Consulta de prueba" };

describe("renderInformationRequestAlert", () => {
  it("compone las líneas aprobadas", () => {
    expect(renderInformationRequestAlert(base)).toBe(
      "Nueva solicitud de información\nFicha: Café Mirador de Prueba\nNombre: Ana de Prueba\nFecha de interés: 25/11/2026\nPersonas: 3\nMensaje: Consulta de prueba",
    );
  });
  it("recorta primero el mensaje", () => {
    const text = renderInformationRequestAlert({ ...base, message: "m".repeat(5000) });
    expect(text.length).toBe(TELEGRAM_TEXT_LIMIT);
    expect(text.endsWith("m…")).toBe(true);
    expect(text).toContain("Nombre: Ana de Prueba");
  });
  it("recorta también el nombre si solo ya no cabe, y conserva fecha y personas", () => {
    const text = renderInformationRequestAlert({ ...base, requesterName: "n".repeat(4096), message: "m".repeat(4096) });
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(text).toContain("Fecha de interés: 25/11/2026\nPersonas: 3\nMensaje: …");
  });
  it("no parte un par sustituto al recortar", () => {
    const text = renderInformationRequestAlert({ ...base, message: "😀".repeat(3000) });
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(text).not.toMatch(/[\uD800-\uDBFF]…/);
  });
});
