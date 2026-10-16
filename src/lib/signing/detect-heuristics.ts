import "server-only";

import type { DetectedField, DetectedType } from "./detect-types";

type Frag = {
  text: string;
  x: number;
  endX: number;
  baseline: number;
  size: number;
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

function cleanLabel(raw: string): string {
  return raw
    .replace(/^\s*[•\-–—*]\s*/, "")
    .replace(/[:\s]+$/, "")
    .trim()
    .slice(0, 50);
}

const SIGNATURE_BLOCK_REGEX =
  /^(?:(?:pour|le|la|les)\s+)?(?:signature(?:s)?|client(?:e)?|prestataire|bailleur|locataire|partenaire|salari[ée]|employeur|parties|soussign[ée]|bon pour accord|lu et approuv[ée])[\s:]*$/i;

const FORM_LABEL_REGEX =
  /^(?:nom(?:\s+(?:et\s+)?pr[ée]nom)?|pr[ée]nom|adresse|soci[ée]t[ée]|entreprise|ville|code\s+postal|email|courriel|t[ée]l[ée]phone|t[ée]l\.|date|fait\s+[àa]|montant|prix|r[ée]f[ée]rence|n°|qualit[ée]|titre|fonction)[\s]*:$/i;

/**
 * Niveau 3 : Moteur heuristique local strict.
 * Conçu pour éliminer les faux positifs sur les paragraphes de texte courant
 * et placer correctement les signatures sous leurs intitulés.
 */
export async function detectHeuristicsFromPdf(
  pdf: PDFDocumentProxy
): Promise<DetectedField[]> {
  const detections: DetectedField[] = [];
  const maxPages = Math.min(pdf.numPages, 10);

  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const frags: Frag[] = [];
    for (const item of content.items) {
      const it = item as { str?: string; transform?: number[]; width?: number; height?: number };
      if (typeof it.str !== "string" || it.str.trim() === "" || !it.transform) continue;
      frags.push({
        text: it.str,
        x: it.transform[4],
        endX: it.transform[4] + (it.width ?? 0),
        baseline: it.transform[5],
        size: it.height || 10,
      });
    }
    if (frags.length === 0) continue;

    // Regroupe les fragments par ligne (baseline proche)
    frags.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
    const lines: Frag[][] = [];
    for (const frag of frags) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last[0].baseline - frag.baseline) < Math.max(2, frag.size * 0.45)) {
        last.push(frag);
      } else {
        lines.push([frag]);
      }
    }

    for (const lineFrags of lines) {
      lineFrags.sort((a, b) => a.x - b.x);
      const text = lineFrags
        .map((f) => f.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;

      // FILTRE ANTI-FAUX-POSITIFS : On ignore les lignes longues de paragraphes
      if (text.length > 70 || text.split(" ").length > 10) {
        continue;
      }

      const startPct = lineFrags[0].x / viewport.width;
      const endPct = lineFrags[lineFrags.length - 1].endX / viewport.width;
      const topPct = 1 - lineFrags[0].baseline / viewport.height;

      // 1. Lignes de soulignement "____" ou pointillés "...."
      const underscore = text.match(/_{3,}|\.{4,}/);
      if (underscore && underscore.index !== undefined) {
        const pre = text.slice(0, underscore.index).trim();
        const totalLen = Math.max(text.length, 1);
        const charPct = (endPct - startPct) / totalLen;
        const runStartPct = startPct + underscore.index * charPct;
        const runWidthPct = underscore[0].length * charPct;

        let type: DetectedType = "text";
        if (/sign|paraphe/i.test(pre)) type = "signature";
        else if (/\bdate\b/i.test(pre)) type = "date";
        else if (/montant|prix|total/i.test(pre)) type = "number";

        detections.push({
          type,
          label: cleanLabel(pre) || (type === "signature" ? "Signature" : "Champ"),
          page: p - 1,
          xPct: clamp(runStartPct + runWidthPct / 2, 0.05, 0.95),
          yPct: clamp(topPct + 0.005, 0.03, 0.96),
          widthPct: clamp(runWidthPct + 0.02, 0.1, 0.5),
          source: "heuristic",
        });
        continue;
      }

      // 2. Bloc signature (ex: "Pour le Client", "Signature :", "Le prestataire")
      // Doit être situé en bas de page (topPct > 0.40)
      if (SIGNATURE_BLOCK_REGEX.test(text) && topPct > 0.4) {
        const width = 0.26;
        detections.push({
          type: "signature",
          label: cleanLabel(text) || "Signature",
          page: p - 1,
          xPct: clamp(startPct + width / 2, 0.05, 0.95),
          // Positionné directement sous l'intitulé de signature
          yPct: clamp(topPct + 0.015, 0.05, 0.92),
          widthPct: width,
          source: "heuristic",
        });
        continue;
      }

      // 3. Libellé de formulaire strict terminé par ":" (ex: "Nom :", "Date :")
      if (FORM_LABEL_REGEX.test(text)) {
        let type: DetectedType = "text";
        if (/\bdate\b|fait\s+[àa]/i.test(text)) type = "date";
        else if (/montant|prix/i.test(text)) type = "number";

        const gap = 0.02;
        const available = 0.95 - endPct - gap;
        const widthPct = Math.min(0.24, Math.max(0.12, available));

        // Si de la place à droite : à droite du libellé
        if (available > 0.1) {
          detections.push({
            type,
            label: cleanLabel(text),
            page: p - 1,
            xPct: clamp(endPct + gap + widthPct / 2, 0.05, 0.95),
            yPct: clamp(topPct, 0.03, 0.96),
            widthPct,
            source: "heuristic",
          });
        } else {
          // Sinon juste en dessous
          detections.push({
            type,
            label: cleanLabel(text),
            page: p - 1,
            xPct: clamp(startPct + 0.12, 0.05, 0.95),
            yPct: clamp(topPct + 0.025, 0.03, 0.96),
            widthPct: 0.24,
            source: "heuristic",
          });
        }
      }
    }
  }

  return detections;
}
