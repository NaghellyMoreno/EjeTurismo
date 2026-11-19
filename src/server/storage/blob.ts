import { get, issueSignedToken, presignUrl, del, type IssuedSignedToken } from "@vercel/blob";
import type { PhotoStorage, StoredFile } from "./types";

// Almacén privado de Vercel Blob (ADR 0009). Las credenciales salen del entorno (`BLOB_READ_WRITE_TOKEN` o `VERCEL_OIDC_TOKEN` con `BLOB_STORE_ID`).
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
const HEAD_BYTES = 16;

export class BlobStorage implements PhotoStorage {
  private readToken: IssuedSignedToken | undefined;

  // El token de lectura se reutiliza hasta poco antes de vencer para no llamar a la API de control en cada petición.
  private async signedReadToken(now: number): Promise<IssuedSignedToken> {
    if (!this.readToken || this.readToken.validUntil - TOKEN_MARGIN_MS <= now) {
      this.readToken = await issueSignedToken({ pathname: "*", operations: ["get"], validUntil: now + TOKEN_LIFETIME_MS });
    }
    return this.readToken;
  }

  async createUploadUrl(input: { pathname: string; contentType: string; maxSizeBytes: number; expiresAt: Date }): Promise<string> {
    const token = await issueSignedToken({ pathname: input.pathname, operations: ["put"], validUntil: input.expiresAt.getTime(), allowedContentTypes: [input.contentType], maximumSizeInBytes: input.maxSizeBytes });
    const { presignedUrl } = await presignUrl(token, {
      access: "private",
      operation: "put",
      pathname: input.pathname,
      validUntil: input.expiresAt.getTime(),
      allowedContentTypes: [input.contentType],
      maximumSizeInBytes: input.maxSizeBytes,
    });
    return presignedUrl;
  }

  async inspect(pathname: string): Promise<StoredFile | null> {
    const found = await get(pathname, { access: "private", useCache: false });
    if (!found || found.statusCode !== 200) return null;
    const reader = found.stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (length < HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
    }
    await reader.cancel().catch(() => undefined);
    const firstBytes = new Uint8Array(Math.min(length, HEAD_BYTES));
    let offset = 0;
    for (const chunk of chunks) {
      const part = chunk.subarray(0, Math.max(0, firstBytes.length - offset));
      firstBytes.set(part, offset);
      offset += part.length;
    }
    return { size: found.blob.size, contentType: found.blob.contentType, firstBytes };
  }

  async createReadUrl(pathname: string, expiresAt: Date): Promise<string> {
    const token = await this.signedReadToken(Date.now());
    const { presignedUrl } = await presignUrl(token, { access: "private", operation: "get", pathname, validUntil: Math.min(expiresAt.getTime(), token.validUntil) });
    return presignedUrl;
  }

  async delete(pathname: string): Promise<void> {
    await del(pathname);
  }
}
