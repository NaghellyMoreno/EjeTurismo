import { type Context, GrammyError, InputFile, InputMediaBuilder } from "grammy";
import { buildListingDetailMessages } from "@/server/domain/listing-detail";
import { logError } from "@/server/observability/logger";
import { downloadPublishedPhoto, type PublicListingDetail } from "@/server/services";
import { requestStartData } from "./callback-ids";
import { buildLocationKeyboard } from "./location-keyboard";
import { send } from "./send";
import { es } from "./texts/es";

type Photo = PublicListingDetail["photos"][number];

// Errores de Telegram que indican que no pudo descargar la URL firmada: solo estos activan el respaldo (ADR 0008). Cualquier otro
// (429, 500...) no se resuelve descargando y reenviando.
const URL_ERROR = /wrong file identifier|failed to get HTTP URL content/i;
const isUrlError = (error: unknown) => error instanceof GrammyError && error.error_code === 400 && URL_ERROR.test(error.description);

const extensionOf = (contentType: string) => (contentType === "image/png" ? "png" : "jpg");

// Envía las fotos de la versión publicada, sin pie. Devuelve falso si no se pudieron enviar (se registra sin URLs ni datos personales).
async function sendPhotos(ctx: Context, photos: Photo[]): Promise<boolean> {
  if (photos.length === 0) return true;
  const chatId = ctx.chatId ?? ctx.from!.id;
  const byUrl = () => (photos.length === 1 ? ctx.api.sendPhoto(chatId, photos[0].url) : ctx.api.sendMediaGroup(chatId, photos.map((photo) => InputMediaBuilder.photo(photo.url))));
  try {
    await byUrl();
    return true;
  } catch (error) {
    if (!isUrlError(error)) {
      logError("bot.photos_failed", error);
      return false;
    }
  }
  try {
    const files = await Promise.all(
      photos.map(async (photo, index) => {
        const { bytes, contentType } = await downloadPublishedPhoto(photo.url);
        return new InputFile(bytes, `foto-${index + 1}.${extensionOf(contentType)}`);
      }),
    );
    if (files.length === 1) await ctx.api.sendPhoto(chatId, files[0]);
    else await ctx.api.sendMediaGroup(chatId, files.map((file) => InputMediaBuilder.photo(file)));
    return true;
  } catch (error) {
    logError("bot.photos_failed", error);
    return false;
  }
}

// B16 (F023): fotos y texto del detalle. `back` es el `callback_data` de "Volver"; los botones van solo en el último mensaje.
export async function showListingDetail(ctx: Context, detail: PublicListingDetail, back: string): Promise<void> {
  if (!(await sendPhotos(ctx, detail.photos))) await send(ctx, es.listingDetail.photosUnavailable);
  const messages = buildListingDetailMessages(
    {
      name: detail.name,
      municipality: detail.municipality.name,
      category: detail.category.name,
      typeName: detail.establishmentType?.name ?? detail.experienceType?.name,
      description: detail.description,
      schedule: detail.schedule,
      contact: detail.contact,
      guidesInfo: detail.guidesInfo,
    },
    es.listingDetail,
  );
  const keyboard = buildLocationKeyboard(detail.mapsUrl);
  // B19 (F030): solo las fichas que aceptan solicitudes (el backend lo calcula; también para el dueño, D-184).
  if (detail.acceptsRequests) keyboard.row().text(es.informationRequest.button, requestStartData(detail.id, back));
  keyboard.row().text(es.explore.back, back);
  for (const [index, text] of messages.entries()) await send(ctx, text, index === messages.length - 1 ? keyboard : undefined);
}
