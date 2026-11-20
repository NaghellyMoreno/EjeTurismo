// Armado del texto del detalle de una ficha publicada (F023, ADR 0008). Función pura: sin acceso a la base ni a Telegram.
export const TELEGRAM_TEXT_LIMIT = 4096;

export interface DetailLabels {
  municipality: string;
  category: string;
  type: string;
  description: string;
  schedule: string;
  contact: string;
  guides: string;
}

export interface DetailFields {
  name: string;
  municipality: string;
  category: string;
  typeName?: string | null;
  description: string;
  schedule: string;
  contact: string;
  guidesInfo?: string | null;
}

// Parte `text` en trozos de `limit` o menos: el corte va tras el último salto de línea o espacio que quepa (el separador queda al final del
// trozo anterior); sin separador, en el carácter `limit`. `protectedPrefix` (la etiqueta) nunca queda sola en un trozo.
export function splitText(text: string, limit: number = TELEGRAM_TEXT_LIMIT, protectedPrefix = 0): string[] {
  const chunks: string[] = [];
  let rest = text;
  let prefix = protectedPrefix;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const separator = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    let cut = separator >= prefix ? separator + 1 : limit;
    const last = rest.charCodeAt(cut - 1);
    if (cut === limit && last >= 0xd800 && last <= 0xdbff) cut -= 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    prefix = 0;
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

// Mensajes de texto en el orden de envío. Si todo cabe en un mensaje, uno solo; si no, el texto principal y después los datos de guías
// (con su etiqueta al inicio), repartidos sin cortar contenido. El último mensaje es el que lleva los botones.
export function buildListingDetailMessages(fields: DetailFields, labels: DetailLabels): string[] {
  const field = (label: string, value: string) => `${label}: ${value}`;
  const main = [
    fields.name,
    "",
    field(labels.municipality, fields.municipality),
    field(labels.category, fields.category),
    ...(fields.typeName ? [field(labels.type, fields.typeName)] : []),
    "",
    field(labels.description, fields.description),
    field(labels.schedule, fields.schedule),
    field(labels.contact, fields.contact),
  ].join("\n");
  if (!fields.guidesInfo) return [main];
  const guidesLabel = `${labels.guides}: `;
  const whole = `${main}\n\n${guidesLabel}${fields.guidesInfo}`;
  if (whole.length <= TELEGRAM_TEXT_LIMIT) return [whole];
  return [main, ...splitText(`${guidesLabel}${fields.guidesInfo}`, TELEGRAM_TEXT_LIMIT, guidesLabel.length)];
}
