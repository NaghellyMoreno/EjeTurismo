// Almacén de fotografías (ADR 0009): subida directa por URL firmada, lectura por URL firmada y borrado.
export interface StoredFile {
  size: number;
  contentType: string;
  // Primeros bytes del archivo, para comprobar la firma de imagen (JPEG o PNG).
  firstBytes: Uint8Array;
}

export interface PhotoStorage {
  createUploadUrl(input: { pathname: string; contentType: string; maxSizeBytes: number; expiresAt: Date }): Promise<string>;
  inspect(pathname: string): Promise<StoredFile | null>;
  createReadUrl(pathname: string, expiresAt: Date): Promise<string>;
  delete(pathname: string): Promise<void>;
  // Todos los archivos del almacén (F038: la tarea de mantenimiento borra los que ninguna foto referencia).
  list(): Promise<string[]>;
}
