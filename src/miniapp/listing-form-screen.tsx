"use client";

import { ArrowLeft, Check, House, Route } from "lucide-react";
import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { components } from "@/shared/api/schema";
import { PhotoPanel } from "./photos-screen";
import { useBackHandler } from "./shell";
import { listingTexts as t, miniappTexts, wizardTexts as w } from "./texts";
import { type Api, useProviderSession } from "./use-provider-session";

type Municipality = components["schemas"]["Municipality"];
type CatalogItem = components["schemas"]["CatalogItem"];
type FieldError = components["schemas"]["FieldError"];

const FIELDS = ["name", "municipalityId", "categoryId", "establishmentTypeId", "experienceTypeId", "description", "schedule", "contact", "mapsUrl", "guidesInfo"] as const;
type Field = (typeof FIELDS)[number];
type Draft = Record<Field, string>;
// Los 7 campos que se exigen al enviar a revisión (D-003); el tipo de establecimiento es opcional (D-040).
// En una ruta o experiencia también se exige el tipo de experiencia (F018); los datos del guía son opcionales.
const REQUIRED = ["name", "municipalityId", "categoryId", "description", "schedule", "contact", "mapsUrl"] as const;
type Kind = "establishment" | "route_experience";
type ErrorKey = Field | "thirdPartyAuthorizationDeclared";
type Errors = Partial<Record<ErrorKey, string>>;

const EMPTY: Draft = { name: "", municipalityId: "", categoryId: "", establishmentTypeId: "", experienceTypeId: "", description: "", schedule: "", contact: "", mapsUrl: "", guidesInfo: "" };
const isErrorKey = (value: string): value is ErrorKey => value === "thirdPartyAuthorizationDeclared" || (FIELDS as readonly string[]).includes(value);

type Lists = { municipalities: Municipality[]; categories: CatalogItem[]; types: CatalogItem[]; experienceTypes: CatalogItem[]; failed: boolean };
type Step = "loading" | "ready" | "locked" | "forbidden" | "submitted";
type Dialog = null | "save" | "submit";
type Outcome = { ok: true; id: string } | { ok: false };
// D-206: pasos del formulario. 1 Tipo (solo al crear), 2 Información, 3 Guardar borrador, 4 Fotografías y 5 Revisar y enviar.
// Las fotos van después de guardar porque el backend las asocia a un borrador que ya existe.
type WizardStep = 1 | 2 | 3 | 4 | 5;
const TOTAL_STEPS = 5;

// M05 y M07 (F013): formulario de la ficha de establecimiento y envío a revisión. Municipio, categoría y tipo se eligen solo de
// las listas del servidor. Solo comprueba que los campos no estén vacíos; los espacios, los límites y el enlace los decide el
// servidor. Ninguna petición sale sin confirmar (invariante 8).
export function ListingFormScreen({ listingId }: { listingId?: string }) {
  const { session, setSession, client } = useProviderSession();
  const [step, setStep] = useState<Step>("loading");
  const [lists, setLists] = useState<Lists>({ municipalities: [], categories: [], types: [], experienceTypes: [], failed: false });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const idRef = useRef<string | undefined>(listingId);
  // Id de la ficha guardada, para el paso de fotos (estado y no ref, porque se usa al dibujar).
  const [savedId, setSavedId] = useState<string | undefined>(listingId);
  // La clase se elige solo al crear (F018, P1); al editar queda fija con la de la ficha.
  const [kind, setKind] = useState<Kind>("establishment");
  const firstStep: WizardStep = listingId ? 2 : 1;
  const [wizard, setWizard] = useState<WizardStep>(firstStep);
  const goTo = (next: WizardStep) => {
    setWizard(next);
    window.scrollTo?.({ top: 0 });
  };

  useEffect(() => {
    if (session.kind !== "ready") return;
    const api = client();
    if (!api) return;
    let cancelled = false;
    (async () => {
      const [municipalities, categories, types, experienceTypes] = await Promise.all([
        api.GET("/api/v1/municipalities"),
        api.GET("/api/v1/categories"),
        api.GET("/api/v1/establishment-types"),
        api.GET("/api/v1/experience-types"),
      ]);
      if (cancelled) return;
      if ([municipalities, categories, types, experienceTypes].some((r) => r.response.status === 401)) return setSession({ kind: "session-error" });
      if ([municipalities, categories, types, experienceTypes].some((r) => r.response.status === 403)) return setStep("forbidden");
      setLists({
        municipalities: municipalities.data ?? [],
        categories: categories.data ?? [],
        types: types.data ?? [],
        experienceTypes: experienceTypes.data ?? [],
        failed: !municipalities.data || !categories.data || !types.data || !experienceTypes.data,
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
      setKind(found.data.kind === "route_experience" ? "route_experience" : "establishment");
      setDraft({
        name: content.name,
        municipalityId: content.municipality.id,
        categoryId: content.category?.id ?? "",
        establishmentTypeId: content.establishmentType?.id ?? "",
        experienceTypeId: content.experienceType?.id ?? "",
        guidesInfo: content.guidesInfo ?? "",
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
    if (Object.keys(fromServer).some((key) => key !== "thirdPartyAuthorizationDeclared")) setWizard(2);
  };

  // Crea la ficha (POST) o reemplaza el borrador (PUT). Muestra el error que corresponda y devuelve si salió bien.
  async function persist(api: Api, genericError: string): Promise<Outcome> {
    const { establishmentTypeId, experienceTypeId, guidesInfo, ...common } = draft;
    const content = kind === "route_experience" ? { ...common, experienceTypeId, guidesInfo } : { ...common, establishmentTypeId };
    const existing = idRef.current;
    const result = existing
      ? await api.PUT("/api/v1/managed-listings/{listingId}/draft", { params: { path: { listingId: existing } }, body: { content, confirmed: true } })
      : await api.POST("/api/v1/managed-listings", { body: { kind, content, confirmed: true } });
    const { response } = result;
    if (response.status === 401) setSession({ kind: "session-error" });
    else if (response.status === 403) setStep("forbidden");
    else if (response.status === 200 || response.status === 201) {
      const id = result.data?.id;
      if (id) {
        idRef.current = id;
        setSavedId(id);
        return { ok: true, id };
      }
    } else if (response.status === 409) {
      if ((result.error as { code?: string } | undefined)?.code === "duplicate") {
        setErrors({ name: t.duplicate });
        setWizard(2);
      }
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
        // Desde el paso "Guardar borrador" se sigue a las fotos; desde "Información" se queda en el mismo paso.
        setWizard((current) => (current === 3 ? 4 : current));
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
    else setWizard(2);
  }

  function onSubmit() {
    const missing: Errors = {};
    const required = kind === "route_experience" ? [...REQUIRED, "experienceTypeId" as const] : REQUIRED;
    for (const field of required) if (draft[field] === "") missing[field] = t.required[field];
    setErrors(missing);
    // Si faltan campos, el aviso junto a los botones muestra que el botón respondió aunque el campo marcado quede arriba.
    setSummary(Object.keys(missing).length > 0 ? t.invalid : null);
    setSaved(false);
    if (Object.keys(missing).length === 0) {
      setDeclared(false);
      setDialog("submit");
    } else setWizard(2);
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

  const list = (field: "municipalityId" | "categoryId" | "establishmentTypeId" | "experienceTypeId", label: string, testId: string, items: { id: string; name: string }[], placeholder: string) =>
    row(field, label, (props) => (
      <select {...props} data-testid={testId} value={draft[field]} onChange={(event) => change(field, event.target.value)}>
        <option value="">{placeholder}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
    ));

  // El gesto de volver cierra el diálogo abierto o retrocede un paso antes de salir del formulario.
  useBackHandler(session.kind === "ready" && step === "ready" && (dialog !== null || wizard > firstStep), () => {
    if (busy) return true;
    if (dialog !== null) setDialog(null);
    else if (wizard > firstStep) goTo((wizard - 1) as WizardStep);
    else return false;
    return true;
  });

  const name = draft.name.trim();
  const isRoute = kind === "route_experience";
  const nameOf = (items: { id: string; name: string }[], id: string) => items.find((item) => item.id === id)?.name ?? "";
  const canContinue = wizard === 1 || wizard === 2 || wizard === 4 || (wizard === 3 && saved && savedId !== undefined);

  const review = (
    <div className="review" data-testid="listing-review">
      <b>{draft.name || "—"}</b>
      <p>
        {nameOf(lists.municipalities, draft.municipalityId) || "—"} · {isRoute ? t.form.kindRoute : t.form.kindEstablishment}
      </p>
      <p>
        <b>{t.form.categoryLabel}:</b> {nameOf(lists.categories, draft.categoryId) || "—"}
      </p>
      <p>
        <b>{t.form.scheduleLabel}:</b> {draft.schedule || "—"}
      </p>
      <p>
        <b>{t.form.contactLabel}:</b> {draft.contact || "—"}
      </p>
      <button type="button" className="textlink" data-testid="listing-review-edit" onClick={() => goTo(2)}>
        {w.steps[1]} →
      </button>
    </div>
  );

  return (
    <main className="screen">
      <Link href="/fichas" className="back-link" data-testid="listing-cancel">
        <ArrowLeft size={14} aria-hidden="true" /> {t.form.cancel}
      </Link>
      <h1 data-testid="listing-title">{listingId ? t.form.titleEdit : isRoute ? t.form.titleNewRoute : t.form.titleNew}</h1>
      <div aria-live="polite">
        {(session.kind === "loading" || (session.kind === "ready" && step === "loading")) && <p>{miniappTexts.loading}</p>}
        {session.kind === "session-error" && <p data-testid="session-error">{miniappTexts.sessionExpired}</p>}
        {(session.kind === "forbidden" || (session.kind === "ready" && step === "forbidden")) && <p data-testid="listing-forbidden" role="alert">{t.forbidden}</p>}
        {session.kind === "ready" && step === "locked" && <p data-testid="listing-locked">{t.locked}</p>}
        {session.kind === "ready" && step === "submitted" && (
          <section className="plain centered">
            <div className="success-graphic" aria-hidden="true">
              <Check size={36} />
            </div>
            <p data-testid="listing-submitted">{t.submitted}</p>
            <p className="actions"><Link href="/fichas" className="primary" data-testid="listing-back">{t.detail.back}</Link></p>
          </section>
        )}
        {session.kind === "ready" && step === "ready" && (
          <section className="attraction-form listing-form plain">
            <div className="step-caption">
              <span data-testid="wizard-step">{w.stepOf(wizard, TOTAL_STEPS)}</span>
              <span>{w.steps[wizard - 1]}</span>
            </div>
            <div className="steps" aria-hidden="true">
              {w.steps.map((label, index) => (
                <span key={label} className={`step${index + 1 < wizard ? " done" : ""}${index + 1 === wizard ? " active" : ""}`} />
              ))}
            </div>
            {lists.failed && <p data-testid="listing-lists-error" role="alert">{t.listsError}</p>}
            {saved && <p className="notice" data-testid="listing-saved">{t.saved}</p>}
            <form onSubmit={onSave} noValidate>
              {wizard === 1 && (
                <div className="field" role="radiogroup" aria-labelledby="listing-kind-legend">
                  <h2 id="listing-kind-legend">{t.form.kindLegend}</h2>
                  {(["establishment", "route_experience"] as const).map((option) => {
                    const Icon = option === "establishment" ? House : Route;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={kind === option}
                        className={`pick-card ${kind === option ? "primary" : "secondary"}`}
                        data-testid={`listing-kind-${option}`}
                        onClick={() => {
                          setKind(option);
                          setErrors({});
                          setSummary(null);
                          setSaved(false);
                        }}
                      >
                        <span className="pick-icon" aria-hidden="true">
                          <Icon size={22} />
                        </span>
                        <b>{option === "establishment" ? t.form.kindEstablishment : t.form.kindRoute}</b>
                        <span className="dot" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              )}
              {wizard === 2 && (
                <>
                  {text("name", t.form.nameLabel, "listing-name")}
                  {list("municipalityId", t.form.municipalityLabel, "listing-municipality", lists.municipalities, t.form.selectPlaceholder)}
                  {list("categoryId", t.form.categoryLabel, "listing-category", lists.categories, t.form.selectPlaceholder)}
                  {isRoute
                    ? list("experienceTypeId", t.form.experienceTypeLabel, "listing-experience-type", lists.experienceTypes, t.form.experienceTypePlaceholder)
                    : list("establishmentTypeId", t.form.establishmentTypeLabel, "listing-establishment-type", lists.types, t.form.noType)}
                  {row("description", t.form.descriptionLabel, (props) => (
                    <textarea {...props} data-testid="listing-description" rows={4} value={draft.description} onChange={(event) => change("description", event.target.value)} />
                  ))}
                  {text("schedule", t.form.scheduleLabel, "listing-schedule")}
                  {text("contact", t.form.contactLabel, "listing-contact")}
                  {text("mapsUrl", t.form.mapsUrlLabel, "listing-maps-url")}
                  {isRoute &&
                    row("guidesInfo", t.form.guidesInfoLabel, (props) => (
                      <>
                        <textarea
                          {...props}
                          data-testid="listing-guides-info"
                          rows={3}
                          aria-describedby={[props["aria-describedby"], "listing-field-guidesInfo-hint"].filter(Boolean).join(" ")}
                          value={draft.guidesInfo}
                          onChange={(event) => change("guidesInfo", event.target.value)}
                        />
                        <p id="listing-field-guidesInfo-hint">{t.form.guidesInfoHint}</p>
                      </>
                    ))}
                </>
              )}
              {(wizard === 3 || wizard === 5) && review}
              {summary && <p data-testid="listing-error" role="alert">{summary}</p>}
              {dialog === null && (
                <div className="sticky-actions">
                  {wizard === 3 && !saved && <button type="submit" className="primary block" data-testid="listing-save" disabled={busy}>{t.form.saveDraft}</button>}
                  {wizard === 5 && <button type="button" className="primary block" data-testid="listing-submit" disabled={busy} onClick={onSubmit}>{t.form.submit}</button>}
                  {wizard < 5 && canContinue && (
                    <button type="button" className="lime block" data-testid="wizard-next" disabled={busy} onClick={() => goTo((wizard + 1) as WizardStep)}>
                      {w.next}
                    </button>
                  )}
                  <div className="buttonrow">
                    {wizard > firstStep && (
                      <button type="button" className="secondary" data-testid="wizard-previous" disabled={busy} onClick={() => goTo((wizard - 1) as WizardStep)}>
                        {w.previous}
                      </button>
                    )}
                    {wizard === 2 && <button type="submit" className="secondary" data-testid="listing-save" disabled={busy}>{t.form.saveDraft}</button>}
                  </div>
                </div>
              )}
            </form>
            {wizard === 4 && savedId && (
              <PhotoPanel listingId={savedId} session={session} setSession={setSession} client={client} embedded />
            )}
            {wizard === 4 && dialog === null && (
              <div className="sticky-actions">
                <button type="button" className="lime block" data-testid="wizard-next-photos" onClick={() => goTo(5)}>
                  {w.next}
                </button>
                <div className="buttonrow">
                  <button type="button" className="secondary" data-testid="wizard-previous-photos" onClick={() => goTo(3)}>
                    {w.previous}
                  </button>
                </div>
              </div>
            )}
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
