import type { ReactNode } from "react";

export const metadata = { title: "Eje Turismo" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
