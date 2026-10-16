import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import {
  agentCreatePdfDocument,
  agentUploadDocument,
  agentDetectAndSaveFields,
  agentFillFields,
  agentSendDocument,
  agentGetDocumentDetails,
  agentListDocuments,
} from "@/lib/agent/service";

/**
 * Endpoint unifié pour les agents d'IA et automatisations externes :
 * POST /api/agent
 * Headers :
 *   Authorization: Bearer <ADMIN_PASSWORD ou SIGNFLOW_API_KEY>
 *   (ou x-api-key: <KEY>)
 * Body :
 *   { action: "create_pdf" | "upload_pdf" | "detect_fields" | "fill_fields" | "send_document" | "get_status" | "list_documents", ...params }
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json(
      { error: "Non autorisé. Fournissez un header 'Authorization: Bearer <CLE>' ou 'x-api-key: <CLE>'." },
      { status: 401 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").toLowerCase().trim();

    switch (action) {
      case "create_pdf":
      case "create": {
        const result = await agentCreatePdfDocument({
          title: body.title,
          content: body.content,
          companyName: body.companyName,
          signers: body.signers,
          fields: body.fields,
          city: body.city,
          autoDetect: body.autoDetect ?? true,
          autoSend: body.autoSend ?? false,
        });
        return NextResponse.json({ ok: true, data: result });
      }

      case "upload_pdf":
      case "upload": {
        const result = await agentUploadDocument({
          title: body.title,
          fileBase64: body.fileBase64,
          signers: body.signers,
          autoDetect: body.autoDetect ?? true,
          autoSend: body.autoSend ?? false,
        });
        return NextResponse.json({ ok: true, data: result });
      }

      case "detect_fields":
      case "detect": {
        if (!body.documentId) {
          return NextResponse.json({ error: "documentId requis" }, { status: 400 });
        }
        const result = await agentDetectAndSaveFields(body.documentId, body.replace ?? true);
        return NextResponse.json({ ok: true, data: result });
      }

      case "fill_fields":
      case "fill": {
        if (!body.documentId || !body.values) {
          return NextResponse.json({ error: "documentId et values requis" }, { status: 400 });
        }
        const result = await agentFillFields(body.documentId, body.values);
        return NextResponse.json({ ok: true, data: result });
      }

      case "send_document":
      case "send": {
        if (!body.documentId) {
          return NextResponse.json({ error: "documentId requis" }, { status: 400 });
        }
        const result = await agentSendDocument(body.documentId);
        return NextResponse.json({ ok: true, data: result });
      }

      case "get_status":
      case "status": {
        if (!body.documentId) {
          return NextResponse.json({ error: "documentId requis" }, { status: 400 });
        }
        const result = await agentGetDocumentDetails(body.documentId);
        return NextResponse.json({ ok: true, data: result });
      }

      case "list_documents":
      case "list": {
        const result = await agentListDocuments(Number(body.limit) || 20, body.status);
        return NextResponse.json({ ok: true, data: result });
      }

      default:
        return NextResponse.json(
          {
            error: `Action inconnue : '${action}'. Actions disponibles : create_pdf, upload_pdf, detect_fields, fill_fields, send_document, get_status, list_documents.`,
          },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error("[api/agent] Erreur :", error);
    return NextResponse.json(
      { error: error.message || "Erreur lors de l'exécution de l'action agent" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/agent?id=... (Lecture rapide du statut d'un document ou liste)
 */
export async function GET(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  try {
    if (id) {
      const details = await agentGetDocumentDetails(id);
      return NextResponse.json({ ok: true, data: details });
    }
    const docs = await agentListDocuments(Number(searchParams.get("limit")) || 20);
    return NextResponse.json({ ok: true, data: docs });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Erreur de consultation" },
      { status: 404 }
    );
  }
}
