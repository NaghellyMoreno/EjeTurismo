import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptIdentityNumber,
  encryptIdentityNumber,
  identityHash,
  normalizeIdentityNumber,
  openSealedIdentity,
  parseTypeInsensitive,
  sealIdentityNumber,
  trimIdentityNumber,
  validateIdentityNumber,
} from "@/server/domain/identity";

const ENC = Buffer.alloc(32, 3);
const HASH = Buffer.alloc(32, 5);
const codes = (type: unknown, number: unknown) => validateIdentityNumber(type, number).map((e) => `${e.field}:${e.code}`);

describe("validateIdentityNumber (criterios 7, 8; ADR 0005)", () => {
  it("acepta cada tipo con un número cualquiera sin reglas por tipo (D-046)", () => {
    for (const type of ["CC", "CE", "PPT", "PA"]) expect(codes(type, "ab-123 .x")).toEqual([]);
  });
  it("rechaza tipos fuera de la lista con not_in_list, incluidos minúsculas, vacío, null y números", () => {
    for (const type of ["TI", "cc", "", null, 5, undefined]) expect(codes(type, "123")).toEqual(["identityDocumentType:not_in_list"]);
  });
  it("número vacío, solo espacios o ausente: required", () => {
    for (const number of ["", "   ", undefined, null]) expect(codes("CC", number)).toEqual(["identityNumber:required"]);
  });
  it("carácter de control: invalid_format; no texto: invalid_format", () => {
    expect(codes("CC", "12\u0000")).toEqual(["identityNumber:invalid_format"]);
    expect(codes("CC", "1\n2")).toEqual(["identityNumber:invalid_format"]);
    expect(codes("CC", 123)).toEqual(["identityNumber:invalid_format"]);
  });
  it("4097 caracteres: too_long; 4096: válido", () => {
    expect(codes("CC", "x".repeat(4097))).toEqual(["identityNumber:too_long"]);
    expect(codes("CC", "x".repeat(4096))).toEqual([]);
  });
  it("informa tipo y número a la vez", () => {
    expect(codes("TI", "")).toEqual(["identityDocumentType:not_in_list", "identityNumber:required"]);
  });
});

describe("normalización y hash (criterio 29; D-055)", () => {
  it("el cifrado conserva lo escrito sin espacios en los extremos y el hash usa mayúsculas", () => {
    expect(trimIdentityNumber(" ab123 ")).toBe("ab123");
    expect(normalizeIdentityNumber(" ab123 ")).toBe("AB123");
  });
  it("ab123, AB123 y ' AB123 ' dan el mismo hash; AB 123 y AB.123 dan otros", () => {
    const h = (n: string) => identityHash(HASH, "PA", n).toString("hex");
    expect(h("ab123")).toBe(h("AB123"));
    expect(h(" AB123 ")).toBe(h("AB123"));
    expect(h("AB 123")).not.toBe(h("AB123"));
    expect(h("AB.123")).not.toBe(h("AB123"));
    expect(h("AB 123")).not.toBe(h("AB.123"));
  });
  it("el hash es HMAC-SHA256 de tipo:número y el tipo cambia el hash (D-054)", () => {
    const expected = createHmac("sha256", HASH).update("CC:1020304050").digest();
    expect(identityHash(HASH, "CC", "1020304050").equals(expected)).toBe(true);
    expect(identityHash(HASH, "CE", "1020304050").equals(expected)).toBe(false);
  });
});

describe("tipo escrito en el bot (criterio 5; D-055)", () => {
  it("acepta las siglas sin distinguir mayúsculas y rechaza el resto", () => {
    expect([parseTypeInsensitive("cc"), parseTypeInsensitive("Cc"), parseTypeInsensitive("ppt"), parseTypeInsensitive(" pa ")]).toEqual(["CC", "CC", "PPT", "PA"]);
    for (const text of ["TI", "cedula", ""]) expect(parseTypeInsensitive(text)).toBeNull();
  });
});

describe("cifrado AES-256-GCM (criterio 13, 18; ADR 0005)", () => {
  const account = randomUUID();
  it("descifra lo que cifró, con IV distinto cada vez, y no deja el número en claro", () => {
    const a = encryptIdentityNumber(ENC, account, " 1020304050 ");
    const b = encryptIdentityNumber(ENC, account, "1020304050");
    expect(a.equals(b)).toBe(false);
    expect(a.toString("latin1")).not.toContain("1020304050");
    expect(decryptIdentityNumber(ENC, account, a)).toBe("1020304050");
  });
  it("conserva mayúsculas y minúsculas tal como se escribieron", () => {
    expect(decryptIdentityNumber(ENC, account, encryptIdentityNumber(ENC, account, "ab123"))).toBe("ab123");
  });
  it("falla con otra cuenta, otra clave o contenido alterado", () => {
    const sealed = sealIdentityNumber(ENC, account, "ab123");
    expect(openSealedIdentity(ENC, account, sealed)).toBe("ab123");
    expect(() => openSealedIdentity(ENC, randomUUID(), sealed)).toThrow();
    expect(() => openSealedIdentity(Buffer.alloc(32, 4), account, sealed)).toThrow();
    const tampered = Buffer.from(sealed, "base64");
    tampered[tampered.length - 1] ^= 1;
    expect(() => openSealedIdentity(ENC, account, tampered.toString("base64"))).toThrow();
  });
});
