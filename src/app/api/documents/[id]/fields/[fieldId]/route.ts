import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string; fieldId: string }> };

const FIELD_TYPES = ["text", "textarea", "date", "number", "checkbox", "select"] as const;

const patchSchema = z.object({
  signerId: z.string().min(1).optional(),
  label: z.string().trim().min(1).max(80).optional(),
  type: z.enum(FIELD_TYPES).optional(),
  options: z.array(z.string().trim().min(1).max(60)).min(1).max(10).nullable().optional(),
  presetValue: z.string().trim().max(500).nullable().optional(),
  page: z.number().int().min(0).max(999).optional(),
  xPct: z.number().min(0).max(1).optional(),
  yPct: z.number().min(0).max(1).optional(),
  widthPct: z.number().min(0.1).max(0.6).optional(),
});

/** Réassigne un champ à un autre signataire (brouillon uniquement). */
export async function PATCH(request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id, fieldId } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
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
  const signer = parsed.data.signerId
    ? document.signers.find((s) => s.id === parsed.data.signerId)
    : undefined;
  if (parsed.data.signerId && !signer) {
    return NextResponse.json({ error: "Signataire introuvable" }, { status: 404 });
  }

  const field = await db.field.findUnique({ where: { id: fieldId } });
  if (!field || field.documentId !== id) {
    return NextResponse.json({ error: "Champ introuvable" }, { status: 404 });
  }

  // Cohérence liste : un champ « select » doit avoir au moins une option
  const nextType = parsed.data.type ?? field.type;
  let nextOptions: string | null = field.options;
  if (parsed.data.options !== undefined) {
    nextOptions = parsed.data.options ? JSON.stringify(parsed.data.options) : null;
  }
  if (nextType === "select") {
    const effective: string[] = (() => {
      try {
        return nextOptions ? (JSON.parse(nextOptions) as string[]) : [];
      } catch {
        return [];
      }
    })();
    if (effective.length === 0) {
      return NextResponse.json(
        { error: "Une liste nécessite au moins une option" },
        { status: 400 }
      );
    }
  } else if (parsed.data.options !== undefined) {
    nextOptions = null;
  }

  await db.field.update({
    where: { id: fieldId },
    data: {
      ...(signer ? { signerId: signer.id } : {}),
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
      ...(parsed.data.options !== undefined || parsed.data.type !== undefined
        ? { options: nextOptions }
        : {}),
      ...(parsed.data.presetValue !== undefined
        ? { presetValue: parsed.data.presetValue || null }
        : {}),
      ...(parsed.data.page !== undefined ? { page: parsed.data.page } : {}),
      ...(parsed.data.xPct !== undefined ? { xPct: parsed.data.xPct } : {}),
      ...(parsed.data.yPct !== undefined ? { yPct: parsed.data.yPct } : {}),
      ...(parsed.data.widthPct !== undefined ? { widthPct: parsed.data.widthPct } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id, fieldId } = await params;

  const document = await db.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }
  if (document.status !== "draft") {
    return NextResponse.json(
      { error: "Les champs ne sont modifiables qu'avant l'envoi des invitations" },
      { status: 409 }
    );
  }

  const field = await db.field.findUnique({ where: { id: fieldId } });
  if (!field || field.documentId !== id) {
    return NextResponse.json({ error: "Champ introuvable" }, { status: 404 });
  }
  await db.field.delete({ where: { id: fieldId } });
  return NextResponse.json({ ok: true });
}
