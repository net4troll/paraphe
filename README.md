# Paraphe

Signature électronique de PDF, multi-signataires, avec **signature cryptographique P12**.
Application maison (Next.js 16 + Prisma 7 + PostgreSQL), pensée pour les conventions
**Partenaires / Intervenants** : 2 signataires en parallèle, et le PDF final signé est
envoyé automatiquement à tout le monde dès que le dernier a signé.

## Comment ça marche

1. **Admin** : crée un document (PDF + titre + signataires — **email optionnel**, le lien se
   partage alors via QR ou copie)
2. **Admin** : place sur le PDF les zones de signature **et les champs à remplir** — texte,
   commentaire multiligne, date, nombre, case à cocher, liste déroulante
3. **Admin** : envoie les invitations → chaque signataire reçoit un lien personnel (email ou QR)
4. **Signataires** : complètent leurs champs puis dessinent (ou tapent) leur signature
   — champs et signatures sont appliqués sur le PDF, chacun scellé par le certificat P12
5. Dès que **tous** ont signé : le PDF final est envoyé en pièce jointe à tous les participants
   ayant un email

### Détection automatique des champs (100 % local)

Sur un document en brouillon, le bouton **« Détecter automatiquement »** analyse le PDF
(extraction du texte avec coordonnées via pdfjs-dist, dans le conteneur Node — aucun service
externe, aucun modèle, CPU only) et propose : zones de signature (attribuées aux signataires
dans l'ordre de lecture), champs texte/date/nombre/case près des libellés connus
(`Signature :`, `Date :`, `Montant :`, `Nom :`…) et emplacements `____` / `......`.
Chaque proposition reste modifiable : déplacement par clic, suppression, et réassignation
du signataire via le sélecteur de la liste. Pour des **PDF scannés en image**, ajouter un
service OCR Docker (Tesseract/PaddleOCR) serait l'évolution naturelle — inutile pour du texte.

### Signature sur mobile

La page de signature affiche un bouton **« Signer sur mobile »** : un QR code permet d'ouvrir
le même lien sécurisé sur téléphone et de signer au doigt. La page laissée ouverte sur
ordinateur **se met à jour toute seule** (polling ~4 s) : confirmation de signature,
rechargement de l'aperçu quand l'autre partie signe, et état final. Côté admin, chaque
signataire en attente a aussi son bouton **QR** (pratique quand le partenaire est présent
physiquement). Le téléphone doit accéder à la même adresse que l'ordinateur (même réseau
ou URL publique).

Chaque signature est vérifiable dans Adobe Reader (panneau Signatures) : signataire, motif,
horodatage, intégrité du document.

## Démarrage local

```bash
pnpm install
docker compose up -d db          # PostgreSQL local
cp .env.example .env             # puis éditez les valeurs
pnpm prisma migrate deploy
pnpm cert:generate               # certificat P12 auto-signé (certs/signing.p12)
pnpm dev                         # http://localhost:3000
```

Connexion admin : mot de passe défini par `ADMIN_PASSWORD`.

## Test de bout en bout

```bash
pnpm build && pnpm start         # ou pnpm dev
pnpm smoke                       # crée un document, signe les 2 signataires en parallèle,
                                 # vérifie les 2 signatures PKCS#7 du PDF final
```

## Déploiement (Coolify / Docker)

```bash
docker compose up -d --build
```

Le conteneur applique les migrations au démarrage. À monter en volumes (persistés) :
`./storage` (PDF) et `./certs` (P12 — **ne pas régénérer** à chaque déploiement).

Variables d'environnement : voir `.env.example`.

| Variable | Rôle |
|---|---|
| `APP_NAME` | Nom affiché de l'application (défaut : Paraphe) |
| `DATABASE_URL` | PostgreSQL |
| `APP_URL` | URL publique (liens de signature dans les emails) |
| `AUTH_SECRET` | Secret JWT de la session admin |
| `ADMIN_PASSWORD` | Mot de passe admin |
| `ADMIN_EMAIL` | (option) notifié à chaque signature reçue |
| `SIGN_CERT_PATH` / `SIGN_CERT_PASSWORD` | Certificat P12 de signature |
| `SIGN_CERT_SUBJECT` | Nom affiché dans le certificat |
| `SMTP_*`, `MAIL_FROM` | Envoi des emails |
| `STORAGE_DIR` | Répertoire des PDF (volume) |
| `COMPANY_NAME` | Nom affiché sur l'app et dans les emails |

Sans SMTP configuré — ou pour un signataire sans email — l'app fonctionne quand même :
les liens de signature sont copiables depuis la fiche du document (bouton « Copier le lien »)
et le QR code permet de signer sur téléphone. Le PDF final reste téléchargeable depuis la
page de confirmation du signataire et depuis l'espace admin.

## Valeur juridique (Algérie)

La signature apposée est une **signature électronique avancée** (certificat auto-signé géré
par vos soins) : elle apporte intégrité + attribution technique, et vaut comme accord entre
parties de bonne foi. Elle n'est pas une **signature qualifiée** au sens de la
loi n° 15-04 — qui exige un certificat délivré par un prestataire de certification agréé
pour l'équivalence légale avec la signature manuscrite.

## Structure

```
src/
  app/
    login/                 connexion admin
    documents/             espace admin (liste, création, détail + zones)
    s/[token]/             page signataire (PDF + pad de signature)
    api/                   auth, documents, zones, envoi, signature, fichiers
  components/              PdfViewer, ZoneEditor, SignaturePad
  lib/
    signing/               stamping pdf-lib + signature @signpdf (P12)
    db.ts / auth.ts / mail.ts / storage.ts / doc-lock.ts
scripts/
  generate-cert.mjs        génération du P12 (node-forge)
  smoke-test.mjs           test e2e (2 signatures parallèles vérifiées)
```

Le verrou par document (`doc-lock.ts`) sérialise les signatures simultanées ; il est
valide pour un déploiement **mono-instance** (cas standard Coolify).
