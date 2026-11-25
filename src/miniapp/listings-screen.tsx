"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { components } from "@/shared/api/schema";
import { listingTexts as t, miniappTexts } from "./texts";
import { useProviderSession } from "./use-provider-session";

type Summary = components["schemas"]["ManagedListingSummary"];
type Loaded = { kind: "loading" } | { kind: "error" } | { kind: "ready"; items: Summary[] };

// M04 (F013): mis fichas. Solo prestador; el backend filtra por negocio (invariante 2).
export function ListingsScreen() {
  const { session, setSession, client } = useProviderSession();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    if (session.kind !== "ready") return;
    const api = client();
    if (!api) return;
    let cancelled = false;
    (async () => {
      const { data, response } = await api.GET("/api/v1/managed-listings", { params: { query: { pageSize: 50 } } });
      if (cancelled) return;
      if (response.status === 401) return setSession({ kind: "session-error" });
      if (response.status === 403) return setSession({ kind: "forbidden" });
      setLoaded(data ? { kind: "ready", items: data.items } : { kind: "error" });
    })().catch(() => {
      if (!cancelled) setLoaded({ kind: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [session.kind, client, setSession]);

  return (
    <main className="screen">
      <h1 data-testid="listing-title">{t.list.title}</h1>
      <section className="listing-list" aria-live="polite">
        {session.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {session.kind === "session-error" && <p data-testid="session-error">{miniappTexts.sessionExpired}</p>}
        {session.kind === "forbidden" && <p data-testid="listing-forbidden" role="alert">{t.forbidden}</p>}
        {session.kind === "ready" && (
          <>
            {loaded.kind === "loading" && <p>{miniappTexts.loading}</p>}
            {loaded.kind === "error" && <p data-testid="listing-load-error" role="alert">{t.listError}</p>}
            {loaded.kind === "ready" && loaded.items.length === 0 && <p data-testid="listing-empty">{t.list.empty}</p>}
            {loaded.kind === "ready" && loaded.items.length > 0 && (
              <ul>
                {loaded.items.map((item) => (
                  <li key={item.id} data-testid={`listing-row-${item.id}`}>
                    <Link href={`/fichas/${item.id}`} data-testid={`listing-open-${item.id}`}>{item.name}</Link>
                    <span data-testid={`listing-municipality-${item.id}`}>{item.municipality.name}</span>
                    <span className={`badge badge-${item.displayStatus}`} data-testid={`listing-status-${item.id}`}>{t.status[item.displayStatus]}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="actions">
              <Link href="/fichas/nueva" className="primary" data-testid="listing-new">{t.list.new}</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
