import { describe, expect, it } from "vitest";
import { LISTING_ERROR_MESSAGES, listingErrorMessage, parseDraftSave, parseProviderCreate, parseManagedListQuery, parseSubmission } from "@/server/domain/listings";
import { listingTexts as t } from "@/miniapp/texts";

// F013, criterio 43: los textos coinciden letra por letra con la tabla "Textos nuevos" y cumplen la regla comprobable.
const FORBIDDEN = [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /\b\d{6,}\b/, /\b(undefined|null|kind|validation_failed)\b/i, /Error:/];

describe("textos de la Mini App (tabla Textos nuevos)", () => {
  it("coinciden letra por letra", () => {
    expect(t.homeLink).toBe("Mis fichas");
    expect(t.list).toEqual({ title: "Mis fichas", empty: "Todavía no tienes fichas.", new: "Nueva ficha" });
    expect(t.status).toEqual({ draft: "Borrador", pending: "Pendiente de revisión", published: "Publicada", rejected: "Rechazada" });
    expect(t.form.titleNew).toBe("Nueva ficha de establecimiento");
    expect(t.form.titleEdit).toBe("Editar ficha");
    expect(t.form.establishmentTypeLabel).toBe("Tipo de establecimiento (opcional)");
    expect(t.form.noType).toBe("Sin tipo");
    expect(t.form.saveDraft).toBe("Guardar borrador");
    expect(t.form.submit).toBe("Enviar a revisión");
    expect(t.form.cancel).toBe("Cancelar");
    expect(t.confirmSave("X")).toBe("Vas a guardar «X» como borrador. No será visible para los visitantes. ¿Confirmas?");
    expect(t.saved).toBe("Borrador guardado.");
    expect(t.declaration).toBe("Declaro que tengo la autorización de los guías y contactos cuyos datos incluyo en esta ficha.");
    expect(t.confirmSubmit("X")).toBe("Vas a enviar «X» a revisión. Mientras esté pendiente no podrás editarla. ¿Confirmas?");
    expect(t.submitted).toBe("Ficha enviada a revisión. El administrador la revisará.");
    expect(t.locked).toBe("Esta ficha está pendiente de revisión y no se puede editar hasta que el administrador decida.");
    expect(t.detail).toEqual({ title: "Detalle de la ficha", workingVersion: "Versión de trabajo", notPublished: "Todavía no está publicada.", edit: "Editar borrador", back: "Volver a mis fichas" });
    expect(t.forbidden).toBe("No tienes permiso para gestionar fichas.");
    expect(t.listError).toBe("No pudimos cargar tus fichas. Inténtalo de nuevo.");
    expect(t.genericError).toBe("No pudimos guardar la ficha. Inténtalo de nuevo en unos minutos.");
    expect(t.submitGenericError).toBe("No pudimos enviar la ficha a revisión. Inténtalo de nuevo en unos minutos.");
    expect(t.declarationRequired).toBe("Debes declarar que tienes la autorización de los guías y contactos.");
  });

  it("ningún texto visible contiene UUID, números largos ni literales técnicos (sin el nombre escrito por la usuaria)", () => {
    const flat = (value: unknown): string[] => (typeof value === "string" ? [value] : typeof value === "function" ? [(value as (n: string) => string)("")] : Object.values(value as object).flatMap(flat));
    const texts = flat(t);
    expect(texts.length).toBeGreaterThan(40);
    for (const text of texts) for (const pattern of FORBIDDEN) expect(text, `${text} ${pattern}`).not.toMatch(pattern);
  });
});

describe("mensajes del servidor de F013", () => {
  it("los textos nuevos coinciden con la tabla", () => {
    expect(listingErrorMessage("thirdPartyAuthorizationDeclared", "declaration_required")).toBe("Debes declarar que tienes la autorización de los guías y contactos.");
    expect(listingErrorMessage("experienceTypeId", "not_allowed", "establishment")).toBe("Este dato no corresponde a un establecimiento.");
    expect(listingErrorMessage("establishmentTypeId", "invalid")).toBe("El tipo de establecimiento elegido no es válido.");
    expect(listingErrorMessage("establishmentTypeId", "not_found")).toBe("El tipo de establecimiento elegido ya no existe. Actualiza la pantalla.");
  });

  it("ningún errors[].message de un cuerpo inválido contiene UUID, números largos ni literales técnicos", () => {
    const messages = [...Object.values(LISTING_ERROR_MESSAGES), listingErrorMessage("x", "not_allowed", "establishment")];
    const bad = [
      parseProviderCreate({ kind: "route_experience", otro: 1, content: { name: 5, experienceTypeId: "x", guidesInfo: "y", mapsUrl: 4, categoryId: "no", municipalityId: "no" }, confirmed: "true" }),
      parseProviderCreate([]),
      parseDraftSave({ x: 1 }),
      parseSubmission({ otro: 1 }),
      parseManagedListQuery(new URLSearchParams({ page: "0", pageSize: "51", kind: "otro", displayStatus: "otro" })),
    ];
    for (const result of bad) {
      expect(result.ok).toBe(false);
      if (!result.ok && "errors" in result) messages.push(...result.errors.map((e) => e.message));
    }
    for (const message of messages) {
      expect(message).toBeTruthy();
      for (const pattern of FORBIDDEN) {
        // Las claves del catálogo de F012 con la palabra "tipo de ficha" no llevan literales; `kind` solo viaja como `field`.
        expect(message, `${message} ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
