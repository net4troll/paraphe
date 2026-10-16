import "server-only";

import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { db } from "@/lib/db";
import {
  ensureStorageDirs,
  ensureDocumentDir,
  originalPath,
  versionPath,
  readStoredFile,
} from "@/lib/storage";
import { createPdfDocument, type CreatePdfParams } from "@/lib/signing/create-pdf";
import { detectFields } from "@/lib/signing/detect-fields";
import { stampFieldValues, type FieldToStamp } from "@/lib/signing/stamp-fields";
import { sendInvitations } from "@/lib/notify";

export type AgentSignerInput = {
  name: string;
  email?: string;
  role?: string;
};

export type AgentCreateDocumentInput = {
  title: string;
  content: string; // Texte / clauses du contrat
  companyName?: string;
  signers: AgentSignerInput[];
  fields?: Array<{ label: string; value: string }>;
  city?: string;
  autoDetect?: boolean; // Défaut: true
  autoSend?: boolean; // Défaut: false
};

export type AgentUploadDocumentInput = {
  title: string;
  fileBase64: string; // Contenu du PDF encodé en base64
  signers: AgentSignerInput[];
  autoDetect?: boolean; // Défaut: true
  autoSend?: boolean; // Défaut: false
};

function getAppUrl(): string {
  return process.env.APP_URL?.replace(/\/+$/, "") || "http://localhost:3000";
}

/**
 * 1. Créer un PDF de toute pièce et initialiser le flux de signature.
 */
export async function agentCreatePdfDocument(input: AgentCreateDocumentInput) {
  if (!input.title?.trim()) throw new Error("Le titre est obligatoire");
  if (!input.signers || input.signers.length === 0) {
    throw new Error("Au moins un signataire est requis");
  }

  // 1. Génération du buffer PDF
  const pdfBuffer = await createPdfDocument({
    title: input.title,
    content: input.content,
    companyName: input.companyName,
    signers: input.signers,
    fields: input.fields,
    city: input.city,
  });

  return await initializeDocumentFromBuffer(input.title, pdfBuffer, input.signers, {
    autoDetect: input.autoDetect ?? true,
    autoSend: input.autoSend ?? false,
    presetFields: input.fields,
  });
}

/**
 * 2. Téléverser un PDF existant (base64) et initialiser le flux.
 */
export async function agentUploadDocument(input: AgentUploadDocumentInput) {
  if (!input.title?.trim()) throw new Error("Le titre est obligatoire");
  if (!input.fileBase64?.trim()) throw new Error("Le contenu fileBase64 est obligatoire");
  if (!input.signers || input.signers.length === 0) {
    throw new Error("Au moins un signataire est requis");
  }

  // Nettoyage éventuel du préfixe data:application/pdf;base64,
  const cleanBase64 = input.fileBase64.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");

  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Le fichier fourni n'est pas un PDF valide");
  }

  return await initializeDocumentFromBuffer(input.title, buffer, input.signers, {
    autoDetect: input.autoDetect ?? true,
    autoSend: input.autoSend ?? false,
  });
}

/**
 * Initialise un document en base, sauvegarde le fichier original et applique la détection / préremplissage.
 */
async function initializeDocumentFromBuffer(
  title: string,
  pdfBuffer: Buffer,
  signersInput: AgentSignerInput[],
  options: {
    autoDetect: boolean;
    autoSend: boolean;
    presetFields?: Array<{ label: string; value: string }>;
  }
) {
  await ensureStorageDirs();
  const docId = randomUUID();
  const filePath = originalPath(docId);
  await fs.writeFile(filePath, pdfBuffer);

  const document = await db.document.create({
    data: {
      id: docId,
      title: title.trim(),
      status: "draft",
      originalPath: filePath,
      currentPath: filePath,
      signers: {
        create: signersInput.map((s) => ({
          name: s.name.trim(),
          email: s.email?.trim() || "",
          role: s.role?.trim() || "Signataire",
          token: randomBytes(32).toString("base64url"),
        })),
      },
    },
    include: { signers: { orderBy: { createdAt: "asc" } } },
  });

  let detectedSummary = { created: 0, signatureZones: 0, source: "none" };

  // Détection automatique si demandée
  if (options.autoDetect) {
    detectedSummary = await agentDetectAndSaveFields(docId);
  }

  // Pré-remplissage des champs éventuels
  if (options.presetFields && options.presetFields.length > 0) {
    const valMap: Record<string, string> = {};
    for (const f of options.presetFields) {
      valMap[f.label] = f.value;
    }
    await agentFillFields(docId, valMap);
  }

  // Envoi automatique si demandé
  let sendResult = null;
  if (options.autoSend) {
    sendResult = await agentSendDocument(docId);
  }

  const details = await agentGetDocumentDetails(docId);
  return {
    ...details,
    detection: detectedSummary,
    sendResult,
  };
}

/**
 * 3. Lancer la détection automatique (AcroForms, Groq Qwen Vision, Heuristique) et enregistrer.
 */
export async function agentDetectAndSaveFields(docId: string, replace = true) {
  const document = await db.document.findUnique({
    where: { id: docId },
    include: { signers: { orderBy: { createdAt: "asc" } } },
  });
  if (!document) throw new Error("Document introuvable");
  if (document.status !== "draft") {
    throw new Error("La détection n'est permise qu'en mode brouillon (draft)");
  }

  const base = await readStoredFile(document.originalPath);
  const detected = await detectFields(base);

  if (replace) {
    await db.field.deleteMany({ where: { documentId: docId } });
  }

  // Affectation des signatures
  const freeSigners = [...document.signers.filter((s) => s.page === null)];
  let signatureZones = 0;

  for (const spot of detected.filter((d) => d.type === "signature")) {
    if (freeSigners.length === 0) break;

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
    if (targetIndex === -1) targetIndex = 0;
    const target = freeSigners.splice(targetIndex, 1)[0];

    await db.signer.update({
      where: { id: target.id },
      data: {
        page: spot.page,
        xPct: spot.xPct,
        yPct: spot.yPct,
        widthPct: spot.widthPct ?? 0.26,
      },
    });
    signatureZones++;
  }

  // Affectation des champs interactifs
  const defaultSignerId = document.signers[0]?.id ?? null;
  let created = 0;

  for (const spot of detected) {
    if (spot.type === "signature") continue;

    let signerId = defaultSignerId;
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
        documentId: docId,
        signerId,
        label: spot.label || "Champ",
        type: spot.type,
        page: spot.page,
        xPct: spot.xPct,
        yPct: spot.yPct,
        widthPct: spot.widthPct,
      },
    });
    created++;
  }

  return {
    created,
    signatureZones,
    source: detected[0]?.source || "heuristic",
    totalDetected: detected.length,
  };
}

/**
 * 4. Remplir / Pré-remplir les valeurs de champs existants.
 */
export async function agentFillFields(
  docId: string,
  values: Record<string, string | boolean>
) {
  const fields = await db.field.findMany({ where: { documentId: docId } });
  let updatedCount = 0;

  for (const [key, val] of Object.entries(values)) {
    const normKey = key.trim().toLowerCase().replace(/[\s_\-]+/g, "");
    const target = fields.find((f) => {
      if (f.id === key) return true;
      const normLabel = f.label.trim().toLowerCase().replace(/[\s_\-]+/g, "");
      return normLabel === normKey;
    });
    if (!target) continue;

    await db.field.update({
      where: { id: target.id },
      data: { presetValue: String(val) },
    });
    updatedCount++;
  }

  return { updatedCount, totalFields: fields.length };
}

/**
 * 5. Envoyer le document et générer les liens de signature pour chaque signataire.
 */
export async function agentSendDocument(docId: string) {
  const document = await db.document.findUnique({
    where: { id: docId },
    include: { signers: { orderBy: { createdAt: "asc" } } },
  });
  if (!document) throw new Error("Document introuvable");
  if (document.status !== "draft") {
    // Si déjà envoyé, renvoie l'état existant avec les liens
    return await agentGetDocumentDetails(docId);
  }
  if (document.signers.length === 0) {
    throw new Error("Aucun signataire configuré");
  }

  // Si des signataires n'ont pas de zone de signature, on leur en attribue une par défaut en bas
  for (let i = 0; i < document.signers.length; i++) {
    const s = document.signers[i];
    if (s.page === null || s.xPct === null || s.yPct === null) {
      const colWidth = 0.26;
      const xPct = 0.25 + (i % 2) * 0.45;
      await db.signer.update({
        where: { id: s.id },
        data: {
          page: 0,
          xPct,
          yPct: 0.82,
          widthPct: colWidth,
        },
      });
    }
  }

  // Tamponnage des champs préremplis si présents
  const presetFields = await db.field.findMany({
    where: { documentId: docId, presetValue: { not: null } },
  });
  const validPresets = presetFields.filter((f) => f.presetValue && f.presetValue.trim() !== "");
  let nextCurrentPath = document.originalPath;

  if (validPresets.length > 0) {
    const fieldsToStamp: FieldToStamp[] = validPresets.map((f) => ({
      type: f.type,
      label: f.label,
      value: f.type === "checkbox" ? f.presetValue === "true" : f.presetValue!,
      page: f.page,
      xPct: f.xPct,
      yPct: f.yPct,
      widthPct: f.widthPct,
    }));
    const base = await readStoredFile(document.originalPath);
    const stampedPdf = await stampFieldValues(base, fieldsToStamp);
    nextCurrentPath = versionPath(document.id, 0);
    await ensureDocumentDir(document.id);
    await fs.writeFile(nextCurrentPath, stampedPdf);
  }

  // Envoi des emails d'invitation (si SMTP configuré)
  const results = await sendInvitations(document);

  await db.document.update({
    where: { id: docId },
    data: { currentPath: nextCurrentPath, status: "pending" },
  });

  return await agentGetDocumentDetails(docId);
}

/**
 * 6. Obtenir les détails complets d'un document (signataires, liens de signature, statut, téléchargements).
 */
export async function agentGetDocumentDetails(docId: string) {
  const document = await db.document.findUnique({
    where: { id: docId },
    include: {
      signers: { orderBy: { createdAt: "asc" } },
      fields: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!document) throw new Error("Document introuvable");

  const baseUrl = getAppUrl();

  const signers = document.signers.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    role: s.role,
    page: s.page,
    status: s.status,
    signedAt: s.signedAt,
    signingUrl: `${baseUrl}/s/${s.token}`,
    token: s.token,
    hasSignatureZone: s.page !== null,
  }));

  const fields = document.fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    page: f.page,
    presetValue: f.presetValue,
    signerId: f.signerId,
  }));

  return {
    id: document.id,
    title: document.title,
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    signers,
    fields,
    urls: {
      documentView: `${baseUrl}/documents/${document.id}`,
      originalDownload: `${baseUrl}/api/files/${document.id}/original`,
      currentDownload: `${baseUrl}/api/files/${document.id}/current`,
      finalDownload:
        document.status === "completed"
          ? `${baseUrl}/api/files/${document.id}/final`
          : null,
    },
  };
}

/**
 * 7. Lister les documents récents.
 */
export async function agentListDocuments(limit = 20, status?: string) {
  const where = status ? { status: status as any } : {};
  const docs = await db.document.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      signers: { select: { id: true, name: true, role: true, status: true } },
      _count: { select: { fields: true } },
    },
  });

  const baseUrl = getAppUrl();
  return docs.map((d) => ({
    id: d.id,
    title: d.title,
    status: d.status,
    createdAt: d.createdAt,
    signers: d.signers,
    fieldCount: d._count.fields,
    url: `${baseUrl}/documents/${d.id}`,
  }));
}
