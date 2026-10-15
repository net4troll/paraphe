import "server-only";

import { appUrl, companyName, sendMail } from "@/lib/mail";

type SignerLike = {
  id: string;
  name: string;
  email: string;
  role: string;
  token: string;
  status: string;
};

type DocumentLike = {
  id: string;
  title: string;
  status: string;
  signers: SignerLike[];
};

export function signerLink(token: string): string {
  return `${appUrl()}/s/${token}`;
}

/** Nom de fichier sûr, sans accents ni caractères spéciaux. */
export function pdfFileName(title: string, suffix?: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "document";
  return suffix ? `${base}-${suffix}.pdf` : `${base}.pdf`;
}

const BTN_STYLE =
  "display:inline-block;background:#0f766e;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;";

function wrapHtml(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f1f5f9;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0f766e;">${escapeHtml(companyName())}</p>
    <h1 style="margin:0 0 16px;font-size:18px;">${escapeHtml(title)}</h1>
    ${bodyHtml}
  </div>
  <p style="max-width:560px;margin:12px auto 0;font-size:11px;color:#94a3b8;">Email automatique — ne pas répondre.</p>
</body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type InvitationResult = { signerId: string; sent: boolean; skipped?: boolean; error?: string };

/** Envoie les invitations de signature (un signataire, ou tous ceux en attente).
 *  Les signataires sans email sont ignorés : leur lien se partage via QR / copie. */
export async function sendInvitations(
  doc: DocumentLike,
  signerId?: string
): Promise<InvitationResult[]> {
  const targets = doc.signers.filter(
    (s) =>
      s.status === "pending" &&
      s.email.trim() !== "" &&
      (!signerId || s.id === signerId)
  );
  const results: InvitationResult[] = [];

  for (const signer of targets) {
    const link = signerLink(signer.token);
    const html = wrapHtml(
      doc.title,
      `<p style="margin:0 0 12px;">Bonjour ${escapeHtml(signer.name)},</p>
       <p style="margin:0 0 12px;">Vous êtes invité(e) à <strong>signer électroniquement</strong> le document
       «&nbsp;${escapeHtml(doc.title)}&nbsp;» en qualité de <strong>${escapeHtml(signer.role)}</strong>.</p>
       <p style="margin:0 0 20px;">Votre signature sera apposée avec un certificat numérique, puis le document final
       signé par toutes les parties vous sera envoyé à cette adresse.</p>
       <p style="margin:0 0 20px;"><a href="${link}" style="${BTN_STYLE}">Signer le document</a></p>
       <p style="margin:0;font-size:12px;color:#64748b;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br>
       <a href="${link}" style="color:#0f766e;word-break:break-all;">${link}</a></p>`
    );
    const result = await sendMail({
      to: signer.email,
      subject: `À signer — ${doc.title}`,
      html,
      text: `Bonjour ${signer.name},\n\nVous êtes invité(e) à signer électroniquement le document « ${doc.title} » en qualité de ${signer.role}.\n\nLien de signature : ${link}\n\n${companyName()}`,
    });
    results.push({ signerId: signer.id, sent: result.sent, skipped: result.skipped, error: result.error });
  }
  return results;
}

/** Envoie le PDF final signé à tous les participants. */
export async function sendFinalPdf(
  doc: DocumentLike,
  finalPdf: Buffer
): Promise<InvitationResult[]> {
  const signedNames = doc.signers
    .map((s) => `${s.name} (${s.role})`)
    .join(", ");
  const html = wrapHtml(
    doc.title,
    `<p style="margin:0 0 12px;">Bonjour,</p>
     <p style="margin:0 0 12px;">Le document «&nbsp;<strong>${escapeHtml(doc.title)}</strong>&nbsp;» est désormais
     <strong>signé par toutes les parties</strong>. Vous trouverez le PDF final en pièce jointe.</p>
     <p style="margin:0 0 12px;font-size:13px;color:#475569;">Signataires : ${escapeHtml(signedNames)}</p>
     <p style="margin:0;font-size:12px;color:#64748b;">Ce document porte des signatures électroniques apposées avec un certificat numérique (visible dans Adobe Reader).</p>`
  );

  const results: InvitationResult[] = [];
  for (const signer of doc.signers.filter((s) => s.email.trim() !== "")) {
    const result = await sendMail({
      to: signer.email,
      subject: `Document signé — ${doc.title}`,
      html,
      text: `Bonjour,\n\nLe document « ${doc.title} » est signé par toutes les parties. Le PDF final est en pièce jointe.\n\n${companyName()}`,
      attachments: [
        {
          filename: pdfFileName(doc.title, "signe"),
          content: finalPdf,
          contentType: "application/pdf",
        },
      ],
    });
    results.push({ signerId: signer.id, sent: result.sent, skipped: result.skipped, error: result.error });
  }
  return results;
}

/** Notification admin (optionnelle) à chaque signature reçue. */
export async function notifyAdminSignature(docTitle: string, signer: SignerLike): Promise<void> {
  const admin = process.env.ADMIN_EMAIL?.trim();
  if (!admin) return;
  await sendMail({
    to: admin,
    subject: `Signature reçue — ${docTitle}`,
    html: wrapHtml(
      docTitle,
      `<p style="margin:0;">Signature reçue de <strong>${escapeHtml(signer.name)}</strong>
       (${escapeHtml(signer.role)}, ${escapeHtml(signer.email)}).</p>`
    ),
    text: `Signature reçue de ${signer.name} (${signer.role}, ${signer.email}) sur « ${docTitle} ».`,
  });
}
