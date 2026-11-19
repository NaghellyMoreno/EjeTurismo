import { InlineKeyboard } from "grammy";
import { isGoogleMapsUrl } from "@/server/domain/maps-url";
import { es } from "./texts/es";

// Teclado con un único botón de tipo URL hacia la ubicación de la ficha (F021, D-163). Telegram abre el enlace;
// no pasa por callback ni por nuestro servidor. Un enlace vacío o que no sea de Google Maps es un error de quien llama.
export function buildLocationKeyboard(mapsUrl: unknown): InlineKeyboard {
  if (typeof mapsUrl !== "string" || !isGoogleMapsUrl(mapsUrl)) throw new Error("invalid_maps_url");
  return new InlineKeyboard().url(es.location.button, mapsUrl);
}
