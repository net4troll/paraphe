import Module from "node:module";
const origRequire = Module.prototype.require;
Module.prototype.require = function (id, ...args) {
  if (id === "server-only") return {};
  return origRequire.call(this, id, ...args);
};

import dotenv from "dotenv";
dotenv.config();

import fs from "node:fs/promises";
import path from "node:path";

async function run() {
  const {
    agentUploadDocument,
    agentFillFields,
    agentGetDocumentDetails,
  } = await import("../src/lib/agent/service");
  const { db } = await import("../src/lib/db");

  const pdfPath = "C:/Users/alire/Downloads/Contrat_ICCHM_vierge_remplissable.pdf";
  console.log(`Lecture du PDF : ${pdfPath}...`);
  const pdfBytes = await fs.readFile(pdfPath);
  const fileBase64 = pdfBytes.toString("base64");

  const title = "Contrat de Sponsoring et d'Exposition ICCHM - Ali Rezouali & Christian Boyer";

  console.log("Création du document avec signataires :");
  console.log(" - Ali Rezouali (Partenaire, alirezouali@gmail.com)");
  console.log(" - Christian Boyer (Organisateur, sans email)");

  const doc = await agentUploadDocument({
    title,
    fileBase64,
    signers: [
      {
        name: "Ali Rezouali",
        role: "Partenaire",
        email: "alirezouali@gmail.com",
      },
      {
        name: "Christian Boyer",
        role: "Organisateur",
        email: "",
      },
    ],
    autoDetect: true,
    autoSend: false,
  });

  console.log(`✅ Document créé avec succès ! ID = ${doc.id}`);
  console.log(`Détection automatique : ${doc.detection?.created} champs interactifs, ${doc.detection?.signatureZones} zones de signature (${doc.detection?.source})`);

  // Liste des valeurs fictives (dummy data) pour le contrat ICCHM
  const dummyValues = {
    societe: "Acme Health Technologies",
    adresse: "20 Avenue des Champs-Élysées, 75008 Paris",
    siret: "832 941 123 00045",
    tva: "FR83832941123",
    representant: "Ali Rezouali",
    formule: "Formule GOLD",
    formule_ht: "14 500 €",
    formule_ttc: "17 400 €",
    places_ht: "0 €",
    places_ttc: "0 €",
    total_ht: "14 500 €",
    total_ttc: "17 400 €",
    ville: "Paris",
    date: "16/10/2026",
    nom_sponsor: "Ali Rezouali",
    fonction_sponsor: "Directeur Général",
    nom_organisateur: "Christian Boyer",
    fonction_organisateur: "Directeur Associé D-Code Lab",
  };

  console.log("Pré-remplissage des champs avec les données de test...");
  const fillResult = await agentFillFields(doc.id, dummyValues);
  console.log(`✅ ${fillResult.updatedCount}/${fillResult.totalFields} champs préremplis.`);

  // Récupération des détails finaux
  const details = await agentGetDocumentDetails(doc.id);
  const baseUrl = process.env.APP_URL?.replace(/\/+$/, "") || "https://paraph.dcode-lab.com";

  console.log("\n================ RÉCAPITULATIF ================");
  console.log(`Titre : ${details.title}`);
  console.log(`Statut : ${details.status}`);
  console.log(`URL Gestion : ${baseUrl}/documents/${details.id}`);
  console.log("\nSignataires :");
  for (const s of details.signers) {
    console.log(` - ${s.name} (${s.role}) : ${s.email || "aucun email"}`);
    console.log(`   Page signature : ${s.page !== null ? s.page + 1 : "non placée"}`);
    console.log(`   Lien de signature : ${s.signingUrl}`);
  }
  console.log("\nChamps détectés et valeurs pré-remplies :");
  for (const f of details.fields) {
    console.log(` - [Page ${f.page + 1}] ${f.label} (${f.type}) = "${f.presetValue || ""}" [Assigné : ${f.signer?.name || "Tous"}]`);
  }
  console.log("===============================================\n");
}

run().catch(console.error);
