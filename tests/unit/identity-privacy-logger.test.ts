import { afterEach, describe, expect, it, vi } from "vitest";
import { log, logError, redact } from "@/server/observability/logger";
import { expectNoIdentity, identityLeaks, N1, N1_NUMBER, plainNeedles, watchConsole } from "../helpers/identity-leak";

// F027, criterio 16: el registro técnico nunca lleva el número de identidad, ni anidado ni dentro de un Error.
const FIELDS = { identityNumber: N1_NUMBER, identity_number: N1_NUMBER, identity_number_encrypted: "\\x0a0b0c0d0e0f", identityDocumentType: "CC", sealedIdentity: `sellado-${N1}` };
const nest = (levels: number, leaf: Record<string, unknown>) => Array.from({ length: levels }).reduce<Record<string, unknown>>((acc) => ({ capa: acc }), leaf);

afterEach(() => vi.restoreAllMocks());

describe("criterio 16: log y logError", () => {
  it.each([0, 1, 3, 5])("log redacta los cinco campos anidados a %i niveles de profundidad", (levels) => {
    const watch = watchConsole();
    log("info", "prueba.identidad", nest(levels, FIELDS));
    expect(watch.lines).toHaveLength(1);
    expectNoIdentity(watch.lines[0], [], "", true);
    expect(watch.lines[0]).toContain("[redactado]");
    expect(redact(nest(levels, FIELDS))).toBeTruthy();
  });

  it("log redacta los campos dentro de listas", () => {
    const watch = watchConsole();
    log("warn", "prueba.lista", { filas: [FIELDS, { anidado: [FIELDS] }] });
    expectNoIdentity(watch.lines[0], [], "", true);
  });

  it("logError con un Error cuyo mensaje, causa y propiedades llevan N1 solo registra el nombre y el código", () => {
    const watch = watchConsole();
    const error = Object.assign(new Error(`falló con ${N1} y ${N1_NUMBER}`, { cause: new Error(N1_NUMBER) }), { code: "23505", detail: N1_NUMBER });
    logError("prueba.error", error);
    expect(watch.lines).toHaveLength(1);
    expectNoIdentity(watch.lines[0], [], "", true);
    expect(JSON.parse(watch.lines[0])).toEqual({ level: "error", event: "prueba.error", errorName: "Error", errorCode: "23505" });
  });

  it("log con un Error dentro de los campos no deja pasar el mensaje", () => {
    const watch = watchConsole();
    log("error", "prueba.error_anidado", { error: new Error(`falló con ${N1}`), identityNumber: N1_NUMBER });
    expectNoIdentity(watch.lines[0], [], "", true);
  });
});

describe("verificación del detector de fugas", () => {
  it("detecta N1 normalizado, en minúsculas, con espacios o puntos, y las claves de identidad", () => {
    for (const leaked of plainNeedles()) expect(identityLeaks(`dato ${leaked} fin`, []), leaked).not.toEqual([]);
    expect(identityLeaks("5 5 5 0 1 2 3 9 8 7", [])).not.toEqual([]);
    expect(identityLeaks('{"identityNumber":"x"}', [])).not.toEqual([]);
    expect(identityLeaks("texto inocente 1020304050", [])).toEqual([]);
    expect(identityLeaks("abc123def", ["ABC123DEF"])).not.toEqual([]);
  });
});
