import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Tamponne les valeurs des champs remplis par un signataire sur le PDF.
 * Convention de position identique aux zones de signature : xPct = centre,
 * yPct = bord supérieur (fractions de page), widthPct = largeur (fraction).
 */

export type FieldToStamp = {
  type: string;
  label: string;
  value: string | boolean;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
};

const INK = rgb(0.09, 0.13, 0.22);
const LINE = rgb(0.58, 0.62, 0.68);
const LABEL = rgb(0.42, 0.46, 0.52);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Tronque un texte à la largeur donnée (approximation par mesure pdf-lib). */
function fitText(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, maxWidth: number, size: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(out + "…", size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + "…";
}

export async function stampFieldValues(
  pdfBytes: Buffer,
  fields: FieldToStamp[]
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const field of fields) {
    const page = pages[field.page];
    if (!page) continue;
    const { width, height } = page.getSize();

    const boxW = clamp(field.widthPct, 0.04, 0.9) * width;
    const boxX = clamp(field.xPct, 0.02, 0.98) * width - boxW / 2;
    const topY = height - clamp(field.yPct, 0.02, 0.98) * height;

    const isCheckbox = field.type === "checkbox";
    const isArea = field.type === "textarea";
    const boxH = isCheckbox ? 13 : isArea ? 44 : 17;
    const rectY = topY - boxH;

    if (isCheckbox) {
      page.drawRectangle({
        x: boxX,
        y: rectY,
        width: 12,
        height: 12,
        borderColor: LINE,
        borderWidth: 1,
      });
      if (field.value === true) {
        page.drawText("X", {
          x: boxX + 3,
          y: rectY + 2.5,
          size: 8,
          font,
          color: INK,
        });
      }
      continue;
    }

    const value = String(field.value ?? "").trim();
    if (!value) continue;

    // Texte embriqué directement dans le PDF — aucun cadre ni libellé artificiel
    try {
      page.drawRectangle({
        x: Math.max(0, boxX - 1),
        y: Math.max(0, rectY),
        width: boxW + 2,
        height: boxH,
        color: rgb(1, 1, 1),
      });
      if (isArea) {
        const size = 9;
        const lineHeight = 12;
        const words = value.split(/\s+/).filter(Boolean);
        const lines: string[] = [];
        let current = "";
        for (const word of words) {
          const candidate = current ? `${current} ${word}` : word;
          if (font.widthOfTextAtSize(candidate, size) <= boxW) {
            current = candidate;
          } else {
            if (current) lines.push(current);
            current = word;
          }
          if (lines.length >= 6) break;
        }
        if (lines.length < 6 && current) lines.push(current);
        lines.forEach((line, i) => {
          page.drawText(fitText(line, font, boxW, size), {
            x: boxX,
            y: topY - 11 - i * lineHeight,
            size,
            font,
            color: INK,
          });
        });
      } else {
        page.drawText(fitText(value, font, boxW, 9.5), {
          x: boxX,
          y: topY - 11,
          size: 9.5,
          font,
          color: INK,
        });
      }
    } catch {
      // caractères non encodables
    }
  }

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
