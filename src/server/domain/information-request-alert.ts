import { formatBotDate } from "./information-request";

// B14 (F031): texto plano de la alerta al prestador (D-188). Sin parse_mode, así que lo escrito por el visitante llega literal.
export const TELEGRAM_TEXT_LIMIT = 4096;

export interface AlertData {
  listingName: string;
  requesterName: string;
  interestDate: string; // AAAA-MM-DD, tal como se guardó (sin conversión de zona horaria)
  partySize: number;
  message: string;
}

// Recorta a `max` unidades terminando en "…", sin partir un par sustituto.
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max < 1) return "";
  let out = text.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return `${out}…`;
}

const compose = (d: AlertData, name: string, message: string) =>
  [
    "Nueva solicitud de información",
    `Ficha: ${d.listingName}`,
    `Nombre: ${name}`,
    `Fecha de interés: ${formatBotDate(d.interestDate)}`,
    `Personas: ${d.partySize}`,
    `Mensaje: ${message}`,
  ].join("\n");

// Si pasa de 4096 se recorta primero el mensaje y, si el nombre solo ya no cabe, también el nombre; fecha y personas se conservan.
export function renderInformationRequestAlert(d: AlertData): string {
  const full = compose(d, d.requesterName, d.message);
  if (full.length <= TELEGRAM_TEXT_LIMIT) return full;
  const budget = TELEGRAM_TEXT_LIMIT - compose(d, "", "").length;
  const messageRoom = budget - d.requesterName.length;
  if (messageRoom >= 1) return compose(d, d.requesterName, clip(d.message, messageRoom));
  return compose(d, clip(d.requesterName, budget - 1), "…");
}
