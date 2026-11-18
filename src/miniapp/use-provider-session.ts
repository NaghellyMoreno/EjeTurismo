"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient } from "@/shared/api/client";

export type Api = ReturnType<typeof createApiClient>;
export type Session = { kind: "loading" } | { kind: "session-error" } | { kind: "forbidden" } | { kind: "ready" };

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
}

// Sesión de las pantallas del prestador (F013). Sin `initData` o con `getMe` rechazado: M12 sin más llamadas. El rol se lee
// de `getMe` solo para decidir qué mostrar; el backend vuelve a decidir en cada petición (invariante 1).
export function useProviderSession(): { session: Session; setSession: (next: Session) => void; client: () => Api | null } {
  const [session, setSession] = useState<Session>({ kind: "loading" });
  const clientRef = useRef<Api | null>(null);

  useEffect(() => {
    const webApp = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
    webApp?.ready?.();
    const initData = webApp?.initData ?? "";
    let cancelled = false;
    (async () => {
      if (!initData) return setSession({ kind: "session-error" });
      const client = createApiClient(initData);
      clientRef.current = client;
      const me = await client.GET("/api/v1/me");
      if (cancelled) return;
      if (!me.data) return setSession({ kind: "session-error" });
      if (me.data.consent.required || !me.data.roles.includes("provider") || me.data.roles.includes("admin")) return setSession({ kind: "forbidden" });
      setSession({ kind: "ready" });
    })().catch(() => {
      if (!cancelled) setSession({ kind: "session-error" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const client = useCallback(() => clientRef.current, []);
  return { session, setSession, client };
}
