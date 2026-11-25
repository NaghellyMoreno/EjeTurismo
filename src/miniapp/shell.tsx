"use client";

import { FileText, House, LayoutGrid, Plus, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "@/shared/api/client";
import type { components } from "@/shared/api/schema";
import { shellTexts as t } from "./texts";

type Me = components["schemas"]["Me"];
type BackHandler = () => boolean;

interface TelegramBackButton {
  show?: () => void;
  hide?: () => void;
  onClick?: (callback: () => void) => void;
  offClick?: (callback: () => void) => void;
}

interface TelegramWebApp {
  initData?: string;
  BackButton?: TelegramBackButton;
}

interface ShellContext {
  // `getMe` de la cuenta, solo para decidir la barra inferior; el backend vuelve a decidir en cada petición (invariante 1).
  me: Me | null;
  setMe: (me: Me | null) => void;
  // Las pantallas con pasos internos registran cómo retroceder un paso antes de cambiar de página (gesto de volver, D-206).
  registerBack: (handler: BackHandler) => () => void;
}

const Context = createContext<ShellContext>({ me: null, setMe: () => {}, registerBack: () => () => {} });

export const useShell = () => useContext(Context);

// Registra un manejador del gesto de volver mientras `active` sea verdadero.
export function useBackHandler(active: boolean, handler: BackHandler) {
  const { registerBack } = useShell();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => (active ? registerBack(() => ref.current()) : undefined), [active, registerBack]);
}

const webApp = (): TelegramWebApp | undefined => (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;

type Tab = { href: string; label: string; icon: typeof House; special?: boolean };

// Pestañas según el rol que informa `getMe`; el administrador prevalece sobre el prestador (D-116).
function tabsFor(me: Me): Tab[] {
  const home: Tab = { href: "/", label: t.nav.home, icon: House };
  const account: Tab = { href: "/cuenta", label: t.nav.account, icon: UserRound };
  if (me.roles.includes("admin")) return [home, { href: "/catalogos", label: t.nav.catalogs, icon: LayoutGrid }, { href: "/atractivos", label: t.nav.create, icon: Plus, special: true }, account];
  if (me.roles.includes("provider")) return [home, { href: "/fichas", label: t.nav.listings, icon: FileText }, { href: "/fichas/nueva", label: t.nav.create, icon: Plus, special: true }, account];
  return [home, account];
}

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : href === "/fichas" ? pathname === "/fichas" || (pathname.startsWith("/fichas/") && !pathname.startsWith("/fichas/nueva")) : pathname.startsWith(href);

// Marco de la Mini App: logo que lleva al inicio del rol, barra inferior y botón de volver de Telegram (D-206).
export function MiniAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const handlers = useRef<BackHandler[]>([]);
  const [handlerCount, setHandlerCount] = useState(0);

  useEffect(() => {
    const initData = webApp()?.initData ?? "";
    // Sin initData no hay sesión: no se llama al servidor (M12).
    if (!initData) return;
    let cancelled = false;
    createApiClient(initData)
      .GET("/api/v1/me")
      .then(({ data }) => {
        if (!cancelled && data) setMe(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const registerBack = useCallback((handler: BackHandler) => {
    handlers.current = [...handlers.current, handler];
    setHandlerCount(handlers.current.length);
    return () => {
      handlers.current = handlers.current.filter((item) => item !== handler);
      setHandlerCount(handlers.current.length);
    };
  }, []);

  const goBack = useCallback(() => {
    const top = handlers.current[handlers.current.length - 1];
    if (top?.()) return;
    if (window.history.length > 1) router.back();
    else router.push("/");
  }, [router]);

  // Botón de volver de Telegram: lo usan el gesto y el botón atrás del celular. Se muestra fuera del inicio o con pasos internos.
  const canGoBack = pathname !== "/" || handlerCount > 0;
  useEffect(() => {
    const button = webApp()?.BackButton;
    if (!button) return;
    if (canGoBack) button.show?.();
    else button.hide?.();
    button.onClick?.(goBack);
    return () => button.offClick?.(goBack);
  }, [canGoBack, goBack]);

  const value = useMemo(() => ({ me, setMe, registerBack }), [me, registerBack]);
  const tabs = me && !me.consent.required ? tabsFor(me) : null;

  return (
    <Context.Provider value={value}>
      <header className="brand">
        <Link href="/" aria-label={t.goHome} data-testid="brand-home">
          {/* SVG vectorial: se sirve tal cual, sin pasar por el optimizador de imágenes. */}
          <Image src="/logo.svg" alt="Eje Turismo" width={40} height={40} priority unoptimized />
        </Link>
      </header>
      <div className={tabs ? "with-nav" : undefined}>{children}</div>
      {tabs && (
        <nav className="bottomnav" aria-label={t.navLabel} data-testid="bottom-nav">
          {tabs.map(({ href, label, icon: Icon, special }) => (
            <Link key={href} href={href} className={`navitem${special ? " special" : ""}`} aria-current={isActive(pathname, href) ? "page" : undefined} data-testid={`nav-${href === "/" ? "home" : href.slice(1).replace("/", "-")}`}>
              <span className="nav-symbol" aria-hidden="true">
                <Icon size={special ? 20 : 22} strokeWidth={2} />
              </span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      )}
    </Context.Provider>
  );
}
