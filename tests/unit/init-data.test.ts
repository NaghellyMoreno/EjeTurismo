import { describe, expect, it } from "vitest";
import { parseAuthorization, verifyInitData } from "@/server/auth/init-data";
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
