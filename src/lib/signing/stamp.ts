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

  // 1. Dimensions du cadre cible (Zone de signature)
  const zoneWidthPct = clamp(zone.widthPct || DEFAULT_SIGNATURE_WIDTH_PCT, 0.08, 0.6);
  const boxWidth = zoneWidthPct * width;

  // Hauteur du cadre : si spécifiée (ex: AcroForms), sinon ratio proportionnel standard (ZoneEditor / ratio 1:4)
  const boxHeight = zone.heightPct
    ? clamp(zone.heightPct, 0.02, 0.3) * height
    : clamp(boxWidth * 0.24, 35, 65);

  const cx = clamp(zone.xPct, 0.03, 0.97) * width;
  const topY = height - clamp(zone.yPct, 0.02, 0.98) * height;
  const bottomY = topY - boxHeight;
  const centerY = (topY + bottomY) / 2;

  // 2. Préparation des mentions légales
  const nameLine = params.signerName.trim() || "Signataire";
  const dateLine = `Signé électroniquement le ${params.signedAt.toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "short",
    timeStyle: "short",
  })}`;

  // Ajustement fin de la taille de texte selon l'espace disponible
  const isCompact = boxHeight < 48;
  const nameSize = isCompact ? 6.5 : 7.5;
  const dateSize = isCompact ? 5 : 5.5;

  const nameWidth = boldFont.widthOfTextAtSize(nameLine, nameSize);
  const dateWidth = regularFont.widthOfTextAtSize(dateLine, dateSize);

  // Budget de hauteur pour le texte (nom + date + espacements)
  const textBudget = nameSize + 2 + dateSize + 3;

  // 3. Dimensionnement proportionnel du tracé de signature (doit tenir DANS le cadre)
  const maxImgW = Math.max(30, boxWidth - 16);
  const maxImgH = Math.max(16, boxHeight - textBudget - 4);

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
