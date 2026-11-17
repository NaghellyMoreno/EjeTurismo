"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createApiClient } from "@/shared/api/client";
import { type HomeView, homeTitle, homeView, homeViewText } from "./home";
import { miniappTexts } from "./texts";

type State = { kind: "loading" } | { kind: "error" } | { kind: "view"; view: HomeView };

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
}

// M02 y M12: lee `getMe` con el `initData` de Telegram en cada apertura; no guarda nada de la cuenta en el navegador.
export function HomeScreen() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const webApp = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
    webApp?.ready?.();
    const initData = webApp?.initData ?? "";
    let cancelled = false;
    // Sin initData no hay sesión que verificar: se muestra M12 sin llamar al servidor.
    const request = initData ? createApiClient(initData).GET("/api/v1/me") : Promise.resolve({ data: undefined });
    request
      .then(({ data }) => {
        if (!cancelled) setState(data ? { kind: "view", view: homeView(data) } : { kind: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="screen">
      <h1>{homeTitle}</h1>
      <section data-testid="miniapp-home" aria-live="polite">
        {state.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {state.kind === "error" && <p data-testid="session-error">{miniappTexts.sessionExpired}</p>}
        {state.kind === "view" && <p data-testid={state.view}>{homeViewText[state.view]}</p>}
        {state.kind === "view" && state.view === "role-admin" && (
          <p>
            <Link href="/municipios" data-testid="municipalities-link">
              {miniappTexts.adminMunicipalitiesLink}
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}
