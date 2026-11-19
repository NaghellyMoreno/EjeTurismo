"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { components } from "@/shared/api/schema";
import { listingTexts, miniappTexts } from "./texts";
import { photoTexts as t } from "@/lib/photo-texts";
import { useProviderSession } from "./use-provider-session";

type Listing = components["schemas"]["ManagedListing"];
type Version = components["schemas"]["ListingVersion"];
type Loaded = { kind: "loading" } | { kind: "error" } | { kind: "forbidden" } | { kind: "ready"; listing: Listing };

const MAX_BYTES = 5_000_000;
const MAX_PHOTOS = 10;
const TYPES = ["image/jpeg", "image/png"];

// Versión cuyas fotos se pueden cambiar: el borrador de una ficha de prestador o la versión publicada de un atractivo (ADR 0009).
function editableVersion(listing: Listing): Version | null {
  if (listing.kind === "attraction") return listing.published ?? null;
  return listing.working?.status === "draft" ? listing.working : null;
}

// M06 (F020): fotos de una ficha. Subir (JPEG o PNG, hasta 5 MB, 10 por ficha) y quitar con confirmación. El cliente solo evita
// llamadas inútiles; el backend vuelve a comprobar tipo, tamaño, límites y permisos (invariante 1).
export function PhotosScreen({ listingId }: { listingId: string }) {
  const { session, setSession, client } = useProviderSession({ allowAdmin: true });
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // `tick` vuelve a pedir la ficha después de subir o quitar una foto (las URL firmadas vienen con cada lectura).
  const [tick, setTick] = useState(0);
  const reload = () => setTick((value) => value + 1);

  useEffect(() => {
    if (session.kind !== "ready") return;
    const api = client();
    if (!api) return;
    let cancelled = false;
    (async () => {
      const { data, response } = await api.GET("/api/v1/managed-listings/{listingId}", { params: { path: { listingId } } });
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
  }, [session.kind, listingId, client, setSession, tick]);

  // Texto del error del servidor: el `detail` de los códigos de fotos ya trae el texto aprobado.
  const failure = (status: number, problem: { code?: string; detail?: string } | undefined): string => {
    const known = ["photo_limit_exceeded", "photo_total_size_exceeded", "storage_quota_exceeded", "rate_limited", "validation_failed", "photo_too_large"];
    if (status === 409 || status === 422 || status === 429) return problem?.code && known.includes(problem.code) && problem.detail ? problem.detail : t.uploadFailed;
    return t.uploadFailed;
  };

  async function upload(file: File) {
    const api = client();
    if (!api || busyRef.current) return;
    setMessage(null);
    if (!TYPES.includes(file.type)) return setMessage({ kind: "error", text: t.invalidType });
    if (file.size > MAX_BYTES) return setMessage({ kind: "error", text: t.tooLarge });
    const version = loaded.kind === "ready" ? editableVersion(loaded.listing) : null;
    if (!version || loaded.kind !== "ready") return;
    busyRef.current = true;
    setBusy(true);
    try {
      const path = { listingId, versionId: version.id };
      const issued = await api.POST("/api/v1/managed-listings/{listingId}/versions/{versionId}/photo-uploads", {
        params: { path },
        body: { fileName: file.name.slice(0, 255) || "foto", contentType: file.type as "image/jpeg" | "image/png", sizeBytes: file.size },
      });
      if (issued.response.status === 401) return setSession({ kind: "session-error" });
      if (!issued.data) return setMessage({ kind: "error", text: failure(issued.response.status, issued.error) });
      const put = await fetch(issued.data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) return setMessage({ kind: "error", text: t.uploadFailed });
      const registered = await api.POST("/api/v1/managed-listings/{listingId}/versions/{versionId}/photos", { params: { path }, body: { uploadId: issued.data.uploadId } });
      if (registered.response.status === 401) return setSession({ kind: "session-error" });
      if (!registered.data) return setMessage({ kind: "error", text: failure(registered.response.status, registered.error) });
      reload();
    } catch {
      setMessage({ kind: "error", text: t.uploadFailed });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function remove(photoId: string) {
    const api = client();
    const version = loaded.kind === "ready" ? editableVersion(loaded.listing) : null;
    if (!api || !version || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const { response } = await api.DELETE("/api/v1/managed-listings/{listingId}/versions/{versionId}/photos/{photoId}", {
        params: { path: { listingId, versionId: version.id, photoId }, query: { confirmed: true } },
      });
      if (response.status === 401) return setSession({ kind: "session-error" });
      setRemoving(null);
      if (response.status === 204) setMessage({ kind: "info", text: t.removed });
      else setMessage({ kind: "error", text: t.uploadFailed });
      reload();
    } catch {
      setRemoving(null);
      setMessage({ kind: "error", text: t.uploadFailed });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const listing = loaded.kind === "ready" ? loaded.listing : null;
  const editable = listing ? editableVersion(listing) : null;
  const shown: Version | null = listing ? (editable ?? listing.working ?? listing.published ?? null) : null;
  const photos = shown?.photos ?? [];
  const full = photos.length >= MAX_PHOTOS;

  return (
    <main className="screen">
      <h1 data-testid="photos-title">{t.title}</h1>
      <section className="photo-list" aria-live="polite">
        {session.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {session.kind === "session-error" && <p data-testid="session-error">{miniappTexts.sessionExpired}</p>}
        {session.kind === "forbidden" && <p data-testid="photos-forbidden" role="alert">{listingTexts.forbidden}</p>}
        {session.kind === "ready" && loaded.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {session.kind === "ready" && loaded.kind === "error" && <p data-testid="photos-load-error" role="alert">{listingTexts.listError}</p>}
        {session.kind === "ready" && loaded.kind === "forbidden" && <p data-testid="photos-forbidden" role="alert">{listingTexts.forbidden}</p>}
        {listing && (
          <>
            <p data-testid="photos-counter">{t.counter(photos.length)}</p>
            {listing.kind === "attraction" && <p data-testid="photos-attraction-note">{t.attractionNote}</p>}
            {listing.kind !== "attraction" && listing.hasPublishedVersion && editable && <p data-testid="photos-published-note">{t.publishedNote}</p>}
            {listing.displayStatus === "pending" && <p data-testid="photos-locked">{listingTexts.locked}</p>}
            {message && <p data-testid="photos-message" role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
            {editable && (
              <>
                <p data-testid="photos-formats">{t.formats}</p>
                {full && <p data-testid="photos-limit">{t.limitReached}</p>}
                <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden tabIndex={-1} aria-hidden="true" data-testid="photo-file" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
                <p className="actions">
                  <button type="button" className="primary" data-testid="photo-upload" disabled={full || busy} onClick={() => fileRef.current?.click()}>{t.upload}</button>
                </p>
              </>
            )}
            <ul>
              {photos.map((photo) => (
                <li key={photo.id} data-testid="photo-item">
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de corta vigencia de otro origen; no se optimiza */}
                  <img src={photo.url} alt={t.alt(photo.position)} width={160} />
                  {editable && (
                    <p className="actions">
                      <button type="button" className="secondary" data-testid={`photo-remove-${photo.position}`} disabled={busy} onClick={() => setRemoving(photo.id)}>{t.remove(photo.position)}</button>
                    </p>
                  )}
                  {removing === photo.id && (
                    <div role="alertdialog" aria-labelledby={`photo-confirm-${photo.id}`}>
                      <p id={`photo-confirm-${photo.id}`} data-testid="photo-confirm">{t.removeConfirm}</p>
                      <p className="actions">
                        <button type="button" className="primary" data-testid="photo-remove-yes" disabled={busy} onClick={() => remove(photo.id)}>{t.removeYes}</button>
                        <button type="button" className="secondary" data-testid="photo-remove-no" disabled={busy} onClick={() => setRemoving(null)}>{t.removeNo}</button>
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {listing.kind !== "attraction" && (
              <p className="actions">
                <Link href={`/fichas/${listing.id}`} data-testid="photos-back">{listingTexts.detail.title}</Link>
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
