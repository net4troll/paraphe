/**
 * Test de bout en bout SignFlow (serveur démarré au préalable).
 *
 *   node scripts/smoke-test.mjs
 *   SMOKE_BASE=http://localhost:3000 SMOKE_PASSWORD=admin
 *
 * Scénario : login admin → PDF de test → 2 signataires → zones → envoi →
 * les DEUX signatures sont envoyées en parallèle (test du verrou) →
 * téléchargement du PDF final → vérification structurelle ET des 2 PKCS#7.
 */
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PNG } from "pngjs";
import forge from "node-forge";

const BASE = (process.env.SMOKE_BASE || "http://localhost:3000").replace(/\/+$/, "");
const PASSWORD = process.env.SMOKE_PASSWORD || "admin";

let adminCookie = "";

function log(step, ...rest) {
  console.log(`\n▶ ${step}`, ...rest);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (adminCookie) headers.cookie = adminCookie;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  return res;
}

/** PDF de test : 2 pages avec du texte (une convention fictive). */
async function buildTestPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const pageIndex of [0, 1]) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Convention de test — page ${pageIndex + 1}`, {
      x: 60,
      y: 760,
      size: 18,
      font: bold,
      color: rgb(0.06, 0.46, 0.44),
    });
    for (let i = 0; i < 12; i++) {
      page.drawText(
        `Ligne ${i + 1} du document de démonstration SignFlow (page ${pageIndex + 1}).`,
        { x: 60, y: 700 - i * 22, size: 11, font }
      );
    }
  }
  return Buffer.from(await doc.save());
}

/** Faux PNG de signature : une courbe dessinée, 600×200 transparent. */
function buildSignaturePng(variant) {
  const png = new PNG({ width: 600, height: 200 });
  const setInk = (x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px + 2 >= png.width || py + 2 >= png.height) return;
    for (let dx = 0; dx < 3; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        const idx = ((py + dy) * png.width + (px + dx)) << 2;
        png.data[idx] = 30;
        png.data[idx + 1] = 58;
        png.data[idx + 2] = 95;
        png.data[idx + 3] = 255;
      }
    }
  };
  const amp = variant === 1 ? 38 : 26;
  const phase = variant === 1 ? 0 : Math.PI / 2;
  for (let x = 40; x < 560; x += 0.5) {
    const y = 100 + amp * Math.sin(x / 34 + phase);
    setInk(x, y);
    if (x % 60 < 1) for (let yy = y; yy < 160; yy += 4) setInk(x, yy); // paraphe
  }
  return PNG.sync.write(png);
}

function extractPkcs7Signatures(pdfBuffer) {
  const latin = pdfBuffer.toString("latin1");
  const signatures = [];
  const re = /\/Contents\s*<([0-9A-Fa-f]+)>/g;
  let match;
  while ((match = re.exec(latin)) !== null) {
    let der = Buffer.from(match[1], "hex");
    // @signpdf bourre le champ /Contents de zéros : on tronque à la longueur DER réelle
    // (SEQUENCE 0x30 + longueur long-form 0x82 XX XX).
    if (der[0] === 0x30 && der[1] === 0x82) {
      der = der.subarray(0, 4 + der.readUInt16BE(2));
    }
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der.toString("binary"), "binary"));
    const p7 = forge.pkcs7.messageFromAsn1(asn1);
    signatures.push(p7);
  }
  return signatures;
}

async function main() {
  log(`Serveur : ${BASE}`);

  // 1. Login admin
  log("1. Login admin");
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(loginRes.status, 200, `login a échoué (${loginRes.status})`);
  const setCookie = loginRes.headers.getSetCookie?.() ?? [];
  const sessionCookie = setCookie.find((c) => c.startsWith("signflow_session="));
  assert.ok(sessionCookie, "cookie de session absent");
  adminCookie = sessionCookie.split(";")[0];

  // 2. Création du document
  log("2. Création du document (2 signataires)");
  const pdf = await buildTestPdf();
  const form = new FormData();
  form.set("title", "Smoke test — convention de démonstration");
  form.set("file", new Blob([pdf], { type: "application/pdf" }), "test.pdf");
  form.set(
    "signers",
    JSON.stringify([
      { name: "Amine B.", email: "amine.partenaire@example.dz", role: "Partenaire" },
      { name: "Sofia K.", email: "", role: "Intervenant" },
    ])
  );
  const createRes = await api("/api/documents", { method: "POST", body: form });
  if (createRes.status !== 200) {
    console.error("   échec création:", await createRes.text());
    process.exit(1);
  }
  const { id: docId } = await createRes.json();
  console.log("   document :", docId);

  // 3. Zones de signature
  log("3. Placement des zones");
  const docRes = await api(`/api/documents/${docId}`);
  const doc = await docRes.json();
  assert.equal(doc.signers.length, 2);
  const zones = [
    { page: 0, xPct: 0.3, yPct: 0.82 },
    { page: 0, xPct: 0.72, yPct: 0.82 },
  ];
  for (const [i, signer] of doc.signers.entries()) {
    const res = await api(`/api/documents/${docId}/zone`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signerId: signer.id, ...zones[i] }),
    });
    assert.equal(res.status, 200, `zone signataire ${i + 1} a échoué`);
  }

  // 3 bis. Champs à remplir par les signataires (tous types)
  log("3 bis. Création des champs (nombre, case, texte, et champ commun prérempli)");
  const fieldDefs = [
    { signerIndex: 0, label: "Montant du contrat", type: "number", xPct: 0.3, yPct: 0.55 },
    { signerIndex: 0, label: "Conditions acceptées", type: "checkbox", xPct: 0.3, yPct: 0.62 },
    { signerIndex: 1, label: "Ville d'exercice", type: "text", xPct: 0.72, yPct: 0.55 },
    { signerIndex: null, label: "Référence contrat", type: "text", presetValue: "CTR-2026-001", xPct: 0.5, yPct: 0.2 },
  ];
  for (const def of fieldDefs) {
    const res = await api(`/api/documents/${docId}/fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signerId: def.signerIndex !== null ? doc.signers[def.signerIndex].id : null,
        label: def.label,
        type: def.type,
        presetValue: def.presetValue,
        page: 0,
        xPct: def.xPct,
        yPct: def.yPct,
        widthPct: 0.22,
      }),
    });
    if (res.status !== 200) {
      console.error("   échec création champ:", await res.text());
      process.exit(1);
    }
  }

  // 4. Envoi des invitations (SMTP absent → warning attendu, pas une erreur)
  log("4. Envoi des invitations");
  const sendRes = await api(`/api/documents/${docId}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const sendBody = await sendRes.json();
  assert.equal(sendRes.status, 200, `envoi a échoué: ${JSON.stringify(sendBody)}`);
  console.log("   statut :", sendBody.status, sendBody.warning ? `(warning: ${sendBody.warning.slice(0, 60)}…)` : "");

  // 5. Signatures EN PARALLÈLE (valide le verrou par document) + champs remplis
  log("5. Signature des 2 signataires EN PARALLÈLE (avec champs)");
  const freshDoc = await (await api(`/api/documents/${docId}`)).json();
  const signers = freshDoc.signers;
  const fields = freshDoc.fields;
  assert.equal(fields.length, 4, "4 champs attendus");
  const valuesBySigner = new Map(signers.map((s) => [s.id, {}]));
  for (const field of fields) {
    if (!field.signerId) continue;
    const vals = valuesBySigner.get(field.signerId);
    if (field.type === "checkbox") vals[field.id] = true;
    else if (field.type === "number") vals[field.id] = "12500,50";
    else vals[field.id] = "Paris";
  }
  const payloads = signers.map((s, i) => ({
    token: s.token,
    body: JSON.stringify({
      name: s.name,
      image: `data:image/png;base64,${buildSignaturePng(i === 0 ? 1 : 2).toString("base64")}`,
      consent: true,
      values: valuesBySigner.get(s.id),
    }),
  }));
  const signResults = await Promise.all(
    payloads.map((p) =>
      api(`/api/sign/${p.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: p.body,
      }).then(async (res) => ({ status: res.status, body: await res.json() }))
    )
  );
  for (const r of signResults) {
    assert.equal(r.status, 200, `signature a échoué: ${JSON.stringify(r.body)}`);
  }
  const statuses = signResults.map((r) => r.body.status).sort();
  assert.deepEqual(statuses, ["completed", "signed"], "un seul 'completed' attendu");
  console.log("   réponses :", statuses.join(", "), "(les 2 signatures appliquées)");

  // 6. Téléchargement du PDF final (via token signataire)
  log("6. Téléchargement du PDF final");
  const finalRes = await fetch(
    `${BASE}/api/files/${docId}/final?t=${signers[0].token}&download=1`
  );
  assert.equal(finalRes.status, 200, `téléchargement final a échoué (${finalRes.status})`);
  const finalPdf = Buffer.from(await finalRes.arrayBuffer());
  console.log("   taille :", finalPdf.length, "octets (original :", pdf.length, ")");

  // 7. Vérifications structurelles
  log("7. Vérification du PDF final");
  const latin = finalPdf.toString("latin1");
  const byteRangeCount = (latin.match(/\/ByteRange/g) || []).length;
  const subFilterCount = (latin.match(/\/Subfilter/gi) || []).length;
  assert.ok(byteRangeCount >= 2, `ByteRange attendus ≥ 2, trouvé ${byteRangeCount}`);
  assert.ok(subFilterCount >= 2, `SubFilter attendus ≥ 2, trouvé ${subFilterCount}`);
  const reopened = await PDFDocument.load(finalPdf);
  assert.equal(reopened.getPageCount(), 2, "le nombre de pages doit être conservé");
  console.log(`   ByteRange: ${byteRangeCount}, SubFilter: ${subFilterCount}, pages: ${reopened.getPageCount()} ✓`);

  // 8. Vérification des 2 structures PKCS#7
  log("8. Vérification des PKCS#7 embarqués");
  const pkcs7s = extractPkcs7Signatures(finalPdf);
  assert.equal(pkcs7s.length, 2, `2 PKCS#7 attendus, trouvé ${pkcs7s.length}`);
  for (const p7 of pkcs7s) {
    const SIGNED_TYPES = new Set(["signed", "pkcs7-signedData", "1.2.840.113549.1.7.2"]);
    assert.ok(SIGNED_TYPES.has(p7.type), `type PKCS#7 inattendu: ${p7.type}`);
    const certs = p7.certificates ?? [];
    assert.ok(certs.length >= 1, "aucun certificat dans la signature");
    const cn = certs[0].subject.getField("CN")?.value;
    console.log(`   signature valide en structure — signataire CN: ${cn} (${certs.length} certificat(s))`);
  }

  // 9. Accès refusé sans authentification
  log("9. Contrôle d'accès");
  const anonRes = await fetch(`${BASE}/api/files/${docId}/current`);
  assert.equal(anonRes.status, 401, "accès anonyme au fichier aurait dû être refusé");
  const badToken = await fetch(`${BASE}/api/files/${docId}/current?t=token-invente`);
  assert.equal(badToken.status, 401, "token invalide aurait dû être refusé");
  console.log("   anonyme → 401 ✓, token invalide → 401 ✓");

  console.log("\n✅ SMOKE TEST PASSÉ — document de démonstration :", `${BASE}/documents/${docId}`);
}

main().catch((error) => {
  console.error("\n❌ SMOKE TEST ÉCHOUÉ :", error.message);
  process.exit(1);
});
