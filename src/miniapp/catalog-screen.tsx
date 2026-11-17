"use client";

import { type FormEvent, useEffect, useState } from "react";
import { createApiClient } from "@/shared/api/client";
import type { components } from "@/shared/api/schema";
import { catalogTexts, miniappTexts } from "./texts";

type CatalogItem = components["schemas"]["CatalogItem"];
type Result = { status: number; data?: CatalogItem | CatalogItem[] };
type Client = ReturnType<typeof createApiClient>;

const t = catalogTexts;

interface Api {
  list: () => Promise<Result>;
  create: (name: string) => Promise<Result>;
  rename: (id: string, name: string) => Promise<Result>;
}

// Une cada respuesta tipada de `openapi-fetch` en {estado, cuerpo}: M11 solo decide por el estado HTTP, nunca muestra su texto.
const settle = async (request: Promise<{ data?: unknown; response: Response }>): Promise<Result> => {
  const { data, response } = await request;
  return { status: response.status, data: data as Result["data"] };
};

function apis(client: Client) {
  const body = (name: string) => ({ name, confirmed: true as const });
  return {
    categories: {
      list: () => settle(client.GET("/api/v1/categories")),
      create: (name) => settle(client.POST("/api/v1/categories", { body: body(name) })),
      rename: (id, name) => settle(client.PATCH("/api/v1/categories/{categoryId}", { params: { path: { categoryId: id } }, body: body(name) })),
    },
    experienceTypes: {
      list: () => settle(client.GET("/api/v1/experience-types")),
      create: (name) => settle(client.POST("/api/v1/experience-types", { body: body(name) })),
      rename: (id, name) =>
        settle(client.PATCH("/api/v1/experience-types/{experienceTypeId}", { params: { path: { experienceTypeId: id } }, body: body(name) })),
    },
    establishmentTypes: {
      list: () => settle(client.GET("/api/v1/establishment-types")),
      create: (name) => settle(client.POST("/api/v1/establishment-types", { body: body(name) })),
      rename: (id, name) =>
        settle(client.PATCH("/api/v1/establishment-types/{establishmentTypeId}", { params: { path: { establishmentTypeId: id } }, body: body(name) })),
    },
  } satisfies Record<string, Api>;
}

type ListKey = keyof ReturnType<typeof apis>;
const LISTS: { key: ListKey; slug: string; title: string; heading: string }[] = [
  { key: "categories", slug: "categories", title: t.categories, heading: "catalog-categories" },
  { key: "experienceTypes", slug: "experience-types", title: t.experienceTypes, heading: "catalog-experience-types" },
  { key: "establishmentTypes", slug: "establishment-types", title: t.establishmentTypes, heading: "catalog-establishment-types" },
];

type Screen =
  | { kind: "loading" }
  | { kind: "session-error" }
  | { kind: "forbidden" }
  | { kind: "ready"; items: Record<ListKey, CatalogItem[]>; loadFailed: boolean };

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
}

// M11 (D-041): solo el administrador. El rol se comprueba con `getMe` antes de pedir ninguna lista; el backend vuelve a decidir
// en cada petición, y un 403 de cualquier lectura o escritura deja solo `catalog-forbidden`.
export function CatalogScreen() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [client, setClient] = useState<ReturnType<typeof apis> | null>(null);

  useEffect(() => {
    const webApp = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
    webApp?.ready?.();
    const initData = webApp?.initData ?? "";
    const api = apis(createApiClient(initData));
    let cancelled = false;
    (async () => {
      // Sin initData no hay sesión que verificar: M12 sin llamar al servidor.
      if (!initData) return setScreen({ kind: "session-error" });
      const me = await createApiClient(initData).GET("/api/v1/me");
      if (cancelled) return;
      if (!me.data) return setScreen({ kind: "session-error" });
      if (me.data.consent.required || !me.data.roles.includes("admin")) return setScreen({ kind: "forbidden" });
      const results = await Promise.all(LISTS.map((list) => api[list.key].list()));
      if (cancelled) return;
      if (results.some((r) => r.status === 401)) return setScreen({ kind: "session-error" });
      if (results.some((r) => r.status === 403)) return setScreen({ kind: "forbidden" });
      const loadFailed = results.some((r) => !Array.isArray(r.data));
      const items = Object.fromEntries(LISTS.map((list, i) => [list.key, (results[i]!.data as CatalogItem[] | undefined) ?? []])) as Record<ListKey, CatalogItem[]>;
      setClient(api);
      setScreen({ kind: "ready", items, loadFailed });
    })().catch(() => {
      if (!cancelled) setScreen({ kind: "session-error" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const replace = (key: ListKey, items: CatalogItem[]) =>
    setScreen((current) => (current.kind === "ready" ? { ...current, items: { ...current.items, [key]: items } } : current));

  return (
    <main className="screen">
      <h1 data-testid="catalog-title">{t.title}</h1>
      <div aria-live="polite">
        {screen.kind === "loading" && <p>{miniappTexts.loading}</p>}
        {screen.kind === "session-error" && <p data-testid="session-error">{miniappTexts.sessionExpired}</p>}
        {screen.kind === "forbidden" && <p data-testid="catalog-forbidden">{t.forbidden}</p>}
        {screen.kind === "ready" && client && (
          <>
            {screen.loadFailed && <p data-testid="catalog-error" role="alert">{t.genericError}</p>}
            {LISTS.map((list) => (
              <CatalogList
                key={list.key}
                slug={list.slug}
                title={list.title}
                heading={list.heading}
                items={screen.items[list.key]}
                api={client[list.key]}
                onItems={(items) => replace(list.key, items)}
                onForbidden={() => setScreen({ kind: "forbidden" })}
                onSessionError={() => setScreen({ kind: "session-error" })}
              />
            ))}
          </>
        )}
      </div>
    </main>
  );
}

interface ListProps {
  slug: string;
  title: string;
  heading: string;
  items: CatalogItem[];
  api: Api;
  onItems: (items: CatalogItem[]) => void;
  onForbidden: () => void;
  onSessionError: () => void;
}

// Una lista: sus elementos, un formulario para agregar y, al elegir un elemento, para cambiarle el nombre. Todo guardado pasa
// por un paso de confirmación (invariante 8); cancelarlo no envía nada.
function CatalogList({ slug, title, heading, items, api, onItems, onForbidden, onSessionError }: ListProps) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed === "") return setError(t.nameRequired);
    setError(null);
    setConfirming(trimmed);
  }

  function choose(item: CatalogItem) {
    setError(null);
    if (editing?.id === item.id) {
      setEditing(null);
      setName("");
    } else {
      setEditing(item);
      setName(item.name);
    }
  }

  async function confirm() {
    if (confirming === null || busy) return;
    setBusy(true);
    try {
      const result = editing ? await api.rename(editing.id, confirming) : await api.create(confirming);
      if (result.status === 401) return onSessionError();
      if (result.status === 403) return onForbidden();
      setConfirming(null);
      if (result.status === 409) return setError(t.duplicate);
      if (result.status !== 200 && result.status !== 201) return setError(t.genericError);
      // La lista vuelve a pedirse para mostrar el orden y los nombres reales del servidor.
      const fresh = await api.list();
      if (Array.isArray(fresh.data)) onItems(fresh.data);
      setName("");
      setEditing(null);
      setError(null);
    } catch {
      setConfirming(null);
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid={`catalog-list-${slug}`} className="catalog-list">
      <h2 data-testid={heading}>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" data-testid="catalog-item" aria-pressed={editing?.id === item.id} onClick={() => choose(item)}>
              {item.name}
            </button>
          </li>
        ))}
      </ul>
      {confirming === null ? (
        <form onSubmit={submit} noValidate>
          <label>
            {t.nameLabel}
            <input data-testid="catalog-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="submit" data-testid="catalog-save">{t.save}</button>
        </form>
      ) : (
        <div>
          <p data-testid="catalog-confirm-text">{editing ? t.confirmEdit(confirming) : t.confirmCreate(confirming)}</p>
          <button type="button" data-testid="catalog-confirm" disabled={busy} onClick={confirm}>{t.confirm}</button>
          <button type="button" data-testid="catalog-cancel" disabled={busy} onClick={() => setConfirming(null)}>{t.cancel}</button>
        </div>
      )}
      {error && <p data-testid="catalog-error" role="alert">{error}</p>}
    </section>
  );
}
