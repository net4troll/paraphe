import { NextResponse } from "next/server";
import fs from "fs/promises";
import { z } from "zod";
import { db } from "@/lib/db";
import { withDocumentLock } from "@/lib/doc-lock";
import { readStoredFile, versionPath, ensureDocumentDir } from "@/lib/storage";
import { stampSignature } from "@/lib/signing/stamp";
import { stampFieldValues, type FieldToStamp } from "@/lib/signing/stamp-fields";
import { signPdfWithCert } from "@/lib/signing/sign-pdf";
import { notifyAdminSignature, sendFinalPdf } from "@/lib/notify";

type RouteContext = { params: Promise<{ token: string }> };

const PNG_MAGIC = "89504e470d0a1a0a";

const signSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(120),
  image: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Image de signature invalide"),
  consent: z.literal(true, { message: "Consentement requis" }),
  values: z
    .record(z.string(), z.union([z.string().max(2000), z.boolean()]))
    .optional()
    .default({}),
});

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;

  const parsed = signSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Données invalides" },
      { status: 400 }
    );
  }

  const signer = await db.signer.findUnique({
    where: { token },
    include: { document: { include: { signers: true } } },
  });
  if (!signer) {
    return NextResponse.json({ error: "Lien de signature invalide" }, { status: 404 });
  }

  const document = signer.document;
  if (document.status === "draft") {
    return NextResponse.json(
      { error: "Ce document n'est pas encore ouvert à la signature" },
      { status: 409 }
    );
  }
  if (signer.status === "signed") {
    return NextResponse.json({ error: "Vous avez déjà signé ce document" }, { status: 409 });
  }
  if (signer.page === null || signer.xPct === null || signer.yPct === null) {
    return NextResponse.json(
      { error: "Emplacement de signature non défini — contactez l'expéditeur" },
      { status: 409 }
    );
  }

  const base64 = parsed.data.image.slice("data:image/png;base64,".length);
  const png = Buffer.from(base64, "base64");
  if (png.length === 0 || png.length > 500_000) {
    return NextResponse.json({ error: "Image de signature invalide" }, { status: 400 });
  }
  if (png.subarray(0, 8).toString("hex") !== PNG_MAGIC) {
    return NextResponse.json({ error: "Image de signature invalide" }, { status: 400 });
  }

  // Copie locale des coordonnées : le narrowing TS ne traverse pas la closure du verrou.
  const zone = {
    page: signer.page,
    xPct: signer.xPct,
    yPct: signer.yPct,
    widthPct: signer.widthPct ?? 0.26,
  };

  // Champs du signataire : validation des valeurs par type avant tamponnage.
  const signerFields = await db.field.findMany({
    where: { signerId: signer.id },
    orderBy: { createdAt: "asc" },
  });
  const fieldsToStamp: FieldToStamp[] = [];
  const presetFieldsToStamp: FieldToStamp[] = [];
  for (const field of signerFields) {
    const raw = parsed.data.values[field.id];
    const label = field.label;

    // Champ prérempli par l'admin : valeur fixe, non exigée du signataire.
    const preset = field.presetValue?.trim() ?? "";
    if (preset) {
      presetFieldsToStamp.push({
        type: field.type,
        label,
        value: field.type === "checkbox" ? preset === "true" : preset,
        page: field.page,
        xPct: field.xPct,
        yPct: field.yPct,
        widthPct: field.widthPct,
      });
      continue;
    }

    if (field.type === "checkbox") {
      if (raw !== true) {
        return NextResponse.json(
          { error: `Case « ${label} » à cocher` },
          { status: 400 }
        );
      }
      fieldsToStamp.push({ type: field.type, label, value: true, page: field.page, xPct: field.xPct, yPct: field.yPct, widthPct: field.widthPct });
      continue;
    }

    const value = (typeof raw === "string" ? raw : "").trim();
    if (!value) {
      return NextResponse.json({ error: `Champ « ${label} » à compléter` }, { status: 400 });
    }
    if (field.type === "number" && !/^-?\d+([.,]\d+)?$/.test(value)) {
      return NextResponse.json(
        { error: `« ${label} » doit être un nombre` },
        { status: 400 }
      );
    }
    if (field.type === "date") {
      const parsed_ = Date.parse(value);
      if (Number.isNaN(parsed_)) {
        return NextResponse.json(
          { error: `« ${label} » doit être une date` },
          { status: 400 }
        );
      }
    }
    if (field.type === "select") {
      let options: string[] = [];
      try {
        options = JSON.parse(field.options ?? "[]") as string[];
      } catch {
        options = [];
      }
      if (!options.includes(value)) {
        return NextResponse.json(
          { error: `« ${label} » : valeur hors liste` },
          { status: 400 }
        );
      }
    }

    fieldsToStamp.push({
      type: field.type,
      label,
      value:
        field.type === "date"
          ? new Date(value).toLocaleDateString("fr-FR")
          : value,
      page: field.page,
      xPct: field.xPct,
      yPct: field.yPct,
      widthPct: field.widthPct,
    });
  }

  const signedAt = new Date();
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 400) || null;

  let completed = false;
  try {
    completed = await withDocumentLock(document.id, async () => {
      // Relecture dans le verrou : currentPath peut avoir changé (signature parallèle).
      const fresh = await db.document.findUnique({
        where: { id: document.id },
        include: { signers: true },
      });
      if (!fresh || fresh.status !== "pending") {
        throw new Error("Document non disponible à la signature");
      }

      const signedCount = fresh.signers.filter((s) => s.status === "signed").length;
      const base = await readStoredFile(fresh.currentPath);

      const activeFieldsToStamp =
        fresh.currentPath === fresh.originalPath
          ? [...presetFieldsToStamp, ...fieldsToStamp]
          : fieldsToStamp;
      const withFields = await stampFieldValues(base, activeFieldsToStamp);
      const stamped = await stampSignature(
        withFields,
        zone,
        { signaturePng: png, signerName: parsed.data.name, signedAt }
      );
      const signedPdf = await signPdfWithCert(stamped, {
        signerName: parsed.data.name,
        signerEmail: signer.email,
        documentTitle: fresh.title,
        signatureIndex: signedCount,
        signingTime: signedAt,
      });

      const newPath = versionPath(fresh.id, signedCount + 1);
      await ensureDocumentDir(fresh.id);
      await fs.writeFile(newPath, signedPdf);

      await db.signer.update({
        where: { id: signer.id },
        data: { status: "signed", signedAt, ip, userAgent },
      });

      const allSigned = fresh.signers.every(
        (s) => s.id === signer.id || s.status === "signed"
      );
      if (allSigned) {
        await db.document.update({
          where: { id: fresh.id },
          data: { currentPath: newPath, finalPath: newPath, status: "completed" },
        });
      } else {
        await db.document.update({
          where: { id: fresh.id },
          data: { currentPath: newPath },
        });
      }
      return allSigned;
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur lors de la signature du document";
    console.error("[sign]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Emails après la signature : une erreur d'envoi ne doit pas invalider la signature.
  try {
    if (completed) {
      const finalDoc = await db.document.findUnique({
        where: { id: document.id },
        include: { signers: true },
      });
      if (finalDoc?.finalPath) {
        const finalPdf = await readStoredFile(finalDoc.finalPath);
        await sendFinalPdf(finalDoc, finalPdf);
      }
    }
    await notifyAdminSignature(document.title, {
      id: signer.id,
      name: parsed.data.name,
      email: signer.email,
      role: signer.role,
      token: signer.token,
      status: "signed",
    });
  } catch (error) {
    console.error("[sign] Emails non envoyés :", error);
  }

  return NextResponse.json({ ok: true, status: completed ? "completed" : "signed" });
}
