import { describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";

// Criterio 20 de F028: los textos de error e indicación no usan lenguaje técnico.
const TEXTS = {
  "common.nothingToCancel": es.common.nothingToCancel,
  "common.useButtons": es.common.useButtons,
  "common.sessionConflict": es.common.sessionConflict,
  "errors.generic": es.errors.generic,
  "provider.typeInvalid": es.provider.typeInvalid,
  "provider.numberInvalid": es.provider.numberInvalid,
  "provider.noDraft": es.provider.noDraft,
  "provider.error": es.provider.error,
  "provider.expired": es.provider.expired,
  "provider.duplicate": es.provider.duplicate,
  "provider.rateLimited": es.provider.rateLimited,
  "provider.cancelled": es.provider.cancelled,
  "adminAuth.askId": es.adminAuth.askId,
  "adminAuth.idInvalid": es.adminAuth.idInvalid,
  "adminAuth.confirm": es.adminAuth.confirm("900000052"),
  "adminAuth.authorized": es.adminAuth.authorized("900000052"),
  "adminAuth.alreadyAdmin": es.adminAuth.alreadyAdmin,
  "adminAuth.conflict": es.adminAuth.conflict,
  "adminAuth.cancelled": es.adminAuth.cancelled,
  "adminAuth.noDraft": es.adminAuth.noDraft,
  "adminAuth.error": es.adminAuth.error,
};
const WORDS = ["exception", "stack", "undefined", "null", "SQL", "500", "422", "code", "token"];
const TABLES = ["accounts", "consent_events", "provider_registrations", "role_grants", "audit_events", "rate_limit_counters", "notification_outbox", "bot_sessions", "processed_updates"];

describe("textos de error e indicación (criterio 20)", () => {
  it.each(Object.entries(TEXTS))("%s no contiene lenguaje técnico", (_key, text) => {
    for (const word of [...WORDS, ...TABLES]) expect(new RegExp(`\\b${word}\\b`, "i").test(text), word).toBe(false);
    expect(text).not.toContain("error:");
  });

  it("los textos comunes quedan con la redacción aprobada (D-083)", () => {
    expect(es.common.nothingToCancel).toBe("No hay nada que cancelar.");
    expect(es.common.useButtons).toBe("Para continuar, usa los botones del mensaje anterior. Si prefieres salir, envía /cancelar.");
    expect(es.common.sessionConflict).toBe("Tu mensaje anterior todavía se estaba procesando. Repite el paso, por favor.");
  });

  it("los textos de B06 y B08 quedan con la redacción aprobada (D-103)", () => {
    expect(es.admin.authorizeButton).toBe("Autorizar administrador");
    expect(es.adminAuth.askId).toBe("Escribe el ID de Telegram de la persona que quieres autorizar como administrador. Es un número, por ejemplo 123456789.");
    expect(es.adminAuth.idInvalid).toBe("Ese ID no es válido. Debe ser un número de Telegram, solo con dígitos y sin espacios. Escríbelo de nuevo.");
    expect(es.adminAuth.confirm("123")).toBe("¿Confirmas que autorizas como administrador al ID de Telegram 123? Esa persona podrá usar las funciones de administrador.");
    expect(es.adminAuth.authorized("123")).toBe("Autorización completada. El ID de Telegram 123 ya es administrador.");
    expect(es.adminAuth.alreadyAdmin).toBe("Ese ID ya está autorizado como administrador.");
    expect(es.adminAuth.conflict).toBe("Ese ID ya tiene un rol de prestador o un registro de prestador pendiente, y no puede ser administrador.");
    expect(es.adminAuth.cancelled).toBe("No se hizo ningún cambio. No se autorizó a nadie.");
    expect(es.adminAuth.noDraft).toBe("No hay ninguna autorización por confirmar.");
    expect(es.adminAuth.error).toBe("No pude completar la autorización. Inténtalo de nuevo más tarde.");
  });
});
