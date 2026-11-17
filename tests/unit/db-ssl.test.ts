import { describe, expect, it } from "vitest";
import { poolSsl } from "@/server/db";

const cloud = "postgresql://eje_app.ref:clave@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";
const pem = "-----BEGIN CERTIFICATE-----\nMIIDxTCCAq2gAwIBAgIBADANBgkq\n-----END CERTIFICATE-----";

describe("SSL de la conexión a la base (ADR 0012)", () => {
  it("no usa SSL en local", () => {
    expect(poolSsl("postgresql://eje_app@localhost:5432/eje", undefined)).toBe(false);
    expect(poolSsl("postgresql://eje_app@127.0.0.1:5432/eje", undefined)).toBe(false);
  });

  it("en la nube verifica el servidor con el certificado de Supabase", () => {
    expect(poolSsl(cloud, pem)).toEqual({ ca: pem, rejectUnauthorized: true });
  });

  it("acepta el certificado escrito en una sola línea con \\n", () => {
    expect(poolSsl(cloud, pem.replace(/\n/g, "\\n"))).toEqual({ ca: pem, rejectUnauthorized: true });
  });

  it("falla cerrado si falta el certificado o no es PEM", () => {
    expect(() => poolSsl(cloud, undefined)).toThrow(/DATABASE_CA_CERT/);
    expect(() => poolSsl(cloud, "")).toThrow(/DATABASE_CA_CERT/);
    expect(() => poolSsl(cloud, "no es un certificado")).toThrow(/DATABASE_CA_CERT/);
  });

  it("rechaza sslmode en la URL de la nube sin repetir la URL", () => {
    let message = "";
    try {
      poolSsl(`${cloud}?sslmode=require`, pem);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/sslmode/);
    expect(message).not.toContain("clave");
  });
});
