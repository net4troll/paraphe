import "server-only";

import { createCanvas } from "@napi-rs/canvas";
import type { DetectedField, DetectedType } from "./detect-types";

type PDFPageProxy = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (params: { canvasContext: unknown; viewport: unknown }) => {
    promise: Promise<void>;
  };
};

type PDFDocumentProxy = {
  numPages: number;
  getPage: (n: number) => Promise<PDFPageProxy>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const VALID_TYPES = new Set<DetectedType>([
  "signature",
  "text",
  "textarea",
  "date",
  "number",
  "checkbox",
  "select",
]);

const GROQ_SYSTEM_PROMPT = `Tu es un modèle spécialisé dans l'analyse de documents juridiques, contrats, formulaires administratifs et devis.
Ton rôle est d'analyser l'image de la page transmise pour détecter TOUTES les zones où du texte ou une signature doit être ajouté(e) ou rempli(e) :

1. "signature" : zones de signature, paraphes, cachets ou mentions "Pour le Client", "Pour le Prestataire", etc.
2. "text" : zones de saisie textuelle (lignes de soulignement "____", pointillés "....", mentions "Nom :", "Prénom :", "Adresse :", "Qualité :", "Fait à :", cases ou champs vides).
3. "date" : emplacements où inscrire la date ("Date :", "Fait le :", etc.).
4. "number" : montants, totaux, numéros de référence.
5. "checkbox" : cases à cocher à remplir ([ ], case carrée).
6. "textarea" : blocs de texte multi-lignes, observations, commentaires.

Pour chaque zone détectée, fournis :
- "type": "signature" | "text" | "date" | "number" | "checkbox" | "textarea"
- "label": libellé clair du champ (ex: "Nom du client", "Date", "Signature du Client", "Montant")
- "bbox_2d": [ymin, xmin, ymax, xmax] normalisé entre 0 et 1000 correspondant au rectangle où inscrire le texte ou la signature
- "signerHint": rôle supposé ("client", "prestataire", "1", "2") si identifiable

Format strict de réponse : un objet JSON valide avec la clé "fields" : { "fields": [ ... ] }`;

/**
 * Normalise un champ renvoyé par Qwen (supporte bbox_2d, box_2d, rect ou xPct/yPct).
 */
function normalizeModelField(
  raw: Record<string, unknown>,
  pageIndex: number
): DetectedField | null {
  const rawLabel = String(raw.label || raw.text_content || raw.name || raw.field_name || "").trim();
  let type = String(raw.type || "").toLowerCase().trim() as DetectedType;

  // Déduction de type intelligente si manquant ou imprécis
  if (!VALID_TYPES.has(type)) {
    if (/sign|paraphe|cachet/i.test(type) || /sign|paraphe|cachet/i.test(rawLabel)) {
      type = "signature";
    } else if (/check|case/i.test(type) || /case|cocher/i.test(rawLabel)) {
      type = "checkbox";
    } else if (/date/i.test(type) || /\bdate\b|en date du/i.test(rawLabel)) {
      type = "date";
    } else if (/num|montant|prix|total/i.test(type) || /montant|prix|total/i.test(rawLabel)) {
      type = "number";
    } else {
      type = "text";
    }
  }

  let xPct = 0.5;
  let yPct = 0.5;
  let widthPct = type === "signature" ? 0.26 : type === "checkbox" ? 0.03 : 0.22;

  // 1. Détection via boîte englobante (bbox_2d / box_2d / bbox / rect)
  const box = (raw.bbox_2d || raw.box_2d || raw.bbox || raw.rect) as number[] | undefined;
  if (Array.isArray(box) && box.length === 4) {
    let [ymin, xmin, ymax, xmax] = box.map(Number);
    // Si coordonnées exprimées de 0 à 1000 (standard Qwen-VL / LayoutLM)
    if (ymax > 1 || xmax > 1 || ymin > 1 || xmin > 1) {
      ymin /= 1000;
      xmin /= 1000;
      ymax /= 1000;
      xmax /= 1000;
    }
    const actualYmin = Math.min(ymin, ymax);
    const actualYmax = Math.max(ymin, ymax);
    const actualXmin = Math.min(xmin, xmax);
    const actualXmax = Math.max(xmin, xmax);

    xPct = (actualXmin + actualXmax) / 2;
    yPct = actualYmin;
    widthPct = Math.max(0.04, actualXmax - actualXmin);

    // Ajustement de taille minimale pour les signatures
    if (type === "signature" && widthPct < 0.15) {
      widthPct = 0.26;
    }
  }
  // 2. Détection via coordonnées directes (xPct, yPct, widthPct)
  else if (typeof raw.xPct === "number" && typeof raw.yPct === "number") {
    xPct = raw.xPct;
    yPct = raw.yPct;
    if (typeof raw.widthPct === "number") widthPct = raw.widthPct;
    if (xPct > 1) xPct /= 100;
    if (yPct > 1) yPct /= 100;
    if (widthPct > 1) widthPct /= 100;
  }
  // 3. Détection via x, y, width, height
  else if (typeof raw.x === "number" && typeof raw.y === "number") {
    let x = raw.x;
    let y = raw.y;
    let w = typeof raw.width === "number" ? raw.width : widthPct;
    if (x > 1) x /= 100;
    if (y > 1) y /= 100;
    if (w > 1) w /= 100;
    xPct = x + w / 2;
    yPct = y;
    widthPct = w;
  } else {
    return null;
  }

  const label = (rawLabel || (type === "signature" ? "Signature" : "Champ")).slice(0, 60);
  const signerHint = typeof raw.signerHint === "string" ? raw.signerHint.trim().toLowerCase() : undefined;

  return {
    type,
    label,
    page: pageIndex,
    xPct: clamp(xPct, 0.05, 0.95),
    yPct: clamp(yPct, 0.03, 0.95),
    widthPct: clamp(widthPct, 0.02, 0.6),
    signerHint: signerHint || undefined,
    source: "groq-vision",
  };
}

/**
 * Rend une page PDF en buffer JPEG haute fidélité via @napi-rs/canvas.
 */
async function renderPageToJpeg(page: PDFPageProxy, scale = 1.4): Promise<Buffer> {
  const viewport = page.getViewport({ scale });
  const width = Math.floor(viewport.width);
  const height = Math.floor(viewport.height);

  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  // Fond blanc pour éviter la transparence
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toBuffer("image/jpeg", 85);
}

/**
 * Niveau 2 : Détection visuelle par Groq API (modèle multimodal Qwen 3.8-27b Vision).
 */
export async function detectWithGroqVision(
  pdf: PDFDocumentProxy
): Promise<DetectedField[]> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return [];

  const model = process.env.GROQ_DETECTION_MODEL?.trim() || "qwen/qwen3.8-27b";

  // Sélection des pages pertinentes (sur contrats courts : toutes les pages ; sur longs : début et fin)
  const targetPages: number[] = [];
  if (pdf.numPages <= 3) {
    for (let i = 1; i <= pdf.numPages; i++) targetPages.push(i);
  } else {
    targetPages.push(1);
    if (!targetPages.includes(pdf.numPages - 1)) targetPages.push(pdf.numPages - 1);
    if (!targetPages.includes(pdf.numPages)) targetPages.push(pdf.numPages);
  }

  const allFields: DetectedField[] = [];

  for (const pageNum of targetPages) {
    const page = await pdf.getPage(pageNum);
    const jpegBuffer = await renderPageToJpeg(page, 1.4);
    const base64Data = jpegBuffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64Data}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: GROQ_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Analyse cette page (Page ${pageNum} sur ${pdf.numPages}). Identifie toutes les zones où du texte ou une signature doit être ajouté(e). Retourne un objet JSON avec la clé 'fields'.`,
                },
                {
                  type: "image_url",
                  image_url: { url: dataUrl },
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        console.error(`[detectWithGroqVision] Échec Groq (${res.status}):`, errorText);
        continue;
      }

      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = body.choices?.[0]?.message?.content;
      if (!content) continue;

      let rawFields: Record<string, unknown>[] = [];
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          rawFields = parsed;
        } else if (Array.isArray(parsed.fields)) {
          rawFields = parsed.fields;
        } else if (Array.isArray(parsed.detections)) {
          rawFields = parsed.detections;
        } else if (typeof parsed === "object" && parsed !== null) {
          // Si objet avec clés numériques ou unique champ
          const values = Object.values(parsed);
          const firstArray = values.find(Array.isArray);
          if (firstArray) rawFields = firstArray as Record<string, unknown>[];
        }
      } catch (jsonErr) {
        console.error("[detectWithGroqVision] Erreur parse JSON:", jsonErr);
        continue;
      }

      for (const raw of rawFields) {
        const field = normalizeModelField(raw, pageNum - 1);
        if (field) allFields.push(field);
      }
    } catch (err) {
      console.error(`[detectWithGroqVision] Erreur page ${pageNum}:`, err);
    } finally {
      clearTimeout(timeout);
    }
  }

  return allFields;
}
