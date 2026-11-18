// Validador único del enlace de Google Maps (ADR 0016, D-044). Solo analiza el texto: no llama a ninguna API de Google,
// no usa claves ni coordenadas (invariante 6). La lista de hosts es Inferida y se ajusta aquí.
export const MAPS_URL_MAX = 2048;

// Cada host con la ruta que debe empezar (`null`: cualquier ruta).
const HOSTS: Record<string, string | null> = {
  "google.com": "/maps",
  "www.google.com": "/maps",
  "maps.google.com": null,
  "maps.app.goo.gl": null,
  "goo.gl": "/maps",
};

export function isGoogleMapsUrl(value: string): boolean {
  if (value.length > MAPS_URL_MAX) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return false;
  if (!Object.hasOwn(HOSTS, url.hostname)) return false;
  const prefix = HOSTS[url.hostname];
  return prefix === null || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
}
