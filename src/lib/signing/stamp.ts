import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Zone de signature : xPct = centre, yPct = bord supérieur, widthPct = largeur
 *  (fractions de page, y mesuré depuis le HAUT). */
export type SignatureZone = {
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
};

const PT_PER_MM = 72 / 25.4;
export const DEFAULT_SIGNATURE_WIDTH_PCT = 0.26; // ≈ 55 mm sur un A4

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Appose l'image de signature d'un signataire sur le PDF à l'emplacement de sa zone,
 * avec la mention « Signé électroniquement le … par … ».
 */
export async function stampSignature(
  pdfBytes: Buffer,
  zone: SignatureZone,
  params: { signaturePng: Buffer; signerName: string; signedAt: Date }
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const page = pages[zone.page];
  if (!page) {
    throw new Error(`Page ${zone.page + 1} inexistante dans le document`);
  }

  const { width, height } = page.getSize();
  const image = await doc.embedPng(params.signaturePng);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const plainFont = await doc.embedFont(StandardFonts.Helvetica);

  const widthPt =
    clamp(zone.widthPct || DEFAULT_SIGNATURE_WIDTH_PCT, 0.1, 0.6) * width;
  const widthPtClamped = widthPt;
  const imageHeightPt = (image.height / image.width) * widthPtClamped;
  const cx = clamp(zone.xPct, 0.03, 0.97) * width;
  const topY = height - clamp(zone.yPct, 0.03, 0.97) * height;

  page.drawImage(image, {
    x: cx - widthPtClamped / 2,
    y: topY - imageHeightPt,
    width: widthPtClamped,
    height: imageHeightPt,
    opacity: 0.95,
  });

  const dateLine = `Signé électroniquement le ${params.signedAt.toLocaleString("fr-FR", {
    timeZone: "Africa/Algiers",
    dateStyle: "short",
    timeStyle: "short",
  })}`;
  const nameLine = params.signerName.trim() || "Signataire";

  const nameSize = 8;
  const nameWidth = font.widthOfTextAtSize(nameLine, nameSize);
  page.drawText(nameLine, {
    x: cx - nameWidth / 2,
    y: topY - imageHeightPt - nameSize - 4,
    size: nameSize,
    font,
    color: rgb(0.09, 0.13, 0.22),
  });

  const dateSize = 6;
  const dateWidth = plainFont.widthOfTextAtSize(dateLine, dateSize);
  page.drawText(dateLine, {
    x: cx - dateWidth / 2,
    y: topY - imageHeightPt - nameSize - 4 - dateSize - 3,
    size: dateSize,
    font: plainFont,
    color: rgb(0.35, 0.38, 0.44),
  });

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
