"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowClockwise,
  Check,
  Copy,
  CursorClick,
  DeviceMobile,
  DownloadSimple,
  MagicWand,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  ShieldCheck,
  Trash,
  X,
} from "@phosphor-icons/react/ssr";
import QrCode from "react-qr-code";
import StatusDot from "@/components/StatusDot";
import PdfViewer from "@/components/PdfViewer";
import ZoneEditor, { type FieldType, type FieldView, type ZoneSigner } from "@/components/ZoneEditor";

type SignerView = ZoneSigner & {
  email: string;
  token: string;
  status: string;
  signedAt: string | null;
};

type DocumentView = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  signers: SignerView[];
};

const AVATAR_COLORS = [
  "bg-brand-50 text-brand-700",
  "bg-amber-50 text-amber-700",
  "bg-blue-50 text-blue-700",
  "bg-rose-50 text-rose-700",
  "bg-violet-50 text-violet-700",
  "bg-slate-100 text-slate-600",
];

const SIGNED_DOT: Record<string, string> = {
  signed: "bg-brand-600",
  pending: "bg-slate-300",
};

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export default function DocumentDetail({
  document: doc,
  fields,
}: {
  document: DocumentView;
  fields: FieldView[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qrSignerId, setQrSignerId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(doc.title);

  // État édition signataire
  const [editingSignerId, setEditingSignerId] = useState<string | null>(null);
  const [signerNameDraft, setSignerNameDraft] = useState("");
  const [signerEmailDraft, setSignerEmailDraft] = useState("");
  const [signerRoleDraft, setSignerRoleDraft] = useState("Partenaire");

  // État ajout signataire
  const [addingSigner, setAddingSigner] = useState(false);
  const [newSignerName, setNewSignerName] = useState("");
  const [newSignerEmail, setNewSignerEmail] = useState("");
  const [newSignerRole, setNewSignerRole] = useState("Partenaire");

  const signedCount = doc.signers.filter((s) => s.status === "signed").length;
  const total = doc.signers.length;
  const zoneSigners: ZoneSigner[] = doc.signers.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    page: s.page,
    xPct: s.xPct,
    yPct: s.yPct,
    widthPct: s.widthPct,
  }));

  async function handleReopenForEdit() {
    if (signedCount > 0) {
      const confirmed = window.confirm(
        `⚠️ Attention : ${signedCount} signataire(s) ont déjà signé ce document.\n\n` +
          `Modifier ce document annulera les signatures existantes afin de garantir la validité et la conformité juridique du fichier.\n\n` +
          `Tous les signataires devront signer la nouvelle version modifiée.\n\n` +
          `Voulez-vous continuer et rouvrir le document en modification ?`
      );
      if (!confirmed) return;
    } else {
      const confirmed = window.confirm(
        `Voulez-vous passer ce document en mode modification ?\n\n` +
          `Vous pourrez ajuster les champs, déplacer les zones de signature ou modifier les signataires avant de renvoyer les invitations.`
      );
      if (!confirmed) return;
    }

    setBusy("edit");
    setMessage(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/edit`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMessage({ kind: "error", text: body.error ?? "Impossible de rouvrir le document" });
        return;
      }
      setMessage({
        kind: "ok",
        text: "Document réouvert en mode modification. Vous pouvez ajuster les champs, les zones et les signataires, puis cliquer sur « Envoyer les invitations ».",
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function startEditSigner(signer: SignerView) {
    setEditingSignerId(signer.id);
    setSignerNameDraft(signer.name);
    setSignerEmailDraft(signer.email);
    setSignerRoleDraft(signer.role);
  }

  async function saveSigner(signerId: string) {
    const name = signerNameDraft.trim();
    if (!name) return;
    setBusy(`signer-${signerId}`);
    try {
      const res = await fetch(`/api/documents/${doc.id}/signers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signerId,
          name,
          email: signerEmailDraft.trim(),
          role: signerRoleDraft.trim() || "Partenaire",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage({ kind: "error", text: body.error ?? "Modification impossible" });
        return;
      }
      setEditingSignerId(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function addSigner() {
    const name = newSignerName.trim();
    if (!name) return;
    setBusy("add-signer");
    try {
      const res = await fetch(`/api/documents/${doc.id}/signers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: newSignerEmail.trim(),
          role: newSignerRole.trim() || "Partenaire",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage({ kind: "error", text: body.error ?? "Ajout impossible" });
        return;
      }
      setAddingSigner(false);
      setNewSignerName("");
      setNewSignerEmail("");
      setNewSignerRole("Partenaire");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function deleteSigner(signerId: string) {
    if (!confirm("Supprimer ce signataire ? Ses champs deviendront communs et visibles par tous.")) {
      return;
    }
    setBusy(`signer-${signerId}`);
    try {
      const res = await fetch(`/api/documents/${doc.id}/signers`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage({ kind: "error", text: body.error ?? "Suppression impossible" });
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function renameTitle() {
    const title = titleDraft.trim();
    if (!title) return;
    setBusy("rename");
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        setRenaming(false);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function placeZone(signerId: string, page: number, xPct: number, yPct: number) {
    setBusy(`zone-${signerId}`);
    setMessage(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/zone`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerId, page, xPct, yPct }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage({ kind: "error", text: body.error ?? "Enregistrement impossible" });
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function send(mode: "all" | "final", signerId?: string) {
    setBusy(signerId ?? mode);
    setMessage(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signerId ? { signerId } : {}),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        warning?: string;
      };
      if (!res.ok) {
        setMessage({ kind: "error", text: body.error ?? "Échec de l'envoi" });
        return;
      }
      if (body.warning) {
        setMessage({ kind: "error", text: body.warning });
      } else {
        setMessage({
          kind: "ok",
          text:
            doc.status === "completed" && mode === "final"
              ? "PDF final renvoyé à tous les participants."
              : doc.status === "draft"
                ? "Invitations envoyées — le document est ouvert à la signature."
                : "Invitation renvoyée.",
        });
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function addField(
    signerId: string | null,
    type: FieldType,
    label: string,
    options: string[],
    presetValue: string,
    page: number,
    xPct: number,
    yPct: number
  ) {
    setBusy("field");
    setMessage(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signerId: signerId || null,
          type,
          label,
          ...(options.length ? { options } : {}),
          ...(presetValue ? { presetValue } : {}),
          page,
          xPct,
          yPct,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage({ kind: "error", text: body.error ?? "Ajout du champ impossible" });
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function deleteField(fieldId: string) {
    setBusy(`field-${fieldId}`);
    try {
      const res = await fetch(`/api/documents/${doc.id}/fields/${fieldId}`, {
        method: "DELETE",
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function reassignField(fieldId: string, signerId: string | null) {
    setBusy(`field-${fieldId}`);
    try {
      const res = await fetch(`/api/documents/${doc.id}/fields/${fieldId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerId: signerId || null }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function deleteZone(signerId: string) {
    const res = await fetch(`/api/documents/${doc.id}/zone`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signerId, clear: true }),
    });
    if (res.ok) router.refresh();
  }

  async function moveZone(
    signerId: string,
    geom: { page: number; xPct: number; yPct: number; widthPct: number }
  ) {
    const res = await fetch(`/api/documents/${doc.id}/zone`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signerId, ...geom }),
    });
    if (res.ok) router.refresh();
  }

  async function moveField(
    fieldId: string,
    geom: { page: number; xPct: number; yPct: number; widthPct: number }
  ) {
    const res = await fetch(`/api/documents/${doc.id}/fields/${fieldId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geom),
    });
    if (res.ok) router.refresh();
  }

  async function presetField(fieldId: string, presetValue: string) {
    const res = await fetch(`/api/documents/${doc.id}/fields/${fieldId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetValue: presetValue || null }),
    });
    if (res.ok) router.refresh();
  }

  async function updateField(
    fieldId: string,
    patch: { label: string; type: FieldType; options: string[]; presetValue: string }
  ) {
    setBusy(`field-${fieldId}`);
    try {
      const res = await fetch(`/api/documents/${doc.id}/fields/${fieldId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: patch.label,
          type: patch.type,
          ...(patch.type === "select" ? { options: patch.options } : { options: null }),
          presetValue: patch.presetValue || null,
        }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function renameField(fieldId: string, label: string) {
    const res = await fetch(`/api/documents/${doc.id}/fields/${fieldId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (res.ok) router.refresh();
  }

  async function detectFields() {
    if (
      fields.length > 0 &&
      !confirm(
        `Relancer l'analyse remplacera les ${fields.length} champ${fields.length > 1 ? "s" : ""} existants (zones de signature conservées). Continuer ?`
      )
    ) {
      return;
    }
    setBusy("detect");
    setMessage(null);
    try {
      const replace = fields.length > 0 ? "?replace=1" : "";
      const res = await fetch(`/api/documents/${doc.id}/detect${replace}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        created?: number;
        signatureZones?: number;
      };
      if (!res.ok) {
        setMessage({ kind: "error", text: body.error ?? "Détection impossible" });
        return;
      }
      const { created = 0, signatureZones = 0 } = body;
      if (created === 0 && signatureZones === 0) {
        setMessage({
          kind: "error",
          text: "Aucun champ détectable (PDF scanné ou sans texte exploitable) — placez manuellement.",
        });
      } else {
        setMessage({
          kind: "ok",
          text: `${created} champ${created > 1 ? "s" : ""} et ${signatureZones} zone${signatureZones > 1 ? "s" : ""} de signature détectés — vérifiez, ajustez ou réassignez si besoin.`,
        });
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Supprimer définitivement « ${doc.title} » et ses fichiers ?`)) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/documents");
        return;
      }
      setMessage({ kind: "error", text: "Suppression impossible" });
    } finally {
      setBusy(null);
    }
  }

  function copyLink(signer: SignerView) {
    const url = `${window.location.origin}/s/${signer.token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(signer.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/documents"
        className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 transition hover:text-slate-800"
      >
        <ArrowLeft size={14} /> Documents
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={titleDraft}
                maxLength={200}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") renameTitle();
                  if (e.key === "Escape") setRenaming(false);
                }}
                className="w-full max-w-lg rounded-lg border border-slate-300 px-3 py-1.5 text-xl font-semibold outline-none focus:border-brand-600"
              />
              <button
                type="button"
                onClick={renameTitle}
                disabled={busy !== null || !titleDraft.trim()}
                title="Enregistrer"
                className="rounded-lg bg-slate-900 p-2 text-white disabled:opacity-40"
              >
                <Check size={15} />
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                title="Annuler"
                className="rounded-lg border border-slate-200 p-2 text-slate-500"
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <div className="group flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{doc.title}</h1>
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(doc.title);
                  setRenaming(true);
                }}
                title="Renommer le document"
                className="rounded-md p-1.5 text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100"
              >
                <PencilSimple size={15} />
              </button>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <StatusDot status={doc.status} />
            <span className="text-sm text-slate-400">
              {signedCount}/{total} signature{total > 1 ? "s" : ""}
            </span>
            <span className="text-[13px] text-slate-400">
              Créé le {new Date(doc.createdAt).toLocaleDateString("fr-FR")}
            </span>
          </div>
          <div className="mt-3 h-1 w-48 overflow-hidden rounded-full bg-slate-200/70">
            <div
              className="h-full rounded-full bg-brand-600 transition-all"
              style={{ width: `${total === 0 ? 0 : (signedCount / total) * 100}%` }}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {doc.status === "draft" && (
            <button
              type="button"
              onClick={() => send("all")}
              disabled={busy !== null}
              className="flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50"
            >
              <PaperPlaneTilt size={15} /> {busy === "all" ? "Envoi…" : "Envoyer les invitations"}
            </button>
          )}
          {doc.status === "completed" && (
            <>
              <a
                href={`/api/files/${doc.id}/final?download=1`}
                className="flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800"
              >
                <DownloadSimple size={15} /> PDF final signé
              </a>
              <button
                type="button"
                onClick={() => send("final")}
                disabled={busy !== null}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-600 transition hover:text-slate-900 disabled:opacity-50"
              >
                <ArrowClockwise size={15} /> Renvoyer
              </button>
            </>
          )}
          {doc.status !== "draft" && (
            <button
              type="button"
              onClick={handleReopenForEdit}
              disabled={busy !== null}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
              title="Modifier les champs, zones de signature et signataires"
            >
              <PencilSimple size={15} /> {busy === "edit" ? "Réouverture…" : "Modifier le document"}
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={busy !== null}
            title="Supprimer le document"
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-400 transition hover:text-red-600 disabled:opacity-50"
          >
            <Trash size={15} />
          </button>
        </div>
      </div>

      {message && (
        <p
          className={`mt-5 rounded-xl border px-4 py-3 text-sm ${
            message.kind === "ok"
              ? "border-brand-200 bg-brand-50 text-brand-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Colonne document */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-sm font-medium text-slate-900">
              {doc.status === "draft" ? "Placement des signatures" : "Aperçu du document"}
            </h2>
            {doc.status === "draft" ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={detectFields}
                  disabled={busy !== null}
                  title="Analyser le PDF et proposer les champs automatiquement (100 % local)"
                  className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-800 transition hover:bg-brand-100 disabled:opacity-50"
                >
                  <MagicWand size={13} />
                  {busy === "detect" ? "Analyse…" : "Détecter automatiquement"}
                </button>
                <span className="hidden items-center gap-1.5 text-xs text-slate-400 sm:flex">
                  <CursorClick size={13} /> cliquez pour placer
                </span>
              </div>
            ) : doc.status === "completed" ? (
              <span className="flex items-center gap-1.5 text-xs text-brand-700">
                <ShieldCheck size={13} /> certifié P12
              </span>
            ) : null}
          </div>
          {doc.status === "draft" ? (
            <div className="p-4">
            <ZoneEditor
              fileUrl={`/api/files/${doc.id}/original`}
              signers={zoneSigners}
              fields={fields}
              onPlace={placeZone}
              onAddField={addField}
              onDeleteField={deleteField}
              onReassignField={reassignField}
              onPresetField={presetField}
              onUpdateField={updateField}
              onRenameField={renameField}
              onDeleteZone={deleteZone}
              onMoveZone={moveZone}
              onMoveField={moveField}
            />
            </div>
          ) : (
            <div className="max-h-[72vh] overflow-hidden bg-slate-100/70 p-4">
              <div className="max-h-[68vh] overflow-auto rounded-lg">
                <PdfViewer url={`/api/files/${doc.id}/current`} />
              </div>
            </div>
          )}
        </section>

        {/* Colonne signataires */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-sm font-medium text-slate-900">Signataires</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums text-slate-400">
                  {signedCount}/{total}
                </span>
                {doc.status === "draft" && total < 6 && (
                  <button
                    type="button"
                    onClick={() => setAddingSigner(!addingSigner)}
                    className="flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-100"
                    title="Ajouter un signataire"
                  >
                    <Plus size={12} weight="bold" /> Ajouter
                  </button>
                )}
              </div>
            </div>
            <ul className="divide-y divide-slate-100">
              {doc.signers.map((signer, i) => {
                const signed = signer.status === "signed";
                const fieldCount = fields.filter((f) => f.signerId === signer.id).length;
                const qrValue =
                  typeof window !== "undefined"
                    ? `${window.location.origin}/s/${signer.token}`
                    : "";

                if (editingSignerId === signer.id && doc.status === "draft") {
                  return (
                    <li key={signer.id} className="p-4 bg-slate-50/70 border-l-2 border-brand-600">
                      <div className="space-y-2.5">
                        <p className="text-xs font-semibold text-slate-700">Modifier le signataire</p>
                        <div>
                          <label className="text-[11px] font-medium text-slate-500">Nom & prénom</label>
                          <input
                            type="text"
                            value={signerNameDraft}
                            onChange={(e) => setSignerNameDraft(e.target.value)}
                            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-brand-600"
                            placeholder="Nom et prénom"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] font-medium text-slate-500">Rôle</label>
                            <input
                              type="text"
                              value={signerRoleDraft}
                              onChange={(e) => setSignerRoleDraft(e.target.value)}
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-brand-600"
                              placeholder="Partenaire"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-slate-500">Email</label>
                            <input
                              type="email"
                              value={signerEmailDraft}
                              onChange={(e) => setSignerEmailDraft(e.target.value)}
                              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-brand-600"
                              placeholder="email@example.com"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => setEditingSignerId(null)}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          >
                            Annuler
                          </button>
                          <button
                            type="button"
                            onClick={() => saveSigner(signer.id)}
                            disabled={busy !== null || !signerNameDraft.trim()}
                            className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                          >
                            Enregistrer
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                }

                return (
                  <li key={signer.id} className="px-5 py-4">
                    <div className="flex items-start gap-3">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold ${
                          signed ? "bg-brand-600 text-white" : AVATAR_COLORS[i % AVATAR_COLORS.length]
                        }`}
                      >
                        {signed ? <Check size={15} /> : initials(signer.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {signer.name}
                          </p>
                          {doc.status === "draft" && (
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => startEditSigner(signer)}
                                title="Modifier ce signataire"
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              >
                                <PencilSimple size={13} />
                              </button>
                              {total > 1 && (
                                <button
                                  type="button"
                                  onClick={() => deleteSigner(signer.id)}
                                  title="Supprimer ce signataire"
                                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                >
                                  <Trash size={13} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <p className="truncate text-[13px] text-slate-500">
                          {signer.role} · {signer.email || "Sans email (QR/Lien)"}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${SIGNED_DOT[signer.status] ?? SIGNED_DOT.pending}`}
                          />
                          {signed
                            ? `A signé le ${new Date(signer.signedAt ?? "").toLocaleString("fr-FR")}`
                            : signer.page === null && doc.status === "draft"
                              ? "Zone de signature à placer"
                              : "En attente de signature"}
                          {fieldCount > 0 && ` · ${fieldCount} champ${fieldCount > 1 ? "s" : ""}`}
                        </p>
                      </div>
                    </div>
                    {!signed && (
                      <div className="mt-3 flex items-center gap-2 pl-12">
                        <button
                          type="button"
                          onClick={() =>
                            setQrSignerId(qrSignerId === signer.id ? null : signer.id)
                          }
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                            qrSignerId === signer.id
                              ? "border-brand-600 bg-brand-700 text-white"
                              : "border-slate-200 text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          <DeviceMobile size={13} /> QR
                        </button>
                        <button
                          type="button"
                          onClick={() => copyLink(signer)}
                          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition hover:text-slate-900"
                        >
                          {copiedId === signer.id ? <Check size={13} /> : <Copy size={13} />}
                          {copiedId === signer.id ? "Copié" : "Copier le lien"}
                        </button>
                        {doc.status !== "draft" && (
                          <button
                            type="button"
                            onClick={() => send("all", signer.id)}
                            disabled={busy !== null}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition hover:text-slate-900 disabled:opacity-50"
                          >
                            <ArrowClockwise size={13} /> Renvoyer
                          </button>
                        )}
                      </div>
                    )}
                    {qrSignerId === signer.id && !signed && (
                      <div className="mt-3 flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/50 p-3 pl-12">
                        <div className="shrink-0 rounded-lg border border-slate-200 bg-white p-1.5">
                          <QrCode value={qrValue} size={92} />
                        </div>
                        <p className="text-xs leading-relaxed text-slate-600">
                          Le signataire scanne ce code pour signer au doigt sur son téléphone —
                          même lien sécurisé, même réseau ou URL publique.
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
              {addingSigner && doc.status === "draft" && (
                <li className="border-t border-slate-200 bg-brand-50/40 p-4">
                  <div className="space-y-2.5">
                    <p className="text-xs font-semibold text-slate-800">Nouveau signataire</p>
                    <div>
                      <label className="text-[11px] font-medium text-slate-500">Nom & prénom</label>
                      <input
                        type="text"
                        value={newSignerName}
                        onChange={(e) => setNewSignerName(e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-brand-600"
                        placeholder="Ex : Jean Dupont"
                        autoFocus
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-medium text-slate-500">Rôle</label>
                        <input
                          type="text"
                          value={newSignerRole}
                          onChange={(e) => setNewSignerRole(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-brand-600"
                          placeholder="Partenaire"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-slate-500">Email (optionnel)</label>
                        <input
                          type="email"
                          value={newSignerEmail}
                          onChange={(e) => setNewSignerEmail(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-brand-600"
                          placeholder="jean@dupont.fr"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAddingSigner(false);
                          setNewSignerName("");
                          setNewSignerEmail("");
                        }}
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={addSigner}
                        disabled={busy !== null || !newSignerName.trim()}
                        className="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
                      >
                        Ajouter
                      </button>
                    </div>
                  </div>
                </li>
              )}
            </ul>
          </div>

          {doc.status === "draft" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-medium text-slate-900">Prochaine étape</h3>
              <ol className="mt-3 space-y-2.5 text-[13px] leading-snug text-slate-500">
                <li className="flex gap-2.5">
                  <span className="font-semibold text-slate-900">1.</span> Sélectionnez un
                  signataire puis cliquez sur le PDF pour placer sa zone de signature.
                </li>
                <li className="flex gap-2.5">
                  <span className="font-semibold text-slate-900">2.</span> Répétez pour chaque
                  signataire (les zones peuvent être sur la même page).
                </li>
                <li className="flex gap-2.5">
                  <span className="font-semibold text-slate-900">3.</span> Cliquez sur « Envoyer
                  les invitations » — chacun reçoit son lien personnel.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => send("all")}
                disabled={busy !== null}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50"
              >
                <PaperPlaneTilt size={15} /> {busy === "all" ? "Envoi…" : "Envoyer les invitations"}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
