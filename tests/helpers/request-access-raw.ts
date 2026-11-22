import {
  changeInformationRequestStatusHandler,
  getInformationRequestHandler,
  listMyBusinessInformationRequestsHandler,
  replyToInformationRequestHandler,
} from "@/server/http/handlers";
import type { Deps } from "@/server/http/deps";

// F033: las cuatro operaciones con encabezados dados tal cual (sin sesión, alterado o vencido).
export function createHandlersForTamperedHeaders(deps: Deps, headers: Record<string, string>) {
  const base = "http://localhost/api/v1/information-requests";
  const json = { "Content-Type": "application/json", ...headers };
  const ctx = (id: string) => ({ params: Promise.resolve({ requestId: id }) });
  return {
    list: () => listMyBusinessInformationRequestsHandler(deps)(new Request(base, { headers })),
    get: (id: string) => getInformationRequestHandler(deps)(new Request(`${base}/${id}`, { headers }), ctx(id)),
    reply: (id: string, body: unknown) => replyToInformationRequestHandler(deps)(new Request(`${base}/${id}/replies`, { method: "POST", headers: json, body: JSON.stringify(body) }), ctx(id)),
    change: (id: string, body: unknown) => changeInformationRequestStatusHandler(deps)(new Request(`${base}/${id}/status-changes`, { method: "POST", headers: json, body: JSON.stringify(body) }), ctx(id)),
  };
}
