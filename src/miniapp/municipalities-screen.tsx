"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { components } from "@/shared/api/schema";
import { createApiClient } from "@/shared/api/client";
import { miniappTexts, municipalityTexts as t } from "./texts";

type Municipality = components["schemas"]["Municipality"];
type FieldError = components["schemas"]["FieldError"];

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
}

type Access = { kind: "loading" } | { kind: "session-error" } | { kind: "forbidden" } | { kind: "allowed"; initData: string };

interface Draft {
  id: string | null; // nulo al crear
  name: string;
  department: string;
  generalInfo: string;
  zone: string;
}

const emptyDraft: Draft = { id: null, name: "", department: "Caldas", generalInfo: "", zone: "" };
const draftOf = (m: Municipality): Draft => ({ id: m.id, name: m.name, department: m.department, generalInfo: m.generalInfo ?? "", zone: m.zone ?? "" });

type Step = "list" | "form" | "confirm";
type Notice = { kind: "message" | "error"; text: string } | null;

// M10 y M12: el administrador lista, crea y edita municipios. La Mini App oculta la pantalla a quien no es administrador,
// pero el backend decide en cada operación (invariante 1). Guardar pide confirmación antes de llamar a la API (invariante 8).
export function MunicipalitiesScreen() {
  const [access, setAccess] = useState<Access>({ kind: "loading" });
  const [items, setItems] = useState<Municipality[]>([]);
  const [step, setStep] = useState<Step>("list");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const initData = access.kind === "allowed" ? access.initData : "";
  const fail = (text: string = t.error) => setNotice({ kind: "error", text });

  const load = useCallback(async (data: string) => {
    const { data: list } = await createApiClient(data).GET("/api/v1/municipalities");
    if (!list) throw new Error("list");
    setItems(list);
  }, []);

  useEffect(() => {
    const webApp = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
    webApp?.ready?.();
    const data = webApp?.initData ?? "";
    let cancelled = false;
    const run = async () => {
      // Sin initData o con sesión no verificable (M12): no se hace ninguna llamada de municipios.
      const me = data ? (await createApiClient(data).GET("/api/v1/me")).data : undefined;
      if (!me) return setAccess({ kind: "session-error" });
      if (me.consent.required || !me.roles.includes("admin")) return setAccess({ kind: "forbidden" });
      setAccess({ kind: "allowed", initData: data });
      try {
        await load(data);
      } catch {
        if (!cancelled) setNotice({ kind: "error", text: t.error });
      }
    };
    run().catch(() => {
      if (!cancelled) setAccess({ kind: "session-error" });
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const edit = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const open = (next: Draft) => {
    setDraft(next);
    setInvalidFields([]);
    setNotice(null);
    setStep("form");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    setStep("confirm");
  };

  const accept = async () => {
    setBusy(true);
    setNotice(null);
    const client = createApiClient(initData);
    const creating = draft.id === null;
    try {
      const generalInfo = draft.generalInfo.trim() === "" ? undefined : draft.generalInfo;
      const zone = draft.zone.trim() === "" ? undefined : draft.zone;
      const result = creating
        ? await client.POST("/api/v1/municipalities", {
            body: { name: draft.name, department: draft.department, generalInfo, zone, confirmed: true },
          })
        : await client.PATCH("/api/v1/municipalities/{municipalityId}", {
            params: { path: { municipalityId: draft.id! } },
            body: { name: draft.name, department: draft.department, generalInfo: generalInfo ?? null, zone: zone ?? null, confirmed: true },
          });
      if (result.data) {
        try {
          await load(initData);
        } catch {
          // La operación ya se hizo; si falla recargar, se conserva la lista anterior sin inventar datos.
        }
        setNotice({ kind: "message", text: creating ? t.created : t.updated });
        setStep("list");
        return;
      }
      // El formulario conserva lo ingresado para corregirlo (criterio 14).
      setStep("form");
      const status = result.response.status;
      if (status === 409) fail(t.duplicate);
      else if (status === 422) {
        const errors = (result.error as { errors?: FieldError[] } | undefined)?.errors ?? [];
        setInvalidFields(errors.map((e) => e.field));
        fail(t.invalid);
      } else fail();
    } catch {
      setStep("form");
      fail();
    } finally {
      setBusy(false);
    }
  };

  if (access.kind === "loading") {
    return (
      <main className="screen">
        <h1>{t.title}</h1>
        <section aria-live="polite">
          <p>{miniappTexts.loading}</p>
        </section>
      </main>
    );
  }
  if (access.kind === "session-error") {
    return (
      <main className="screen">
        <h1>{miniappTexts.title}</h1>
        <section>
          <p data-testid="session-error">{miniappTexts.sessionExpired}</p>
        </section>
      </main>
    );
  }
  if (access.kind === "forbidden") {
    return (
      <main className="screen">
        <h1>{miniappTexts.title}</h1>
        <section>
          <p data-testid="municipalities-forbidden">{t.forbidden}</p>
        </section>
      </main>
    );
  }

  const field = (name: keyof Draft, label: string, testId: string) => (
    <label>
      {label}
      <input
        data-testid={testId}
        value={draft[name] ?? ""}
        onChange={(e) => edit({ [name]: e.target.value })}
        aria-invalid={invalidFields.includes(name)}
      />
    </label>
  );

  return (
    <main className="screen" data-testid="municipalities-screen">
      <h1>{t.title}</h1>
      <section aria-live="polite">
        {notice && (
          <p data-testid={notice.kind === "message" ? "municipality-message" : "municipality-error"} role={notice.kind === "error" ? "alert" : undefined}>
            {notice.text}
          </p>
        )}

        {step === "list" && (
          <>
            <button type="button" data-testid="municipality-new" onClick={() => open(emptyDraft)}>
              {t.newButton}
            </button>
            <ul data-testid="municipality-list">
              {items.length === 0 && <li>{t.empty}</li>}
              {items.map((m) => (
                <li key={m.id} data-testid="municipality-item">
                  <button type="button" data-testid="municipality-edit" onClick={() => open(draftOf(m))}>
                    {m.name}
                  </button>
                  <span> {m.department}</span>
                  {m.zone && <span data-testid="municipality-item-zone"> {m.zone}</span>}
                  {m.generalInfo && <span data-testid="municipality-item-info"> {m.generalInfo}</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        {step !== "list" && (
          <form data-testid="municipality-form" onSubmit={onSubmit}>
            <h2>{draft.id === null ? t.createTitle : t.editTitle}</h2>
            {field("name", t.nameLabel, "municipality-name")}
            {field("department", t.departmentLabel, "municipality-department")}
            {field("generalInfo", t.generalInfoLabel, "municipality-general-info")}
            {field("zone", t.zoneLabel, "municipality-zone")}
            {step === "form" && (
              <button type="submit" data-testid="municipality-save">
                {t.save}
              </button>
            )}
            {step === "form" && (
              <button type="button" onClick={() => setStep("list")}>
                {t.cancel}
              </button>
            )}
            {step === "confirm" && (
              <div role="alertdialog" aria-label={draft.id === null ? t.confirmCreate : t.confirmUpdate}>
                <p data-testid="municipality-confirm">{draft.id === null ? t.confirmCreate : t.confirmUpdate}</p>
                <button type="button" data-testid="municipality-confirm-accept" disabled={busy} onClick={accept}>
                  {t.confirm}
                </button>
                <button type="button" data-testid="municipality-confirm-cancel" disabled={busy} onClick={() => setStep("form")}>
                  {t.cancel}
                </button>
              </div>
            )}
          </form>
        )}
      </section>
    </main>
  );
}
