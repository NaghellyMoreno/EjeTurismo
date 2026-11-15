import { z } from "zod";
import type { components } from "@/shared/api/schema";
import type { Actor } from "@/server/auth/actor";
import { assertConsented } from "@/server/auth/consent-guard";
import { parseAuthorization, verifyInitData } from "@/server/auth/init-data";
import { logError } from "@/server/observability/logger";
import { acceptPrivacyNotice, getConsentState, getCurrentPrivacyNotice, getMe } from "@/server/services";
import type { ConsentState } from "@/server/services";
import type { Deps } from "./deps";
import { fromError, internalError, json, problem, unauthenticated } from "./problem";

type PrivacyNoticeBody = components["schemas"]["PrivacyNotice"];

// Valida `Authorization: tma <initData>` sin tocar la base (ADR 0003). Devuelve el actor o la respuesta 401.
export function authenticate(request: Request, deps: Deps): Actor | Response {
  const raw = parseAuthorization(request.headers.get("authorization"));
  if (!raw) return unauthenticated();
  const config = deps.config();
  const identity = verifyInitData(raw, config.botToken, config.initDataMaxAgeSeconds, deps.now());
  return identity ?? unauthenticated();
}

async function guarded(event: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const known = fromError(error);
    if (known) return known;
    logError(event, error);
    return internalError();
  }
}

// GET /api/v1/privacy-notices/current (getCurrentPrivacyNotice): público, no guarda nada.
export function getCurrentPrivacyNoticeHandler(deps: Deps) {
  return () =>
    guarded("privacy_notice.get_failed", async () => {
      const notice = await getCurrentPrivacyNotice(deps.db());
      const body: PrivacyNoticeBody = {
        version: notice.version,
        bodyMarkdown: notice.bodyMarkdown,
        declarationText: notice.declarationText,
        ...(notice.revocationNote ? { revocationNote: notice.revocationNote } : {}),
        publishedAt: notice.publishedAt.toISOString(),
      };
      return json(body);
    });
}

// GET /api/v1/me (getMe): solo lectura.
export function getMeHandler(deps: Deps) {
  return (request: Request) =>
    guarded("me.get_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      return json(await getMe(deps.db(), actor));
    });
}

// Estricto: campos desconocidos se rechazan (ADR 0006). `channel` se acepta pero la API HTTP siempre registra `mini_app`.
const acceptBody = z.strictObject({
  noticeVersion: z.string().min(1),
  accepted: z.literal(true),
  channel: z.enum(["bot", "mini_app"]).optional(),
});

// POST /api/v1/consents (acceptPrivacyNotice). El 401 va antes que el 422.
export function acceptPrivacyNoticeHandler(deps: Deps) {
  return (request: Request) =>
    guarded("consent.accept_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;

      const parsed = acceptBody.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) {
        const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "body")))];
        return problem(422, "validation_failed", "Revisa los campos marcados.",
          fields.map((field) => ({
            field,
            code: field === "body" ? "invalid_format" : "required",
            message: field === "accepted" ? "Debes aceptar el aviso." : "Revisa este campo.",
          })));
      }
      const me = await acceptPrivacyNotice(deps.db(), actor, { noticeVersion: parsed.data.noticeVersion, channel: "mini_app" }, deps.now());
      return json(me, 201);
    });
}

// Envuelve una operación que exige el aviso vigente aceptado (403 `consent_required`). F001 no lo usa en ninguna ruta:
// lo usarán las funcionalidades siguientes (se prueba sobre una ruta de ejemplo).
export function withConsentGuard(
  deps: Deps,
  handler: (actor: Actor, request: Request) => Promise<Response>,
  load: (actor: Actor) => Promise<ConsentState> = (actor) => getConsentState(deps.db(), actor.telegramUserId),
) {
  return (request: Request) =>
    guarded("consent.guard_failed", async () => {
      const actor = authenticate(request, deps);
      if (actor instanceof Response) return actor;
      assertConsented(await load(actor));
      return handler(actor, request);
    });
}
