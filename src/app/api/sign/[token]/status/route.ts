import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * GET /api/sign/:token/status
 * Statut léger, interrogé par la page de signature (polling ~4 s) pour que
 * l'ordinateur se mette à jour tout seul quand la signature est apposée
 * depuis le téléphone (ou par l'autre partie).
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { token } = await params;
  const signer = await db.signer.findUnique({
    where: { token },
    include: { document: { include: { signers: true } } },
  });
  if (!signer) {
    return NextResponse.json({ error: "Lien invalide" }, { status: 404 });
  }
  return NextResponse.json(
    {
      signerStatus: signer.status,
      signedAt: signer.signedAt?.toISOString() ?? null,
      docStatus: signer.document.status,
      signedCount: signer.document.signers.filter((s) => s.status === "signed").length,
      signerCount: signer.document.signers.length,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
