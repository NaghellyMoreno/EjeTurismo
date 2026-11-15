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
});
