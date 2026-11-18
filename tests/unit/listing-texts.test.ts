import { describe, expect, it } from "vitest";
import { LISTING_ERROR_MESSAGES, listingErrorMessage, parseAttractionCreate, parsePublishedListQuery } from "@/server/domain/listings";

// F012, criterio 28: textos del servidor (D-147) y regla comprobable de lo que nunca debe verse.
const FORBIDDEN = [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /\b\d{6,}\b/, /undefined/, /null/, /\bkind\b/, /validation_failed/, /Error:/];

describe("textos de errores de campo del servidor", () => {
  it("coinciden letra por letra con la tabla aprobada", () => {
    expect(listingErrorMessage("name", "required")).toBe("El nombre es obligatorio.");
    expect(listingErrorMessage("municipalityId", "required")).toBe("Elige un municipio.");
    expect(listingErrorMessage("categoryId", "required")).toBe("Elige una categoría.");
    expect(listingErrorMessage("description", "required")).toBe("La descripción es obligatoria.");
    expect(listingErrorMessage("schedule", "required")).toBe("Los horarios son obligatorios.");
    expect(listingErrorMessage("contact", "required")).toBe("El contacto es obligatorio.");
    expect(listingErrorMessage("mapsUrl", "required")).toBe("El enlace de Google Maps es obligatorio.");
    expect(listingErrorMessage("name", "too_long")).toBe("El nombre admite hasta 100 caracteres.");
    expect(listingErrorMessage("description", "too_long")).toBe("La descripción admite hasta 1500 caracteres.");
    expect(listingErrorMessage("schedule", "too_long")).toBe("Los horarios admiten hasta 300 caracteres.");
    expect(listingErrorMessage("contact", "too_long")).toBe("El contacto admite hasta 200 caracteres.");
    expect(listingErrorMessage("mapsUrl", "invalid_maps_url")).toBe("Escribe un enlace de Google Maps (por ejemplo, maps.app.goo.gl o google.com/maps).");
    expect(listingErrorMessage("municipalityId", "invalid")).toBe("El municipio elegido no es válido.");
    expect(listingErrorMessage("categoryId", "invalid")).toBe("La categoría elegida no es válida.");
    expect(listingErrorMessage("confirmed", "confirmation_required")).toBe("Debes confirmar la operación para continuar.");
    expect(listingErrorMessage("establishmentTypeId", "not_allowed")).toBe("Este dato no corresponde a un atractivo.");
    expect(listingErrorMessage("otro", "unknown_field")).toBe("Este dato no se reconoce.");
    expect(listingErrorMessage("kind", "required")).toBe("El tipo de ficha es obligatorio.");
    expect(listingErrorMessage("kind", "invalid")).toBe("El tipo de ficha no es válido.");
    expect(listingErrorMessage("content", "required")).toBe("Faltan los datos del atractivo.");
    expect(listingErrorMessage("body", "invalid_json")).toBe("La solicitud no tiene un formato válido.");
    expect(listingErrorMessage("municipalityId", "not_found")).toBe("El municipio elegido ya no existe. Actualiza la pantalla.");
    expect(listingErrorMessage("categoryId", "not_found")).toBe("La categoría elegida ya no existe. Actualiza la pantalla.");
  });

  it("ningún texto contiene UUID, números largos ni literales técnicos", () => {
    const params = parsePublishedListQuery(new URLSearchParams({ page: "0", pageSize: "51", municipalityId: "no-uuid", kind: "otro" }));
    const fromParams = params.ok ? [] : params.errors.map((e) => e.message);
    expect(fromParams).toHaveLength(4);
    const texts = [...Object.values(LISTING_ERROR_MESSAGES), ...fromParams, listingErrorMessage("x", "not_allowed"), listingErrorMessage("x", "unknown_field")];
    for (const text of texts) for (const pattern of FORBIDDEN) expect(text, `${text} ${pattern}`).not.toMatch(pattern);
  });
});

describe("parseAttractionCreate", () => {
  const valid = () => ({
    kind: "attraction",
    content: { name: " Atractivo Ficticio Uno ", municipalityId: "5f0c1a10-0000-4000-8000-000000000001", categoryId: "5f0c1a10-0000-4000-8000-000000000002", description: "d", schedule: "s", contact: "c", mapsUrl: "https://maps.app.goo.gl/AbC" },
    confirmed: true,
  });
  it("cuerpo válido: recorta los espacios de los extremos", () => {
    const parsed = parseAttractionCreate(valid());
    expect(parsed).toMatchObject({ ok: true, content: { name: "Atractivo Ficticio Uno" } });
  });
  it("otro kind válido es forbiddenKind; kind fuera del enum es 422", () => {
    expect(parseAttractionCreate({ ...valid(), kind: "establishment" })).toEqual({ ok: false, forbiddenKind: true });
    expect(parseAttractionCreate({ ...valid(), kind: "otro" })).toMatchObject({ ok: false, errors: [{ field: "kind", code: "invalid" }] });
  });
  it("un cuerpo que no es objeto es invalid_json", () => {
    for (const raw of [undefined, null, [], "texto", 5]) expect(parseAttractionCreate(raw)).toMatchObject({ ok: false, errors: [{ field: "body", code: "invalid_json" }] });
  });
});

describe("parsePublishedListQuery", () => {
  it("valores por defecto", () => {
    expect(parsePublishedListQuery(new URLSearchParams())).toEqual({ ok: true, query: { page: 1, pageSize: 20 } });
  });
});
