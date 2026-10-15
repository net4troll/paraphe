import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

const zoneSchema = z.object({
  signerId: z.string().min(1),
  clear: z.literal(true).optional(),
  page: z.number().int().min(0).max(999).optional(),
  xPct: z.number().min(0).max(1).optional(),
  yPct: z.number().min(0).max(1).optional(),
  widthPct: z.number().min(0.1).max(0.6).optional(),
});

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const parsed = zoneSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Zone invalide" }, { status: 400 });
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
      { error: "Les zones ne sont modifiables qu'avant l'envoi des invitations" },
      { status: 409 }
    );
  }
  const signer = document.signers.find((s) => s.id === parsed.data.signerId);
  if (!signer) {
    return NextResponse.json({ error: "Signataire introuvable" }, { status: 404 });
  }

  // clear : supprime la zone de signature placée (à replacer ensuite)
  if (parsed.data.clear) {
    await db.signer.update({
      where: { id: signer.id },
      data: { page: null, xPct: null, yPct: null },
    });
    return NextResponse.json({ ok: true });
  }

  if (
    parsed.data.page === undefined ||
    parsed.data.xPct === undefined ||
    parsed.data.yPct === undefined
  ) {
    return NextResponse.json({ error: "Position invalide" }, { status: 400 });
  }

  await db.signer.update({
    where: { id: signer.id },
    data: {
      page: parsed.data.page,
      xPct: parsed.data.xPct,
      yPct: parsed.data.yPct,
      ...(parsed.data.widthPct !== undefined ? { widthPct: parsed.data.widthPct } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
