import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { readStoredFile } from "@/lib/storage";
import { pdfFileName } from "@/lib/notify";

type RouteContext = { params: Promise<{ docId: string; variant: string }> };

const VARIANTS = ["original", "current", "final"] as const;
type Variant = (typeof VARIANTS)[number];

/**
 * GET /api/files/:docId/:variant?t=<tokenSignataire>[&download=1]
 * Accessible à l'admin, ou à un signataire via son token (t).
 */
export async function GET(request: Request, { params }: RouteContext) {
  const { docId, variant } = await params;
  if (!VARIANTS.includes(variant as Variant)) {
    return NextResponse.json({ error: "Variante inconnue" }, { status: 404 });
  }

  const document = await db.document.findUnique({
    where: { id: docId },
    include: { signers: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }

  const admin = await isAdmin();
  const signerToken = new URL(request.url).searchParams.get("t");
  const isSigner = Boolean(signerToken && document.signers.some((s) => s.token === signerToken));
  if (!admin && !isSigner) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let filePath: string;
  if (variant === "original") {
    filePath = document.originalPath;
  } else if (variant === "final") {
    if (!document.finalPath) {
      return NextResponse.json(
        { error: "Document pas encore complètement signé" },
        { status: 409 }
      );
    }
    filePath = document.finalPath;
  } else {
    filePath = document.currentPath;
  }

  const buffer = await readStoredFile(filePath);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const filename = pdfFileName(
    document.title,
    variant === "original" ? undefined : variant === "final" ? "signe" : variant
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buffer.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
