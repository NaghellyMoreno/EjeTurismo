"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { es } from "@/bot/texts/es";
import { createApiClient } from "@/shared/api/client";
import type { components } from "@/shared/api/schema";
import { homeTitle, homeView, homeViewText, protectedText, revokeConfirmText } from "./home";
import { noticeText } from "./notice";
import { attractionTexts, catalogTexts, miniappTexts } from "./texts";

type Me = components["schemas"]["Me"];
type Api = ReturnType<typeof createApiClient>;

// Pantallas: M12 (`session-error`), M01 (`notice` y `declined`), M02 (`home`), M03 (`confirm` y `revoked`).
type State =
  | { kind: "loading" }
  | { kind: "session-error" }
  | { kind: "notice-error" }
  | { kind: "notice"; me: Me; text: string; version: string; flash?: string }
  | { kind: "declined"; me: Me; text: string; version: string }
  | { kind: "home"; me: Me; flash?: string }
  | { kind: "confirm"; me: Me; text?: string; version?: string; error?: string }
  | { kind: "revoked"; message: string };

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
}

// El aviso vigente es público; si no se puede leer o no tiene los apartados esperados no se muestran botones de aceptar.
async function fetchNotice(api: Api): Promise<{ text: string; version: string } | null> {
  const { data } = await api.GET("/api/v1/privacy-notices/current");
  const text = data ? noticeText(data) : null;
  return data && text ? { text, version: data.version } : null;
}

// Pantalla que corresponde a lo que informa `getMe`: aviso pendiente (M01) o inicio (M02).
async function stateFor(api: Api, me: Me): Promise<State> {
  if (!me.consent.required) return { kind: "home", me };
  const notice = await fetchNotice(api);
  return notice ? { kind: "notice", me, ...notice } : { kind: "notice-error" };
}

// M01, M02, M03 y M12: lee `getMe` con el `initData` de Telegram en cada apertura; no guarda nada de la cuenta en el navegador.
// La Mini App no decide nada: aceptar y revocar pasan por el servidor, que verifica la firma y las reglas (invariante 1).
export function HomeScreen() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    const webApp = (
      window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }
    ).Telegram?.WebApp;
    webApp?.ready?.();
    const initData = webApp?.initData ?? "";
    let cancelled = false;
    const set = (next: State) => {
      if (!cancelled) setState(next);
    };
    // Sin initData no hay sesión que verificar: se muestra M12 sin llamar al servidor.
    if (!initData) {
      set({ kind: "session-error" });
      return;
    }
    const api = createApiClient(initData);
    apiRef.current = api;
    api
      .GET("/api/v1/me")
      .then(async ({ data, response }) => {
        if (response.status === 401) return set({ kind: "session-error" });
        set(data ? await stateFor(api, data) : { kind: "notice-error" });
      })
      .catch(() => set({ kind: "notice-error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Una sola petición a la vez: el botón queda deshabilitado y un segundo clic no envía nada.
  async function run(action: (api: Api) => Promise<State>) {
    const api = apiRef.current;
    if (!api || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setState(await action(api));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const accept = (current: Extract<State, { kind: "notice" }>) =>
    run(async (api) => {
      try {
        const { data, response } = await api.POST("/api/v1/consents", { body: { noticeVersion: current.version, accepted: true, channel: "mini_app" } });
        if (response.status === 401) return { kind: "session-error" };
        if (data) return { kind: "home", me: data };
        // La versión vigente cambió: se pide de nuevo el aviso vigente y no se guarda nada.
        if (response.status === 409) {
          const notice = await fetchNotice(api);
          return notice ? { ...current, ...notice, flash: undefined } : { kind: "notice-error" };
        }
      } catch {
        // Cae en el aviso de error de más abajo.
      }
      return { ...current, flash: miniappTexts.acceptError };
    });

  const revoke = (current: Extract<State, { kind: "confirm" }>) =>
    run(async (api) => {
      try {
        const { data, error, response } = await api.POST("/api/v1/consents/revocations", { body: { confirmed: true } });
        if (response.status === 401) return { kind: "session-error" };
        if (data) return { kind: "revoked", message: data.message };
        // 409: el motivo del servidor y vuelve al inicio sin cambios.
        const reason = response.status === 409 ? protectedText(error?.code) : null;
        if (reason) return backHome(current, reason);
      } catch {
        // Cae en el aviso de error de más abajo.
      }
      return { ...current, error: es.selfRevoke.error };
    });

  // Vuelve al inicio: M02 con el aviso vigente aceptado y M01 si la cuenta tiene una versión anterior.
  const backHome = (current: Extract<State, { kind: "confirm" }>, flash: string): State =>
    current.text && current.version
      ? { kind: "notice", me: current.me, text: current.text, version: current.version, flash }
      : { kind: "home", me: current.me, flash };

  return (
    <main className="screen">
      <h1 id="miniapp-title">{homeTitle}</h1>
      <section data-testid="miniapp-home" aria-live="polite">
        {state.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {state.kind === "session-error" && <p data-testid="session-error">{miniappTexts.sessionExpired}</p>}
        {state.kind === "notice-error" && <p data-testid="notice-error">{miniappTexts.noticeError}</p>}
        {state.kind === "notice" && (
          <>
            {state.flash && <p data-testid="flash">{state.flash}</p>}
            <div role="region" aria-labelledby="miniapp-title" data-testid="notice">
              <p className="notice-text" data-testid="notice-body">{state.text}</p>
              {state.me.consent.canRevoke && <p data-testid="self-revoke-note">{es.selfRevoke.note}</p>}
            </div>
            <div className="actions">
              <button type="button" className="primary" data-testid="notice-accept" disabled={busy} onClick={() => accept(state)}>
                {es.notice.accept}
              </button>
              <button type="button" className="secondary" data-testid="notice-decline" disabled={busy} onClick={() => setState({ kind: "declined", me: state.me, text: state.text, version: state.version })}>
                {es.notice.decline}
              </button>
              {state.me.consent.canRevoke && (
                <button
                  type="button"
                  className="primary"
                  data-testid="self-revoke-button"
                  disabled={busy}
                  onClick={() => setState({ kind: "confirm", me: state.me, text: state.text, version: state.version })}
                >
                  {es.selfRevoke.button}
                </button>
              )}
            </div>
          </>
        )}
        {state.kind === "declined" && (
          <>
            <p data-testid="declined">{miniappTexts.declined}</p>
            <div className="actions">
              <button type="button" className="primary" data-testid="decline-show-again" onClick={() => setState({ kind: "notice", me: state.me, text: state.text, version: state.version })}>
                {es.decline.showAgain}
              </button>
            </div>
          </>
        )}
        {state.kind === "home" && (
          <>
            {state.flash && <p data-testid="flash">{state.flash}</p>}
            <p data-testid={homeView(state.me)}>{homeViewText[homeView(state.me)]}</p>
            {homeView(state.me) === "role-admin" && (
              <>
                <p>
                  <Link href="/municipios" data-testid="municipalities-link">
                    {miniappTexts.adminMunicipalitiesLink}
                  </Link>
                </p>
                <p>
                  <Link href="/catalogos" data-testid="catalog-link">
                    {catalogTexts.link}
                  </Link>
                </p>
                <p>
                  <Link href="/atractivos" data-testid="attractions-link">
                    {attractionTexts.link}
                  </Link>
                </p>
              </>
            )}
            {state.me.consent.canRevoke && (
              <>
                <p data-testid="self-revoke-note">{es.selfRevoke.note}</p>
                <div className="actions">
                  <button type="button" className="primary" data-testid="self-revoke-button" onClick={() => setState({ kind: "confirm", me: state.me })}>
                    {es.selfRevoke.button}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {state.kind === "confirm" && (
          <>
            <p data-testid="self-revoke-confirm">{revokeConfirmText(state.me)}</p>
            {state.error && <p data-testid="self-revoke-error">{state.error}</p>}
            <div className="actions">
              <button type="button" className="primary" data-testid="self-revoke-yes" disabled={busy} onClick={() => revoke(state)}>
                {es.selfRevoke.confirmButton}
              </button>
              <button
                type="button"
                className="secondary"
                data-testid="self-revoke-no"
                disabled={busy}
                onClick={() => setState(state.text && state.version ? { kind: "notice", me: state.me, text: state.text, version: state.version, flash: es.selfRevoke.cancelled } : { kind: "home", me: state.me, flash: es.selfRevoke.cancelled })}
              >
                {es.selfRevoke.cancelButton}
              </button>
            </div>
          </>
        )}
        {state.kind === "revoked" && <p data-testid="self-revoke-done">{state.message}</p>}
      </section>
    </main>
  );
}
