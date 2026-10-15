import { NextResponse } from "next/server";
import { randomUUID, randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { ensureStorageDirs, originalPath } from "@/lib/storage";
import fs from "fs/promises";

const signerSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(120),
  email: z
    .string()
    .trim()
    .max(200)
    .default("")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Email invalide"),
  role: z.string().trim().min(1).max(60).default("Partenaire"),
});

const createSchema = z.object({
  title: z.string().trim().min(1, "Titre requis").max(200),
  signers: z.array(signerSchema).min(1, "Au moins un signataire").max(6),
});

const MAX_SIZE = 15 * 1024 * 1024;

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Formulaire invalide" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier PDF manquant" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Fichier trop volumineux (max 15 Mo)" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return NextResponse.json({ error: "Le fichier n'est pas un PDF valide" }, { status: 400 });
  }

  const parsed = createSchema.safeParse({
    title: form.get("title"),
    signers: JSON.parse(String(form.get("signers") || "[]")),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Données invalides" },
      { status: 400 }
    );
  }

  await ensureStorageDirs();
  const docId = randomUUID();
  await fs.writeFile(originalPath(docId), buffer);

  const document = await db.document.create({
    data: {
      id: docId,
      title: parsed.data.title,
      status: "draft",
      originalPath: originalPath(docId),
      currentPath: originalPath(docId),
      signers: {
        create: parsed.data.signers.map((s) => ({
          name: s.name,
          email: s.email,
          role: s.role,
          token: randomBytes(32).toString("base64url"),
        })),
      },
    },
    include: { signers: true },
  });

  return NextResponse.json({ id: document.id });
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const documents = await db.document.findMany({
    orderBy: { createdAt: "desc" },
    include: { signers: { select: { status: true } } },
  });
  return NextResponse.json(
    documents.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      createdAt: d.createdAt,
      signedCount: d.signers.filter((s) => s.status === "signed").length,
      signerCount: d.signers.length,
    }))
  );
}
