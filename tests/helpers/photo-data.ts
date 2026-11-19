// Archivos ficticios de F020: imágenes mínimas con firma válida, rellenadas hasta el tamaño pedido.
export const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00];
export const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];

const fill = (head: number[], size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  bytes.set(head.slice(0, size));
  return bytes;
};

// JPEG ficticio de `size` bytes (por defecto, uno diminuto).
export const jpegBytes = (size = 125): Uint8Array => fill(JPEG_HEAD, size);
export const pngBytes = (size = 90): Uint8Array => fill(PNG_HEAD, size);
export const textBytes = (): Uint8Array => new TextEncoder().encode("esto no es una imagen, es texto con extensión .jpg");
export const pdfBytes = (): Uint8Array => new TextEncoder().encode("%PDF-1.4\n%ficticio\n");
