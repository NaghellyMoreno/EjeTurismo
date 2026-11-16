import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Eje Turismo" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        {/* Lo entrega Telegram; define window.Telegram.WebApp con el initData firmado. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
