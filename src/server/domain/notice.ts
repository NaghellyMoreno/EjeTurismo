import { formatBogotaDate } from "@/lib/time";

// Marcas de anotación de docs/05-aviso-privacidad.md al final de un párrafo. La semilla ya las trae quitadas; se limpian
// otra vez por si una versión nueva las deja (contrato F001, criterio 2, transformación a).
export const ANNOTATION_PATTERN = / \[(?:Confirmado|Inferido|Pendiente)[^\]]*\]/g;
export const DATE_PLACEHOLDER = "[fecha de publicación en producción]";
// Límite de un mensaje de texto de la Bot API (ADR 0008).
export const TELEGRAM_MESSAGE_LIMIT = 4096;

export interface NoticeText {
  bodyMarkdown: string;
  declarationText: string;
  publishedAt: Date;
}

// Apartados de cada mensaje (D-066, D-072): título y 1 a 4; 5 a 9; 10 a 13 y la declaración.
function groupOf(apartado: number): 0 | 1 | 2 {
  return apartado <= 4 ? 0 : apartado <= 9 ? 1 : 2;
}

// Texto del aviso para mostrarlo: sin marcas y con la fecha de vigencia en America/Bogota ("15 de noviembre de 2026").
export function prepareNoticeBody(notice: Pick<NoticeText, "bodyMarkdown" | "publishedAt">): string {
  return notice.bodyMarkdown
    .replace(ANNOTATION_PATTERN, "")
    .replaceAll(DATE_PLACEHOLDER, formatBogotaDate(notice.publishedAt))
    .trim();
}

// Parte el aviso en 3 mensajes, solo entre apartados completos. Lanza un error si un apartado no existe o si un
// mensaje pasa de 4096 caracteres: no se mueven apartados por cuenta propia (contrato F001, D-066).
export function buildNoticeMessages(notice: NoticeText): [string, string, string] {
  const groups: string[][] = [[], [], []];
  let current: 0 | 1 | 2 = 0;
  for (const line of prepareNoticeBody(notice).split("\n")) {
    const heading = /^### (\d+)\./.exec(line);
    if (heading) current = groupOf(Number(heading[1]));
    groups[current].push(line);
  }
  const messages = groups.map((lines) => lines.join("\n").trim());
  messages[2] = `${messages[2]}\n\n${notice.declarationText.trim()}`.trim();
  if (messages.some((m) => m === "")) throw new Error("El aviso no tiene los apartados esperados para los 3 mensajes");
  if (messages.some((m) => m.length > TELEGRAM_MESSAGE_LIMIT)) throw new Error("Un mensaje del aviso supera los 4096 caracteres");
  return messages as [string, string, string];
}
