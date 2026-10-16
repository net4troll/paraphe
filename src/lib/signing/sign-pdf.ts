import "server-only";

import fs from "fs/promises";
import path from "path";
import signPdfImport from "@signpdf/signpdf";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { P12Signer } from "@signpdf/signer-p12";
import { PDFDocument } from "pdf-lib";
import { APP_NAME } from "@/lib/app";

type SignPdfInstance = {
  sign: (pdf: Buffer, signer: P12Signer, signingTime?: Date) => Promise<Buffer | Uint8Array>;
};

function getSignPdf(): SignPdfInstance {
  const mod = signPdfImport as SignPdfInstance & { default?: SignPdfInstance };
  if (typeof mod.sign === "function") return mod;
  if (mod.default && typeof mod.default.sign === "function") return mod.default;
  throw new Error("Module @signpdf/signpdf invalide");
}

function resolveP12Path(): string | null {
  const configured = process.env.SIGN_CERT_PATH?.trim();
  if (!configured) return null;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

export function certConfigured(): boolean {
  const p12Path = resolveP12Path();
  return Boolean(p12Path);
}

/**
 * Signature cryptographique PKCS#7/PKCS#12 du PDF (chaque appel ajoute une signature
 * incrémentale : les signatures précédentes restent valides).
 * `signatureIndex` décale le rectangle visible de la signature en bas de page 1
 * pour que plusieurs signatures ne se superposent pas.
 */
export async function signPdfWithCert(
  pdf: Buffer,
  params: { signerName: string; signerEmail: string; documentTitle: string; signatureIndex: number; signingTime: Date }
): Promise<Buffer> {
  const p12Path = resolveP12Path();
  if (!p12Path) {
    throw new Error("Certificat de signature non configuré (SIGN_CERT_PATH) — générez-le avec : pnpm cert:generate");
  }

  let p12: Buffer;
  try {
    p12 = await fs.readFile(/* turbopackIgnore: true */ p12Path);
  } catch {
    throw new Error(`Certificat P12 introuvable : ${p12Path} — générez-le avec : pnpm cert:generate`);
  }

  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });

  const offsetX = 36 + params.signatureIndex * 200;
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: `Signature du document « ${params.documentTitle} »`,
    contactInfo: process.env.SIGN_CERT_CONTACT?.trim() || params.signerEmail,
    name: params.signerName,
    location: process.env.COMPANY_NAME?.trim() || "France",
    signingTime: params.signingTime,
    appName: APP_NAME,
    widgetRect: [offsetX, 36, offsetX + 170, 100],
    signatureLength: 16000,
  });

  const pdfWithPlaceholder = Buffer.from(await doc.save({ useObjectStreams: false }));

  const passphrase = process.env.SIGN_CERT_PASSWORD?.trim() || "";
  const signer = new P12Signer(p12, { passphrase });
  const signed = await getSignPdf().sign(pdfWithPlaceholder, signer, params.signingTime);
  return Buffer.from(signed);
}
