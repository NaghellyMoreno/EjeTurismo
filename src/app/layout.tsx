import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { MiniAppShell } from "@/miniapp/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eje Turismo",
  // Logo del proyecto en public/: el SVG para la pestaña y el PNG para iOS, que no acepta SVG.
  icons: { icon: "/logo.svg", apple: "/logo.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        {/* Lo entrega Telegram; define window.Telegram.WebApp con el initData firmado. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {/* Logo, barra inferior y botón de volver de Telegram (D-206). */}
        <MiniAppShell>{children}</MiniAppShell>
      </body>
    </html>
  );
}
