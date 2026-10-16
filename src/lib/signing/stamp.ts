import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Zone de signature : xPct = centre, yPct = bord supérieur, widthPct = largeur
 *  (fractions de page, y mesuré depuis le HAUT). */
export type SignatureZone = {
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct?: number;
};

export const DEFAULT_SIGNATURE_WIDTH_PCT = 0.26; // ≈ 55 mm sur un A4

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Appose l'image de signature d'un signataire sur le PDF à l'emplacement précis de sa zone,
 * avec la mention « Signé électroniquement le … par … », en garantissant que l'ensemble
 * (tracé + nom + horodatage) reste strictement contenu et centré à l'intérieur du cadre défini.
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
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await doc.embedFont(StandardFonts.Helvetica);

  // 1. Dimensions du cadre cible (Zone de signature définie à l'édit ou détectée)
  const zoneWidthPct = clamp(zone.widthPct || DEFAULT_SIGNATURE_WIDTH_PCT, 0.05, 0.9);
  const boxWidth = zoneWidthPct * width;

  // Hauteur du cadre : si spécifiée (détectée ou éditée), sinon ratio proportionnel standard (ZoneEditor / ratio standard)
  const boxHeight = zone.heightPct
    ? clamp(zone.heightPct, 0.01, 0.6) * height
    : clamp(boxWidth * 0.24, 25, 140);

  const cx = clamp(zone.xPct, 0.03, 0.97) * width;
  const topY = height - clamp(zone.yPct, 0.01, 0.99) * height;
  const bottomY = topY - boxHeight;
  const centerY = (topY + bottomY) / 2;

  // 2. Préparation des mentions légales
  const nameLine = params.signerName.trim() || "Signataire";
  const dateLine = `Signé électroniquement le ${params.signedAt.toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "short",
    timeStyle: "short",
  })}`;

  // Tailles de texte adaptatives selon la hauteur et la largeur de la zone
  let nameSize = clamp(boxHeight * 0.14, 5, 8.5);
  let dateSize = clamp(boxHeight * 0.10, 4.2, 6.5);

  let nameWidth = boldFont.widthOfTextAtSize(nameLine, nameSize);
  let dateWidth = regularFont.widthOfTextAtSize(dateLine, dateSize);

  // Si le texte est plus large que le cadre (avec 8pt de marge latérale), on adapte la taille
  const maxTextWidth = Math.max(20, boxWidth - 8);
  if (nameWidth > maxTextWidth) {
    const ratio = maxTextWidth / nameWidth;
    nameSize = Math.max(4.5, nameSize * ratio);
    nameWidth = boldFont.widthOfTextAtSize(nameLine, nameSize);
  }
  if (dateWidth > maxTextWidth) {
    const ratio = maxTextWidth / dateWidth;
    dateSize = Math.max(3.8, dateSize * ratio);
    dateWidth = regularFont.widthOfTextAtSize(dateLine, dateSize);
  }

  // Budget de hauteur pour le texte (nom + date + espacements)
  const textBudget = nameSize + 2 + dateSize + 3;

  // 3. Dimensionnement proportionnel du tracé de signature (doit tenir DANS le cadre)
  const maxImgW = Math.max(20, boxWidth - 10);
  const maxImgH = Math.max(12, boxHeight - textBudget - 4);

  const scale = Math.min(maxImgW / image.width, maxImgH / image.height);
  const imgW = image.width * scale;
  const imgH = image.height * scale;

  // 4. Centrage vertical harmonieux du bloc complet (image + nom + date) dans le cadre
  const totalContentHeight = imgH + 2 + nameSize + 2 + dateSize;
  const contentTop = centerY + totalContentHeight / 2;

  // Position Y de l'image
  const imgY = contentTop - imgH;

  page.drawImage(image, {
    x: cx - imgW / 2,
    y: imgY,
    width: imgW,
    height: imgH,
    opacity: 0.98,
  });

  // Position Y du nom du signataire
  const nameY = imgY - 2 - nameSize;
  page.drawText(nameLine, {
    x: cx - nameWidth / 2,
    y: nameY,
    size: nameSize,
    font: boldFont,
    color: rgb(0.09, 0.13, 0.22),
  });

  // Position Y de l'horodatage
  const dateY = nameY - 2 - dateSize;
  page.drawText(dateLine, {
    x: cx - dateWidth / 2,
    y: dateY,
    size: dateSize,
    font: regularFont,
    color: rgb(0.35, 0.38, 0.44),
  });

  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
