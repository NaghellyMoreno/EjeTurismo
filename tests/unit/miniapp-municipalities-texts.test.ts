import { describe, expect, it } from "vitest";
import { miniappTexts, municipalityTexts } from "@/miniapp/texts";

// F010, criterio 31: textos aprobados (D-129), por igualdad exacta.
const EXPECTED = {
  title: "Municipios",
  empty: "Aún no hay municipios registrados.",
  newButton: "Nuevo municipio",
  createTitle: "Nuevo municipio",
  editTitle: "Editar municipio",
  nameLabel: "Nombre",
  departmentLabel: "Departamento",
  generalInfoLabel: "Información general",
  zoneLabel: "Zona (opcional)",
  save: "Guardar",
  confirmCreate: "¿Confirmas que quieres crear este municipio?",
  confirmUpdate: "¿Confirmas que quieres guardar los cambios de este municipio?",
  confirm: "Confirmar",
  cancel: "Cancelar",
  created: "Municipio creado.",
  updated: "Municipio actualizado.",
  duplicate: "Ya existe un municipio con ese nombre.",
  invalid: "Revisa los campos marcados.",
  error: "No pudimos completar la operación. Intenta de nuevo en unos minutos.",
  forbidden: "No tienes permiso para administrar municipios.",
} as const;

const ALL = [...Object.values(municipalityTexts), miniappTexts.adminMunicipalitiesLink];

describe("textos de municipios en la Mini App", () => {
  it("el enlace del inicio del administrador", () => {
    expect(miniappTexts.adminMunicipalitiesLink).toBe("Administrar municipios");
  });

  it("el texto del inicio del administrador no cambia (D-117, D-120)", () => {
    expect(miniappTexts.adminOptions).toBe("Eres administrador. Las opciones de administración se usan desde el bot de Telegram.");
  });

  it.each(Object.entries(EXPECTED))("miniapp.municipalities.%s", (key, text) => {
    expect((municipalityTexts as Record<string, string>)[key]).toBe(text);
  });

  it("no sobra ni falta ninguna clave", () => {
    expect(Object.keys(municipalityTexts).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("ningún texto lleva IDs de prueba ni dígitos largos", () => {
    for (const text of ALL) {
      expect(text).not.toMatch(/9000000[7][1-9]/);
      expect(text).not.toMatch(/\d{6,}/);
    }
  });
});
