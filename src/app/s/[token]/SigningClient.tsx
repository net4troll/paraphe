"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowClockwise,
  Check,
  Circle,
  DeviceMobile,
  DownloadSimple,
  FileText,
  Fingerprint,
  ListChecks,
  SealCheck,
  ShieldCheck,
  X,
} from "@phosphor-icons/react/ssr";
import QrCode from "react-qr-code";
import { LogoMark } from "@/components/Logo";
import PdfFillableViewer from "@/components/PdfFillableViewer";
import SignaturePad from "@/components/SignaturePad";

type FieldProp = {
  id: string;
  label: string;
  type: "text" | "textarea" | "date" | "number" | "checkbox" | "select";
  options: string[];
  presetValue: string;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
};

type Props = {
  token: string;
  docId: string;
  docTitle: string;
  docStatus: string;
  signerName: string;
  signerRole: string;
  signerStatus: string;
  signedAt: string | null;
  company: string;
  fields: FieldProp[];
};

export default function SigningClient(props: Props) {
  const router = useRouter();
  const padRef = useRef<{ submit: () => void } | null>(null);
  const docSectionRef = useRef<HTMLDivElement>(null);
  const signSectionRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState(props.signerName);
  const [signed, setSigned] = useState(props.signerStatus === "signed");
  const [docCompleted, setDocCompleted] = useState(props.docStatus === "completed");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signedAt, setSignedAt] = useState(props.signedAt);
  const [showQr, setShowQr] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const init: Record<string, string | boolean> = {};
    for (const f of props.fields) {
      if (f.presetValue) {
        init[f.id] = f.type === "checkbox" ? f.presetValue === "true" : f.presetValue;
      }
    }
    return init;
  });
  const [hasInk, setHasInk] = useState(false);
  const [docRead, setDocRead] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ fieldId: string; nonce: number } | null>(null);
  // Incrémenté pour forcer le rechargement du PDF quand l'autre partie signe.
  const [pdfVersion, setPdfVersion] = useState(0);
  const lastCountsRef = useRef<{ signedCount: number; docStatus: string } | null>(null);

  // Polling : la page ordinateur reflète la signature apposée sur mobile,
  // et recharge l'aperçu quand l'autre partie signe.
  useEffect(() => {
    if (signed) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/sign/${props.token}/status`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          signerStatus: string;
          docStatus: string;
          signedCount: number;
          signedAt: string | null;
        };
        const previous = lastCountsRef.current;
        lastCountsRef.current = { signedCount: data.signedCount, docStatus: data.docStatus };
        if (previous === null) return;

        if (data.signerStatus === "signed") {
          setSigned(true);
          setDocCompleted(data.docStatus === "completed");
          if (data.signedAt) setSignedAt(data.signedAt);
          router.refresh();
          return;
        }
        if (data.signedCount !== previous.signedCount || data.docStatus !== previous.docStatus) {
          setPdfVersion((v) => v + 1);
          router.refresh();
        }
      } catch {
        // réseau indisponible : on retentera au prochain tick
      }
    }, 4000);
    return () => clearInterval(id);
  }, [signed, props.token, router]);

  const requiredFields = props.fields.filter((f) => !f.presetValue);
  const remainingFields = requiredFields.filter(
    (f) => (f.type === "checkbox" ? values[f.id] !== true : String(values[f.id] ?? "").trim() === "")
  );
  const hasFieldsToFill = requiredFields.length > 0;
  const fieldsFilled = remainingFields.length === 0;

  const missing: string[] = [];
  if (hasFieldsToFill && !fieldsFilled) missing.push("champs à compléter");
  if (!hasInk) missing.push("votre signature");
  if (!name.trim()) missing.push("votre nom");
  if (!consent) missing.push("le consentement");
  const ready = missing.length === 0;

  function focusField(fieldId: string) {
    setFocusRequest({ fieldId, nonce: Date.now() });
    docSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit(signatureDataUrl: string) {
    setError(null);
    if (!ready) {
      if (remainingFields.length > 0) focusField(remainingFields[0].id);
      setError(`Il reste : ${missing.join(" · ")}`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/sign/${props.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          image: signatureDataUrl,
          consent: true,
          values,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "La signature a échoué");
        return;
      }
      setSigned(true);
      setSignedAt(new Date().toISOString());
      setDocCompleted(body.status === "completed");
    } finally {
      setLoading(false);
    }
  }

  function toggleQr() {
    if (!showQr) setQrUrl(window.location.href);
    setShowQr((v) => !v);
  }

  if (signed) {
    return (
      <main className="flex min-h-screen flex-col">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3.5">
            <LogoMark size={30} />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-medium text-slate-900">{props.docTitle}</p>
              <p className="text-xs text-slate-400">{props.company}</p>
            </div>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center px-4 py-12">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
              <SealCheck size={28} className="text-brand-700" />
            </span>
            <h1 className="mt-4 text-lg font-semibold tracking-tight">Signature enregistrée</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
              Votre signature du document a été apposée avec un certificat numérique.
            </p>
            <dl className="mt-5 space-y-2 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 text-left text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Document</dt>
                <dd className="truncate font-medium text-slate-700">{props.docTitle}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Signataire</dt>
                <dd className="font-medium text-slate-700">{name || props.signerName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Date</dt>
                <dd className="font-medium text-slate-700">
                  {signedAt ? new Date(signedAt).toLocaleString("fr-FR") : "—"}
                </dd>
              </div>
            </dl>
            {docCompleted ? (
              <p className="mt-4 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-[13px] text-brand-800">
                Toutes les parties ont signé — le PDF final vous a été envoyé par email.
              </p>
            ) : (
              <p className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
                En attente des autres signataires. Le PDF final vous sera envoyé par email dès que
                tout le monde aura signé.
              </p>
            )}
            <a
              href={`/api/files/${props.docId}/${docCompleted ? "final" : "current"}?t=${props.token}&download=1`}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800"
            >
              <DownloadSimple size={16} />
              Télécharger le PDF {docCompleted ? "final signé" : "en cours"}
            </a>
          </div>
        </div>
      </main>
    );
  }

  if (props.docStatus === "draft") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-slate-500">
          Ce document n&apos;est pas encore ouvert à la signature. Revenez plus tard.
        </p>
      </main>
    );
  }

  const steps = [
    {
      n: 1,
      label: hasFieldsToFill ? "Lire et compléter" : "Lire le document",
      done: docRead && fieldsFilled,
      ref: docSectionRef,
    },
    { n: 2, label: "Signer", done: false, ref: signSectionRef },
  ];

  return (
    <main className="min-h-screen pb-28">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <LogoMark size={30} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium text-slate-900">{props.docTitle}</p>
            <p className="text-xs text-slate-400">
              {props.company} · Vous signez en qualité de{" "}
              <span className="font-medium text-slate-600">{props.signerRole}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 md:flex">
              <ShieldCheck size={14} /> Signature certifiée P12
            </span>
            <button
              type="button"
              onClick={toggleQr}
              className={`hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition md:flex ${
                showQr
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:text-slate-900"
              }`}
            >
              <DeviceMobile size={14} /> Signer sur mobile
            </button>
          </div>
        </div>
      </header>

      {/* Fil d'étapes */}
      <div className="mx-auto max-w-7xl px-4 pt-4">
        <ol className="flex flex-wrap items-center gap-2">
          {steps.map((step, i) => (
            <li key={step.n} className="flex items-center gap-2">
              {i > 0 && <span className="text-xs text-slate-300">→</span>}
              <button
                type="button"
                onClick={() => step.ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
                  step.done
                    ? "border-slate-200 bg-slate-50 text-slate-500"
                    : "border-slate-900 bg-white font-semibold text-slate-900"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                    step.done ? "bg-brand-600 text-white" : "bg-slate-900 text-white"
                  }`}
                >
                  {step.done ? <Check size={11} weight="bold" /> : step.n}
                </span>
                {step.label}
              </button>
            </li>
          ))}
        </ol>
      </div>

      {showQr && (
        <div className="mx-auto max-w-7xl px-4 pt-4">
          <div className="relative flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-center sm:flex-row sm:gap-5 sm:text-left">
            <button
              type="button"
              onClick={toggleQr}
              title="Fermer"
              className="absolute right-3 top-3 text-slate-400 hover:text-slate-700"
            >
              <X size={16} />
            </button>
            <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-2">
              <QrCode value={qrUrl} size={132} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Scannez avec votre téléphone
              </h2>
              <p className="mt-1 max-w-md text-[13px] leading-relaxed text-slate-600">
                Ouvrez ce lien sur votre mobile pour signer confortablement au doigt.{" "}
                <strong>Cette page se mettra à jour toute seule</strong> dès que la signature sera
                apposée — téléphone et ordinateur partagent le même lien sécurisé.
              </p>
              <p className="mt-1.5 text-xs text-slate-400">
                Le téléphone doit accéder à la même adresse que cet ordinateur (même réseau, ou URL
                publique).
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 py-5">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* Le PDF avec les champs à remplir directement dedans */}
          <section
            ref={docSectionRef}
            className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-xs text-slate-500">
              <FileText size={14} className="text-slate-400" />
              {hasFieldsToFill
                ? fieldsFilled
                  ? "Tous les champs sont complétés — vérifiez puis signez"
                  : "Complétez les champs requis dans le document (surlignés en pointillés)"
                : "Document pré-rempli par l'expéditeur — vérifiez le contenu avant d'apposer votre signature"}
            </div>
            <div key={pdfVersion}>
              <PdfFillableViewer
                url={`/api/files/${props.docId}/current?t=${props.token}`}
                fields={props.fields}
                values={values}
                onChange={(fieldId, value) => setValues((v) => ({ ...v, [fieldId]: value }))}
                onRead={() => setDocRead(true)}
                focusRequest={focusRequest}
              />
            </div>
          </section>

          {/* Rail : récapitulatif + signature */}
          <aside className="space-y-4">
            {hasFieldsToFill ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <h3 className="flex items-center justify-between text-sm font-semibold text-slate-900">
                  <span className="flex items-center gap-2">
                    <ListChecks size={16} className="text-brand-700" /> Champs à compléter
                  </span>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                      fieldsFilled
                        ? "border-slate-200 bg-slate-50 text-slate-500"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    {fieldsFilled
                      ? "terminé ✓"
                      : `${remainingFields.length} restant(s)`}
                  </span>
                </h3>
                <ul className="mt-3 space-y-1">
                  {requiredFields.map((field) => {
                    const filled =
                      field.type === "checkbox"
                        ? values[field.id] === true
                        : String(values[field.id] ?? "").trim() !== "";
                    return (
                      <li key={field.id}>
                        <button
                          type="button"
                          onClick={() => focusField(field.id)}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition hover:bg-slate-50"
                        >
                          {filled ? (
                            <Check size={13} weight="bold" className="shrink-0 text-brand-700" />
                          ) : (
                            <Circle
                              size={13}
                              className="shrink-0 text-slate-300"
                              weight="bold"
                            />
                          )}
                          <span
                            className={`min-w-0 flex-1 truncate ${
                              filled ? "text-slate-400 line-through" : "text-slate-700 font-medium"
                            }`}
                          >
                            {field.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[11px] text-slate-400">
                  Cliquez sur un champ pour y accéder directement dans le document.
                </p>
              </section>
            ) : props.fields.length > 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-xs text-emerald-900 shadow-xs">
                <SealCheck size={22} className="shrink-0 text-emerald-600" />
                <div className="leading-relaxed">
                  <p className="font-semibold text-emerald-950">Champs déjà complétés</p>
                  <p className="text-emerald-700/90">
                    L&apos;expéditeur a déjà pré-rempli toutes les informations. Vous pouvez apposer directement votre signature ci-dessous.
                  </p>
                </div>
              </div>
            ) : null}

            <section
              ref={signSectionRef}
              className="scroll-mt-24 space-y-4 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Fingerprint size={16} className="text-brand-700" /> Votre signature
              </h3>

              <SignaturePad
                ref={padRef}
                name={name}
                consent={consent}
                loading={loading}
                blockSubmit={!fieldsFilled && props.fields.length > 0}
                onInkChange={setHasInk}
                onConsentChange={setConsent}
                onSubmit={submit}
              />

              <div>
                <label
                  htmlFor="signer-name"
                  className="block text-[13px] font-medium text-slate-700"
                >
                  Nom complet
                </label>
                <input
                  id="signer-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15"
                />
              </div>

              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                  {error}
                </p>
              )}

              <p className="text-[11px] leading-relaxed text-slate-400">
                Conformément à la loi algérienne n° 15-04, cette signature électronique avancée
                garantit l&apos;intégrité du document et l&apos;identification du signataire.
              </p>
            </section>
          </aside>
        </div>
      </div>

      {/* Barre d'action fixe : consentement + état + CTA */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <label className="flex min-w-0 flex-1 items-start gap-2.5 text-xs leading-snug text-slate-600">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-700"
            />
            <span>
              Je certifie mon identité et j&apos;accepte que cette signature électronique
              m&apos;engage sur le présent document.
            </span>
          </label>
          <div className="flex shrink-0 items-center gap-3">
            {ready ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-700">
                <Check size={14} weight="bold" /> Prêt à signer
              </span>
            ) : (
              <span className="text-xs text-slate-400">Il reste : {missing.join(" · ")}</span>
            )}
            <button
              type="button"
              disabled={!ready || loading}
              onClick={() => padRef.current?.submit()}
              className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Signature…" : "Signer le document"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
