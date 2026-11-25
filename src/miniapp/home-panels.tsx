"use client";

import { ChevronRight, FileText, House, Landmark, LayoutGrid, MapPin, MessageCircle, Plus, Route, Send } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { createApiClient } from "@/shared/api/client";
import type { components } from "@/shared/api/schema";
import { homeView, homeViewText } from "./home";
import { adminHomeTexts, attractionTexts, catalogTexts, listingTexts, miniappTexts, providerHomeTexts, visitorHomeTexts } from "./texts";

type Me = components["schemas"]["Me"];
type Api = ReturnType<typeof createApiClient>;
type Summary = components["schemas"]["ManagedListingSummary"];
type Status = Summary["displayStatus"];

const kindIcon = (kind: Summary["kind"]) => (kind === "route_experience" ? <Route size={22} /> : kind === "attraction" ? <Landmark size={22} /> : <House size={22} />);

// Tarjeta de una ficha con su estado (prototipo, D-206). Lleva al detalle M08.
export function ListingCard({ item }: { item: Summary }) {
  return (
    <Link href={`/fichas/${item.id}`} className="item-card" data-testid={`home-listing-${item.id}`}>
      <span className="thumb" aria-hidden="true">
        {kindIcon(item.kind)}
      </span>
      <span className="item-copy">
        <span className="item-name">{item.name}</span>
        <span className="item-meta">{item.municipality.name}</span>
        <span className={`badge badge-${item.displayStatus}`}>{listingTexts.status[item.displayStatus]}</span>
      </span>
      <ChevronRight className="card-arrow" size={18} aria-hidden="true" />
    </Link>
  );
}

// M02 del prestador (D-206): cabecera, contadores, las 3 fichas más recientes y cómo se publica. El backend filtra por negocio.
function ProviderHome({ api }: { api: Api | null }) {
  const [counts, setCounts] = useState<Partial<Record<Status, number>>>({});
  const [recent, setRecent] = useState<Summary[] | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const total = (displayStatus: Status) =>
      api.GET("/api/v1/managed-listings", { params: { query: { displayStatus, pageSize: 1 } } }).then(({ data }) => [displayStatus, data?.total ?? 0] as const);
    Promise.all([total("published"), total("pending"), total("draft")])
      .then((pairs) => !cancelled && setCounts(Object.fromEntries(pairs)))
      .catch(() => {});
    api
      .GET("/api/v1/managed-listings", { params: { query: { pageSize: 3 } } })
      .then(({ data }) => !cancelled && setRecent(data?.items ?? []))
      .catch(() => !cancelled && setRecent([]));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const t = providerHomeTexts;
  return (
    <>
      <div className="hero">
        <small>{t.kicker}</small>
        <h2>{t.hero}</h2>
        <Link href="/fichas/nueva" className="hero-button" data-testid="home-create">
          <Plus size={16} aria-hidden="true" /> {t.create}
        </Link>
      </div>
      <p className="support" data-testid="role-provider">{homeViewText["role-provider"]}</p>
      <div className="stats">
        {([["published", t.published], ["pending", t.pending], ["draft", t.drafts]] as const).map(([status, label]) => (
          <div className="stat" key={status}>
            <strong data-testid={`home-count-${status}`}>{counts[status] ?? "–"}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="between">
        <h3>{t.myListings}</h3>
        <Link href="/fichas" className="textlink" data-testid="listings-link">
          {t.seeAll}
        </Link>
      </div>
      {recent === null && <p>{miniappTexts.loading}</p>}
      {recent?.length === 0 && <p className="support">{listingTexts.list.empty}</p>}
      {recent?.map((item) => <ListingCard key={item.id} item={item} />)}
      <div className="inset">
        <b>{t.howTitle}</b>
        <p>{t.howText}</p>
      </div>
    </>
  );
}

// M02 del administrador (D-206): cabecera, accesos a la gestión de contenidos y lo que se hace en el bot.
function AdminHome({ api }: { api: Api | null }) {
  const [municipalities, setMunicipalities] = useState<number | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    api
      .GET("/api/v1/municipalities")
      .then(({ data }) => !cancelled && data && setMunicipalities(data.length))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  const t = adminHomeTexts;
  return (
    <>
      <div className="hero">
        <small>{t.kicker}</small>
        <h2>{t.hero}</h2>
        <Link href="/atractivos" className="hero-button" data-testid="home-create">
          <Plus size={16} aria-hidden="true" /> {t.create}
        </Link>
      </div>
      <p className="support" data-testid="role-admin">{homeViewText["role-admin"]}</p>
      <span className="section-kicker">{t.section}</span>
      <div className="tile-grid">
        <Link href="/atractivos" className="tile" data-testid="attractions-link" aria-label={attractionTexts.link}>
          <Landmark className="tile-icon" size={24} aria-hidden="true" />
          <span>
            <b>{t.attraction}</b>
            <small>{t.attractionHint}</small>
          </span>
        </Link>
        <Link href="/municipios" className="tile" data-testid="municipalities-link" aria-label={miniappTexts.adminMunicipalitiesLink}>
          <MapPin className="tile-icon" size={24} aria-hidden="true" />
          <span>
            <b>{t.municipalities}</b>
            <small>{municipalities === null ? "" : t.municipalitiesHint(municipalities)}</small>
          </span>
        </Link>
        <Link href="/catalogos" className="tile" data-testid="catalog-link" aria-label={catalogTexts.link}>
          <LayoutGrid className="tile-icon" size={24} aria-hidden="true" />
          <span>
            <b>{t.categories}</b>
            <small>{t.categoriesHint}</small>
          </span>
        </Link>
        <Link href="/catalogos" className="tile" data-testid="experience-types-link">
          <Route className="tile-icon" size={24} aria-hidden="true" />
          <span>
            <b>{t.experienceTypes}</b>
            <small>{t.experienceTypesHint}</small>
          </span>
        </Link>
      </div>
      <div className="between">
        <h3>{t.telegramTitle}</h3>
      </div>
      <div className="inset">
        <b>{t.telegramSubtitle}</b>
        <p>{t.telegramText}</p>
      </div>
    </>
  );
}

// M02 sin rol (D-206): logo, invitación a explorar en el bot y el estado del registro que informa `getMe`.
function VisitorHome({ me }: { me: Me }) {
  const view = homeView(me);
  const icon = view === "register-hint" ? <Send size={20} aria-hidden="true" /> : view === "registration-pending" ? <FileText size={20} aria-hidden="true" /> : <MessageCircle size={20} aria-hidden="true" />;
  return (
    <>
      <div className="placeholder-logo">
        <Image src="/logo.svg" alt="" width={68} height={68} unoptimized />
      </div>
      <span className="section-kicker">{visitorHomeTexts.kicker}</span>
      <h2 className="page-heading">{visitorHomeTexts.hero}</h2>
      <div className="inset with-icon">
        {icon}
        <p data-testid={view}>{homeViewText[view]}</p>
      </div>
    </>
  );
}

// Inicio según el rol que informa `getMe`; nada de rol viene del cliente (HU-006 criterio 4).
export function HomePanel({ me, api }: { me: Me; api: Api | null }) {
  const view = homeView(me);
  if (view === "role-admin") return <AdminHome api={api} />;
  if (view === "role-provider") return <ProviderHome api={api} />;
  return <VisitorHome me={me} />;
}
