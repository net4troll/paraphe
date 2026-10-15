import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { APP_NAME } from "@/lib/app";
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
    <html lang="fr" className={GeistSans.variable}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
