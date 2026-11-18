"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { components } from "@/shared/api/schema";
import { listingTexts as t, miniappTexts } from "./texts";
import { useProviderSession } from "./use-provider-session";

type Listing = components["schemas"]["ManagedListing"];
type Loaded = { kind: "loading" } | { kind: "error" } | { kind: "forbidden" } | { kind: "ready"; listing: Listing };

// M08 (F013): detalle de una ficha propia con su estado y su versión de trabajo.
export function ListingDetailScreen({ id }: { id: string }) {
  const { session, setSession, client } = useProviderSession();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    if (session.kind !== "ready") return;
    const api = client();
    if (!api) return;
    let cancelled = false;
    (async () => {
      const { data, response } = await api.GET("/api/v1/managed-listings/{listingId}", { params: { path: { listingId: id } } });
      if (cancelled) return;
      if (response.status === 401) return setSession({ kind: "session-error" });
      if (response.status === 403) return setLoaded({ kind: "forbidden" });
      setLoaded(data ? { kind: "ready", listing: data } : { kind: "error" });
    })().catch(() => {
      if (!cancelled) setLoaded({ kind: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [session.kind, id, client, setSession]);

  const working = loaded.kind === "ready" ? loaded.listing.working : null;
  const fields: [string, string, string | null | undefined][] = working
    ? [
        ["listing-name", t.form.nameLabel, working.content.name],
        ["listing-municipality", t.form.municipalityLabel, working.content.municipality.name],
        ["listing-category", t.form.categoryLabel, working.content.category?.name],
        ["listing-establishment-type", t.form.establishmentTypeLabel, working.content.establishmentType?.name],
        ["listing-description", t.form.descriptionLabel, working.content.description],
        ["listing-schedule", t.form.scheduleLabel, working.content.schedule],
        ["listing-contact", t.form.contactLabel, working.content.contact],
        ["listing-maps-url", t.form.mapsUrlLabel, working.content.mapsUrl],
      ]
    : [];

  return (
    <main className="screen">
      <h1 data-testid="listing-title">{t.detail.title}</h1>
      <section className="listing-list" aria-live="polite">
        {session.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {session.kind === "session-error" && <p data-testid="session-error">{miniappTexts.sessionExpired}</p>}
        {session.kind === "forbidden" && <p data-testid="listing-forbidden">{t.forbidden}</p>}
        {session.kind === "ready" && loaded.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {session.kind === "ready" && loaded.kind === "error" && <p data-testid="listing-load-error" role="alert">{t.listError}</p>}
        {session.kind === "ready" && loaded.kind === "forbidden" && <p data-testid="listing-forbidden">{t.forbidden}</p>}
        {session.kind === "ready" && loaded.kind === "ready" && (
          <>
            <p data-testid="listing-status">{t.status[loaded.listing.displayStatus]}</p>
            {!loaded.listing.hasPublishedVersion && <p data-testid="listing-not-published">{t.detail.notPublished}</p>}
            {working && (
              <div data-testid="listing-working">
                <h2>{t.detail.workingVersion}</h2>
                <dl>
                  {fields.map(([testId, label, value]) => (
                    <div key={testId}>
                      <dt>{label}</dt>
                      <dd data-testid={testId}>{value ?? ""}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <p className="actions">
              {loaded.listing.displayStatus === "draft" && (
                <Link href={`/fichas/${loaded.listing.id}/editar`} className="primary" data-testid="listing-edit">{t.detail.edit}</Link>
              )}
              <Link href="/fichas" data-testid="listing-back">{t.detail.back}</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
