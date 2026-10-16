import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { readStoredFile } from "@/lib/storage";
import { detectFields, type DetectedType } from "@/lib/signing/detect-fields";

type RouteContext = { params: Promise<{ id: string }> };

const VALID_FIELD_TYPES = new Set<DetectedType>([
  "text",
  "textarea",
  "date",
  "number",
  "checkbox",
  "select",
]);

/**
 * POST /api/documents/:id/detect
 * Détection automatique des champs (3 niveaux : AcroForms, Groq Vision Qwen, heuristique) :
 * - Attribue les zones de signature aux signataires (avec hint de rôle si disponible)
 * - Crée les champs interactifs (text, date, number, checkbox, textarea) dans la base
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

  // 1. Zones de signature
  const freeSigners = [...document.signers.filter((s) => s.page === null)];
  let signatureZones = 0;

  for (const spot of detected.filter((d) => d.type === "signature")) {
    if (freeSigners.length === 0) break;

    // Tentative d'association par signerHint (ex: hint "client" vs signer.role "Client")
    let targetIndex = -1;
    if (spot.signerHint) {
      targetIndex = freeSigners.findIndex((s) => {
        const hint = spot.signerHint!.toLowerCase();
        return (
          s.role.toLowerCase().includes(hint) ||
          s.name.toLowerCase().includes(hint) ||
          hint.includes(s.role.toLowerCase())
        );
      });
    }

    // Sinon premier signataire libre
    if (targetIndex === -1) targetIndex = 0;
    const target = freeSigners.splice(targetIndex, 1)[0];

    await db.signer.update({
      where: { id: target.id },
      data: {
        page: spot.page,
        xPct: spot.xPct,
        yPct: spot.yPct,
        widthPct: spot.widthPct ?? 0.26,
        heightPct: spot.heightPct ?? null,
      },
    });
    signatureZones += 1;
  }

  // 2. Création des champs interactifs en base de données
  const defaultSignerId = document.signers[0]?.id ?? null;
  let created = 0;

  for (const spot of detected) {
    if (spot.type === "signature" || !VALID_FIELD_TYPES.has(spot.type)) {
      continue;
    }

    // Association éventuelle à un signataire si hint explicite, sinon champ commun (null)
    let signerId: string | null = null;
    if (spot.signerHint) {
      const match = document.signers.find((s) => {
        const hint = spot.signerHint!.toLowerCase();
        return (
          s.role.toLowerCase().includes(hint) ||
          s.name.toLowerCase().includes(hint)
        );
      });
      if (match) signerId = match.id;
    }

    await db.field.create({
      data: {
        id: randomUUID(),
        documentId: id,
        signerId,
        label: spot.label || "Champ",
        type: spot.type,
        page: spot.page,
        xPct: spot.xPct,
        yPct: spot.yPct,
        widthPct: spot.widthPct,
      },
    });
    created += 1;
  }

  const source = detected[0]?.source || "heuristic";

  return NextResponse.json({
    ok: true,
    created,
    signatureZones,
    detected: detected.length,
    source,
  });
}
