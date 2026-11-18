import { describe, expect, it } from "vitest";
import { attractionTexts as t } from "@/miniapp/texts";

// F012, criterio 28: textos de M09 aprobados en D-147, letra por letra, y regla comprobable de lo que nunca debe verse.
describe("textos de M09", () => {
  it("coinciden con la tabla aprobada", () => {
    expect(t.link).toBe("Registrar atractivo");
    expect(t.title).toBe("Registrar atractivo");
    expect([t.nameLabel, t.municipalityLabel, t.categoryLabel, t.selectPlaceholder, t.descriptionLabel, t.scheduleLabel, t.contactLabel, t.mapsUrlLabel]).toEqual([
      "Nombre", "Municipio", "Categoría", "Elige una opción", "Descripción", "Horarios", "Contacto", "Enlace de Google Maps",
    ]);
    expect([t.save, t.confirm, t.cancel]).toEqual(["Guardar", "Confirmar", "Cancelar"]);
    expect(t.confirmCreate("Atractivo Ficticio Uno")).toBe("Vas a publicar «Atractivo Ficticio Uno». Será visible para los visitantes de inmediato, sin revisión. ¿Confirmas?");
    expect(t.created).toBe("Atractivo registrado y publicado.");
    expect(t.duplicate).toBe("Ya existe un atractivo con ese nombre en ese municipio.");
    expect(t.invalid).toBe("Revisa los campos marcados.");
    expect(t.genericError).toBe("No pudimos registrar el atractivo. Inténtalo de nuevo en unos minutos.");
    expect(t.forbidden).toBe("No tienes permiso para registrar atractivos.");
    expect(t.listsError).toBe("No pudimos cargar las listas. Inténtalo de nuevo.");
    expect(t.required).toEqual({
      name: "El nombre es obligatorio.",
      municipalityId: "Elige un municipio.",
      categoryId: "Elige una categoría.",
      description: "La descripción es obligatoria.",
      schedule: "Los horarios son obligatorios.",
      contact: "El contacto es obligatorio.",
      mapsUrl: "El enlace de Google Maps es obligatorio.",
    });
  });

  it("ningún texto contiene UUID, números largos ni literales técnicos", () => {
    const texts = [
      ...(Object.values(t).filter((v) => typeof v === "string") as string[]),
      ...Object.values(t.required),
      t.confirmCreate("Atractivo Ficticio Uno"),
    ];
    const forbidden = [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /\b\d{6,}\b/, /undefined/, /null/, /\bkind\b/, /validation_failed/, /Error:/];
    for (const text of texts) for (const pattern of forbidden) expect(text, `${text} ${pattern}`).not.toMatch(pattern);
  });
});
