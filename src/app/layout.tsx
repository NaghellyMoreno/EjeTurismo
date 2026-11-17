import type { Metadata } from "next";
import Image from "next/image";
import Script from "next/script";
import type { ReactNode } from "react";
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
        <header className="brand">
          {/* SVG vectorial: se sirve tal cual, sin pasar por el optimizador de imágenes. */}
          <Image src="/logo.svg" alt="Eje Turismo" width={64} height={64} priority unoptimized />
        </header>
        {children}
      </body>
    </html>
  );
}
