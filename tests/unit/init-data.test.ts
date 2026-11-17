import { describe, expect, it } from "vitest";
import { parseAuthorization, verifyInitData } from "@/server/auth/init-data";
import { testConfig } from "../helpers/config";
import { BOT_TOKEN, signInitData } from "../helpers/telegram";

const now = new Date("2026-11-15T12:00:00Z");
const authDate = Math.floor(now.getTime() / 1000);

describe("verifyInitData (ADR 0003; criterios 22, 31)", () => {
  it("acepta una firma válida y devuelve el ID y el nombre", () => {
    const init = signInitData({ userId: 900000001, firstName: "Persona Prueba Uno", authDate });
    expect(verifyInitData(init, BOT_TOKEN, 86400, now)).toEqual({ telegramUserId: "900000001", displayName: "Persona Prueba Uno" });
  });
  it("rechaza una firma hecha con otro token", () => {
    expect(verifyInitData(signInitData({ userId: 1, token: "999:otro", authDate }), BOT_TOKEN, 86400, now)).toBeNull();
  });
  it("rechaza si se cambia el user.id después de firmar", () => {
    expect(verifyInitData(signInitData({ userId: 1, authDate, tamperUserId: 2 }), BOT_TOKEN, 86400, now)).toBeNull();
  });
  it("rechaza cadena vacía, sin hash o con hash mal formado", () => {
    expect(verifyInitData("", BOT_TOKEN, 86400, now)).toBeNull();
    expect(verifyInitData("auth_date=1&user=%7B%7D", BOT_TOKEN, 86400, now)).toBeNull();
    expect(verifyInitData("auth_date=1&hash=zz", BOT_TOKEN, 86400, now)).toBeNull();
  });
  it("rechaza auth_date vencido", () => {
    const old = signInitData({ userId: 1, authDate: authDate - 86401 });
    expect(verifyInitData(old, BOT_TOKEN, 86400, now)).toBeNull();
    expect(verifyInitData(signInitData({ userId: 1, authDate: authDate - 86399 }), BOT_TOKEN, 86400, now)).not.toBeNull();
  });
});

describe("parseAuthorization", () => {
  it("extrae initData de `tma <initData>`", () => {
    expect(parseAuthorization("tma abc=1&hash=2")).toBe("abc=1&hash=2");
  });
  it("devuelve null sin cabecera o con otro esquema", () => {
    expect(parseAuthorization(null)).toBeNull();
    expect(parseAuthorization("Bearer x")).toBeNull();
    expect(parseAuthorization("tma ")).toBeNull();
  });
});

// ---- F009 (criterios 3, 7 a 10, 12, 13) ----
const F009_NOW = new Date("2026-11-17T15:30:00Z");
const f009Date = Math.floor(F009_NOW.getTime() / 1000);
const verify = (init: string, maxAge = 86400) => verifyInitData(init, BOT_TOKEN, maxAge, F009_NOW);
const signed = (o: Partial<Parameters<typeof signInitData>[0]> = {}) => signInitData({ userId: 900000801, authDate: f009Date, ...o });

describe("F009 criterio 3: parseAuthorization", () => {
  const valid = "auth_date=1&query_id=A%3DB&user=%7B%22id%22%3A1%7D&hash=" + "a".repeat(64);
  it("devuelve null para las cinco variantes mal formadas y para null", () => {
    for (const header of ["tma", "tma ", "tma    ", `Bearer ${valid}`, `TMA ${valid}`, valid, null]) {
      expect(parseAuthorization(header)).toBeNull();
    }
  });
  it("devuelve exactamente la cadena, con = & y % conservados", () => {
    expect(parseAuthorization(`tma ${valid}`)).toBe(valid);
  });
});

describe("F009 criterio 7: alteración de campos firmados", () => {
  it("la firma sin alterar es válida (control)", () => {
    expect(verify(signed())).not.toBeNull();
  });
  it("rechaza si cambia auth_date, aunque siga vigente", () => {
    expect(verify(signed({ afterSign: (p) => p.set("auth_date", String(f009Date - 10)) }))).toBeNull();
  });
  it("rechaza si cambia query_id", () => {
    expect(verify(signed({ afterSign: (p) => p.set("query_id", "AAH-otro") }))).toBeNull();
  });
  it("rechaza si cambia el nombre dentro de user (no solo el ID)", () => {
    const init = signed({
      afterSign: (p) => p.set("user", JSON.stringify({ ...JSON.parse(p.get("user")!), first_name: "Otro Nombre" })),
    });
    expect(verify(init)).toBeNull();
  });
  it("rechaza si se agrega un parámetro nuevo o se quita uno firmado", () => {
    expect(verify(signed({ afterSign: (p) => p.set("role", "admin") }))).toBeNull();
    expect(verify(signed({ afterSign: (p) => p.delete("query_id") }))).toBeNull();
  });
});

describe("F009 criterio 8: hash mal formado o duplicado", () => {
  const hashOf = (init: string) => new URLSearchParams(init).get("hash")!;
  it("rechaza hash de 63 o 65 caracteres y no hexadecimal", () => {
    const hash = hashOf(signed());
    for (const bad of [hash.slice(0, 63), hash + "0", "z".repeat(64)]) {
      expect(verify(signed({ afterSign: (p) => p.set("hash", bad) }))).toBeNull();
    }
  });
  it("rechaza un hash duplicado con uno válido y otro alterado, en cualquier orden", () => {
    const hash = hashOf(signed());
    const altered = "0".repeat(64);
    expect(verify(signed({ afterSign: (p) => p.append("hash", altered) }))).toBeNull();
    const reversed = signed({ afterSign: (p) => { p.delete("hash"); p.append("hash", altered); p.append("hash", hash); } });
    expect(verify(reversed)).toBeNull();
  });
});

describe("F009 criterio 9: user y auth_date no válidos con firma válida", () => {
  const userCases: [string, string | null][] = [
    ["user ausente", null],
    ["user con JSON malformado", "{no-json"],
    ["user.id como texto", JSON.stringify({ id: "123" })],
    ["user.id cero", JSON.stringify({ id: 0 })],
    ["user.id negativo", JSON.stringify({ id: -5 })],
    ["user.id decimal", JSON.stringify({ id: 1.5 })],
    ["user.id mayor que MAX_SAFE_INTEGER", '{"id":9007199254740993}'],
    ["user sin id", JSON.stringify({ first_name: "x" })],
  ];
  for (const [name, rawUser] of userCases) {
    it(`rechaza ${name}`, () => expect(verify(signed({ rawUser }))).toBeNull());
  }
  const dateCases: [string, string | null][] = [
    ["auth_date ausente", null],
    ["auth_date no numérico", "ayer"],
    ["auth_date cero", "0"],
    ["auth_date decimal", `${f009Date}.5`],
  ];
  for (const [name, rawAuthDate] of dateCases) {
    it(`rechaza ${name}`, () => expect(verify(signed({ rawAuthDate }))).toBeNull());
  }
});

describe("F009 criterio 10: user duplicado después de firmar", () => {
  it("rechaza aunque el primero sea válido", () => {
    expect(verify(signed({ afterSign: (p) => p.append("user", JSON.stringify({ id: 1 })) }))).toBeNull();
  });
});

describe("F009 criterio 12: límite exacto de vigencia", () => {
  it("acepta a 86400 s y rechaza a 86401 s", () => {
    expect(verify(signed({ authDate: f009Date - 86400 }))).not.toBeNull();
    expect(verify(signed({ authDate: f009Date - 86401 }))).toBeNull();
  });
  it("con otro valor configurado (600) el límite se mueve", () => {
    expect(verify(signed({ authDate: f009Date - 600 }), 600)).not.toBeNull();
    expect(verify(signed({ authDate: f009Date - 601 }), 600)).toBeNull();
  });
  it("el valor llega desde TELEGRAM_INIT_DATA_MAX_AGE_SECONDS", () => {
    const config = testConfig({ TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: "600" });
    expect(config.initDataMaxAgeSeconds).toBe(600);
    expect(testConfig().initDataMaxAgeSeconds).toBe(86400);
  });
});

describe("F009 criterio 13: tolerancia de reloj hacia el futuro", () => {
  it("acepta hasta 60 s en el futuro y rechaza más", () => {
    expect(verify(signed({ authDate: f009Date + 60 }))).not.toBeNull();
    expect(verify(signed({ authDate: f009Date + 61 }))).toBeNull();
  });
});
