import { isMemoryStorageEnabled, memoryStorage } from "@/server/storage";

// Rutas de prueba del doble en memoria (F020, criterio 41). Solo existen con STORAGE_DRIVER=memory fuera de producción;
// en cualquier otro caso responden 404 (criterio 39).
type TokenRoute = { params: Promise<{ token: string }> };
const notFound = () => new Response(null, { status: 404 });

// PUT del navegador a la URL de subida que emitió el doble: guarda los bytes si coinciden el tipo y el tamaño con que se firmó.
export async function putTestUpload(request: Request, context: TokenRoute): Promise<Response> {
  if (!isMemoryStorageEnabled()) return notFound();
  const { token } = await context.params;
  const bytes = new Uint8Array(await request.arrayBuffer());
  const { status } = memoryStorage().receiveUpload(token, bytes, request.headers.get("content-type") ?? "");
  return new Response(null, { status, headers: { "Access-Control-Allow-Origin": "*" } });
}

export async function optionsTestUpload(): Promise<Response> {
  if (!isMemoryStorageEnabled()) return notFound();
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "PUT", "Access-Control-Allow-Headers": "content-type" } });
}

// GET de la URL de lectura: devuelve los mismos bytes con su Content-Type.
export async function getTestRead(_request: Request, context: TokenRoute): Promise<Response> {
  if (!isMemoryStorageEnabled()) return notFound();
  const { token } = await context.params;
  const object = memoryStorage().readByToken(token);
  if (!object) return notFound();
  return new Response(object.bytes as BodyInit, { headers: { "Content-Type": object.contentType, "Cache-Control": "no-store" } });
}
