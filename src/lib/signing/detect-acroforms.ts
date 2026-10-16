import "server-only";

import type { DetectedField } from "./detect-types";

type PDFPageProxy = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  getAnnotations: () => Promise<unknown[]>;
};

type PDFDocumentProxy = {
  numPages: number;
  getPage: (n: number) => Promise<PDFPageProxy>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanLabel(raw: string): string {
  return raw
    .replace(/[._\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[:\s]+$/, "")
    .trim()
    .slice(0, 60);
}

/**
 * Niveau 1a : Détection des champs AcroForms / widgets interactifs natifs du PDF.
 * Si le document est un formulaire interactif (CERFA, PDF Adobe/Word avec formulaires),
 * les coordonnées et types sont extraits avec une précision de 100 %.
 */
export async function detectAcroFormsFromPdf(
  pdf: PDFDocumentProxy
): Promise<DetectedField[]> {
  const fields: DetectedField[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const annotations = await page.getAnnotations();

    for (const raw of annotations) {
      const a = raw as {
        subtype?: string;
        fieldType?: string;
        fieldName?: string;
        alternativeText?: string;
        rect?: number[];
        checkBox?: boolean;
        radioButton?: boolean;
        multiLine?: boolean;
      };

      if (a.subtype !== "Widget" || !Array.isArray(a.rect) || a.rect.length < 4) {
        continue;
      }

      const [x1, y1, x2, y2] = a.rect;
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);

      const width = maxX - minX;
      const height = maxY - minY;
      if (width <= 0 || height <= 0) continue;

      // Conversion repère PDF (origine bas-gauche) -> Signflow (xPct centre, yPct haut)
      const xPct = clamp((minX + width / 2) / viewport.width, 0.02, 0.98);
      const yPct = clamp((viewport.height - maxY) / viewport.height, 0.02, 0.98);
      const widthPct = clamp(width / viewport.width, 0.03, 0.9);

      const rawName = a.fieldName || a.alternativeText || "Champ";
      const nameLower = rawName.toLowerCase();

      // Déduction du type
      let type: DetectedField["type"] = "text";
      if (a.fieldType === "Sig" || /sign|paraphe|cachet/i.test(nameLower)) {
        type = "signature";
      } else if (a.fieldType === "Btn") {
        type = "checkbox";
      } else if (a.fieldType === "Ch") {
        type = "select";
      } else if (a.fieldType === "Tx") {
        if (a.multiLine) {
          type = "textarea";
        } else if (/\bdate\b|en date du/i.test(nameLower)) {
          type = "date";
        } else if (/montant|prix|total|somme|tarif|tva|ht|ttc/i.test(nameLower)) {
          type = "number";
        }
      }

      fields.push({
        type,
        label: cleanLabel(rawName) || "Champ",
        page: p - 1,
        xPct,
        yPct,
        widthPct: type === "checkbox" ? Math.max(widthPct, 0.03) : widthPct,
        source: "acroform",
      });
    }
  }

  return fields;
}
