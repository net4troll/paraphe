import "server-only";

import { pathToFileURL } from "node:url";
import path from "node:path";

/**
 * Moteur de détection de champs 100 % local — analyse du texte et de la géométrie
 * du PDF via pdfjs-dist (aucun service externe, aucun modèle lourd, CPU only).
 *
 * Détecte : lignes de soulignement « ____ », points de conduite, libellés connus
 * (signature / date / montant / nom / case…) et propose une position de champ
 * à droite du libellé. Les propositions restent modifiables dans l'interface.
 */

export type DetectedType =
  | "signature"
  | "text"
  | "textarea"
  | "date"
  | "number"
  | "checkbox"
  | "select";

export type DetectedField = {
  type: DetectedType;
  label: string;
  page: number;
  xPct: number; // centre
  yPct: number; // bord supérieur
  widthPct: number;
};

type Keyword = { re: RegExp; type: DetectedType };

const KEYWORDS: Keyword[] = [
  { re: /signature|sign[ée]e?s?|cachet|paraphe|fait à|fait pour/i, type: "signature" },
  { re: /commentaire|observation|remarque/i, type: "textarea" },
  { re: /\bdate\b|en date du|fait le/i, type: "date" },
  { re: /montant|prix|total|somme|tarif/i, type: "number" },
  { re: /j'?accepte|à cocher|coch[ée]e|\bcase\b/i, type: "checkbox" },
  {
    re: /nom|pr[ée]nom|adresse|soci[ée]t[ée]|entreprise|ville|email|mail|t[ée]l[ée]phone|t[ée]l\.|fonction|qualit[ée]|objet|lieu|r[ée]f[ée]rence|num[ée]ro|n°/i,
    type: "text",
  },
];

type Frag = { text: string; x: number; endX: number; baseline: number; size: number };

function typeForLine(text: string): DetectedType | null {
  for (const kw of KEYWORDS) {
    if (kw.re.test(text)) return kw.type;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Position (début, largeur) d'un motif au sein d'une ligne, en fractions de page. */
function runGeometry(
  text: string,
  matched: string,
  index: number,
  startPct: number,
  endPct: number
): { startPct: number; widthPct: number } {
  const totalLen = Math.max(text.length, 1);
  const charPct = (endPct - startPct) / totalLen;
  return {
    startPct: startPct + index * charPct,
    widthPct: matched.length * charPct,
  };
}

export async function detectFields(pdfBytes: Buffer): Promise<DetectedField[]> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: (src: {
      data: Uint8Array;
      isEvalSupported: boolean;
      useSystemFonts: boolean;
    }) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getViewport: (o: { scale: number }) => { width: number; height: number };
          getTextContent: () => Promise<{ items: unknown[] }>;
        }>;
      }>;
    };
  };

  // En bundle serveur, le fake worker de pdfjs ne retrouve pas son fichier :
  // chemin absolu du worker dans node_modules (dev et Docker : cwd = racine du projet).
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(process.cwd(), "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs")
  ).href;

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

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

    // Regroupe les fragments par ligne (baseline proche), puis de gauche à droite
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

      const startPct = lineFrags[0].x / viewport.width;
      const endPct = lineFrags[lineFrags.length - 1].endX / viewport.width;
      const topPct = 1 - lineFrags[0].baseline / viewport.height;
      const type = typeForLine(text);
      const cleanLabel = (raw: string) =>
        raw
          .replace(/^\s*[•\-–—]\s*/, "")
          .replace(/[:\s]+$/, "")
          .slice(0, 60)
          .trim();

      // 1) Ligne de soulignement « ____ » → champ large à la place des tirets
      const underscore = text.match(/_{3,}/);
      if (underscore && underscore.index !== undefined) {
        const run = runGeometry(text, underscore[0], underscore.index, startPct, endPct);
        detections.push({
          type: type === "signature" ? "signature" : (type ?? "text"),
          label: cleanLabel(text.slice(0, underscore.index)) || "Champ",
          page: p - 1,
          xPct: clamp(run.startPct + run.widthPct / 2, 0.05, 0.95),
          yPct: clamp(topPct + 0.004, 0.03, 0.97),
          widthPct: clamp(run.widthPct + 0.02, 0.1, 0.5),
        });
        continue;
      }

      // 2) Points de conduite « ...... » → champ texte
      const dots = text.match(/\.{6,}/);
      if (dots && dots.index !== undefined) {
        const run = runGeometry(text, dots[0], dots.index, startPct, endPct);
        detections.push({
          type: type === "signature" ? "signature" : (type ?? "text"),
          label: cleanLabel(text.slice(0, dots.index)) || "Champ",
          page: p - 1,
          xPct: clamp(run.startPct + run.widthPct / 2, 0.05, 0.95),
          yPct: clamp(topPct + 0.004, 0.03, 0.97),
          widthPct: clamp(run.widthPct + 0.02, 0.1, 0.5),
        });
        continue;
      }

      // 3) Libellé connu → champ proposé à droite du libellé
      if (type) {
        const gap = 0.025;
        const available = 0.97 - endPct - gap;
        if (available < 0.08) continue; // pas de place à droite
        const w = clamp(
          type === "signature" ? 0.26 : 0.22,
          0.08,
          Math.max(0.08, Math.min(0.3, available))
        );
        detections.push({
          type,
          label: cleanLabel(text) || "Champ",
          page: p - 1,
          xPct: clamp(endPct + gap + w / 2, 0.05, 0.95),
          yPct: clamp(topPct + 0.004, 0.03, 0.97),
          widthPct: w,
        });
      }
    }
  }

  // Dédoublonnage : même page, même ligne, chevauchement horizontal
  const unique: DetectedField[] = [];
  for (const d of detections.sort(
    (a, b) => a.page - b.page || a.yPct - b.yPct || a.xPct - b.xPct
  )) {
    const duplicate = unique.some(
      (u) =>
        u.page === d.page &&
        Math.abs(u.yPct - d.yPct) < 0.025 &&
        Math.abs(u.xPct - d.xPct) < Math.max(u.widthPct, d.widthPct) / 2
    );
    if (!duplicate) unique.push(d);
  }
  return unique.slice(0, 40);
}
