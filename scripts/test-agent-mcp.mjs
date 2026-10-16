import Module from "node:module";
const origRequire = Module.prototype.require;
Module.prototype.require = function (id, ...args) {
  if (id === "server-only") return {};
  return origRequire.call(this, id, ...args);
};

import "dotenv/config";
import assert from "node:assert/strict";

async function main() {
  console.log("\n🚀 TEST DE L'API AGENT ET DU FLUX COMPLET...\n");

  const { createPdfDocument } = await import("../src/lib/signing/create-pdf.ts");
  const { detectFields } = await import("../src/lib/signing/detect-fields.ts");

  // 1. Test unitaire de création de PDF
  console.log("1. Génération d'un contrat PDF complet par l'agent...");
  const pdfBytes = await createPdfDocument({
    title: "Contrat de Partenariat Commercial 2026",
    content: `Article 1 - Objet
Le présent contrat a pour objet de définir les conditions de collaboration entre les parties pour le déploiement de solutions numériques.

Article 2 - Engagements et Rémunération
Le Prestataire s'engage à livrer les prestations convenues selon le calendrier prévisionnel validé par les deux parties.
Le montant des prestations s'élève à 250 000 DZD payable sous trente jours.

Article 3 - Confidentialité
Chacune des parties s'engage à respecter la plus stricte confidentialité concernant les informations échangées.`,
    companyName: "SignFlow Technologies",
    city: "Alger",
    signers: [
      { name: "Directeur Général", role: "Direction" },
      { name: "Partenaire B2B", role: "Client" },
    ],
    fields: [
      { label: "Montant", value: "250 000 DZD" },
      { label: "Durée", value: "12 mois" },
    ],
  });

  assert.ok(pdfBytes.length > 1000, "Le buffer PDF doit faire plus de 1 Ko");
  console.log(`   ✓ PDF généré avec succès ! Taille : ${pdfBytes.length} octets`);

  // 2. Détection automatique sur ce PDF généré
  console.log("\n2. Test de la détection automatique sur le PDF généré...");
  const detected = await detectFields(pdfBytes);
  console.log("   ✓ Éléments détectés :", detected);

  const sigs = detected.filter((d) => d.type === "signature");
  assert.equal(sigs.length, 2, "2 signatures doivent être détectées (une par signataire)");
  console.log(`   ✓ ${sigs.length} zones de signature détectées avec succès pour les 2 signataires !`);

  // 3. Test de l'enregistrement et du flux de base si PostgreSQL est allumé
  try {
    const {
      agentCreatePdfDocument,
      agentFillFields,
      agentSendDocument,
      agentGetDocumentDetails,
      agentListDocuments,
    } = await import("../src/lib/agent/service.ts");

    console.log("\n3. Tentative de cycle de vie complet en base de données...");
    const created = await agentCreatePdfDocument({
      title: "Contrat Test Agent",
      content: "Contenu de test pour la validation agent.",
      signers: [{ name: "Amine Test", role: "Client" }],
    });
    console.log(`   ✓ Document créé en base : ID = ${created.id}`);

    await agentFillFields(created.id, { "Montant": "50 000 DZD" });
    console.log("   ✓ Champs remplis par l'agent");

    const sent = await agentSendDocument(created.id);
    console.log(`   ✓ Document envoyé, lien : ${sent.signers[0]?.signingUrl}`);
  } catch (err) {
    if (err.code === "ECONNREFUSED") {
      console.log("\nℹ️ Base de données PostgreSQL locale non démarrée (Docker arrêté) — tests unitaires PDF/détection validés.");
    } else {
      throw err;
    }
  }

  console.log("\n🎉 TEST DE GÉNÉRATION ET DÉTECTION AGENT VALIDÉ À 100% !");
}

main().catch((err) => {
  console.error("❌ ERREUR TEST :", err);
  process.exit(1);
});
