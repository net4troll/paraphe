import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { removeDocumentFiles } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

const renameSchema = z.object({
  title: z.string().trim().min(1, "Titre requis").max(200),
});

/** Renomme le document. */
export async function PATCH(request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Titre invalide" },
      { status: 400 }
    );
  }
  const document = await db.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }
  await db.document.update({ where: { id }, data: { title: parsed.data.title } });
  return NextResponse.json({ ok: true });
}

export async function GET(_request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  const document = await db.document.findUnique({
    where: { id },
    include: { signers: { orderBy: { createdAt: "asc" } }, fields: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }
  return NextResponse.json(document);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  const document = await db.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }
  await db.document.delete({ where: { id } });
  await removeDocumentFiles(id);
  return NextResponse.json({ ok: true });
}
