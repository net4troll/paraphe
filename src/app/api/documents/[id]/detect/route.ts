import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { readStoredFile } from "@/lib/storage";
import { detectFields, type DetectedType } from "@/lib/signing/detect-fields";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/documents/:id/detect
 * Détection automatique des champs (100 % local) : crée les zones de signature
 * pour les signataires sans zone et les champs pour le premier signataire.
 * Tout reste modifiable/supprimable dans l'interface.
 */
export async function POST(_request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const document = await db.document.findUnique({
    where: { id },
    include: { signers: { orderBy: { createdAt: "asc" } } },
  });
  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }
  if (document.status !== "draft") {
    return NextResponse.json(
      { error: "La détection n'est disponible qu'avant l'envoi des invitations" },
      { status: 409 }
    );
  }
  const base = await readStoredFile(document.originalPath);
  const detected = await detectFields(base);

  // ?replace=1 : les champs existants sont remplacés par la nouvelle analyse
  if (new URL(_request.url).searchParams.get("replace") === "1") {
    await db.field.deleteMany({ where: { documentId: id } });
  }

  // Zones de signature : aux signataires sans zone, dans l'ordre de lecture (si signataires présents)
  const freeSigners = document.signers.filter((s) => s.page === null);
  let signatureZones = 0;
  for (const spot of detected.filter((d) => d.type === "signature")) {
    const target = freeSigners[signatureZones];
    if (!target) break;
    await db.signer.update({
      where: { id: target.id },
      data: { page: spot.page, xPct: spot.xPct, yPct: spot.yPct },
    });
    signatureZones += 1;
  }

  // Champs : créés au niveau document (signerId: null) prêts à être préremplis ou assignés
  let created = 0;
  for (const field of detected.filter((d) => d.type !== "signature")) {
    await db.field.create({
      data: {
        documentId: id,
        signerId: null,
        label: field.label,
        type: field.type as Exclude<DetectedType, "signature">,
        page: field.page,
        xPct: field.xPct,
        yPct: field.yPct,
        widthPct: field.widthPct,
      },
    });
    created += 1;
  }

  return NextResponse.json({
    ok: true,
    signatureZones,
    created,
    detected: detected.length,
  });
}
