import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { withDocumentLock } from "@/lib/doc-lock";
import { cleanDocumentVersions } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/documents/:id/edit
 * Rouvre un document envoyé (pending ou completed) pour modification :
 * - repasse le document en mode draft
 * - supprime les versions intermédiaires générées (version-*.pdf)
 * - remet currentPath vers le document original
 * - réinitialise le statut des signataires ayant déjà signé
 */
export async function POST(_request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  return withDocumentLock(id, async () => {
    const document = await db.document.findUnique({
      where: { id },
      include: { signers: true },
    });
    if (!document) {
      return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
    }

    if (document.status === "draft") {
      return NextResponse.json({ ok: true, status: "draft" });
    }

    // Supprime les versions PDF générées (version-0.pdf, version-1.pdf, etc.)
    await cleanDocumentVersions(id);

    // Réinitialise les signataires et repasse le document en draft
    await db.$transaction([
      db.signer.updateMany({
        where: { documentId: id },
        data: {
          status: "pending",
          signedAt: null,
          ip: null,
          userAgent: null,
        },
      }),
      db.document.update({
        where: { id },
        data: {
          status: "draft",
          currentPath: document.originalPath,
          finalPath: null,
        },
      }),
    ]);

    return NextResponse.json({ ok: true, status: "draft" });
  });
}
