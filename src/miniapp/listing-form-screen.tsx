"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { components } from "@/shared/api/schema";
import { listingTexts as t, miniappTexts } from "./texts";
import { type Api, useProviderSession } from "./use-provider-session";

type Municipality = components["schemas"]["Municipality"];
type CatalogItem = components["schemas"]["CatalogItem"];
type FieldError = components["schemas"]["FieldError"];

const FIELDS = ["name", "municipalityId", "categoryId", "establishmentTypeId", "description", "schedule", "contact", "mapsUrl"] as const;
type Field = (typeof FIELDS)[number];
type Draft = Record<Field, string>;
// Los 7 campos que se exigen al enviar a revisión (D-003); el tipo de establecimiento es opcional (D-040).
const REQUIRED = ["name", "municipalityId", "categoryId", "description", "schedule", "contact", "mapsUrl"] as const;
type ErrorKey = Field | "thirdPartyAuthorizationDeclared";
type Errors = Partial<Record<ErrorKey, string>>;

const EMPTY: Draft = { name: "", municipalityId: "", categoryId: "", establishmentTypeId: "", description: "", schedule: "", contact: "", mapsUrl: "" };
const isErrorKey = (value: string): value is ErrorKey => value === "thirdPartyAuthorizationDeclared" || (FIELDS as readonly string[]).includes(value);

type Lists = { municipalities: Municipality[]; categories: CatalogItem[]; types: CatalogItem[]; failed: boolean };
type Step = "loading" | "ready" | "locked" | "forbidden" | "submitted";
type Dialog = null | "save" | "submit";
type Outcome = { ok: true; id: string } | { ok: false };

// M05 y M07 (F013): formulario de la ficha de establecimiento y envío a revisión. Municipio, categoría y tipo se eligen solo de
// las listas del servidor. Solo comprueba que los campos no estén vacíos; los espacios, los límites y el enlace los decide el
// servidor. Ninguna petición sale sin confirmar (invariante 8).
export function ListingFormScreen({ listingId }: { listingId?: string }) {
  const router = useRouter();
  const { session, setSession, client } = useProviderSession();
  const [step, setStep] = useState<Step>("loading");
  const [lists, setLists] = useState<Lists>({ municipalities: [], categories: [], types: [], failed: false });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const idRef = useRef<string | undefined>(listingId);

  useEffect(() => {
    if (session.kind !== "ready") return;
    const api = client();
    if (!api) return;
    let cancelled = false;
    (async () => {
      const [municipalities, categories, types] = await Promise.all([
        api.GET("/api/v1/municipalities"),
        api.GET("/api/v1/categories"),
        api.GET("/api/v1/establishment-types"),
      ]);
      if (cancelled) return;
      if ([municipalities, categories, types].some((r) => r.response.status === 401)) return setSession({ kind: "session-error" });
      if ([municipalities, categories, types].some((r) => r.response.status === 403)) return setStep("forbidden");
      setLists({
        municipalities: municipalities.data ?? [],
        categories: categories.data ?? [],
        types: types.data ?? [],
        failed: !municipalities.data || !categories.data || !types.data,
      });
      if (!listingId) return setStep("ready");
      const found = await api.GET("/api/v1/managed-listings/{listingId}", { params: { path: { listingId } } });
      if (cancelled) return;
      if (found.response.status === 401) return setSession({ kind: "session-error" });
      if (!found.data) return setStep(found.response.status === 403 ? "forbidden" : "locked");
      // F014: una ficha rechazada se corrige desde su contenido. F015: una ficha publicada se edita desde la versión de trabajo
      // (borrador o edición rechazada) o, si no hay, desde la publicada; al guardar, el servidor crea la versión nueva en borrador.
      const working = found.data.working;
      const editable = working ? working.status === "draft" || working.status === "rejected" : found.data.displayStatus === "published";
      const source = working ?? found.data.published;
      if (!editable || !source) return setStep("locked");
      const content = source.content;
      setDraft({
        name: content.name,
        municipalityId: content.municipality.id,
        categoryId: content.category?.id ?? "",
        establishmentTypeId: content.establishmentType?.id ?? "",
        description: content.description ?? "",
        schedule: content.schedule ?? "",
        contact: content.contact ?? "",
        mapsUrl: content.mapsUrl ?? "",
      });
      setStep("ready");
    })().catch(() => {
      if (!cancelled) setSession({ kind: "session-error" });
    });
    return () => {
      cancelled = true;
    };
  }, [session.kind, listingId, client, setSession]);

  const change = (field: Field, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaved(false);
  };

  const showServerErrors = (items: FieldError[] | undefined) => {
    const fromServer: Errors = {};
    for (const item of items ?? []) if (isErrorKey(item.field) && !fromServer[item.field]) fromServer[item.field] = item.message;
    setErrors(fromServer);
    setSummary(t.invalid);
  };

  // Crea la ficha (POST) o reemplaza el borrador (PUT). Muestra el error que corresponda y devuelve si salió bien.
  async function persist(api: Api, genericError: string): Promise<Outcome> {
    const content = draft;
    const existing = idRef.current;
    const result = existing
      ? await api.PUT("/api/v1/managed-listings/{listingId}/draft", { params: { path: { listingId: existing } }, body: { content, confirmed: true } })
      : await api.POST("/api/v1/managed-listings", { body: { kind: "establishment", content, confirmed: true } });
    const { response } = result;
    if (response.status === 401) setSession({ kind: "session-error" });
    else if (response.status === 403) setStep("forbidden");
    else if (response.status === 200 || response.status === 201) {
      const id = result.data?.id;
      if (id) {
        idRef.current = id;
        return { ok: true, id };
      }
    } else if (response.status === 409) {
      if ((result.error as { code?: string } | undefined)?.code === "duplicate") setErrors({ name: t.duplicate });
      else setStep("locked");
    } else if (response.status === 422) showServerErrors((result.error as { errors?: FieldError[] } | undefined)?.errors);
    else setSummary(genericError);
    return { ok: false };
  }

  async function guarded(action: (api: Api) => Promise<void>, genericError: string) {
    const api = client();
    if (!api || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action(api);
    } catch {
      setSummary(genericError);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setDialog(null);
    }
  }

  const confirmSave = () =>
    guarded(async (api) => {
      const outcome = await persist(api, t.genericError);
      if (outcome.ok) {
        setErrors({});
        setSummary(null);
        setSaved(true);
      }
    }, t.genericError);

  const confirmSubmit = async () => {
    if (!declared) return setErrors((current) => ({ ...current, thirdPartyAuthorizationDeclared: t.declarationRequired }));
    await guarded(async (api) => {
      const outcome = await persist(api, t.submitGenericError);
      if (!outcome.ok) return;
      const { response, error } = await api.POST("/api/v1/managed-listings/{listingId}/submission", {
        params: { path: { listingId: outcome.id } },
        body: { confirmed: true, thirdPartyAuthorizationDeclared: true },
      });
      if (response.status === 200) {
        setErrors({});
        setSummary(null);
        return setStep("submitted");
      }
      if (response.status === 401) return setSession({ kind: "session-error" });
      if (response.status === 403) return setStep("forbidden");
      if (response.status === 409) return setStep("locked");
      if (response.status === 422) return showServerErrors(error?.errors);
      setSummary(t.submitGenericError);
    }, t.submitGenericError);
  };

  function onSave(event: FormEvent) {
    event.preventDefault();
    const missing: Errors = {};
    for (const field of ["name", "municipalityId"] as const) if (draft[field] === "") missing[field] = t.required[field];
    setErrors(missing);
    // Si faltan campos, el aviso junto a los botones muestra que el botón respondió aunque el campo marcado quede arriba.
    setSummary(Object.keys(missing).length > 0 ? t.invalid : null);
    setSaved(false);
    if (Object.keys(missing).length === 0) setDialog("save");
  }

  function onSubmit() {
    const missing: Errors = {};
    for (const field of REQUIRED) if (draft[field] === "") missing[field] = t.required[field];
    setErrors(missing);
    // Si faltan campos, el aviso junto a los botones muestra que el botón respondió aunque el campo marcado quede arriba.
    setSummary(Object.keys(missing).length > 0 ? t.invalid : null);
    setSaved(false);
    if (Object.keys(missing).length === 0) {
      setDeclared(false);
      setDialog("submit");
    }
  }

  const row = (field: Field, label: string, control: (props: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode) => {
    const id = `listing-field-${field}`;
    const message = errors[field];
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        {control({ id, ...(message ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {}) })}
        {message && (
          <p id={`${id}-error`} data-testid={`listing-error-${field}`} role="alert">
            {message}
          </p>
        )}
      </div>
    );
  };

  const text = (field: Field, label: string, testId: string) =>
    row(field, label, (props) => <input {...props} data-testid={testId} value={draft[field]} onChange={(event) => change(field, event.target.value)} />);

  const list = (field: "municipalityId" | "categoryId" | "establishmentTypeId", label: string, testId: string, items: { id: string; name: string }[], placeholder: string) =>
    row(field, label, (props) => (
      <select {...props} data-testid={testId} value={draft[field]} onChange={(event) => change(field, event.target.value)}>
        <option value="">{placeholder}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
    ));

  const name = draft.name.trim();
  return (
    <main className="screen">
      <h1 data-testid="listing-title">{listingId ? t.form.titleEdit : t.form.titleNew}</h1>
      <div aria-live="polite">
        {(session.kind === "loading" || (session.kind === "ready" && step === "loading")) && <p>{miniappTexts.loading}</p>}
        {session.kind === "session-error" && <p data-testid="session-error">{miniappTexts.sessionExpired}</p>}
        {(session.kind === "forbidden" || (session.kind === "ready" && step === "forbidden")) && <p data-testid="listing-forbidden" role="alert">{t.forbidden}</p>}
        {session.kind === "ready" && step === "locked" && <p data-testid="listing-locked">{t.locked}</p>}
        {session.kind === "ready" && step === "submitted" && (
          <section>
            <p data-testid="listing-submitted">{t.submitted}</p>
            <p className="actions"><Link href="/fichas" data-testid="listing-back">{t.detail.back}</Link></p>
          </section>
        )}
        {session.kind === "ready" && step === "ready" && (
          <section className="attraction-form listing-form">
            {lists.failed && <p data-testid="listing-lists-error" role="alert">{t.listsError}</p>}
            {saved && <p data-testid="listing-saved">{t.saved}</p>}
            <form onSubmit={onSave} noValidate>
              {text("name", t.form.nameLabel, "listing-name")}
              {list("municipalityId", t.form.municipalityLabel, "listing-municipality", lists.municipalities, t.form.selectPlaceholder)}
              {list("categoryId", t.form.categoryLabel, "listing-category", lists.categories, t.form.selectPlaceholder)}
              {list("establishmentTypeId", t.form.establishmentTypeLabel, "listing-establishment-type", lists.types, t.form.noType)}
              {row("description", t.form.descriptionLabel, (props) => (
                <textarea {...props} data-testid="listing-description" rows={4} value={draft.description} onChange={(event) => change("description", event.target.value)} />
              ))}
              {text("schedule", t.form.scheduleLabel, "listing-schedule")}
              {text("contact", t.form.contactLabel, "listing-contact")}
              {text("mapsUrl", t.form.mapsUrlLabel, "listing-maps-url")}
              {summary && <p data-testid="listing-error" role="alert">{summary}</p>}
              {dialog === null && (
                <div className="actions">
                  <button type="submit" className="primary" data-testid="listing-save" disabled={busy}>{t.form.saveDraft}</button>
                  <button type="button" className="primary" data-testid="listing-submit" disabled={busy} onClick={onSubmit}>{t.form.submit}</button>
                  <button type="button" className="secondary" data-testid="listing-cancel" onClick={() => router.push("/fichas")}>{t.form.cancel}</button>
                </div>
              )}
            </form>
            {dialog === "save" && (
              <div role="alertdialog" aria-labelledby="listing-confirm-text">
                <p id="listing-confirm-text" data-testid="listing-confirm">{t.confirmSave(name)}</p>
                <div className="actions">
                  <button type="button" className="primary" data-testid="listing-confirm-yes" disabled={busy} onClick={confirmSave}>{t.form.confirm}</button>
                  <button type="button" className="secondary" data-testid="listing-confirm-no" disabled={busy} onClick={() => setDialog(null)}>{t.form.cancel}</button>
                </div>
              </div>
            )}
            {dialog === "submit" && (
              <div role="alertdialog" aria-labelledby="listing-submit-text" data-testid="listing-submit-dialog">
                <p id="listing-submit-text">{t.confirmSubmit(name)}</p>
                <div className="field">
                  <label htmlFor="listing-declaration">
                    <input
                      id="listing-declaration"
                      type="checkbox"
                      data-testid="listing-declaration"
                      checked={declared}
                      onChange={(event) => setDeclared(event.target.checked)}
                    />
                    {t.declaration}
                  </label>
                  {errors.thirdPartyAuthorizationDeclared && (
                    <p data-testid="listing-error-thirdPartyAuthorizationDeclared" role="alert">{errors.thirdPartyAuthorizationDeclared}</p>
                  )}
                </div>
                <div className="actions">
                  <button type="button" className="primary" data-testid="listing-submit-yes" disabled={busy} onClick={confirmSubmit}>{t.form.confirm}</button>
                  <button type="button" className="secondary" data-testid="listing-submit-no" disabled={busy} onClick={() => setDialog(null)}>{t.form.cancel}</button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
