import { describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";
import { homeView, homeViewText } from "@/miniapp/home";
import { miniappTexts } from "@/miniapp/texts";
import type { components } from "@/shared/api/schema";

type Me = components["schemas"]["Me"];

const me = (patch: Partial<Me> = {}, consentRequired = false): Me => ({
  telegramUserId: "900000061",
  displayName: "Persona Prueba",
  consent: { required: consentRequired, currentVersion: "v", acceptedVersion: "v", acceptedAt: null, canRevoke: true },
  roles: [],
  isPrincipalAdmin: false,
  providerRegistrationStatus: "none",
  canRegisterAsProvider: true,
  ...patch,
});

describe("M02: la vista sale solo de getMe (criterios 23 a 28)", () => {
  it.each([
    ["prestador", me({ roles: ["provider"], providerRegistrationStatus: "approved", canRegisterAsProvider: false }), "role-provider"],
    ["administrador", me({ roles: ["admin"], canRegisterAsProvider: false }), "role-admin"],
    ["principal", me({ roles: ["admin"], isPrincipalAdmin: true, canRegisterAsProvider: false }), "role-admin"],
    ["admin y prestador a la vez (D-116)", me({ roles: ["admin", "provider"], canRegisterAsProvider: false }), "role-admin"],
    ["sin rol y sin registro", me(), "register-hint"],
    ["sin rol y registro rechazado (D-115)", me({ providerRegistrationStatus: "rejected" }), "register-hint"],
    ["sin rol y registro pendiente", me({ providerRegistrationStatus: "pending", canRegisterAsProvider: false }), "registration-pending"],
  ] as const)("%s", (_name, input, expected) => {
    expect(homeView(input)).toBe(expected);
  });
});

describe("textos de la Mini App (criterios 23 a 29 y 31)", () => {
  it("coinciden con los aprobados", () => {
    expect(homeViewText["role-provider"]).toBe("Ya tienes el rol de prestador. Las opciones de prestador estarán disponibles pronto.");
    expect(homeViewText["role-provider"]).toBe(es.menu.providerAvailable);
    expect(homeViewText["role-admin"]).toBe("Eres administrador. Las opciones de administración se usan desde el bot de Telegram.");
    expect(homeViewText["register-hint"]).toBe(
      "Para registrarte como prestador, escribe /start en el bot de Telegram y pulsa «Registrarme como prestador».",
    );
    expect(homeViewText["registration-pending"]).toBe("Tu registro como prestador queda a la espera de autorización del administrador.");
    expect(homeViewText["registration-pending"]).toBe(es.provider.pending);
    expect(miniappTexts.sessionExpired).toBe("Tu sesión venció o no se pudo verificar. Cierra la Mini App y ábrela de nuevo desde el bot.");
  });

  it("no llevan números, tipos de documento ni lenguaje técnico", () => {
    for (const text of Object.values(miniappTexts)) {
      expect(/\d/.test(text)).toBe(false);
      expect(/cédula|pasaporte|permiso por protección|\bCC\b|\bPPT\b|exception|stack|undefined|\bnull\b|token/i.test(text)).toBe(false);
    }
  });
});
