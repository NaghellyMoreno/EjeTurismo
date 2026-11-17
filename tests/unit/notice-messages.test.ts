import { describe, expect, it } from "vitest";
import { buildNoticeHtmlMessages, buildNoticeMessages, DATE_PLACEHOLDER, noticePlainText, TELEGRAM_MESSAGE_LIMIT } from "@/server/domain/notice";
import { readNoticeSource } from "../helpers/notice-source";

const publishedAt = new Date("2026-11-16T03:30:00Z"); // 15 de noviembre de 2026 en Bogotá

function expectedJoined(clean = true) {
  const source = readNoticeSource({ keepAnnotations: !clean });
  // Tercera transformación (D-143): sin los "### " de los títulos ni los "**" de las negritas.
  const body = noticePlainText(source.body.replaceAll(DATE_PLACEHOLDER, "15 de noviembre de 2026"));
  return { source, text: `${body}\n\n${source.declaration}` };
}

describe("aviso en 3 mensajes (criterios 1 y 2; D-066, D-072)", () => {
  const { source, text } = expectedJoined();
  const messages = buildNoticeMessages({ bodyMarkdown: source.body, declarationText: source.declaration, publishedAt });

  it("son exactamente 3 mensajes de máximo 4096 caracteres", () => {
    expect(messages).toHaveLength(3);
    for (const m of messages) expect(m.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it("se parten solo entre apartados completos: título y 1 a 4; 5 a 9; 10 a 13 y la declaración", () => {
    const apartados = (m: string) => [...m.matchAll(/^(\d+)\. /gm)].map((x) => Number(x[1]));
    expect(messages[0].startsWith("Eje Turismo. Aviso de privacidad, versión 2026-11-v3.")).toBe(true);
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

describe("sin marcas de Markdown en el texto plano (D-143)", () => {
  const { source } = expectedJoined();
  const messages = buildNoticeMessages({ bodyMarkdown: source.body, declarationText: source.declaration, publishedAt });

  it("no quedan ### ni ** y los títulos se conservan como líneas normales", () => {
    const all = messages.join("\n");
    expect(all).not.toMatch(/^#/m);
    expect(all).not.toContain("**");
    expect(messages[2]).toMatch(/^10\. Si no aceptas este aviso$/m);
  });
});

describe("aviso del bot en HTML con apartados plegables (D-143)", () => {
  const { source } = expectedJoined();
  const notice = { bodyMarkdown: source.body, declarationText: source.declaration, publishedAt };
  const html = buildNoticeHtmlMessages(notice);
  const plain = buildNoticeMessages(notice);
  const visible = (m: string) =>
    m.replace(/<\/?(b|blockquote)( expandable)?>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

  it("son 3 mensajes con un bloque plegable cada uno y títulos en negrita, sin ### ni **", () => {
    expect(html).toHaveLength(3);
    for (const m of html) {
      expect(m.match(/<blockquote expandable>/g)).toHaveLength(1);
      expect(m).not.toMatch(/^#/m);
      expect(m).not.toContain("**");
    }
    expect(html[0]).toContain("<b>1. Quién trata tus datos</b>");
    expect(html[2]).toContain("<b>10. Si no aceptas este aviso</b>");
  });

  it("la línea de versión y la declaración quedan fuera del bloque plegable", () => {
    expect(html[0].startsWith("<b>Eje Turismo. Aviso de privacidad, versión 2026-11-v3.")).toBe(true);
    expect(html[0].indexOf("<blockquote expandable>")).toBeGreaterThan(html[0].indexOf("Vigente desde"));
    expect(html[2].endsWith(`</blockquote>\n\n${source.declaration}`)).toBe(true);
  });

  it("el texto visible es el mismo del texto plano, así que cabe en 4096 caracteres", () => {
    expect(html.map(visible)).toEqual(plain);
    for (const m of html.map(visible)) expect(m.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it("agrega la frase de D-023 visible al final del tercero cuando se pide", () => {
    const tail = "El número de identidad se usa solo para verificar tu identidad y atender tu solicitud de registro como prestador.";
    const withTail = buildNoticeHtmlMessages(notice, tail);
    expect(withTail[2].endsWith(`${source.declaration}\n\n${tail}`)).toBe(true);
    expect(withTail[0]).toBe(html[0]);
  });

  it("escapa <, > y & del texto para parse_mode HTML", () => {
    const odd = { ...notice, declarationText: "Acepto <términos> & condiciones" };
    expect(buildNoticeHtmlMessages(odd)[2].endsWith("Acepto &lt;términos&gt; &amp; condiciones")).toBe(true);
  });
});
