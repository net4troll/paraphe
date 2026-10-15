"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FilePdf, Plus, Trash, UploadSimple, X } from "@phosphor-icons/react/ssr";

type SignerRow = { name: string; email: string; role: string };

const ROLES = ["Partenaire", "Intervenant", "Représentant", "Témoin"];
const INITIALS_COLOR = ["bg-brand-50 text-brand-700", "bg-amber-50 text-amber-700", "bg-blue-50 text-blue-700", "bg-rose-50 text-rose-700", "bg-violet-50 text-violet-700", "bg-slate-100 text-slate-600"];

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function SectionTitle({ step, title, hint }: { step: number; title: string; hint: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-[11px] font-semibold text-white">
        {step}
      </span>
      <div>
        <h2 className="text-sm font-medium text-slate-900">{title}</h2>
        <p className="text-xs text-slate-400">{hint}</p>
      </div>
    </div>
  );
}

export default function NewDocumentPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [signers, setSigners] = useState<SignerRow[]>([
    { name: "", email: "", role: "Partenaire" },
    { name: "", email: "", role: "Intervenant" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateSigner(index: number, patch: Partial<SignerRow>) {
    setSigners((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function pickFile(selected: File | null) {
    if (selected && selected.type !== "application/pdf" && !selected.name.endsWith(".pdf")) {
      setError("Le fichier doit être un PDF");
      return;
    }
    setError(null);
    setFile(selected);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Choisissez un fichier PDF");
      return;
    }
    const filled = signers
      .filter((s) => s.name.trim())
      .map((s) => ({ name: s.name.trim(), email: s.email.trim(), role: s.role.trim() || "Partenaire" }));
    if (filled.length === 0) {
      setError("Renseignez au moins un signataire (nom)");
      return;
    }
    const data = new FormData();
    data.set("title", title.trim());
    data.set("file", file);
    data.set("signers", JSON.stringify(filled));
    setLoading(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: data });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        setError(body.error ?? "Création impossible");
        return;
      }
      router.push(`/documents/${body.id}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/documents"
        className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 transition hover:text-slate-800"
      >
        <ArrowLeft size={14} /> Documents
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Nouveau document</h1>
      <p className="mt-1 text-sm text-slate-500">
        Trois étapes : le PDF, les signataires, puis le placement des zones de signature.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white">
          <SectionTitle step={1} title="Document" hint="Le PDF à faire signer" />
          <div className="p-5">
            <label htmlFor="doc-title" className="block text-[13px] font-medium text-slate-700">
              Titre
            </label>
            <input
              id="doc-title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex. Convention de partenariat IFIN — 2026"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15"
            />

            <p className="mt-4 block text-[13px] font-medium text-slate-700">Fichier</p>
            {file ? (
              <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white">
                  <FilePdf size={16} className="text-brand-700" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
                  <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="rounded-md p-1.5 text-slate-400 hover:text-slate-700"
                  title="Retirer le fichier"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-1.5 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-8 text-center transition hover:border-brand-600/50 hover:bg-brand-50/40"
              >
                <UploadSimple size={20} className="text-slate-400" />
                <span className="text-sm font-medium text-slate-700">
                  Cliquez pour choisir un PDF
                </span>
                <span className="text-xs text-slate-400">15 Mo maximum</span>
              </button>
            )}
            <input
              ref={fileRef}
              id="file"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white">
          <SectionTitle
            step={2}
            title="Signataires"
            hint="Email optionnel — sans email, le lien se partage via QR ou copie"
          />
          <div className="space-y-3 p-5">
            {signers.map((signer, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold ${
                    INITIALS_COLOR[i % INITIALS_COLOR.length]
                  }`}
                >
                  {(signer.name.trim()[0] ?? "?").toUpperCase()}
                </span>
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
                  <input
                    placeholder="Nom complet"
                    value={signer.name}
                    onChange={(e) => updateSigner(i, { name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15"
                  />
                  <input
                    placeholder="Email (optionnel)"
                    type="email"
                    value={signer.email}
                    onChange={(e) => updateSigner(i, { email: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15"
                  />
                  <input
                    placeholder="Qualité"
                    list="roles"
                    value={signer.role}
                    onChange={(e) => updateSigner(i, { role: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15"
                  />
                </div>
                {signers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSigners((rows) => rows.filter((_, j) => j !== i))}
                    className="shrink-0 rounded-md p-1.5 text-slate-300 transition hover:bg-slate-50 hover:text-red-600"
                    title="Retirer"
                  >
                    <Trash size={15} />
                  </button>
                )}
              </div>
            ))}
            <datalist id="roles">
              {ROLES.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            {signers.length < 6 && (
              <button
                type="button"
                onClick={() =>
                  setSigners((rows) => [...rows, { name: "", email: "", role: "Partenaire" }])
                }
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-sm text-slate-500 transition hover:border-brand-600/50 hover:text-brand-700"
              >
                <Plus size={14} /> Ajouter un signataire
              </button>
            )}
          </div>
        </section>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <Link
            href="/documents"
            className="rounded-lg px-4 py-2 text-sm text-slate-500 transition hover:text-slate-800"
          >
            Annuler
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50"
          >
            {loading ? "Création…" : "Créer le document"}
          </button>
        </div>
      </form>
    </div>
  );
}
