import { randomUUID } from "node:crypto";
import type { PhotoStorage, StoredFile } from "./types";

export type StorageCall = { type: "createUploadUrl" | "inspect" | "createReadUrl" | "delete"; pathname: string };

interface UploadGrant {
  pathname: string;
  contentType: string;
  maxSizeBytes: number;
  expiresAt: number;
}

// Dirección absoluta (el contrato pide `format: uri`); en el navegador de pruebas es el mismo origen de la Mini App.
const absolute = (path: string): string => new URL(path, process.env.APP_BASE_URL ?? "http://localhost:3000").toString();

// Doble en memoria del almacén (F020, criterio 41): solo para pruebas y vista previa, nunca en producción (lo decide `getStorage`).
// Las URL apuntan a las rutas `/api/test-storage/...`, que guardan y devuelven los bytes de este mismo objeto.
export class MemoryStorage implements PhotoStorage {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly calls: StorageCall[] = [];
  private readonly uploads = new Map<string, UploadGrant>();
  private readonly reads = new Map<string, string>();

  async createUploadUrl(input: { pathname: string; contentType: string; maxSizeBytes: number; expiresAt: Date }): Promise<string> {
    this.calls.push({ type: "createUploadUrl", pathname: input.pathname });
    const token = randomUUID();
    this.uploads.set(token, { pathname: input.pathname, contentType: input.contentType, maxSizeBytes: input.maxSizeBytes, expiresAt: input.expiresAt.getTime() });
    return absolute(`/api/test-storage/upload/${token}`);
  }

  async inspect(pathname: string): Promise<StoredFile | null> {
    this.calls.push({ type: "inspect", pathname });
    const object = this.objects.get(pathname);
    if (!object) return null;
    return { size: object.bytes.length, contentType: object.contentType, firstBytes: object.bytes.slice(0, 16) };
  }

  async createReadUrl(pathname: string): Promise<string> {
    this.calls.push({ type: "createReadUrl", pathname });
    const token = randomUUID();
    this.reads.set(token, pathname);
    return absolute(`/api/test-storage/read/${token}`);
  }

  async delete(pathname: string): Promise<void> {
    this.calls.push({ type: "delete", pathname });
    this.objects.delete(pathname);
  }

  // PUT del navegador: acepta el archivo con el tipo y el tamaño con que se firmó la URL.
  receiveUpload(token: string, bytes: Uint8Array, contentType: string, now = Date.now()): { status: number } {
    const grant = this.uploads.get(token);
    if (!grant || grant.expiresAt <= now) return { status: 403 };
    if (contentType !== grant.contentType || bytes.length > grant.maxSizeBytes) return { status: 400 };
    this.objects.set(grant.pathname, { bytes, contentType });
    return { status: 200 };
  }

  readByToken(token: string): { bytes: Uint8Array; contentType: string } | null {
    const pathname = this.reads.get(token);
    return pathname ? (this.objects.get(pathname) ?? null) : null;
  }

  // Para las pruebas: pone un archivo directo (por ejemplo, uno de tamaño distinto del declarado).
  put(pathname: string, bytes: Uint8Array, contentType: string): void {
    this.objects.set(pathname, { bytes, contentType });
  }

  deletedPathnames(): string[] {
    return this.calls.filter((call) => call.type === "delete").map((call) => call.pathname);
  }

  reset(): void {
    this.objects.clear();
    this.calls.length = 0;
    this.uploads.clear();
    this.reads.clear();
  }
}

// Una sola instancia por proceso, también entre las rutas de Next (que pueden cargar el módulo más de una vez).
const GLOBAL_KEY = Symbol.for("eje-turismo.memory-storage");
export function memoryStorage(): MemoryStorage {
  const holder = globalThis as unknown as Record<symbol, MemoryStorage | undefined>;
  return (holder[GLOBAL_KEY] ??= new MemoryStorage());
}
