import Module from "node:module";
const origRequire = Module.prototype.require;
Module.prototype.require = function (id, ...args) {
  if (id === "server-only") return {};
  return origRequire.call(this, id, ...args);
};

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

let detectFields;

async function testAcroForms() {
  console.log("\n--- TEST 1 : AcroForms natifs ---");
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();

  const nameField = form.createTextField("client.nom");
  nameField.addToPage(page, { x: 50, y: 750, width: 200, height: 25 });

  const dateField = form.createTextField("document.date");
  dateField.addToPage(page, { x: 50, y: 700, width: 120, height: 25 });

  const checkField = form.createCheckBox("conditions.acceptees");
  checkField.addToPage(page, { x: 50, y: 650, width: 15, height: 15 });

  const pdfBytes = Buffer.from(await doc.save());
  const detected = await detectFields(pdfBytes);

  console.log("Résultats AcroForms :", detected);
  if (detected.length >= 3 && detected[0].source === "acroform") {
    console.log("✅ TEST 1 RÉUSSI : AcroForms correctement détectés");
  } else {
    console.error("❌ TEST 1 ÉCHOUÉ");
    process.exit(1);
  }
}

async function testAnchors() {
  console.log("\n--- TEST 2 : Balises d'ancrage (DocuSign/Documenso style) ---");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);

  page.drawText("Veuillez signer ici : {{signature:client}}", { x: 50, y: 700, size: 12, font });
  page.drawText("Date du jour : {{date}}", { x: 50, y: 650, size: 12, font });

  const pdfBytes = Buffer.from(await doc.save());
  const detected = await detectFields(pdfBytes);

  console.log("Résultats Balises d'ancrage :", detected);
  const hasSig = detected.some((d) => d.type === "signature" && d.source === "anchor");
  const hasDate = detected.some((d) => d.type === "date" && d.source === "anchor");

  if (hasSig && hasDate) {
    console.log("✅ TEST 2 RÉUSSI : Balises d'ancrage correctement détectées");
  } else {
    console.error("❌ TEST 2 ÉCHOUÉ");
    process.exit(1);
  }
}

async function testHeuristicsStrict() {
  console.log("\n--- TEST 3 : Heuristique stricte (bloc signature en bas) ---");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);

  // Paragraphe normal qui ne DOIT PAS déclencher de faux positifs
  page.drawText("La société signataire s'engage à payer le montant des factures à la date convenue.", {
    x: 50,
    y: 700,
    size: 11,
    font,
  });

  // Vrai bloc signature en bas de page
  page.drawText("Pour le Client", { x: 80, y: 200, size: 12, font: bold });
  page.drawText("Signature :", { x: 80, y: 180, size: 11, font });

  const pdfBytes = Buffer.from(await doc.save());
  const detected = await detectFields(pdfBytes);

  console.log("Résultats Heuristique stricte :", detected);
  const falsePositives = detected.filter((d) => d.yPct < 0.3); // Aucun champ ne doit être sur le paragraphe du haut
  const sig = detected.filter((d) => d.type === "signature");

  if (falsePositives.length === 0 && sig.length >= 1) {
    console.log("✅ TEST 3 RÉUSSI : Zéro faux positif sur le texte, signature détectée et bien positionnée en bas");
  } else {
    console.error("❌ TEST 3 ÉCHOUÉ : faux positifs =", falsePositives.length, "signatures =", sig.length);
    process.exit(1);
  }
}

async function main() {
  const mod = await import("../src/lib/signing/detect-fields.ts");
  detectFields = mod.detectFields;

  await testAcroForms();
  await testAnchors();
  await testHeuristicsStrict();
  console.log("\n🎉 TOUS LES TESTS DE DÉTECTION SONT PASSÉS !");
}

main().catch((e) => {
  console.error("Erreur test :", e);
  process.exit(1);
});
