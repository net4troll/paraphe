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

const GROQ_SYSTEM_PROMPT = `Tu es un modèle spécialisé dans l'analyse de documents juridiques, contrats, devis et formulaires.
Ton rôle est de détecter VISUELLEMENT les zones à signer ou à remplir sur l'image de la page transmise.

Pour chaque zone détectée :
1. "signature" : rectangle de signature, paraphe ou cachet. IMPORTANT : la zone de signature se situe EN DESSOUS de l'intitulé (ex: sous "Pour le Client", "Signature", etc.) ou dans le cadre réservé.
2. "date" : zone réservée à l'inscription de la date (ex: après ou sous "Fait le :", "Date :").
3. "text" : champ textuel à remplir (ex: après ou sous "Nom :", "Prénom :", "Qualité :", "Adresse :", etc.).
4. "number" : champ numérique (montant, total, etc.).
5. "checkbox" : case à cocher vide ([ ], case carrée).
6. "textarea" : zone de texte multi-lignes (observations, commentaires).

RÈGLES IMPORTANTES :
- Ne détecte PAS le texte normal des clauses ou des paragraphes. Uniquement les zones d'interaction (lignes de soulignement, pointillés, cadres de signature, mentions "Fait à... le...", mentions de signature).
- Retourne les coordonnées en fractions de page (valeurs décimales entre 0.0 et 1.0) :
  * xPct : position horizontale du CENTRE du champ (0.0 = bord gauche, 1.0 = bord droit)
  * yPct : position verticale du BORD SUPÉRIEUR du champ (0.0 = haut de page, 1.0 = bas de page)
  * widthPct : largeur de la zone (ex: 0.26 pour signature, 0.20 pour texte, 0.03 pour case à cocher)
- Précise le rôle ou signataire supposé dans "signerHint" si identifiable (ex: "client", "prestataire", "1", "2").

Format strict de réponse : un objet JSON valide avec une clé "fields" contenant le tableau des champs détectés.`;

/**
 * Normalise un champ renvoyé par le modèle (gère xPct/yPct ou boîtes englobantes box_2d / rect).
 */
function normalizeModelField(
  raw: Record<string, unknown>,
  pageIndex: number
): DetectedField | null {
  let type = String(raw.type || "text").toLowerCase() as DetectedType;
  if (!VALID_TYPES.has(type)) {
    if (/sign|paraphe|cachet/i.test(type)) type = "signature";
    else if (/check|case/i.test(type)) type = "checkbox";
    else if (/date/i.test(type)) type = "date";
    else if (/num|montant|prix/i.test(type)) type = "number";
    else type = "text";
  }

  let xPct = 0.5;
  let yPct = 0.5;
  let widthPct = type === "signature" ? 0.26 : type === "checkbox" ? 0.03 : 0.22;

  // Cas 1 : box_2d [ymin, xmin, ymax, xmax] (format standard détection d'objets)
  if (Array.isArray(raw.box_2d) && raw.box_2d.length === 4) {
    let [ymin, xmin, ymax, xmax] = raw.box_2d.map(Number);
    // Si coordonnées 0..1000
    if (ymax > 1 || xmax > 1) {
      ymin /= 1000;
      xmin /= 1000;
      ymax /= 1000;
      xmax /= 1000;
    }
    xPct = (xmin + xmax) / 2;
    yPct = ymin;
    widthPct = Math.max(0.03, xmax - xmin);
  }
  // Cas 2 : direct xPct, yPct, widthPct
  else if (typeof raw.xPct === "number" && typeof raw.yPct === "number") {
    xPct = raw.xPct;
    yPct = raw.yPct;
    if (typeof raw.widthPct === "number") widthPct = raw.widthPct;
    // Si valeurs exprimées en pourcentages entiers (ex: 75 au lieu de 0.75)
    if (xPct > 1) xPct /= 100;
    if (yPct > 1) yPct /= 100;
    if (widthPct > 1) widthPct /= 100;
  }
  // Cas 3 : x, y, width, height
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

  const label = String(raw.label || (type === "signature" ? "Signature" : "Champ")).slice(0, 60);
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
 * Rend une page PDF en buffer JPEG via @napi-rs/canvas.
 */
async function renderPageToJpeg(page: PDFPageProxy, scale = 1.3): Promise<Buffer> {
  const viewport = page.getViewport({ scale });
  const width = Math.floor(viewport.width);
  const height = Math.floor(viewport.height);

  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  // Fond blanc pour éviter la transparence sur le modèle
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toBuffer("image/jpeg", 80);
}

/**
 * Niveau 2 : Détection visuelle par Groq API (modèle Qwen Vision, ex: qwen/qwen3.8-27b).
 */
export async function detectWithGroqVision(
  pdf: PDFDocumentProxy
): Promise<DetectedField[]> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return [];

  const model = process.env.GROQ_DETECTION_MODEL?.trim() || "qwen/qwen3.8-27b";

  // Sélection des pages pertinentes (la dernière page contient quasi toujours les signatures)
  const targetPages: number[] = [];
  if (pdf.numPages <= 3) {
    for (let i = 1; i <= pdf.numPages; i++) targetPages.push(i);
  } else {
    // Page 1 (en-tête / formulaire) et les 2 dernières pages (signatures & annexes)
    targetPages.push(1);
    if (!targetPages.includes(pdf.numPages - 1)) targetPages.push(pdf.numPages - 1);
    if (!targetPages.includes(pdf.numPages)) targetPages.push(pdf.numPages);
  }

  const allFields: DetectedField[] = [];

  for (const pageNum of targetPages) {
    const page = await pdf.getPage(pageNum);
    const jpegBuffer = await renderPageToJpeg(page, 1.3);
    const base64Data = jpegBuffer.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${base64Data}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

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
                  text: `Analyse cette page (Page ${pageNum} sur ${pdf.numPages}). Identifie les zones de signature et les champs interactifs à remplir.`,
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
          max_tokens: 1500,
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

      const parsed = JSON.parse(content) as { fields?: Record<string, unknown>[] };
      const rawFields = Array.isArray(parsed.fields)
        ? parsed.fields
        : Array.isArray(parsed)
        ? (parsed as Record<string, unknown>[])
        : [];

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
