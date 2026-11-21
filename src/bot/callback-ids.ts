// Identificadores compactos para `callback_data` (máximo 64 bytes): cada UUID viaja en base64url (22 caracteres).
// `callback_data` solo identifica la acción; nunca autoriza nada (ADR 0006).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const pack = (uuid: string) => Buffer.from(uuid.replaceAll("-", ""), "hex").toString("base64url");

// Nulo si el texto no es un UUID empaquetado canónico (mal formado, truncado o alterado).
export function unpack(text: string): string | null {
  if (text.length !== 22) return null;
  const hex = Buffer.from(text, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID.test(uuid) && pack(uuid) === text ? uuid : null;
}

// B19 (F030): "Solicitar información" desde B16. Usa el prefijo `exp:` de la exploración (exp:r:), por ser un botón del detalle B16. Lleva la ficha y lo que sigue al último ":" del "Volver" de B16 (`exp:b:<ficha>:<origen><página>`),
// para que cancelar regrese al mismo detalle.
export const REQUEST_PREFIX = "ir:";
export const REQUEST_START = "exp:r:";
export const requestStartData = (listingId: string, back: string) => `${REQUEST_START}${pack(listingId)}:${back.slice(back.lastIndexOf(":") + 1)}`;
