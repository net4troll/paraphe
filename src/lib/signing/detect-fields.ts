import "server-only";

import { pathToFileURL } from "node:url";
import path from "node:path";
import type { DetectedField, DetectedType, DetectedSource } from "./detect-types";
import { detectAcroFormsFromPdf } from "./detect-acroforms";
import { detectAnchorsFromPdf } from "./detect-anchors";
import { detectWithGroqVision } from "./detect-groq";
import { detectHeuristicsFromPdf } from "./detect-heuristics";

export type { DetectedField, DetectedType, DetectedSource };

function deduplicateFields(fields: DetectedField[]): DetectedField[] {
  const sorted = [...fields].sort(
    (a, b) => a.page - b.page || a.yPct - b.yPct || a.xPct - b.xPct
  );
  const unique: DetectedField[] = [];

  for (const f of sorted) {
    const isDup = unique.some(
      (u) =>
        u.page === f.page &&
        Math.abs(u.yPct - f.yPct) < 0.03 &&
        Math.abs(u.xPct - f.xPct) < Math.max(u.widthPct, f.widthPct) / 1.5
    );
    if (!isDup) unique.push(f);
  }

  return unique.slice(0, 50);
}

/**
 * Moteur unifié de détection de champs à 3 niveaux :
 * 1. AcroForms natifs & Balises d'ancrage (DocuSign/Documenso style {{signature}}, [signature])
 * 2. Vision IA via Groq (modèle multimodal Qwen 3.8-27b) si GROQ_API_KEY est configurée
 * 3. Moteur heuristique local strict (anti-faux-positifs, placement sous les intitulés)
 */
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
        getPage: (n: number) => Promise<any>;
      }>;
    };
  };

  // En bundle serveur, spécification du worker absolu
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(process.cwd(), "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs")
  ).href;

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  // --- NIVEAU 1a : Formulaires interactifs natifs (AcroForms) ---
  try {
    const acroFields = await detectAcroFormsFromPdf(pdf);
    if (acroFields.length > 0) {
      console.log(`[detectFields] ${acroFields.length} champ(s) AcroForms natif(s) détecté(s).`);
      return deduplicateFields(acroFields);
    }
  } catch (err) {
    console.error("[detectFields] Erreur lecture AcroForms:", err);
  }

  // --- NIVEAU 1b : Balises d'ancrage textuelles ({{signature}}, [signature], etc.) ---
  try {
    const anchorFields = await detectAnchorsFromPdf(pdf);
    if (anchorFields.length > 0) {
      console.log(`[detectFields] ${anchorFields.length} balise(s) d'ancrage détectée(s).`);
      return deduplicateFields(anchorFields);
    }
  } catch (err) {
    console.error("[detectFields] Erreur lecture ancres:", err);
  }

  // --- NIVEAU 2 : Analyse Visuelle par Groq API (Qwen 3.8-27b Vision) ---
  if (process.env.GROQ_API_KEY?.trim()) {
    try {
      console.log("[detectFields] Lancement de l'analyse visuelle IA via Groq (Qwen)...");
      const groqFields = await detectWithGroqVision(pdf);
      if (groqFields.length > 0) {
        console.log(`[detectFields] Groq Vision a détecté ${groqFields.length} champ(s).`);
        return deduplicateFields(groqFields);
      }
    } catch (err) {
      console.error("[detectFields] Erreur Groq Vision, repli sur heuristique:", err);
    }
  }

  // --- NIVEAU 3 : Moteur heuristique local strict ---
  console.log("[detectFields] Utilisation du moteur heuristique local strict.");
  const heuristicFields = await detectHeuristicsFromPdf(pdf);
  return deduplicateFields(heuristicFields);
}
