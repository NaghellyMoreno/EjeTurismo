"use client";

import { ChevronDown, ChevronUp, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { es } from "@/bot/texts/es";
import { createApiClient } from "@/shared/api/client";
import type { components } from "@/shared/api/schema";
import { protectedText, revokeConfirmText } from "./home";
import { noticeText } from "./notice";
import { useBackHandler, useShell } from "./shell";
import { accountTexts as t, miniappTexts } from "./texts";

type Me = components["schemas"]["Me"];
type Api = ReturnType<typeof createApiClient>;
type State =
  | { kind: "loading" }
  | { kind: "session-error" }
  | { kind: "ready"; me: Me; flash?: string }
  | { kind: "confirm"; me: Me; error?: string }
  | { kind: "revoked"; message: string };

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
}

// Rol que se muestra: el administrador principal y el administrador prevalecen sobre el prestador (D-116).
const roleLabel = (me: Me) =>
  me.isPrincipalAdmin ? t.roles.principal : me.roles.includes("admin") ? t.roles.admin : me.roles.includes("provider") ? t.roles.provider : t.roles.none;

const dateFormat = new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "America/Bogota" });

// Pestaña Cuenta (D-206): datos básicos de `getMe`, el aviso aceptado y "Revocar mi autorización" con la frase de D-023 (M03).
// No muestra el ID de Telegram ni el número de identidad (sección 3.15). La regla de quién puede revocar es del backend.
export function AccountScreen() {
  const router = useRouter();
  const shell = useShell();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [notice, setNotice] = useState<{ open: boolean; text: string | null }>({ open: false, text: null });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    const webApp = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
    webApp?.ready?.();
    const initData = webApp?.initData ?? "";
    let cancelled = false;
    const set = (next: State) => {
      if (!cancelled) setState(next);
    };
    // Sin initData no hay sesión que verificar: M12 sin llamar al servidor.
    if (!initData) {
      set({ kind: "session-error" });
      return;
    }
    const api = createApiClient(initData);
    apiRef.current = api;
    api
      .GET("/api/v1/me")
      .then(({ data }) => {
        if (cancelled) return;
        if (!data) return setState({ kind: "session-error" });
        // Sin el aviso vigente aceptado, el inicio muestra M01.
        if (data.consent.required) return router.replace("/");
        setState({ kind: "ready", me: data });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "session-error" });
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // El gesto de volver en la confirmación la cancela sin cambios.
  useBackHandler(state.kind === "confirm", () => {
    if (state.kind !== "confirm") return false;
    setState({ kind: "ready", me: state.me, flash: es.selfRevoke.cancelled });
    return true;
  });

  async function toggleNotice() {
    if (notice.open) return setNotice({ ...notice, open: false });
    if (notice.text) return setNotice({ ...notice, open: true });
    const api = apiRef.current;
    const { data } = api ? await api.GET("/api/v1/privacy-notices/current") : { data: undefined };
    setNotice({ open: true, text: (data && noticeText(data)) || miniappTexts.noticeError });
  }

  async function revoke(current: Extract<State, { kind: "confirm" }>) {
    const api = apiRef.current;
    if (!api || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const { data, error, response } = await api.POST("/api/v1/consents/revocations", { body: { confirmed: true } });
      if (response.status === 401) return setState({ kind: "session-error" });
      if (data) {
        shell.setMe(null);
        return setState({ kind: "revoked", message: data.message });
      }
      const reason = response.status === 409 ? protectedText(error?.code) : null;
      setState(reason ? { kind: "ready", me: current.me, flash: reason } : { ...current, error: es.selfRevoke.error });
    } catch {
      setState({ ...current, error: es.selfRevoke.error });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <span className="section-kicker">{t.kicker}</span>
      <h1 data-testid="account-title">{t.title}</h1>
      <div aria-live="polite">
        {state.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {state.kind === "session-error" && <p data-testid="session-error">{miniappTexts.sessionExpired}</p>}
        {state.kind === "revoked" && <p className="notice" data-testid="self-revoke-done">{state.message}</p>}
        {state.kind === "ready" && (
          <>
            {state.flash && <p className="notice" data-testid="flash">{state.flash}</p>}
            <div className="settings-card" data-testid="account-data">
              <h2>
                <UserRound size={18} aria-hidden="true" /> {roleLabel(state.me)}
              </h2>
              <dl className="info-lines">
                <div>
                  <dt>{t.name}</dt>
                  <dd data-testid="account-name">{state.me.displayName ?? ""}</dd>
                </div>
                <div>
                  <dt>{t.role}</dt>
                  <dd data-testid="account-role">{roleLabel(state.me)}</dd>
                </div>
                <div>
                  <dt>{t.registration}</dt>
                  <dd data-testid="account-registration">{t.registrationStatus[state.me.providerRegistrationStatus]}</dd>
                </div>
                <div>
                  <dt>{t.notice}</dt>
                  <dd data-testid="account-notice">
                    {state.me.consent.acceptedVersion && state.me.consent.acceptedAt
                      ? t.noticeValue(state.me.consent.acceptedVersion, dateFormat.format(new Date(state.me.consent.acceptedAt)))
                      : ""}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="settings-card">
              <h2>
                <ShieldCheck size={18} aria-hidden="true" /> {t.notice}
              </h2>
              <button type="button" className="textlink" data-testid="account-notice-toggle" aria-expanded={notice.open} onClick={toggleNotice}>
                {notice.open ? t.hideNotice : t.showNotice}
                {notice.open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              </button>
              {notice.open && (
                <p className="notice-text" data-testid="account-notice-body">
                  {notice.text}
                </p>
              )}
            </div>
            {state.me.consent.canRevoke && (
              <div className="settings-card">
                <h2>{t.revokeTitle}</h2>
                <p data-testid="self-revoke-note">{es.selfRevoke.note}</p>
                <div className="actions">
                  <button type="button" className="primary" data-testid="self-revoke-button" onClick={() => setState({ kind: "confirm", me: state.me })}>
                    {es.selfRevoke.button}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {state.kind === "confirm" && (
          <div className="settings-card" role="alertdialog" aria-labelledby="self-revoke-confirm">
            <p id="self-revoke-confirm" data-testid="self-revoke-confirm">{revokeConfirmText(state.me)}</p>
            {state.error && <p data-testid="self-revoke-error" role="alert">{state.error}</p>}
            <div className="actions">
              <button type="button" className="primary" data-testid="self-revoke-yes" disabled={busy} onClick={() => revoke(state)}>
                {es.selfRevoke.confirmButton}
              </button>
              <button type="button" className="secondary" data-testid="self-revoke-no" disabled={busy} onClick={() => setState({ kind: "ready", me: state.me, flash: es.selfRevoke.cancelled })}>
                {es.selfRevoke.cancelButton}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
