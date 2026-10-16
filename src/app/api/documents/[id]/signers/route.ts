import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

const signerCreateSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(120),
  email: z
    .string()
    .trim()
    .max(200)
    .default("")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Email invalide"),
  role: z.string().trim().min(1, "Rôle requis").max(60).default("Partenaire"),
});

const signerUpdateSchema = z.object({
  signerId: z.string().uuid(),
  name: z.string().trim().min(1, "Nom requis").max(120),
  email: z
    .string()
    .trim()
    .max(200)
    .default("")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Email invalide"),
  role: z.string().trim().min(1, "Rôle requis").max(60).default("Partenaire"),
});

const signerDeleteSchema = z.object({
  signerId: z.string().uuid(),
});

/** POST: Ajouter un signataire (draft uniquement) */
export async function POST(request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  const document = await db.document.findUnique({
    where: { id },
    include: { signers: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }
  if (document.status !== "draft") {
    return NextResponse.json(
      { error: "Impossible d'ajouter un signataire hors du mode brouillon" },
      { status: 409 }
    );
  }
  if (document.signers.length >= 6) {
    return NextResponse.json({ error: "Maximum 6 signataires par document" }, { status: 400 });
  }

  const parsed = signerCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Données invalides" },
      { status: 400 }
    );
  }

  const signer = await db.signer.create({
    data: {
      documentId: id,
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      token: randomBytes(32).toString("base64url"),
    },
  });

  return NextResponse.json(signer);
}

/** PATCH: Mettre à jour un signataire (draft uniquement) */
export async function PATCH(request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  const document = await db.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }
  if (document.status !== "draft") {
    return NextResponse.json(
      { error: "Impossible de modifier un signataire hors du mode brouillon" },
      { status: 409 }
    );
  }

  const parsed = signerUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Données invalides" },
      { status: 400 }
    );
  }

  const signer = await db.signer.findFirst({
    where: { id: parsed.data.signerId, documentId: id },
  });
  if (!signer) {
    return NextResponse.json({ error: "Signataire introuvable" }, { status: 404 });
  }

  const updated = await db.signer.update({
    where: { id: parsed.data.signerId },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
    },
  });

  return NextResponse.json(updated);
}

/** DELETE: Supprimer un signataire (draft uniquement) */
export async function DELETE(request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  const document = await db.document.findUnique({
    where: { id },
    include: { signers: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }
  if (document.status !== "draft") {
    return NextResponse.json(
      { error: "Impossible de supprimer un signataire hors du mode brouillon" },
      { status: 409 }
    );
  }
  if (document.signers.length <= 1) {
    return NextResponse.json(
      { error: "Un document doit comporter au moins un signataire" },
      { status: 400 }
    );
  }

  const parsed = signerDeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Données invalides" },
      { status: 400 }
    );
  }

  const signer = document.signers.find((s) => s.id === parsed.data.signerId);
  if (!signer) {
    return NextResponse.json({ error: "Signataire introuvable" }, { status: 404 });
  }

  // Supprimer les champs associés à ce signataire
  await db.field.deleteMany({
    where: { signerId: parsed.data.signerId },
  });

  await db.signer.delete({ where: { id: parsed.data.signerId } });

  return NextResponse.json({ ok: true });
}
