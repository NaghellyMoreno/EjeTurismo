"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { createApiClient } from "@/shared/api/client";
import type { components } from "@/shared/api/schema";
import { attractionTexts as t, miniappTexts } from "./texts";
import { photoTexts } from "@/lib/photo-texts";

type Municipality = components["schemas"]["Municipality"];
type CatalogItem = components["schemas"]["CatalogItem"];
type FieldError = components["schemas"]["FieldError"];

const FIELDS = ["name", "municipalityId", "categoryId", "description", "schedule", "contact", "mapsUrl"] as const;
type Field = (typeof FIELDS)[number];
type Draft = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;

const EMPTY: Draft = { name: "", municipalityId: "", categoryId: "", description: "", schedule: "", contact: "", mapsUrl: "" };
const isField = (value: string): value is Field => (FIELDS as readonly string[]).includes(value);

type Screen =
  | { kind: "loading" }
  | { kind: "session-error" }
  | { kind: "forbidden" }
  | { kind: "ready"; municipalities: Municipality[]; categories: CatalogItem[]; loadFailed: boolean };

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
}

// M09 (F012): solo el administrador. El rol se comprueba con `getMe` antes de pedir las listas; el backend vuelve a decidir
// en cada petición. Municipio y categoría solo se eligen de las listas del servidor (D-124); nunca se escriben.
export function AttractionScreen() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  // F020: el atractivo recién creado enlaza a M06 para agregarle fotos.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const clientRef = useRef<ReturnType<typeof createApiClient> | null>(null);

  useEffect(() => {
    const webApp = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
    webApp?.ready?.();
    const initData = webApp?.initData ?? "";
    let cancelled = false;
    (async () => {
      // Sin initData no hay sesión que verificar: M12 sin llamar al servidor.
      if (!initData) return setScreen({ kind: "session-error" });
      const client = createApiClient(initData);
      clientRef.current = client;
      const me = await client.GET("/api/v1/me");
      if (cancelled) return;
      if (!me.data) return setScreen({ kind: "session-error" });
      if (me.data.consent.required || !me.data.roles.includes("admin")) return setScreen({ kind: "forbidden" });
      const [municipalities, categories] = await Promise.all([client.GET("/api/v1/municipalities"), client.GET("/api/v1/categories")]);
      if (cancelled) return;
      if (municipalities.response.status === 401 || categories.response.status === 401) return setScreen({ kind: "session-error" });
      if (municipalities.response.status === 403 || categories.response.status === 403) return setScreen({ kind: "forbidden" });
      setScreen({
        kind: "ready",
        municipalities: municipalities.data ?? [],
        categories: categories.data ?? [],
        loadFailed: !municipalities.data || !categories.data,
      });
    })().catch(() => {
      if (!cancelled) setScreen({ kind: "session-error" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const change = (field: Field, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setCreated(false);
  };

  // Solo comprueba que el campo no esté vacío; los espacios, los límites y el enlace los decide el servidor.
  function submit(event: FormEvent) {
    event.preventDefault();
    const missing: Errors = {};
    for (const field of FIELDS) if (draft[field] === "") missing[field] = t.required[field];
    setErrors(missing);
    setSummary(null);
    setCreated(false);
    if (Object.keys(missing).length === 0) setConfirming(true);
  }

  async function confirm() {
    const client = clientRef.current;
    if (!client || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const { data, response, error } = await client.POST("/api/v1/managed-listings", { body: { kind: "attraction", content: draft, confirmed: true } });
      if (response.status === 401) return setScreen({ kind: "session-error" });
      if (response.status === 403) return setScreen({ kind: "forbidden" });
      setConfirming(false);
      if (response.status === 201) {
        setDraft(EMPTY);
        setErrors({});
        setSummary(null);
        setCreatedId(data?.id ?? null);
        return setCreated(true);
      }
      if (response.status === 409) return setErrors({ name: t.duplicate });
      if (response.status === 422) {
        const fromServer: Errors = {};
        for (const item of (error?.errors ?? []) as FieldError[]) if (isField(item.field) && !fromServer[item.field]) fromServer[item.field] = item.message;
        setErrors(fromServer);
        return setSummary(t.invalid);
      }
      setSummary(t.genericError);
    } catch {
      setConfirming(false);
      setSummary(t.genericError);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Etiqueta asociada por `htmlFor`; el mensaje de error queda fuera de la etiqueta y enlazado con `aria-describedby`.
  const row = (field: Field, label: string, control: (props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode) => {
    const id = `attraction-field-${field}`;
    const message = errors[field];
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        {control({ id, ...(message ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {}) })}
        {message && (
          <p id={`${id}-error`} data-testid={`attraction-error-${field}`} role="alert">
            {message}
          </p>
        )}
      </div>
    );
  };

  const text = (field: Field, label: string, testId: string) =>
    row(field, label, (props) => <input {...props} data-testid={testId} value={draft[field]} onChange={(event) => change(field, event.target.value)} />);

  const list = (field: "municipalityId" | "categoryId", label: string, testId: string, items: { id: string; name: string }[]) =>
    row(field, label, (props) => (
      <select {...props} data-testid={testId} value={draft[field]} onChange={(event) => change(field, event.target.value)}>
        <option value="">{t.selectPlaceholder}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
    ));

  return (
    <main className="screen">
      <h1 data-testid="attraction-title">{t.title}</h1>
      <div aria-live="polite">
        {screen.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {screen.kind === "session-error" && <p data-testid="session-error">{miniappTexts.sessionExpired}</p>}
        {screen.kind === "forbidden" && <p data-testid="attraction-forbidden">{t.forbidden}</p>}
        {screen.kind === "ready" && (
          <section className="attraction-form">
            {screen.loadFailed && <p data-testid="attraction-lists-error" role="alert">{t.listsError}</p>}
            {created && <p data-testid="attraction-created">{t.created}</p>}
            {created && createdId && <Link href={`/fichas/${createdId}/fotos`} data-testid="attraction-photos-link">{photoTexts.title}</Link>}
            <form onSubmit={submit} noValidate>
              {text("name", t.nameLabel, "attraction-name")}
              {list("municipalityId", t.municipalityLabel, "attraction-municipality", screen.municipalities)}
              {list("categoryId", t.categoryLabel, "attraction-category", screen.categories)}
              {row("description", t.descriptionLabel, (props) => (
                <textarea {...props} data-testid="attraction-description" rows={4} value={draft.description} onChange={(event) => change("description", event.target.value)} />
              ))}
              {text("schedule", t.scheduleLabel, "attraction-schedule")}
              {text("contact", t.contactLabel, "attraction-contact")}
              {text("mapsUrl", t.mapsUrlLabel, "attraction-maps-url")}
              {summary && <p data-testid="attraction-error" role="alert">{summary}</p>}
              {!confirming && (
                <button type="submit" className="primary" data-testid="attraction-save">{t.save}</button>
              )}
            </form>
            {confirming && (
              <div role="alertdialog" aria-labelledby="attraction-confirm-text">
                <p id="attraction-confirm-text" data-testid="attraction-confirm">{t.confirmCreate(draft.name.trim())}</p>
                <div className="actions">
                  <button type="button" className="primary" data-testid="attraction-confirm-yes" disabled={busy} onClick={confirm}>{t.confirm}</button>
                  <button type="button" className="secondary" data-testid="attraction-confirm-no" disabled={busy} onClick={() => setConfirming(false)}>{t.cancel}</button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
