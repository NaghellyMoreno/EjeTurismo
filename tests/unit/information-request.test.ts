import { describe, expect, it } from "vitest";
import { pack, requestStartData } from "@/bot/callback-ids";
import { es } from "@/bot/texts/es";
import { bogotaToday, parseBotDate, parseIsoDate, parsePartySize, validateInformationRequest } from "@/server/domain/information-request";
import { APPROVED_PHRASE, forbiddenIn } from "../helpers/information-request";
import { testConfig } from "../helpers/config";

// F030: reglas de validación compartidas por la API y el bot, textos y callback_data.
describe("fecha del bot (D-182) y de la API", () => {
  it("el bot solo acepta DD/MM/AAAA de calendario", () => {
    expect(parseBotDate("25/12/2026")).toBe("2026-12-25");
    expect(parseBotDate(" 29/02/2028 ")).toBe("2028-02-29");
    for (const bad of ["", "   ", "mañana", "31/02/2027", "2026-12-25", "5/1/2027", "25-12-2026", "25/13/2026", "00/01/2026"]) expect(parseBotDate(bad), bad).toBeNull();
  });

  it("la API solo acepta AAAA-MM-DD de calendario", () => {
    expect(parseIsoDate("2026-12-25")).toBe("2026-12-25");
    for (const bad of ["2027-02-31", "31/02/2027", "2026-1-5", "", "hoy"]) expect(parseIsoDate(bad), bad).toBeNull();
  });

  it("hoy en America/Bogota: a las 23:30 de Bogotá todavía es el día anterior en UTC", () => {
    expect(bogotaToday(new Date("2026-11-22T04:30:00Z"))).toBe("2026-11-21");
    expect(bogotaToday(new Date("2026-11-22T05:00:00Z"))).toBe("2026-11-22");
    expect(bogotaToday(new Date("2026-11-21T04:59:59Z"))).toBe("2026-11-20");
  });
});

describe("número de personas", () => {
  it("entero mayor que cero", () => {
    expect(parsePartySize("3")).toBe(3);
    expect(parsePartySize(" 12 ")).toBe(12);
    for (const bad of ["0", "-2", "2.5", "dos", "", "03", "99999999999"]) expect(parsePartySize(bad), bad).toBeNull();
  });
});

describe("validateInformationRequest", () => {
  const ok = { requesterName: " Ana ", interestDate: "2026-12-25", partySize: 3, message: " Hola ", confirmed: true };
  it("acepta un cuerpo válido y recorta los textos", () => {
    expect(validateInformationRequest(ok, "2026-11-21").value).toEqual({ requesterName: "Ana", interestDate: "2026-12-25", partySize: 3, message: "Hola" });
  });
  it("acepta hoy y rechaza ayer", () => {
    expect(validateInformationRequest({ ...ok, interestDate: "2026-11-21" }, "2026-11-21").errors).toEqual([]);
    expect(validateInformationRequest({ ...ok, interestDate: "2026-11-20" }, "2026-11-21").errors.map((e) => e.code)).toEqual(["must_be_future"]);
  });
  it("los errores nunca repiten lo enviado ni el nombre de un campo desconocido", () => {
    const secret = "CANARIO-F030-7731";
    const { errors } = validateInformationRequest({ ...ok, [secret]: secret, requesterName: " ", message: "x".repeat(4097), partySize: 0, confirmed: false }, "2026-11-21");
    expect(JSON.stringify(errors)).not.toContain(secret);
    expect(errors.map((e) => e.field).sort()).toEqual(["body", "confirmed", "message", "partySize", "requesterName"]);
  });
});

describe("textos del bot", () => {
  const t = es.informationRequest;
  const sample = [
    t.button, t.proposeName("Ana"), t.useName, t.changeName, t.cancelButton, t.askName, t.nameInvalid, t.askDate, t.dateInvalid, t.datePast, t.askParty,
    t.partyInvalid, t.askMessage, t.messageInvalid, t.summary({ listing: "Ficha", name: "Ana", date: "25/12/2026", partySize: 3, message: "Hola" }),
    t.confirmButton, t.sent, t.cancelled, t.alreadySent, t.rateLimited, t.unavailable, t.expired, t.error,
  ];

  it("textos aprobados (D-182, D-183 y D-184)", () => {
    expect(t.button).toBe("Solicitar información");
    expect(t.cancelled).toBe("Solicitud cancelada.");
    expect(t.alreadySent).toBe("Esta solicitud ya fue enviada.");
    expect(t.rateLimited).toBe("Llegaste al límite de solicitudes de hoy. Intenta de nuevo mañana.");
    expect(t.unavailable).toBe("Esta ficha ya no recibe solicitudes.");
    expect(t.sent).toBe(`Tu solicitud fue enviada al prestador. ${APPROVED_PHRASE}`);
  });

  it("ninguno ofrece pagar, cupos, disponibilidad ni reserva, salvo la frase aprobada", () => {
    expect(forbiddenIn(sample)).toEqual([]);
    expect(forbiddenIn(["Reserva tu cupo"])).toHaveLength(1);
  });
});

describe("callback_data de B16", () => {
  it("el botón de solicitud cabe en 64 bytes y usa el prefijo de exploración", () => {
    const id = "5f0c1a10-0000-4000-8000-000000000001";
    const data = requestStartData(id, `exp:b:${pack(id)}:e100000`);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(data).toMatch(/^exp:r:[A-Za-z0-9_-]{22}:e100000$/);
  });
});

describe("configuración", () => {
  it("el límite de solicitudes es de 10 por día (ADR 0006) y se puede reemplazar con RATE_LIMITS", () => {
    expect(testConfig().rateLimits.information_request).toEqual({ limit: 10, windowSeconds: 86400 });
    expect(testConfig({ RATE_LIMITS: JSON.stringify({ information_request: { limit: 2, windowSeconds: 60 } }) }).rateLimits.information_request).toEqual({ limit: 2, windowSeconds: 60 });
  });
});
