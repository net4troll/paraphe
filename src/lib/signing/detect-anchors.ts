import "server-only";

import type { DetectedField, DetectedType } from "./detect-types";

type TextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
};

type PDFPageProxy = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: unknown[] }>;
};

type PDFDocumentProxy = {
  numPages: number;
  getPage: (n: number) => Promise<PDFPageProxy>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type AnchorDef = {
  regex: RegExp;
  type: DetectedType;
  defaultWidth: number;
  labelPrefix: string;
};

const ANCHOR_PATTERNS: AnchorDef[] = [
  // Signatures : {{signature}}, {{sig:1}}, {{signature:client}}, [signature], \s1\
  {
    regex: /(?:\{\{(?:signature|sig)(?::([^}]+))?\}\}|\[signature(?::([^\]]+))?\]|\\s(\d+)\\)/i,
    type: "signature",
    defaultWidth: 0.26,
    labelPrefix: "Signature",
  },
  // Dates : {{date}}, {{date:1}}, [date], \d1\
  {
    regex: /(?:\{\{date(?::([^}]+))?\}\}|\[date(?::([^\]]+))?\]|\\d(\d+)\\)/i,
    type: "date",
    defaultWidth: 0.18,
    labelPrefix: "Date",
  },
  // Textes : {{nom}}, {{name}}, {{text}}, {{texte}}, [nom]
  {
    regex: /\{\{(?:nom|name|texte?)(?::([^}]+))?\}\}|\[(?:nom|name|texte?)\]/i,
    type: "text",
    defaultWidth: 0.22,
    labelPrefix: "Nom",
  },
  // Cases à cocher : {{case}}, {{checkbox}}, [x] vide : "[ ]"
  {
    regex: /\{\{(?:case|checkbox)(?::([^}]+))?\}\}|\[\s{1,2}\]/i,
    type: "checkbox",
    defaultWidth: 0.03,
    labelPrefix: "Case à cocher",
  },
  // Commentaire : {{commentaire}}, {{textarea}}
  {
    regex: /\{\{(?:commentaire|observation|textarea)(?::([^}]+))?\}\}/i,
    type: "textarea",
    defaultWidth: 0.4,
    labelPrefix: "Commentaire",
  },
];

/**
 * Niveau 1b : Détection des balises d'ancrage (DocuSign, Documenso, HelloSign).
 * Recherche dans le calque de texte des balises standard comme {{signature}}, [signature], \s1\.
 */
export async function detectAnchorsFromPdf(
  pdf: PDFDocumentProxy
): Promise<DetectedField[]> {
  const fields: DetectedField[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    for (const rawItem of content.items) {
      const item = rawItem as TextItem;
      if (typeof item.str !== "string" || !item.str.trim() || !item.transform) {
        continue;
      }

      for (const anchor of ANCHOR_PATTERNS) {
        const match = anchor.regex.exec(item.str);
        if (!match) continue;

        // Hint de signataire éventuel (ex: {{signature:client}} ou \s1\)
        const signerHint = (match[1] || match[2] || match[3] || "").trim().toLowerCase();

        const x = item.transform[4];
        const baseline = item.transform[5];
        const itemWidth = item.width ?? 50;

        // Position de l'ancre en % de la page
        const startX = x / viewport.width;
        const widthPct = anchor.defaultWidth;
        const xPct = clamp(startX + widthPct / 2, 0.05, 0.95);
        const yPct = clamp(1 - baseline / viewport.height, 0.03, 0.95);

        fields.push({
          type: anchor.type,
          label: signerHint ? `${anchor.labelPrefix} (${signerHint})` : anchor.labelPrefix,
          page: p - 1,
          xPct,
          yPct,
          widthPct,
          signerHint: signerHint || undefined,
          source: "anchor",
        });
      }
    }
  }

  return fields;
}
