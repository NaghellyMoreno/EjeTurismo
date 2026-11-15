import { describe, expect, it } from "vitest";
import { buildNoticeMessages, DATE_PLACEHOLDER, TELEGRAM_MESSAGE_LIMIT } from "@/server/domain/notice";
import { readNoticeSource } from "../helpers/notice-source";

const publishedAt = new Date("2026-11-16T03:30:00Z"); // 15 de noviembre de 2026 en Bogotá

function expectedJoined(clean = true) {
  const source = readNoticeSource({ keepAnnotations: !clean });
  return { source, text: `${source.body.replaceAll(DATE_PLACEHOLDER, "15 de noviembre de 2026")}\n\n${source.declaration}` };
}

describe("aviso en 3 mensajes (criterios 1 y 2; D-066, D-072)", () => {
  const { source, text } = expectedJoined();
  const messages = buildNoticeMessages({ bodyMarkdown: source.body, declarationText: source.declaration, publishedAt });

  it("son exactamente 3 mensajes de máximo 4096 caracteres", () => {
    expect(messages).toHaveLength(3);
    for (const m of messages) expect(m.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it("se parten solo entre apartados completos: título y 1 a 4; 5 a 9; 10 a 13 y la declaración", () => {
    const apartados = (m: string) => [...m.matchAll(/^### (\d+)\./gm)].map((x) => Number(x[1]));
    expect(messages[0].startsWith("**Eje Turismo. Aviso de privacidad, versión 2026-11-v3.")).toBe(true);
    expect(apartados(messages[0])).toEqual([1, 2, 3, 4]);
    expect(apartados(messages[1])).toEqual([5, 6, 7, 8, 9]);
    expect(apartados(messages[2])).toEqual([10, 11, 12, 13]);
    expect(messages[2].endsWith(source.declaration)).toBe(true);
  });

  it("unidos en orden son el Texto 1 más la declaración, con la fecha de vigencia en Bogotá", () => {
    expect(messages.join("\n\n")).toBe(text);
    expect(messages[0]).toContain("Vigente desde 15 de noviembre de 2026.");
    expect(messages.join("")).not.toContain(DATE_PLACEHOLDER);
  });

  it("quita las marcas de anotación del texto original de docs/05", () => {
    const raw = expectedJoined(false).source;
    expect(raw.body).toMatch(/\[(Confirmado|Inferido|Pendiente)/);
    const fromRaw = buildNoticeMessages({ bodyMarkdown: raw.body, declarationText: raw.declaration, publishedAt });
    expect(fromRaw.join("\n\n")).toBe(text);
    expect(fromRaw.join("")).not.toMatch(/\[(Confirmado|Inferido|Pendiente)/);
  });

  it("no incluye la frase de D-023 (es del apartado 2.2, de F034)", () => {
    expect(messages.join("\n")).not.toContain("El número de identidad se usa solo para verificar");
  });

  it("conserva la indicación de correo y teléfono del apartado 8 (criterio 14)", () => {
    expect(messages[1]).toContain("karen.moreno35879@ucaldas.edu.co");
    expect(messages[1]).toContain("305 382 7085");
  });

  it("falla con un error claro si un mensaje no cabe en 4096 caracteres o faltan apartados", () => {
    const big = `${source.body}\n${"x".repeat(5000)}`;
    expect(() => buildNoticeMessages({ bodyMarkdown: big, declarationText: source.declaration, publishedAt })).toThrow(/4096/);
    expect(() => buildNoticeMessages({ bodyMarkdown: "solo título", declarationText: "d", publishedAt })).toThrow(/apartados/);
  });
});
