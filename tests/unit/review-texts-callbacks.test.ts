import { describe, expect, it } from "vitest";
import { ADMIN_PREFIX } from "@/bot/admin";
import { AUTH_PREFIX } from "@/bot/forms/authorize-admin";
import { isReviewCallback, MY_LISTINGS, parseReviewCallback, REVIEW_LIST, REVIEW_PREFIX } from "@/bot/review";
import { SELF_REVOKE_PREFIX } from "@/bot/self-revoke";
import { es } from "@/bot/texts/es";
import { listingReviewTexts } from "@/miniapp/texts";
import { changedFields } from "@/server/services/listing-review";
import { loadConfig } from "@/server/config";
import { normalizeReason, parseApproval, parseRejection } from "@/server/domain/review";
import { testConfig } from "../helpers/config";

// F014: prefijo rev: sin colisiones, textos de la tabla "Textos nuevos" y reglas de los cuerpos.
const ID = "5e286716-eef9-4f2b-abca-fbe5f7d81398";

describe("callbacks de revisión (criterio 15)", () => {
  const all = [REVIEW_LIST, `rev:o:${ID}`, `rev:a:${ID}`, `rev:r:${ID}`, `rev:ca:${ID}`, `rev:cr:${ID}`, `rev:x:${ID}`];

  it("las 7 formas se reconocen, miden como máximo 64 bytes y traen solo acción y versionId", () => {
    expect(REVIEW_PREFIX).toBe("rev:");
    for (const data of all) {
      expect(isReviewCallback(data), data).toBe(true);
      expect(parseReviewCallback(data), data).not.toBeNull();
      expect(Buffer.byteLength(data), data).toBeLessThanOrEqual(64);
    }
    expect(parseReviewCallback(`rev:cr:${ID}`)).toEqual({ action: "confirmReject", id: ID });
    expect(Buffer.byteLength(`rev:cr:${ID}`)).toBe(43);
  });

  it("un UUID mal formado, una acción desconocida o un callback largo no se interpretan", () => {
    for (const data of ["rev:o:", "rev:o:no-uuid", "rev:zz:" + ID, `rev:o:${ID}x`, `rev:o:${ID}` + "a".repeat(40), "rev:"]) expect(parseReviewCallback(data), data).toBeNull();
  });

  it("ningún prefijo de rev: coincide con adm:, auth:, srv: ni con los de F034 y F035 (consent:, provider:, ml:)", () => {
    const others = [ADMIN_PREFIX, AUTH_PREFIX, SELF_REVOKE_PREFIX, "adm:v", "consent:", "provider:", MY_LISTINGS];
    for (const data of all) {
      for (const other of others) {
        expect(data.startsWith(other), `${data} / ${other}`).toBe(false);
        expect(other.startsWith(data), `${other} / ${data}`).toBe(false);
      }
    }
    for (const other of others.filter((o) => o.startsWith("adm:") || o.startsWith("auth:") || o.startsWith("srv:"))) expect(isReviewCallback(other)).toBe(false);
  });
});

describe("textos del bot (tabla Textos nuevos)", () => {
  it("coinciden letra por letra", () => {
    expect(es.menu.reviews).toBe("Fichas por revisar");
    expect(es.menu.myListings).toBe("Mis fichas");
    const r = es.review;
    expect(r.empty).toBe("No hay fichas por revisar.");
    expect(r.listTitle).toBe("Fichas por revisar");
    expect(r.morePending).toBe("Hay más fichas por revisar. Decide algunas y vuelve a pulsar «Fichas por revisar».");
    expect(r.changed("Nombre")).toBe("Cambios: Nombre");
    expect(r.firstReview).toBe("Es la primera revisión de esta ficha.");
    expect([r.approve, r.reject]).toEqual(["Aprobar", "Rechazar"]);
    expect(r.confirmApprove("X")).toBe("Vas a aprobar «X». Quedará publicada y visible para los visitantes. ¿Confirmas?");
    expect([r.yesApprove, r.yesReject, r.cancel]).toEqual(["Sí, aprobar", "Sí, rechazar", "Cancelar"]);
    expect(r.askReason).toBe("Escribe el motivo del rechazo. El prestador lo verá. Máximo 4096 caracteres.");
    expect(r.reasonInvalid).toBe("El motivo es obligatorio y debe ser un texto de hasta 4096 caracteres.");
    expect(r.confirmReject("X", "Y")).toBe("Vas a rechazar «X» con este motivo: Y. ¿Confirmas?");
    expect(r.approved).toBe("Ficha aprobada y publicada.");
    expect(r.rejected).toBe("Ficha rechazada. El prestador recibirá el motivo.");
    expect(r.cancelled).toBe("Revisión cancelada. No se hizo ningún cambio.");
    expect(r.alreadyDecided).toBe("Esa ficha ya fue decidida. Vuelve a abrir «Fichas por revisar».");
    expect(r.notFound).toBe("No encontramos esa ficha. Vuelve a abrir «Fichas por revisar».");
    expect(r.ownerRevoked).toBe("El prestador ya no tiene el permiso, así que esta ficha no se puede aprobar.");
    expect(r.sessionExpired).toBe("La revisión venció. Vuelve a abrir «Fichas por revisar».");
    expect(r.genericError).toBe("No pudimos completar la revisión. Inténtalo de nuevo en unos minutos.");
    expect(es.provider.listingApproved("X")).toBe("Tu ficha «X» fue aprobada y ya es visible para los visitantes.");
    expect(es.provider.listingRejected("X", "Y")).toBe("Tu ficha «X» fue rechazada. Motivo: Y. Puedes corregirla y volver a enviarla desde la Mini App.");
    const m = es.myListings;
    expect(m.title).toBe("Tus fichas");
    expect(m.empty).toBe("Todavía no tienes fichas. Crea una desde la Mini App.");
    expect(m.line("X", "Rechazada")).toBe("«X»: Rechazada");
    expect(m.reason("Y")).toBe("Motivo del rechazo: Y");
    expect(m.open).toBe("Abrir la Mini App");
  });

  it("los textos de la Mini App coinciden y los mensajes del servidor de F014 coinciden", () => {
    expect(listingReviewTexts).toEqual({
      rejectionReason: "Motivo del rechazo",
      correct: "Corregir y reenviar",
      pendingNote: "Tu ficha está pendiente de revisión.",
      rejectedNote: "El administrador rechazó esta ficha. Corrige lo señalado y envíala de nuevo.",
    });
    const rejection = parseRejection({ confirmed: true });
    expect(rejection.ok ? [] : rejection.errors.map((e) => e.message)).toContain("El motivo del rechazo es obligatorio.");
    const long = parseRejection({ confirmed: true, reason: "a".repeat(4097) });
    expect(long.ok ? [] : long.errors.map((e) => e.message)).toEqual(["El motivo del rechazo no puede pasar de 4096 caracteres."]);
  });
});

describe("reglas de los cuerpos y del motivo", () => {
  it("el motivo se recorta y se acepta de 1 a 4096 caracteres", () => {
    expect(normalizeReason("  Falta el horario.  ")).toBe("Falta el horario.");
    expect([normalizeReason(undefined), normalizeReason(""), normalizeReason("   "), normalizeReason("a".repeat(4097))]).toEqual([null, null, null, null]);
    expect(normalizeReason("a".repeat(4096))).toHaveLength(4096);
  });

  it("parseApproval exige solo confirmed true y rechaza campos desconocidos", () => {
    expect(parseApproval({ confirmed: true }).ok).toBe(true);
    for (const raw of [{}, { confirmed: false }, { confirmed: true, reason: "x" }, undefined, [], "x"]) expect(parseApproval(raw).ok, JSON.stringify(raw)).toBe(false);
  });
});

describe("changedFields (P5)", () => {
  const version = (content: Record<string, unknown>) => ({ content: { name: "A", municipality: { id: "m", name: "M" }, category: null, description: null, schedule: null, contact: null, mapsUrl: null, ...content } }) as never;
  it("sin publicada: los campos con valor; con publicada: solo los distintos", () => {
    expect(changedFields(version({ category: { id: "c", name: "C" }, description: "d" }), null)).toEqual(["name", "municipality", "category", "description"]);
    expect(changedFields(version({ description: "nueva" }), version({ description: "vieja" }))).toEqual(["description"]);
    expect(changedFields(version({}), version({}))).toEqual([]);
  });
});

describe("configuración: APP_BASE_URL (botón de la Mini App)", () => {
  it("es opcional, se normaliza sin barra final y debe ser una URL", () => {
    expect(testConfig({ APP_BASE_URL: "https://ejemplo.invalid/" }).appBaseUrl).toBe("https://ejemplo.invalid");
    expect(testConfig({ APP_BASE_URL: "" }).appBaseUrl).toBeNull();
    expect(() => testConfig({ APP_BASE_URL: "no es url" })).toThrow("APP_BASE_URL");
    expect(() => loadConfig({})).toThrow();
  });
});
