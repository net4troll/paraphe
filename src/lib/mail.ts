import "server-only";

import nodemailer from "nodemailer";
import { APP_NAME } from "@/lib/app";

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type SendMailResult = { sent: boolean; skipped?: boolean; error?: string };

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

function getTransport() {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) throw new Error("SMTP non configuré (SMTP_HOST)");
  const port = Number(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });
}

export function mailFrom(): string {
  const from = process.env.MAIL_FROM?.trim();
  if (from) return from;
  const company = process.env.COMPANY_NAME?.trim() || APP_NAME;
  return `"${company.replace(/"/g, "")}" <no-reply@localhost>`;
}

/** Envoie un email ; échoue doucement si SMTP n'est pas configuré. */
export async function sendMail(input: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
}): Promise<SendMailResult> {
  if (!smtpConfigured()) {
    console.warn("[mail] SMTP non configuré, email non envoyé :", input.subject);
    return { sent: false, skipped: true };
  }
  const transport = getTransport();
  try {
    await transport.sendMail({
      from: mailFrom(),
      to: Array.isArray(input.to) ? input.to.join(", ") : input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments,
    });
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[mail] Échec envoi :", message);
    return { sent: false, error: message };
  } finally {
    transport.close();
  }
}

export function appUrl(): string {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

export function companyName(): string {
  return process.env.COMPANY_NAME?.trim() || APP_NAME;
}
