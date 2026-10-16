#!/usr/bin/env node
/**
 * Serveur MCP (Model Context Protocol) pour SignFlow.
 * Permet aux agents d'IA (Claude Desktop, Cursor, Antigravity, etc.) de :
 * - Créer et générer des PDF de contrats/documents
 * - Téléverser des PDF existants
 * - Détecter automatiquement les champs et zones de signature
 * - Remplir / pré-remplir les valeurs
 * - Envoyer les invitations et récupérer les liens de signature
 * - Suivre l'avancement et récupérer le PDF certifié final
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.SIGNFLOW_BASE_URL || process.env.APP_URL || "https://paraph.dcode-lab.com").replace(/\/+$/, "");
const API_KEY =
  process.env.SIGNFLOW_API_KEY && process.env.SIGNFLOW_API_KEY !== "admin"
    ? process.env.SIGNFLOW_API_KEY
    : process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD !== "admin"
    ? process.env.ADMIN_PASSWORD
    : "Y2Oo-QAgsOBp";

async function callSignflowApi(action, params = {}) {
  const url = `${BASE_URL}/api/agent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({ action, ...params }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `L'endpoint ${url} n'a pas été trouvé (404). Assurez-vous que le serveur sur ${BASE_URL} a bien été déployé avec les dernières modifications.`
      );
    }
    throw new Error(body.error || `Erreur API SignFlow (${res.status})`);
  }
  return body.data ?? body;
}

const server = new McpServer({
  name: "signflow-mcp",
  version: "1.0.0",
});

// 1. Outil : Créer un document PDF et lancer le flux
server.tool(
  "create_pdf_document",
  "Génère un contrat/document PDF professionnel à partir de clauses/texte, configure les signataires et détecte automatiquement les zones de signature.",
  {
    title: z.string().describe("Titre du document (ex: 'Contrat de Prestation de Service', 'Accord NDA')"),
    content: z.string().describe("Contenu textuel, articles ou clauses du document"),
    companyName: z.string().optional().describe("Nom de l'entreprise émettrice"),
    city: z.string().optional().describe("Ville (ex: 'Paris', 'Lyon')"),
    signers: z
      .array(
        z.object({
          name: z.string().describe("Nom complet du signataire"),
          role: z.string().optional().describe("Rôle (ex: 'Client', 'Prestataire')"),
          email: z.string().optional().describe("Adresse email (optionnelle)"),
        })
      )
      .min(1)
      .describe("Liste des signataires"),
    fields: z
      .array(
        z.object({
          label: z.string().describe("Libellé du champ (ex: 'Montant', 'Référence')"),
          value: z.string().describe("Valeur pré-remplie"),
        })
      )
      .optional()
      .describe("Champs ou métadonnées pré-remplies dans le document"),
    autoSend: z
      .boolean()
      .optional()
      .default(false)
      .describe("Si true, envoie immédiatement le document et retourne les URLs de signature"),
  },
  async (args) => {
    try {
      const data = await callSignflowApi("create_pdf", args);
      return {
        content: [
          {
            type: "text",
            text: `✅ Document PDF créé avec succès !\n\nID : ${data.id}\nTitre : ${data.title}\nStatut : ${data.status}\n\nSignataires :\n${data.signers
              .map((s) => `- ${s.name} (${s.role}) : ${s.signingUrl}`)
              .join("\n")}\n\nLien d'administration : ${data.urls?.documentView || ""}\n\nDétails JSON :\n${JSON.stringify(
              data,
              null,
              2
            )}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `❌ Erreur : ${err.message}` }],
      };
    }
  }
);

// 2. Outil : Téléverser un PDF existant
server.tool(
  "upload_pdf_document",
  "Téléverse un fichier PDF existant (encodé en Base64), crée le document dans SignFlow et détecte automatiquement les champs.",
  {
    title: z.string().describe("Titre du document"),
    fileBase64: z.string().describe("Contenu du fichier PDF encodé en base64"),
    signers: z
      .array(
        z.object({
          name: z.string().describe("Nom du signataire"),
          role: z.string().optional().describe("Rôle du signataire"),
          email: z.string().optional().describe("Email du signataire"),
        })
      )
      .min(1)
      .describe("Liste des signataires"),
    autoSend: z.boolean().optional().default(false).describe("Si true, envoie immédiatement"),
  },
  async (args) => {
    try {
      const data = await callSignflowApi("upload_pdf", args);
      return {
        content: [
          {
            type: "text",
            text: `✅ PDF téléversé avec succès (ID: ${data.id}) !\n\nSignataires :\n${data.signers
              .map((s) => `- ${s.name} : ${s.signingUrl}`)
              .join("\n")}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `❌ Erreur : ${err.message}` }],
      };
    }
  }
);

// 3. Outil : Détecter les champs et zones de signature
server.tool(
  "detect_document_fields",
  "Déclenche l'analyse et la détection automatique des zones de signature et champs sur un document via AcroForms, Groq Qwen Vision ou heuristique.",
  {
    documentId: z.string().describe("Identifiant du document SignFlow"),
    replace: z.boolean().optional().default(true).describe("Remplacer les champs existants"),
  },
  async (args) => {
    try {
      const data = await callSignflowApi("detect_fields", args);
      return {
        content: [
          {
            type: "text",
            text: `🔍 Détection terminée (Moteur: ${data.source}) :\n- ${data.signatureZones} zone(s) de signature attribuée(s)\n- ${data.created} champ(s) interactif(s) créé(s)\n- Total éléments détectés : ${data.totalDetected}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `❌ Erreur : ${err.message}` }],
      };
    }
  }
);

// 4. Outil : Remplir / Pré-remplir les champs
server.tool(
  "fill_document_fields",
  "Remplit ou pré-remplit les valeurs de champs d'un document avant signature.",
  {
    documentId: z.string().describe("Identifiant du document"),
    values: z
      .record(z.union([z.string(), z.boolean()]))
      .describe("Dictionnaire des valeurs avec comme clé le libellé du champ ou son identifiant (ex: { 'Montant': '15000', 'Conditions': true })"),
  },
  async (args) => {
    try {
      const data = await callSignflowApi("fill_fields", args);
      return {
        content: [
          {
            type: "text",
            text: `✏️ ${data.updatedCount} champ(s) mis à jour avec succès (sur ${data.totalFields} champs au total).`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `❌ Erreur : ${err.message}` }],
      };
    }
  }
);

// 5. Outil : Envoyer le document & obtenir les liens de signature
server.tool(
  "send_document",
  "Finalise la préparation du document, active les liens de signature et envoie les emails d'invitation si configurés.",
  {
    documentId: z.string().describe("Identifiant du document"),
  },
  async (args) => {
    try {
      const data = await callSignflowApi("send_document", args);
      return {
        content: [
          {
            type: "text",
            text: `🚀 Document envoyé (Statut: ${data.status}) !\n\nLiens de signature uniques par signataire :\n${data.signers
              .map((s) => `• ${s.name} (${s.role}) : ${s.signingUrl}`)
              .join("\n")}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `❌ Erreur : ${err.message}` }],
      };
    }
  }
);

// 6. Outil : Obtenir le statut et le lien de téléchargement
server.tool(
  "get_document_status",
  "Consulte l'avancement de signature d'un document, la liste des signataires et l'URL de téléchargement du PDF final signé.",
  {
    documentId: z.string().describe("Identifiant du document SignFlow"),
  },
  async (args) => {
    try {
      const data = await callSignflowApi("get_status", args);
      return {
        content: [
          {
            type: "text",
            text: `📄 Document "${data.title}" (Statut: ${data.status})\n\nSignataires :\n${data.signers
              .map((s) => `• ${s.name} : ${s.status === "signed" ? "✅ Signé le " + s.signedAt : "⏳ En attente (" + s.signingUrl + ")"}`)
              .join("\n")}\n\nPDF Téléchargement :\n- Original : ${data.urls?.originalDownload}\n- PDF Final certifié : ${data.urls?.finalDownload || "(non disponible tant que non complété)"}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `❌ Erreur : ${err.message}` }],
      };
    }
  }
);

// 7. Outil : Lister les documents récents
server.tool(
  "list_documents",
  "Liste les documents récents enregistrés dans SignFlow.",
  {
    limit: z.number().optional().default(10).describe("Nombre maximal de documents"),
    status: z.string().optional().describe("Filtre de statut : 'draft', 'pending' ou 'completed'"),
  },
  async (args) => {
    try {
      const docs = await callSignflowApi("list_documents", args);
      return {
        content: [
          {
            type: "text",
            text: `📚 Documents SignFlow (${docs.length}) :\n\n${docs
              .map((d) => `• [${d.status.toUpperCase()}] ${d.title} (ID: ${d.id})\n  Signataires: ${d.signers?.map((s) => s.name + " (" + s.status + ")").join(", ")}\n  Lien: ${d.url}`)
              .join("\n\n")}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `❌ Erreur : ${err.message}` }],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SignFlow MCP Server démarré sur stdio.");
}

main().catch((err) => {
  console.error("Erreur fatale MCP Server:", err);
  process.exit(1);
});
