import createClient from "openapi-fetch";
import type { paths } from "./schema";

// Cliente tipado de la Mini App (ADR 0013): cada petición lleva `Authorization: tma <initData>`; el servidor valida la firma.
export function createApiClient(initData: string, baseUrl = "") {
  return createClient<paths>({ baseUrl, headers: { Authorization: `tma ${initData}` }, cache: "no-store" });
}
