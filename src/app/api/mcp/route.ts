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

const MCP_TOOLS = [
  {
    name: "create_pdf_document",
    description:
      "Génère un contrat/document PDF professionnel à partir de clauses/texte, configure les signataires et détecte automatiquement les zones de signature.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titre du document" },
        content: { type: "string", description: "Contenu textuel, articles ou clauses" },
        companyName: { type: "string", description: "Nom de l'entreprise émettrice" },
        city: { type: "string", description: "Ville (ex: Paris, Alger)" },
        signers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              email: { type: "string" },
            },
            required: ["name"],
          },
          description: "Liste des signataires",
        },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
            },
            required: ["label", "value"],
          },
          description: "Champs ou métadonnées préremplies",
        },
        autoSend: { type: "boolean", description: "Envoyer immédiatement et générer les liens" },
      },
      required: ["title", "content", "signers"],
    },
  },
  {
    name: "upload_pdf_document",
    description: "Téléverse un fichier PDF existant en Base64 et lance la détection.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        fileBase64: { type: "string", description: "PDF encodé en base64" },
        signers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              email: { type: "string" },
            },
            required: ["name"],
          },
        },
        autoSend: { type: "boolean" },
      },
      required: ["title", "fileBase64", "signers"],
    },
  },
  {
    name: "detect_document_fields",
    description: "Déclenche l'analyse et la détection automatique des zones de signature et champs.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string" },
        replace: { type: "boolean", default: true },
      },
      required: ["documentId"],
    },
  },
  {
    name: "fill_document_fields",
    description: "Remplit ou pré-remplit les valeurs de champs d'un document avant signature.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string" },
        values: { type: "object", description: "Paires clé/valeur { [libellé]: valeur }" },
      },
      required: ["documentId", "values"],
    },
  },
  {
    name: "send_document",
    description: "Finalise le document, active les liens de signature et envoie les emails.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string" },
      },
      required: ["documentId"],
    },
  },
  {
    name: "get_document_status",
    description: "Consulte le statut d'un document, la progression des signataires et l'URL de téléchargement.",
    inputSchema: {
      type: "object",
      properties: {
        documentId: { type: "string" },
      },
      required: ["documentId"],
    },
  },
  {
    name: "list_documents",
    description: "Liste les documents récents enregistrés dans SignFlow.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10 },
        status: { type: "string" },
      },
    },
  },
];

async function executeTool(name: string, args: Record<string, any>) {
  switch (name) {
    case "create_pdf_document":
      return await agentCreatePdfDocument(args as any);
    case "upload_pdf_document":
      return await agentUploadDocument(args as any);
    case "detect_document_fields":
      return await agentDetectAndSaveFields(args.documentId, args.replace ?? true);
    case "fill_document_fields":
      return await agentFillFields(args.documentId, args.values);
    case "send_document":
      return await agentSendDocument(args.documentId);
    case "get_document_status":
      return await agentGetDocumentDetails(args.documentId);
    case "list_documents":
      return await agentListDocuments(args.limit, args.status);
    default:
      throw new Error(`Outil inconnu : ${name}`);
  }
}

/**
 * Endpoint MCP HTTP (JSON-RPC 2.0) pour agents distants et connecteurs web.
 * Supporte : initialize, tools/list, tools/call
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Non autorisé. Clé API requise (Authorization: Bearer <CLE> ou x-api-key)." },
        id: null,
      },
      { status: 401 }
    );
  }

  const rpc = (await request.json().catch(() => null)) as {
    jsonrpc?: string;
    method?: string;
    params?: any;
    id?: string | number | null;
  } | null;

  if (!rpc || !rpc.method) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32600, message: "Requête JSON-RPC invalide" }, id: null },
      { status: 400 }
    );
  }

  const id = rpc.id ?? null;

  switch (rpc.method) {
    case "initialize":
      return NextResponse.json({
        jsonrpc: "2.0",
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "signflow-mcp", version: "1.0.0" },
          capabilities: { tools: {} },
        },
        id,
      });

    case "tools/list":
      return NextResponse.json({
        jsonrpc: "2.0",
        result: { tools: MCP_TOOLS },
        id,
      });

    case "tools/call": {
      const toolName = rpc.params?.name;
      const toolArgs = rpc.params?.arguments || {};
      try {
        const result = await executeTool(toolName, toolArgs);
        return NextResponse.json({
          jsonrpc: "2.0",
          result: {
            content: [
              {
                type: "text",
                text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
              },
            ],
          },
          id,
        });
      } catch (err: any) {
        return NextResponse.json({
          jsonrpc: "2.0",
          result: {
            isError: true,
            content: [{ type: "text", text: `Erreur : ${err.message}` }],
          },
          id,
        });
      }
    }

    default:
      return NextResponse.json(
        { jsonrpc: "2.0", error: { code: -32601, message: `Méthode inconnue : ${rpc.method}` }, id },
        { status: 404 }
      );
  }
}
