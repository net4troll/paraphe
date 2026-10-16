import fs from "node:fs/promises";

const BASE_URL = "https://paraph.dcode-lab.com";
const API_KEY = "Y2Oo-QAgsOBp";

async function callProd(action, params = {}) {
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
    throw new Error(body.error || `Erreur API (${res.status})`);
  }
  return body.data ?? body;
}

async function main() {
  console.log(`Connexion à la production : ${BASE_URL}...`);

  // 1. Lecture du fichier PDF
  const pdfPath = "C:/Users/alire/Downloads/Contrat_ICCHM_vierge_remplissable.pdf";
  console.log(`Lecture du fichier PDF : ${pdfPath}...`);
  const pdfBytes = await fs.readFile(pdfPath);
  const fileBase64 = pdfBytes.toString("base64");

  const title = "Contrat de Sponsoring et d'Exposition ICCHM - Amin Gasmi & Ali Rezouali";

  console.log("Envoi du document à l'API de production...");
  const uploadResult = await callProd("upload_pdf", {
    title,
    fileBase64,
    signers: [
      {
        name: "Amin Gasmi",
        role: "Partenaire",
        email: "gasmi.aminn@gmail.com",
      },
      {
        name: "Ali Rezouali",
        role: "Organisateur",
        email: "alirezouali@gmail.com",
      },
    ],
    autoDetect: true,
    autoSend: false,
  });

  const docId = uploadResult.id;
  console.log(`✅ Document créé sur PROD ! ID = ${docId}`);
  console.log(`Détection : ${uploadResult.detection?.created} champs interactifs, ${uploadResult.detection?.signatureZones} zones de signature (${uploadResult.detection?.source})`);

  // 2. Remplissage des champs avec dummy data
  const dummyValues = {
    societe: "Acme Health Technologies",
    adresse: "20 Avenue des Champs-Élysées, 75008 Paris",
    siret: "832 941 123 00045",
    tva: "FR83832941123",
    representant: "Amin Gasmi",
    formule: "Formule GOLD",
    formule_ht: "14 500 €",
    formule_ttc: "17 400 €",
    places_ht: "0 €",
    places_ttc: "0 €",
    total_ht: "14 500 €",
    total_ttc: "17 400 €",
    ville: "Paris",
    date: "16/10/2026",
    nom_sponsor: "Amin Gasmi",
    fonction_sponsor: "Directeur Général",
    nom_organisateur: "Ali Rezouali",
    fonction_organisateur: "Directeur Associé D-Code Lab",
  };

  console.log("Pré-remplissage des champs sur PROD...");
  const fillResult = await callProd("fill_fields", {
    documentId: docId,
    values: dummyValues,
  });
  console.log(`✅ ${fillResult.updatedCount}/${fillResult.totalFields} champs remplis.`);

  console.log("Envoi / Activation du document sur PROD...");
  await callProd("send_document", { documentId: docId });

  // 3. Récupération des statuts et URLs finales de production
  const details = await callProd("get_status", { documentId: docId });

  console.log("\n=================== CONTRAT SUR PROD ===================");
  console.log(`ID : ${details.id}`);
  console.log(`Titre : ${details.title}`);
  console.log(`Statut : ${details.status}`);
  console.log(`Lien Admin : ${BASE_URL}/documents/${details.id}`);
  console.log("\nSignataires :");
  for (const s of details.signers) {
    console.log(` - ${s.name} (${s.role}) : ${s.email || "aucun email"}`);
    console.log(`   Lien de signature : ${s.signingUrl}`);
  }
  console.log("\nChamps enregistrés sur le document :");
  for (const f of details.fields) {
    console.log(` - [Page ${f.page + 1}] ${f.label} = "${f.presetValue || ""}"`);
  }
  console.log("=========================================================\n");
}

main().catch(console.error);
