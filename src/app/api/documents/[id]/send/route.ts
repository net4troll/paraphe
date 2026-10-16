import { NextResponse } from "next/server";
import fs from "fs/promises";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { readStoredFile, versionPath, ensureDocumentDir } from "@/lib/storage";
import { stampFieldValues, type FieldToStamp } from "@/lib/signing/stamp-fields";
import { stampDocumentWithFields } from "@/lib/agent/service";
import { sendFinalPdf, sendInvitations, pdfFileName } from "@/lib/notify";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/documents/:id/send
 *  - draft     : vérifie les zones puis envoie toutes les invitations → passe en pending
 *  - pending   : renvoie les invitations (corps optionnel { signerId } pour une seule)
 *  - completed : renvoie le PDF final signé à tous les participants
 */
export async function POST(request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as { signerId?: string };
  const document = await db.document.findUnique({
    where: { id },
    include: { signers: { orderBy: { createdAt: "asc" } } },
  });
  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }

  if (document.status === "draft") {
    if (document.signers.length === 0) {
      return NextResponse.json({ error: "Aucun signataire" }, { status: 400 });
    }
    const missingZone = document.signers.filter(
      (s) => s.page === null || s.xPct === null || s.yPct === null
    );
    if (missingZone.length > 0) {
      return NextResponse.json(
        {
          error: `Emplacement de signature manquant pour : ${missingZone
            .map((s) => `${s.name} (${s.role})`)
            .join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Nettoyage des éventuels textes non renseignés
    await db.field.deleteMany({
      where: {
        documentId: id,
        signerId: null,
        OR: [{ presetValue: null }, { presetValue: "" }],
      },
    });

    // Tamponnage préalable de tous les champs préremplis par l'admin sur le PDF de base
    await stampDocumentWithFields(id);

    const results = await sendInvitations(document);
    const failed = results.filter((r) => !r.sent && !r.skipped);
    if (failed.length > 0) {
      return NextResponse.json(
        {
          error:
            "Échec d'envoi de certains emails — vérifiez la configuration SMTP puis renvoyez. " +
            (failed[0]?.error ?? ""),
          results,
        },
        { status: 502 }
      );
    }
    await db.document.update({
      where: { id },
      data: { status: "pending" },
    });
    const noEmail = results.length === 0;
    const smtpSkipped = results.some((r) => r.skipped);
    return NextResponse.json({
      ok: true,
      status: "pending",
      results,
      ...(noEmail
        ? {
            warning:
              "Aucun signataire n'a d'email : partagez les liens de signature via QR ou « Copier le lien ».",
          }
        : smtpSkipped
          ? {
              warning:
                "SMTP non configuré : emails non envoyés. Utilisez QR ou « Copier le lien » pour transmettre les liens.",
            }
          : {}),
    });
  }

  if (document.status === "pending") {
    const results = await sendInvitations(document, body.signerId);
    const failed = results.filter((r) => !r.sent && !r.skipped);
    if (failed.length > 0) {
      return NextResponse.json(
        { error: `Échec d'envoi : ${failed[0]?.error ?? "erreur SMTP"}`, results },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, results });
  }

  // completed : renvoyer le PDF final
  if (!document.finalPath) {
    return NextResponse.json({ error: "PDF final introuvable" }, { status: 404 });
  }
  const finalPdf = await readStoredFile(document.finalPath);
  const results = await sendFinalPdf(document, finalPdf);
  const failed = results.filter((r) => !r.sent);
  if (failed.length > 0) {
    return NextResponse.json(
      { error: `Échec d'envoi : ${failed[0]?.error ?? "erreur SMTP"}`, results },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, filename: pdfFileName(document.title, "signe") });
}
