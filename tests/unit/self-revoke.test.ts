import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSelfRevokeCallback,
  parseSelfRevokeCallback,
  SELF_REVOKE_ASK,
  SELF_REVOKE_CANCEL,
  SELF_REVOKE_CONFIRM,
} from "@/bot/self-revoke";
import { es } from "@/bot/texts/es";
import { formatBogota } from "@/lib/time";
import { readNoticeSource } from "../helpers/notice-source";

// F034: textos, analizador de callback_data y fecha (criterios 4, 6, 8, 15, 26, 33 y 35).
const KEYS = Object.entries(es.selfRevoke) as [string, string][];
// Frase de D-023, tal como la define la decisión (sin punto final).
const D023 = "El número de identidad se usa solo para verificar tu identidad y atender tu solicitud de registro como prestador";

describe("textos de selfRevoke (criterios 4, 6, 26 y 35)", () => {
  it("4: el botón dice Revocar mi autorización y no se confunde con Revocar rol", () => {
    expect(es.selfRevoke.button).toBe("Revocar mi autorización");
    expect(es.selfRevoke.button).not.toBe(es.revoke.button);
    for (const text of [es.admin.pendingButton, es.admin.authorizeButton, es.revoke.button]) expect(text).not.toContain("Revocar mi autorización");
  });

  it("textos confirmados: botones de B03 y la lista exacta de claves", () => {
    expect(es.selfRevoke.confirmButton).toBe("Sí, revocar");
    expect(es.selfRevoke.cancelButton).toBe("Cancelar");
    expect(Object.keys(es.selfRevoke).sort()).toEqual(
      ["activeRole", "blocked", "button", "cancelButton", "cancelled", "confirm", "confirmButton", "error", "note", "revoked"],
    );
  });

  it("6: la frase es la de D-023 y coincide con la frase del aviso aprobado (que la cierra con punto)", () => {
    expect(es.selfRevoke.note).toBe(D023);
    expect(readNoticeSource().revocationNote).toBe(`${D023}.`);
    expect(readFileSync(resolve(process.cwd(), "supabase/seed/reference.sql"), "utf8")).toContain(`$aviso$${D023}.$aviso$`);
  });

  it("7: la confirmación dice qué se borra y qué se conserva", () => {
    for (const part of ["vinculación de este chat", "datos de tu cuenta", "registro como prestador", "prueba de que autorizaste y revocaste", "sin tu número de identidad"]) {
      expect(es.selfRevoke.confirm).toContain(part);
    }
  });

  it("35 y 26: ningún texto nuevo lleva dígitos, la palabra código ni el número de identidad sembrado", () => {
    for (const [key, text] of KEYS) {
      expect(text, key).not.toMatch(/\d/);
      expect(text.toLowerCase(), key).not.toContain("código");
      expect(text.toLowerCase(), key).not.toContain("otp");
      expect(text, key).not.toContain("900000099");
    }
    expect(Object.keys(es.selfRevoke).join(" ").toLowerCase()).not.toMatch(/code|codigo|otp|verif/);
  });

  it("15: la hora de la prueba se formatea en America/Bogota y ninguna pantalla muestra fecha", () => {
    expect(formatBogota(new Date("2026-11-17T15:30:00Z"))).toBe("17 de noviembre de 2026, 10:30 a. m.");
    expect(es.selfRevoke.revoked).not.toMatch(/\d/);
  });
});

describe("callback_data de revocar mi autorización (criterios 8 y 33)", () => {
  it("8: los tres valores tienen 64 bytes o menos, sin datos de la persona y sin el prefijo adm:", () => {
    for (const data of [SELF_REVOKE_ASK, SELF_REVOKE_CONFIRM, SELF_REVOKE_CANCEL]) {
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(data).not.toMatch(/\d/);
      expect(data.startsWith("adm:")).toBe(false);
      expect(isSelfRevokeCallback(data)).toBe(true);
    }
    expect(new Set([SELF_REVOKE_ASK, SELF_REVOKE_CONFIRM, SELF_REVOKE_CANCEL]).size).toBe(3);
  });

  it("33: reconoce las tres acciones y descarta lo mal formado", () => {
    expect(parseSelfRevokeCallback(SELF_REVOKE_ASK)).toBe("ask");
    expect(parseSelfRevokeCallback(SELF_REVOKE_CONFIRM)).toBe("confirm");
    expect(parseSelfRevokeCallback(SELF_REVOKE_CANCEL)).toBe("cancel");
    for (const bad of ["srv:", "srv:other", "srv:yes:1", "srv:yes:", "srv", `srv:${"x".repeat(80)}`, "SRV:YES", "adm:srv:yes"]) {
      expect(parseSelfRevokeCallback(bad), bad).toBeNull();
    }
    expect(isSelfRevokeCallback(undefined)).toBe(false);
    expect(isSelfRevokeCallback("provider:cancel")).toBe(false);
  });
});

// Criterio 35: los textos visibles viven en es.ts. Se buscan literales de varias palabras en el resto de src/bot; solo se
// permiten la descripción del comando y los mensajes técnicos de registro o de respuesta HTTP que ya existían.
const ALLOWED = new Set(["Mostrar el menú", "No hay un aviso de privacidad vigente", "No pudimos verificar el origen de la petición."]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

function multiWordLiterals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]).filter((text) => /\p{L}+ \p{L}+/u.test(text));
}

describe("literales fuera de es.ts (criterio 35)", () => {
  it("el verificador detecta una frase de varias palabras", () => {
    expect(multiWordLiterals('send(ctx, "Hola, esto es un texto");')).toEqual(["Hola, esto es un texto"]);
    expect(multiWordLiterals('const a = "srv:ask"; // un comentario con palabras')).toEqual([]);
  });

  it("src/bot no agrega literales de varias palabras fuera de es.ts", () => {
    const found = sourceFiles(resolve(process.cwd(), "src/bot"))
      .filter((file) => !file.endsWith("texts/es.ts"))
      .flatMap((file) => multiWordLiterals(readFileSync(file, "utf8")).map((text) => ({ file, text })))
      .filter(({ text }) => !ALLOWED.has(text));
    expect(found).toEqual([]);
  });
});
