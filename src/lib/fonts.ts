import { Caveat, Dancing_Script, Great_Vibes, Marck_Script } from "next/font/google";

export const fontCaveat = Caveat({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-sig-caveat",
  display: "swap",
});

export const fontDancing = Dancing_Script({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-sig-dancing",
  display: "swap",
});

export const fontGreatVibes = Great_Vibes({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-sig-greatvibes",
  display: "swap",
});

export const fontMarck = Marck_Script({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-sig-marck",
  display: "swap",
});

export const SIGNATURE_STYLES = [
  { id: "caveat", label: "Moderne", font: fontCaveat, cssFamily: 'var(--font-sig-caveat), cursive' },
  { id: "dancing", label: "Fluide", font: fontDancing, cssFamily: 'var(--font-sig-dancing), cursive' },
  { id: "greatvibes", label: "Élégante", font: fontGreatVibes, cssFamily: 'var(--font-sig-greatvibes), cursive' },
  { id: "marck", label: "Classique", font: fontMarck, cssFamily: 'var(--font-sig-marck), cursive' },
] as const;
