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

// Agrupa el aviso preparado (con sus marcas de Markdown) en los 3 bloques de D-066 y D-072, solo entre apartados completos.
// La declaración va aparte. Lanza un error si un bloque queda vacío: no se mueven apartados por cuenta propia (contrato F001).
function noticeGroups(notice: NoticeText): { groups: [string, string, string]; declaration: string } {
  const groups: string[][] = [[], [], []];
  let current: 0 | 1 | 2 = 0;
  for (const line of prepareNoticeBody(notice).split("\n")) {
    const heading = /^### (\d+)\./.exec(line);
    if (heading) current = groupOf(Number(heading[1]));
    groups[current].push(line);
  }
  const joined = groups.map((lines) => lines.join("\n").trim());
  if (joined.some((g) => g === "")) throw new Error("El aviso no tiene los apartados esperados para los 3 mensajes");
  return { groups: joined as [string, string, string], declaration: notice.declarationText.trim() };
}

// Texto plano: quita los "### " de los títulos y los "**" de las negritas (D-143). Lo usa la Mini App (D-141).
export function noticePlainText(markdown: string): string {
  return markdown.replace(/^### /gm, "").replace(/\*\*(.+?)\*\*/g, "$1");
}

// Parte el aviso en 3 mensajes de texto plano, solo entre apartados completos. Lanza un error si un apartado no existe o si
// un mensaje pasa de 4096 caracteres (contrato F001, D-066).
export function buildNoticeMessages(notice: NoticeText): [string, string, string] {
  const { groups, declaration } = noticeGroups(notice);
  const messages = groups.map(noticePlainText);
  messages[2] = `${messages[2]}\n\n${declaration}`.trim();
  if (messages.some((m) => m.length > TELEGRAM_MESSAGE_LIMIT)) throw new Error("Un mensaje del aviso supera los 4096 caracteres");
  return messages as [string, string, string];
}

const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Títulos y negritas del aviso como <b>, con el resto escapado para parse_mode HTML (ADR 0006).
function noticeHtml(markdown: string): string {
  return escapeHtml(markdown)
    .replace(/^### (.+)$/gm, "<b>$1</b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

const expandable = (html: string) => `<blockquote expandable>${html}</blockquote>`;

// Los mismos 3 mensajes del bot en HTML (D-143): los apartados van en un bloque plegable de Telegram ("leer más"); la línea
// de versión del primer mensaje y la declaración del tercero quedan visibles. `tail` se agrega visible al final del tercero
// (la frase de D-023 para cuentas con versión anterior). El texto visible es el de `buildNoticeMessages`, así que el límite
// de 4096 caracteres se comprueba sobre él: Telegram no cuenta las etiquetas.
export function buildNoticeHtmlMessages(notice: NoticeText, tail?: string): [string, string, string] {
  const plain = buildNoticeMessages(notice);
  if (tail && `${plain[2]}\n\n${tail}`.length > TELEGRAM_MESSAGE_LIMIT) throw new Error("Un mensaje del aviso supera los 4096 caracteres");
  const { groups, declaration } = noticeGroups(notice);
  const [titleLine, ...rest] = groups[0].split("\n");
  const first = `${noticeHtml(titleLine)}\n\n${expandable(noticeHtml(rest.join("\n").trim()))}`;
  const second = expandable(noticeHtml(groups[1]));
  const third = [expandable(noticeHtml(groups[2])), escapeHtml(declaration), ...(tail ? [escapeHtml(tail)] : [])].join("\n\n");
  return [first, second, third];
}
