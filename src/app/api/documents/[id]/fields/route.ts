import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

const FIELD_TYPES = ["text", "textarea", "date", "number", "checkbox", "select"] as const;

const createSchema = z.object({
  signerId: z.string().trim().nullable().optional(),
  label: z.string().trim().min(1, "Libellé requis").max(80),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(60)).min(1).max(10).optional(),
  presetValue: z.string().trim().max(500).optional(),
  page: z.number().int().min(0).max(999),
  xPct: z.number().min(0).max(1),
  yPct: z.number().min(0).max(1),
  widthPct: z.number().min(0.1).max(0.6).default(0.2),
});

export async function POST(request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Champ invalide" },
      { status: 400 }
    );
  }

  const document = await db.document.findUnique({
    where: { id },
    include: { signers: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }
  if (document.status !== "draft") {
    return NextResponse.json(
      { error: "Les champs ne sont modifiables qu'avant l'envoi des invitations" },
      { status: 409 }
    );
  }
  const rawSignerId = parsed.data.signerId?.trim();
  const signer = rawSignerId && rawSignerId !== "common"
    ? document.signers.find((s) => s.id === rawSignerId)
    : null;
  if (rawSignerId && rawSignerId !== "common" && !signer) {
    return NextResponse.json({ error: "Signataire introuvable" }, { status: 404 });
  }
  if (parsed.data.type === "select" && !(parsed.data.options?.length)) {
    return NextResponse.json(
      { error: "Indiquez au moins une option pour une liste" },
      { status: 400 }
    );
  }

  const field = await db.field.create({
    data: {
      id: randomUUID(),
      documentId: id,
      signerId: signer ? signer.id : null,
      label: parsed.data.label,
      type: parsed.data.type,
      options: parsed.data.options ? JSON.stringify(parsed.data.options) : null,
      presetValue: parsed.data.presetValue || null,
      page: parsed.data.page,
      xPct: parsed.data.xPct,
      yPct: parsed.data.yPct,
      widthPct: parsed.data.widthPct,
    },
  });
  return NextResponse.json({ id: field.id });
}
