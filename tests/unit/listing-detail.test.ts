import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { es } from "@/bot/texts/es";
import { buildListingDetailMessages, splitText, TELEGRAM_TEXT_LIMIT, type DetailFields } from "@/server/domain/listing-detail";

// F023, criterios 6, 16 y 17: texto del detalle (función pura), sin estado y textos en es.ts.
const labels = es.listingDetail;
const base = (guidesInfo?: string | null): DetailFields => ({
  name: "N".repeat(100),
  municipality: "Municipio Ficticio",
  category: "Categoria Ficticia",
  typeName: "Tipo Ficticio",
  description: "D".repeat(1500),
  schedule: "H".repeat(300),
  contact: "C".repeat(200),
  guidesInfo,
});
const guidesLabel = `${labels.guides}: `;

// Largo de guidesInfo con el que el texto único mide exactamente `total`.
const guidesFor = (total: number, filler = "g") => {
  const fixed = `${buildListingDetailMessages(base(null), labels)[0]}\n\n${guidesLabel}`.length;
  return filler.repeat(total - fixed);
};

describe("criterio 6: armado del texto", () => {
  it("con los máximos de D-042 y sin guías es un solo mensaje de 4096 o menos", () => {
    const messages = buildListingDetailMessages(base(null), labels);
    expect(messages).toHaveLength(1);
    expect(messages[0].length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    for (const label of [labels.municipality, labels.category, labels.type, labels.description, labels.schedule, labels.contact]) expect(messages[0]).toContain(`${label}: `);
  });

  it.each([4095, 4096])("con total %i es un solo mensaje que lleva las guías completas", (total) => {
    const guides = guidesFor(total);
    const messages = buildListingDetailMessages(base(guides), labels);
    expect(messages).toHaveLength(1);
    expect(messages[0].length).toBe(total);
    expect(messages[0].endsWith(`${guidesLabel}${guides}`)).toBe(true);
  });

  it("con total 4097 manda el texto principal y las guías aparte, sin cortar ningún campo", () => {
    const guides = guidesFor(4097);
    const messages = buildListingDetailMessages(base(guides), labels);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(buildListingDetailMessages(base(null), labels)[0]);
    expect(messages[1].startsWith(guidesLabel)).toBe(true);
    expect(messages[1].slice(guidesLabel.length)).toBe(guides);
    for (const message of messages) expect(message.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  });

  it("guías de 4096 caracteres con espacios y saltos de línea: completas, en trozos de 4096 o menos", () => {
    const guides = Array.from({ length: 400 }, (_, i) => (i % 7 === 0 ? `línea ${i}\n` : `palabra${i} `)).join("").slice(0, 4096);
    expect(guides).toHaveLength(4096);
    const messages = buildListingDetailMessages(base(guides), labels);
    const parts = messages.slice(1);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const message of messages) expect(message.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(parts.join("").slice(guidesLabel.length)).toBe(guides);
    // El separador queda al final del mensaje anterior.
    expect(/[\n ]$/.test(parts[0])).toBe(true);
  });

  it("guías de 4096 caracteres seguidos sin separador: el primer mensaje mide exactamente 4096", () => {
    const guides = "x".repeat(4096);
    const parts = buildListingDetailMessages(base(guides), labels).slice(1);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[0]).toHaveLength(TELEGRAM_TEXT_LIMIT);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(parts.join("").slice(guidesLabel.length)).toBe(guides);
  });

  it("guías nulas o vacías no generan mensaje de guías", () => {
    expect(buildListingDetailMessages(base(null), labels)).toHaveLength(1);
    expect(buildListingDetailMessages(base(undefined), labels)).toHaveLength(1);
    expect(buildListingDetailMessages(base(""), labels)).toHaveLength(1);
  });

  it("splitText no deja la etiqueta sola ni parte un par sustituto", () => {
    expect(splitText("ab cd", 3).join("")).toBe("ab cd");
    const emoji = "😀".repeat(3000);
    const parts = splitText(emoji, 4096);
    expect(parts.join("")).toBe(emoji);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(4096);
  });
});

describe("criterio 16: sin estado de módulo, sin integraciones", () => {
  const files = ["src/bot/listing-detail.ts", "src/server/domain/listing-detail.ts"];
  const codeOf = (file: string) =>
    readFileSync(resolve(process.cwd(), file), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|import\b)/.test(line))
      .map((line) => line.replace(/\s\/\/.*$/, ""))
      .join("\n");

  it("no declaran let, var ni colecciones mutables a nivel de módulo", () => {
    for (const file of files) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/^(let|var)\s/m);
      expect(code, file).not.toMatch(/^(export\s+)?const\s+\w+\s*(:[^=]+)?=\s*(new\s+(Map|Set)\(|\[\s*\]|\{\s*\})/m);
    }
  });

  it("no usan fetch ni nombran a Google", () => {
    for (const file of [...files, "src/bot/explore.ts"]) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/\bfetch\s*\(/);
      expect(code.toLowerCase(), file).not.toMatch(/google|axios|http:\/\/|https:\/\//);
    }
  });
});

describe("criterio 17: textos en es.ts", () => {
  it("existen y no están vacíos", () => {
    for (const value of Object.values(es.listingDetail)) expect(value).toBeTruthy();
    expect(es.listingDetail.photosUnavailable.length).toBeGreaterThan(0);
  });

  it("los archivos de src/bot tocados no tienen literales con acentos, ñ ni frases", () => {
    for (const file of ["src/bot/listing-detail.ts", "src/bot/explore.ts"]) {
      const code = readFileSync(resolve(process.cwd(), file), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|import\b)/.test(line))
        .map((line) => line.replace(/\s\/\/.*$/, ""))
        .join("\n");
      const literals = (code.match(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g) ?? []).filter((literal) => !/^["'`]exp:/.test(literal));
      for (const literal of literals) {
        expect(literal, `${file}: ${literal}`).not.toMatch(/[áéíóúüñÁÉÍÓÚÜÑ]/);
        expect(literal, `${file}: ${literal}`).not.toMatch(/\p{L}+\s+\p{L}+/u);
      }
    }
  });
});
