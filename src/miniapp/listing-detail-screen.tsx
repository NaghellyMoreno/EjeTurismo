"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { components } from "@/shared/api/schema";
import { listingEditTexts as edit, listingReviewTexts as review, listingTexts as t, miniappTexts } from "./texts";
import { photoTexts } from "@/lib/photo-texts";
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

  // La versión de trabajo (borrador, pendiente o rechazada) y, aparte, la publicada (F015: ambas conviven en una edición).
  const working = loaded.kind === "ready" ? loaded.listing.working : null;
  const published = loaded.kind === "ready" ? loaded.listing.published : null;
  const fieldsOf = (version: NonNullable<typeof working>, prefix: string): [string, string, string | null | undefined][] => [
    [`${prefix}-name`, t.form.nameLabel, version.content.name],
    [`${prefix}-municipality`, t.form.municipalityLabel, version.content.municipality.name],
    [`${prefix}-category`, t.form.categoryLabel, version.content.category?.name],
    [`${prefix}-establishment-type`, t.form.establishmentTypeLabel, version.content.establishmentType?.name],
    [`${prefix}-description`, t.form.descriptionLabel, version.content.description],
    [`${prefix}-schedule`, t.form.scheduleLabel, version.content.schedule],
    [`${prefix}-contact`, t.form.contactLabel, version.content.contact],
    [`${prefix}-maps-url`, t.form.mapsUrlLabel, version.content.mapsUrl],
  ];
  const blocks = [
    working && { testId: "listing-working", title: t.detail.workingVersion, fields: fieldsOf(working, "listing") },
    published && { testId: "listing-published", title: null, fields: fieldsOf(published, working ? "listing-published" : "listing") },
  ].filter((block) => block !== null && block !== undefined);

  return (
    <main className="screen">
      <h1 data-testid="listing-title">{t.detail.title}</h1>
      <section className="listing-list" aria-live="polite">
        {session.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {session.kind === "session-error" && <p data-testid="session-error">{miniappTexts.sessionExpired}</p>}
        {session.kind === "forbidden" && <p data-testid="listing-forbidden" role="alert">{t.forbidden}</p>}
        {session.kind === "ready" && loaded.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {session.kind === "ready" && loaded.kind === "error" && <p data-testid="listing-load-error" role="alert">{t.listError}</p>}
        {session.kind === "ready" && loaded.kind === "forbidden" && <p data-testid="listing-forbidden" role="alert">{t.forbidden}</p>}
        {session.kind === "ready" && loaded.kind === "ready" && (
          <>
            <p data-testid="listing-status">{t.status[loaded.listing.displayStatus]}</p>
            {!loaded.listing.hasPublishedVersion && <p data-testid="listing-not-published">{t.detail.notPublished}</p>}
            {loaded.listing.displayStatus === "pending" && <p data-testid="listing-pending-note">{review.pendingNote}</p>}
            {loaded.listing.hasPublishedVersion && working && <p data-testid="listing-still-visible">{edit.stillVisible}</p>}
            {loaded.listing.lastRejection && (
              <div data-testid="listing-rejection">
                <h2>{review.rejectionReason}</h2>
                <p data-testid="listing-rejection-reason">{loaded.listing.lastRejection.reason}</p>
                {loaded.listing.displayStatus === "rejected" && <p data-testid="listing-rejected-note">{review.rejectedNote}</p>}
                {loaded.listing.displayStatus === "published" && working?.status === "rejected" && <p data-testid="listing-rejected-edit-note">{edit.rejectedEditNote}</p>}
              </div>
            )}
            {blocks.map((block) => (
              <div key={block.testId} data-testid={block.testId}>
                {block.title && <h2>{block.title}</h2>}
                <dl>
                  {block.fields.map(([testId, label, value]) => (
                    <div key={testId}>
                      <dt>{label}</dt>
                      <dd data-testid={testId}>{value ?? ""}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            {(working ?? published) && (
              <ul data-testid="listing-photos">
                {(working ?? published)!.photos.map((photo) => (
                  <li key={photo.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de corta vigencia de otro origen; no se optimiza */}
                    <img src={photo.url} alt={photoTexts.alt(photo.position)} width={160} />
                  </li>
                ))}
              </ul>
            )}
            <p className="actions">
              {working && (
                <Link href={`/fichas/${loaded.listing.id}/fotos`} data-testid="listing-photos-link">{photoTexts.title}</Link>
              )}
              {loaded.listing.displayStatus === "draft" && (
                <Link href={`/fichas/${loaded.listing.id}/editar`} className="primary" data-testid="listing-edit">{t.detail.edit}</Link>
              )}
              {loaded.listing.displayStatus === "published" && !working && (
                <Link href={`/fichas/${loaded.listing.id}/editar`} className="primary" data-testid="listing-edit-published">{edit.editPublished}</Link>
              )}
              {working?.status === "rejected" && (
                <Link href={`/fichas/${loaded.listing.id}/editar`} className="primary" data-testid="listing-correct">{review.correct}</Link>
              )}
              <Link href="/fichas" data-testid="listing-back">{t.detail.back}</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
