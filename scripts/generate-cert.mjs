/**
 * Génère (une seule fois) le certificat P12 de signature SignFlow.
 *
 * Usage :
 *   pnpm cert:generate             # crée certs/signing.p12 si absent
 *   pnpm cert:generate -- --force  # régénère (invalide l'ancien pour Adobe)
 *   pnpm cert:status               # état sans créer
 *
 * Variables .env : SIGN_CERT_PASSWORD, SIGN_CERT_SUBJECT, SIGN_CERT_YEARS (défaut 10)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import forge from "node-forge";
import { config as loadEnv } from "dotenv";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env") });

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const statusOnly = args.has("--status");

const outDir = path.join(root, "certs");
const outFile = path.join(outDir, "signing.p12");

const password = process.env.SIGN_CERT_PASSWORD?.trim() || "signflow-dev-p12";
const commonName = process.env.SIGN_CERT_SUBJECT?.trim() || "Paraphe";
const years = Number(process.env.SIGN_CERT_YEARS || "10");

if (statusOnly) {
  const exists = fs.existsSync(outFile);
  console.log("Certificat P12 :", outFile);
  console.log("Présent :", exists ? "oui" : "non");
  if (exists) {
    try {
      const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(fs.readFileSync(outFile)));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
      const cert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0]?.cert;
      if (cert) {
        console.log("Sujet   :", cert.subject.getField("CN")?.value);
        console.log("Valide  :", cert.validity.notBefore.toISOString(), "→", cert.validity.notAfter.toISOString());
      }
    } catch {
      console.log("(mot de passe incorrect pour lire le certificat)");
    }
  }
  process.exit(exists ? 0 : 1);
}

if (fs.existsSync(outFile) && !force) {
  console.log("Le certificat existe déjà :", outFile);
  console.log("Pour régénérer : pnpm cert:generate -- --force");
  process.exit(0);
}

if (fs.existsSync(outFile) && force) {
  console.warn("⚠ Régénération : les PDF signés avec l'ancien certificat ne correspondront plus à cette clé.");
}

const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
const serialNumber = String(Date.now());
cert.serialNumber = serialNumber;
const notBefore = new Date();
const notAfter = new Date();
notAfter.setFullYear(notBefore.getFullYear() + years);
cert.validity.notBefore = notBefore;
cert.validity.notAfter = notAfter;

const subject = [
  { name: "commonName", value: commonName },
  { name: "organizationName", value: commonName },
  { name: "countryName", value: "DZ" },
];

cert.setSubject(subject);
cert.setIssuer(subject);
cert.setExtensions([
  { name: "basicConstraints", cA: false },
  { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
]);

cert.sign(keys.privateKey, forge.md.sha256.create());

const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
  algorithm: "3des",
});
const p12Der = forge.asn1.toDer(p12Asn1).getBytes();

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, Buffer.from(p12Der, "binary"));

console.log(force ? "Certificat régénéré :" : "Certificat créé :", outFile);
console.log("Sujet  :", commonName);
console.log("Valide du", notBefore.toISOString(), "au", notAfter.toISOString());
console.log("");
console.log("Renseignez dans .env :");
console.log("  SIGN_CERT_PATH=./certs/signing.p12");
console.log("  SIGN_CERT_PASSWORD=<le mot de passe utilisé>");
console.log("");
console.log("Production Docker : montez un volume sur /app/certs — ne régénérez pas à chaque déploiement.");
console.log("Adobe affiche « signature non approuvée » : normal en auto-signé (une AC qualifiée est requise pour la confiance publique).");
