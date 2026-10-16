import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { APP_NAME } from "@/lib/app";
import { fontCaveat, fontDancing, fontGreatVibes, fontMarck } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: `${APP_NAME} — Signature de documents`,
  description: "Signature électronique de PDF, multi-signataires, certificat P12",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${GeistSans.variable} ${fontCaveat.variable} ${fontDancing.variable} ${fontGreatVibes.variable} ${fontMarck.variable}`}
    >
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
