import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAGE_SIZE_BOT, parseRevokeCallback } from "@/bot/revoke";
import { es } from "@/bot/texts/es";
import { homeView, homeViewText } from "@/miniapp/home";
import { miniappTexts } from "@/miniapp/texts";
import type { components } from "@/shared/api/schema";

type Me = components["schemas"]["Me"];

const me = (patch: Partial<Me> = {}, consentRequired = false): Me => ({
  telegramUserId: "900000071",
  displayName: "Persona Prueba",
  consent: { required: consentRequired, currentVersion: "v", acceptedVersion: "v", acceptedAt: null, canRevoke: true },
  roles: [],
  isPrincipalAdmin: false,
  providerRegistrationStatus: "none",
  canRegisterAsProvider: true,
  ...patch,
});

// Criterio 41: todas las claves nuevas de es.ts (con las funciones llamadas con un nombre de ejemplo).
const revokeTexts = (): string[] => [
  es.revoke.button,
  es.revoke.listHeader,
  es.revoke.listItem("Ana", "admin", false),
  es.revoke.listItem("Ana", "provider", false),
  es.revoke.listItem("Ana", "admin", true),
  es.revoke.principalMark,
  es.revoke.more,
  es.revoke.confirmAdmin("Ana"),
  es.revoke.confirmProvider("Ana"),
  es.revoke.cancelled,
  es.revoke.revoked("Ana"),
  es.revoke.principalProtected,
  es.revoke.lastAdminProtected,
  es.revoke.alreadyRevoked,
];

describe("F006: textos (criterios 2 y 41)", () => {
  it("el botón se llama Revocar rol y no es Revocar mi autorización (D-020)", () => {
    expect(es.revoke.button).toBe("Revocar rol");
    expect(es.revoke.button).not.toBe("Revocar mi autorización");
    expect(JSON.stringify(es.admin)).not.toContain("Revocar mi autorización");
  });

  it("los textos aprobados (D-128) quedan sin cambios de redacción", () => {
    expect(es.revoke.listHeader).toBe("Elige a la persona a la que quieres quitar el rol.");
    expect(es.revoke.listItem("Ana", "admin", false)).toBe("Ana (administrador)");
    expect(es.revoke.listItem("Ana", "provider", false)).toBe("Ana (prestador)");
    expect(es.revoke.listItem("Ana", "admin", true)).toBe("Ana (administrador principal)");
    expect(es.revoke.principalMark).toBe("administrador principal");
    expect(es.revoke.more).toBe("Ver más");
    expect(es.revoke.confirmAdmin("Ana")).toBe("¿Confirmas que quitas el rol de administrador a Ana? Perderá el acceso de inmediato.");
    expect(es.revoke.confirmProvider("Ana")).toBe(
      "¿Confirmas que quitas el rol de prestador a Ana? Perderá el acceso de inmediato; sus fichas no se borran.",
    );
    expect(es.revoke.cancelled).toBe("No se hizo ningún cambio. La persona conserva su rol.");
    expect(es.revoke.revoked("Ana")).toBe("Rol revocado. Ana ya no tiene acceso.");
    expect(es.revoke.principalProtected).toBe("No se puede quitar el rol al administrador principal.");
    expect(es.revoke.lastAdminProtected).toBe("No se puede quitar el rol porque el sistema se quedaría sin administradores.");
    expect(es.revoke.alreadyRevoked).toBe("Ese rol ya fue revocado o no está disponible.");
    expect(miniappTexts.providerRevoked).toBe(
      "Tu rol de prestador fue revocado y ya no tienes acceso a las opciones de prestador. Si tienes dudas, comunícate con el administrador.",
    );
  });

  it("ninguna clave nueva contiene 900000099, la palabra documento ni dígitos", () => {
    for (const text of [...revokeTexts(), miniappTexts.providerRevoked]) {
      expect(text).not.toContain("900000099");
      expect(/documento/i.test(text)).toBe(false);
      expect(/\d/.test(text)).toBe(false);
    }
  });
});

describe("F006: sin literales de texto visible fuera de es.ts y texts.ts (criterio 41)", () => {
  // Lista explícita de excepciones: ninguna por ahora. Aquí se agregarían, una a una, prefijos de callback_data o mensajes de registro técnico.
  const EXCEPTIONS: string[] = [];
  const FILES = ["src/bot/admin.ts", "src/bot/revoke.ts", "src/miniapp/home.ts"];
  const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

  it.each(FILES)("%s", (file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    const literals = [...code.matchAll(/"([^"\\\n]*)"|`([^`\\]*)`/g)].map((m) => (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, ""));
    const visible = literals.filter((text) => /\S\s+\S/.test(text) && !EXCEPTIONS.includes(text));
    expect(visible).toEqual([]);
  });
});

describe("F006: analizador de callback_data de B09 (criterio 42)", () => {
  const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  it("acepta las acciones conocidas y cabe en 64 bytes", () => {
    expect(parseRevokeCallback("adm:vl")).toEqual({ action: "list" });
    expect(parseRevokeCallback("adm:vp:2")).toEqual({ action: "page", page: 2 });
    expect(parseRevokeCallback(`adm:vs:${ID}`)).toEqual({ action: "select", id: ID });
    expect(parseRevokeCallback(`adm:vc:${ID}`)).toEqual({ action: "confirm", id: ID });
    expect(parseRevokeCallback(`adm:vx:${ID}`)).toEqual({ action: "cancel", id: ID });
    for (const data of ["adm:vl", `adm:vs:${ID}`, `adm:vc:${ID}`, `adm:vx:${ID}`, "adm:vp:999999"]) {
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    }
    expect(PAGE_SIZE_BOT).toBe(8);
  });

  it.each([
    ["acción desconocida", `adm:vz:${ID}`],
    ["sin segmento", "adm:vs:"],
    ["segmento de más", `adm:vs:${ID}:x`],
    ["id que no es UUID", "adm:vs:no-es-uuid"],
    ["página no válida", "adm:vp:0"],
    ["página con letras", "adm:vp:a"],
    ["lista con segmento de más", "adm:vl:1"],
    ["más de 64 bytes", `adm:vs:${ID}${"a".repeat(30)}`],
  ])("ignora: %s", (_name, data) => {
    expect(parseRevokeCallback(data)).toBeNull();
  });
});

describe("F006: homeView con la vista role-revoked (criterio 20b)", () => {
  it.each([
    ["consentimiento requerido gana a todo", me({ roles: ["admin"], providerRegistrationStatus: "approved" }, true), "consent-required"],
    ["admin gana a provider", me({ roles: ["admin", "provider"], providerRegistrationStatus: "approved" }), "role-admin"],
    ["provider activo", me({ roles: ["provider"], providerRegistrationStatus: "approved" }), "role-provider"],
    ["sin roles y approved", me({ providerRegistrationStatus: "approved", canRegisterAsProvider: false }), "role-revoked"],
    ["sin roles y pending", me({ providerRegistrationStatus: "pending", canRegisterAsProvider: false }), "registration-pending"],
    ["sin roles y none", me(), "register-hint"],
    ["sin roles y rejected", me({ providerRegistrationStatus: "rejected" }), "register-hint"],
  ] as const)("%s", (_name, input, expected) => {
    expect(homeView(input)).toBe(expected);
  });

  it("el texto de role-revoked no menciona número ni tipo de documento", () => {
    expect(homeViewText["role-revoked"]).toBe(miniappTexts.providerRevoked);
    expect(/\d|documento|cédula|pasaporte/i.test(homeViewText["role-revoked"])).toBe(false);
  });
});
