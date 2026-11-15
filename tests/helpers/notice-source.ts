import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Marcas de anotación de docs/05-aviso-privacidad.md (contrato F001, criterio 2, transformación a).
export const ANNOTATION_PATTERN = / \[(?:Confirmado|Inferido|Pendiente)[^\]]*\]/g;

export interface NoticeSource {
  body: string;
  declaration: string;
  revocationNote: string;
}

// Lee el texto aprobado de docs/05-aviso-privacidad.md: Texto 1 (sin marcas), declaración 2.1 y frase de D-023.
export function readNoticeSource(
  options: { keepAnnotations?: boolean; file?: string } = {},
): NoticeSource {
  const file = options.file ?? resolve(process.cwd(), "docs/05-aviso-privacidad.md");
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("**Eje Turismo. Aviso de privacidad"));
  const end = lines.findIndex((l, i) => i > start && l.trim() === "---");
  if (start < 0 || end < 0) throw new Error("No se encontró el Texto 1 en docs/05-aviso-privacidad.md");
  const raw = lines.slice(start, end).join("\n");
  const body = (options.keepAnnotations ? raw : raw.replace(ANNOTATION_PATTERN, "")).trim();
  return {
    body,
    declaration: quoteAfter(lines, "### 2.1."),
    revocationNote: quoteAfter(lines, "### 2.2."),
  };
}

function quoteAfter(lines: string[], heading: string): string {
  const from = lines.findIndex((l) => l.startsWith(heading));
  const first = lines.findIndex((l, i) => i > from && l.startsWith("> "));
  if (from < 0 || first < 0) throw new Error(`No se encontró la cita bajo ${heading}`);
  const out: string[] = [];
  for (let i = first; i < lines.length && lines[i].startsWith("> "); i++) out.push(lines[i].slice(2));
  return out.join("\n").trim();
}
