export type DetectedType =
  | "signature"
  | "text"
  | "textarea"
  | "date"
  | "number"
  | "checkbox"
  | "select";

export type DetectedSource = "acroform" | "anchor" | "groq-vision" | "heuristic";

export type DetectedField = {
  type: DetectedType;
  label: string;
  page: number; // 0-indexed
  xPct: number; // centre horizontal (0..1)
  yPct: number; // bord supérieur vertical (0..1, mesuré depuis le haut)
  widthPct: number; // fraction largeur (0..1)
  signerHint?: string; // ex: "client", "fournisseur", "1", "2"
  source?: DetectedSource;
};
