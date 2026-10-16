import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type CreatePdfParams = {
  title: string;
  content: string; // Paragraphes de texte ou clauses
  companyName?: string;
  signers?: Array<{ name: string; role?: string; email?: string }>;
  fields?: Array<{ label: string; value: string }>;
  city?: string;
  dateStr?: string;
};

const TEAL = rgb(0.06, 0.46, 0.44);
const DARK = rgb(0.09, 0.13, 0.22);
const MUTED = rgb(0.42, 0.46, 0.52);
const LINE_COLOR = rgb(0.85, 0.88, 0.92);

/**
 * Découpe un texte en lignes adaptées à la largeur maximale.
 */
function wrapText(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push("");
      continue;
    }
    const words = trimmed.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, size);
      if (width <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  return lines;
}

/**
 * Génère un document PDF soigné à partir de données textuelles fournies par un agent ou l'API.
 * Conçu avec une disposition professionnelle, pagination automatique et blocs de signatures prêts à signer.
 */
export async function createPdfDocument(params: CreatePdfParams): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 54;
  const marginTop = 54;
  const marginBottom = 60;
  const contentWidth = pageWidth - marginX * 2;

  let currentPage = doc.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - marginTop;

  // En-tête de première page
  const company = params.companyName?.trim() || process.env.COMPANY_NAME || "SignFlow";
  currentPage.drawText(company.toUpperCase(), {
    x: marginX,
    y: cursorY,
    size: 10,
    font: fontBold,
    color: TEAL,
  });

  const todayStr =
    params.dateStr ||
    new Date().toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

  const dateHeader = `Date : ${todayStr}`;
  const dateWidth = fontRegular.widthOfTextAtSize(dateHeader, 9);
  currentPage.drawText(dateHeader, {
    x: pageWidth - marginX - dateWidth,
    y: cursorY,
    size: 9,
    font: fontRegular,
    color: MUTED,
  });

  cursorY -= 28;

  // Ligne de séparation
  currentPage.drawLine({
    start: { x: marginX, y: cursorY },
    end: { x: pageWidth - marginX, y: cursorY },
    thickness: 1,
    color: LINE_COLOR,
  });

  cursorY -= 32;

  // Titre du document
  currentPage.drawText(params.title, {
    x: marginX,
    y: cursorY,
    size: 18,
    font: fontBold,
    color: DARK,
  });

  cursorY -= 26;

  // Tableau éventuel de champs / métadonnées (ex: Nom du client, Référence, Montant)
  if (params.fields && params.fields.length > 0) {
    cursorY -= 6;
    for (const field of params.fields) {
      const label = `${field.label} : `;
      const labelW = fontBold.widthOfTextAtSize(label, 10);
      currentPage.drawText(label, {
        x: marginX,
        y: cursorY,
        size: 10,
        font: fontBold,
        color: DARK,
      });
      currentPage.drawText(String(field.value), {
        x: marginX + labelW,
        y: cursorY,
        size: 10,
        font: fontRegular,
        color: DARK,
      });
      cursorY -= 18;
    }
    cursorY -= 10;
  }

  // Découpage et impression du contenu
  const bodyLines = wrapText(params.content, fontRegular, 10.5, contentWidth);

  for (const line of bodyLines) {
    // Si saut de page nécessaire (en réservant 180pt pour le bloc signatures sur la dernière page)
    if (cursorY < marginBottom + 160) {
      currentPage = doc.addPage([pageWidth, pageHeight]);
      cursorY = pageHeight - marginTop;
    }

    if (line === "") {
      cursorY -= 12;
      continue;
    }

    // Détection de sous-titres (lignes courtes terminées par ":" ou commençant par Article / 1.)
    const isHeading =
      line.length < 50 &&
      (line.endsWith(":") || /^(?:article|chapitre|\d+\.)/i.test(line));

    currentPage.drawText(line, {
      x: marginX,
      y: cursorY,
      size: isHeading ? 11 : 10.5,
      font: isHeading ? fontBold : fontRegular,
      color: isHeading ? DARK : rgb(0.2, 0.24, 0.3),
    });

    cursorY -= isHeading ? 18 : 15;
  }

  // Espace avant la signature
  cursorY -= 25;
  if (cursorY < marginBottom + 140) {
    currentPage = doc.addPage([pageWidth, pageHeight]);
    cursorY = pageHeight - marginTop - 40;
  }

  // Mention de lieu et date
  const city = params.city || "Paris";
  currentPage.drawText(`Fait à ${city}, le ${todayStr}`, {
    x: marginX,
    y: cursorY,
    size: 10,
    font: fontRegular,
    color: MUTED,
  });

  cursorY -= 30;

  // Blocs signatures (2 colonnes)
  const signers = params.signers && params.signers.length > 0
    ? params.signers
    : [
        { name: "Le Responsable", role: "Émetteur" },
        { name: "Le Bénéficiaire", role: "Signataire" },
      ];

  const colWidth = (contentWidth - 40) / 2;

  for (let i = 0; i < Math.min(2, signers.length); i++) {
    const s = signers[i];
    const colX = marginX + i * (colWidth + 40);
    const roleLabel = s.role ? `Pour ${s.role}` : `Signataire ${i + 1}`;

    // Intitulé du signataire
    currentPage.drawText(roleLabel, {
      x: colX,
      y: cursorY,
      size: 11,
      font: fontBold,
      color: DARK,
    });

    currentPage.drawText(s.name, {
      x: colX,
      y: cursorY - 14,
      size: 10,
      font: fontRegular,
      color: MUTED,
    });

    currentPage.drawText("Signature :", {
      x: colX,
      y: cursorY - 32,
      size: 9.5,
      font: fontRegular,
      color: MUTED,
    });

    // Cadre de signature en tirets
    currentPage.drawRectangle({
      x: colX,
      y: cursorY - 95,
      width: colWidth,
      height: 55,
      borderColor: LINE_COLOR,
      borderWidth: 1,
    });

    // Balise d'ancrage discrète pour détection automatique 100% fiable
    currentPage.drawText(`{{signature:${i + 1}}}`, {
      x: colX + 8,
      y: cursorY - 70,
      size: 8,
      font: fontRegular,
      color: rgb(0.92, 0.94, 0.97), // Presque invisible
    });
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
