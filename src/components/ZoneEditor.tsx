"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  Check,
  Eraser,
  PencilSimple,
  Trash,
  X,
  CaretDown,
  CaretRight,
} from "@phosphor-icons/react/ssr";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export type ZoneSigner = {
  id: string;
  name: string;
  role: string;
  page: number | null;
  xPct: number | null;
  yPct: number | null;
  widthPct: number | null;
  heightPct?: number | null;
};

export type FieldType = "text" | "textarea" | "date" | "number" | "checkbox" | "select";

export type FieldView = {
  id: string;
  signerId: string | null;
  label: string;
  type: FieldType;
  options: string[];
  presetValue: string;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
};

type Tool = "signature" | "pdf_text" | FieldType;
type Selection = { kind: "zone" | "field"; id: string } | null;

const ZONE_COLORS = [
  { border: "border-teal-600", bg: "bg-teal-600/10", text: "text-teal-700", solid: "bg-teal-600" },
  { border: "border-amber-500", bg: "bg-amber-500/10", text: "text-amber-600", solid: "bg-amber-500" },
  { border: "border-violet-500", bg: "bg-violet-500/10", text: "text-violet-600", solid: "bg-violet-500" },
  { border: "border-rose-500", bg: "bg-rose-500/10", text: "text-rose-600", solid: "bg-rose-500" },
];

const FIELD_TOOLS: { type: FieldType; label: string; icon: string }[] = [
  { type: "text", label: "Texte", icon: "📝" },
  { type: "date", label: "Date", icon: "📅" },
  { type: "number", label: "Nombre", icon: "🔢" },
  { type: "checkbox", label: "Case", icon: "☑️" },
  { type: "textarea", label: "Commentaire", icon: "💬" },
  { type: "select", label: "Liste", icon: "📋" },
];

const TYPE_LABEL: Record<FieldType, string> = {
  text: "Texte",
  textarea: "Commentaire",
  date: "Date",
  number: "Nombre",
  checkbox: "Case",
  select: "Liste",
};

/** Hauteur d'affichage des champs, en % de la hauteur de page. */
const FIELD_HEIGHT_PCT: Record<FieldType, number> = {
  text: 2.6,
  textarea: 5.5,
  date: 2.6,
  number: 2.6,
  checkbox: 2.2,
  select: 2.6,
};

const RESIZE_HANDLES = [
  { side: "w" as const, className: "-left-2.5 top-1/2 -translate-y-1/2 cursor-ew-resize", label: "Largeur gauche" },
  { side: "e" as const, className: "-right-2.5 top-1/2 -translate-y-1/2 cursor-ew-resize", label: "Largeur droite" },
  { side: "s" as const, className: "left-1/2 -bottom-2.5 -translate-x-1/2 cursor-ns-resize", label: "Hauteur bas" },
  { side: "se" as const, className: "-right-2.5 -bottom-2.5 cursor-nwse-resize", label: "Coin redimensionnement" },
];

type Geometry = { page: number; xPct: number; yPct: number; widthPct: number; heightPct?: number };

type Gesture = {
  kind: "zone" | "field";
  id: string;
  mode: "move" | "resize";
  side: "w" | "e" | "s" | "se";
  pageEl: HTMLElement;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  lastGeometry?: Geometry;
  moved?: boolean;
};

type GestureEvent = {
  stopPropagation: () => void;
  preventDefault: () => void;
  currentTarget: HTMLElement;
  pointerId: number;
  clientX: number;
  clientY: number;
};

export default function ZoneEditor({
  fileUrl,
  signers,
  fields,
  onPlace,
  onAddField,
  onDeleteField,
  onReassignField,
  onPresetField,
  onUpdateField,
  onRenameField,
  onDeleteZone,
  onMoveZone,
  onMoveField,
}: {
  fileUrl: string;
  signers: ZoneSigner[];
  fields: FieldView[];
  onPlace: (
    signerId: string,
    page: number,
    xPct: number,
    yPct: number,
    widthPct?: number,
    heightPct?: number
  ) => void;
  onAddField: (
    signerId: string | null,
    type: FieldType,
    label: string,
    options: string[],
    presetValue: string,
    page: number,
    xPct: number,
    yPct: number
  ) => void;
  onDeleteField: (fieldId: string) => void;
  onReassignField: (fieldId: string, signerId: string | null) => void;
  onPresetField: (fieldId: string, presetValue: string) => void;
  onUpdateField: (
    fieldId: string,
    patch: { label: string; type: FieldType; options: string[]; presetValue: string }
  ) => void;
  onRenameField: (fieldId: string, label: string) => void;
  onDeleteZone: (signerId: string) => void;
  onMoveZone: (signerId: string, geom: Geometry) => void;
  onMoveField: (fieldId: string, geom: Geometry) => void;
}) {
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string>(
    () => signers.find((s) => s.page === null)?.id ?? signers[0]?.id ?? ""
  );

  /** Outil actif pour le prochain clic */
  const [tool, setTool] = useState<Tool | null>("signature");
  const [selected, setSelected] = useState<Selection>(null);

  // Saisie directe de nouveau texte sur le PDF au clic ou double-clic
  const [pendingNewText, setPendingNewText] = useState<{
    page: number;
    xPct: number;
    yPct: number;
    widthPct: number;
    text: string;
  } | null>(null);
  const pendingInputRef = useRef<HTMLInputElement>(null);

  // Édition inline directe du texte sur le PDF (sans aucun window.prompt !)
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [inlineValue, setInlineValue] = useState("");
  const inlineInputRef = useRef<HTMLInputElement>(null);

  // Modal propre pour modifier les propriétés d'un champ
  const [modalField, setModalField] = useState<FieldView | null>(null);
  const [modalDraft, setModalDraft] = useState<{
    label: string;
    type: FieldType;
    options: string;
    preset: string;
    signerId: string | null;
  }>({ label: "", type: "text", options: "", preset: "", signerId: null });

  // Accordéon récapitulatif
  const [showSummary, setShowSummary] = useState(false);

  // Synchronisation locale pour gestes de drag / resize fluides
  const [localSigners, setLocalSigners] = useState<ZoneSigner[]>(signers);
  const [localFields, setLocalFields] = useState<FieldView[]>(fields);
  useEffect(() => setLocalSigners(signers), [signers]);
  useEffect(() => setLocalFields(fields), [fields]);

  const gestureRef = useRef<Gesture | null>(null);
  const activeCleanupRef = useRef<(() => void) | null>(null);

  // Focus automatique lors de l'édition inline ou de la nouvelle saisie
  useEffect(() => {
    if (pendingNewText && pendingInputRef.current) {
      pendingInputRef.current.focus();
    }
  }, [pendingNewText]);

  useEffect(() => {
    if (inlineEditingId && inlineInputRef.current) {
      inlineInputRef.current.focus();
      inlineInputRef.current.select();
    }
  }, [inlineEditingId]);

  // Échap pour tout désélectionner / annuler l'édition
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pendingNewText) {
          cancelPendingNewText();
        } else if (inlineEditingId) {
          cancelInlineEdit();
        } else if (modalField) {
          setModalField(null);
        } else {
          setSelected(null);
          setTool(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingNewText, inlineEditingId, modalField]);

  function commitPendingNewText() {
    if (!pendingNewText) return;
    const val = pendingNewText.text.trim();
    if (val) {
      onAddField(
        null,
        "text",
        val,
        [],
        val,
        pendingNewText.page,
        pendingNewText.xPct,
        pendingNewText.yPct
      );
    }
    setPendingNewText(null);
  }

  function cancelPendingNewText() {
    setPendingNewText(null);
  }

  function startInlineEdit(fieldId: string, currentText: string) {
    setInlineEditingId(fieldId);
    setInlineValue(currentText);
    setSelected({ kind: "field", id: fieldId });
  }

  function commitInlineEdit() {
    if (!inlineEditingId) return;
    const val = inlineValue.trim();
    const field = localFields.find((f) => f.id === inlineEditingId);

    if (field) {
      if (!val) {
        // Si vide, suppression propre
        onDeleteField(field.id);
        setLocalFields((prev) => prev.filter((f) => f.id !== field.id));
      } else {
        onPresetField(field.id, val);
        onRenameField(field.id, val);
        setLocalFields((prev) =>
          prev.map((f) => (f.id === field.id ? { ...f, presetValue: val, label: val } : f))
        );
      }
    }
    setInlineEditingId(null);
  }

  function cancelInlineEdit() {
    if (!inlineEditingId) return;
    const field = localFields.find((f) => f.id === inlineEditingId);
    if (field && !field.presetValue && field.label === "Nouveau texte") {
      // Suppression de l'élément provisoire
      onDeleteField(field.id);
      setLocalFields((prev) => prev.filter((f) => f.id !== field.id));
    }
    setInlineEditingId(null);
  }

  function openFieldModal(field: FieldView) {
    setModalField(field);
    setModalDraft({
      label: field.label,
      type: field.type,
      options: field.options.join(", "),
      preset: field.presetValue,
      signerId: field.signerId,
    });
  }

  function saveModalField() {
    if (!modalField || !modalDraft.label.trim()) return;
    const options =
      modalDraft.type === "select"
        ? modalDraft.options.split(",").map((o) => o.trim()).filter(Boolean)
        : [];

    onUpdateField(modalField.id, {
      label: modalDraft.label.trim(),
      type: modalDraft.type,
      options,
      presetValue: modalDraft.preset.trim(),
    });

    if (modalDraft.signerId !== modalField.signerId) {
      onReassignField(modalField.id, modalDraft.signerId);
    }

    setModalField(null);
  }

  function clampX(v: number) {
    return Math.min(0.97, Math.max(0.03, v));
  }
  function clampY(v: number) {
    return Math.min(0.97, Math.max(0.03, v));
  }
  function clampW(v: number) {
    return Math.min(0.85, Math.max(0.06, v));
  }
  function clampH(v: number) {
    return Math.min(0.5, Math.max(0.02, v));
  }

  const selectedSigner =
    localSigners.find((s) => s.id === selectedId) ?? localSigners[0];
  const selectedSignerIndex = localSigners.findIndex((s) => s.id === selectedSigner?.id);

  function beginGesture(
    kind: "zone" | "field",
    id: string,
    mode: "move" | "resize",
    side: "w" | "e" | "s" | "se",
    start: Geometry,
    event: GestureEvent
  ) {
    event.stopPropagation();
    event.preventDefault();
    activeCleanupRef.current?.();
    activeCleanupRef.current = null;
    setSelected({ kind, id });

    const pageEl = event.currentTarget.closest("[data-page]") as HTMLElement | null;
    if (!pageEl) return;

    gestureRef.current = {
      kind,
      id,
      mode,
      side,
      pageEl,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: start.xPct,
      startY: start.yPct,
      startW: start.widthPct,
      startH: start.heightPct ?? (start.widthPct * 0.24),
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // pas de capture
    }

    const move = (moveEvent: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || !(moveEvent.buttons & 1)) {
        stop();
        return;
      }
      const rect = gesture.pageEl.getBoundingClientRect();
      const dxPx = moveEvent.clientX - gesture.startClientX;
      const dyPx = moveEvent.clientY - gesture.startClientY;
      if (Math.hypot(dxPx, dyPx) > 4) gesture.moved = true;

      const dxPct = dxPx / rect.width;
      const dyPct = dyPx / rect.height;

      if (gesture.mode === "resize") {
        let widthPct = gesture.startW;
        let heightPct = gesture.startH;

        if (gesture.side === "w" || gesture.side === "e" || gesture.side === "se") {
          const dir = gesture.side === "w" ? -1 : 1;
          widthPct = clampW(gesture.startW + 2 * dxPct * dir);
        }
        if (gesture.side === "s" || gesture.side === "se") {
          heightPct = clampH(gesture.startH + dyPct);
        }

        const geometry: Geometry = {
          page: Number(gesture.pageEl.dataset.page ?? 0),
          xPct: gesture.startX,
          yPct: gesture.startY,
          widthPct,
          heightPct,
        };
        gesture.lastGeometry = geometry;

        if (gesture.kind === "zone") {
          setLocalSigners((prev) =>
            prev.map((s) => (s.id === gesture.id ? { ...s, widthPct, heightPct } : s))
          );
        } else {
          setLocalFields((prev) =>
            prev.map((f) => (f.id === gesture.id ? { ...f, widthPct } : f))
          );
        }
        return;
      }

      const geometry: Geometry = {
        page: Number(gesture.pageEl.dataset.page ?? 0),
        xPct: clampX(gesture.startX + dxPct),
        yPct: clampY(gesture.startY + dyPct),
        widthPct: gesture.startW,
        heightPct: gesture.startH,
      };
      gesture.lastGeometry = geometry;

      if (gesture.kind === "zone") {
        setLocalSigners((prev) =>
          prev.map((s) =>
            s.id === gesture.id
              ? { ...s, page: geometry.page, xPct: geometry.xPct, yPct: geometry.yPct, heightPct: geometry.heightPct }
              : s
          )
        );
      } else {
        setLocalFields((prev) =>
          prev.map((f) =>
            f.id === gesture.id
              ? { ...f, page: geometry.page, xPct: geometry.xPct, yPct: geometry.yPct }
              : f
          )
        );
      }
    };

    const stop = () => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (activeCleanupRef.current === stop) activeCleanupRef.current = null;

      if (!gesture?.lastGeometry) {
        // Clic simple sans déplacement : simple sélection
        return;
      }

      if (gesture.kind === "zone") {
        onMoveZone(gesture.id, gesture.lastGeometry);
      } else {
        onMoveField(gesture.id, gesture.lastGeometry);
      }
    };

    activeCleanupRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function handlePageClick(event: React.MouseEvent<HTMLDivElement>, pageIndex: number) {
    if (!tool) {
      setSelected(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const xPct = clampX((event.clientX - rect.left) / rect.width);
    const yPct = clampY((event.clientY - rect.top) / rect.height);

    if (tool === "signature") {
      if (!selectedSigner) {
        alert("Sélectionnez un signataire pour lui attribuer une zone de signature.");
        return;
      }
      onPlace(selectedSigner.id, pageIndex, xPct, yPct, 0.28, 0.08);
      setTool(null);
    } else if (tool === "pdf_text") {
      setPendingNewText({
        page: pageIndex,
        xPct,
        yPct,
        widthPct: 0.24,
        text: "",
      });
      setTool(null);
    } else {
      if (!selectedSigner) {
        alert("Sélectionnez un signataire pour lui attribuer un champ.");
        return;
      }
      const existing = localFields.filter((f) => f.signerId === selectedSigner.id).length;
      const label = `${TYPE_LABEL[tool]} ${existing + 1}`;
      onAddField(selectedSigner.id, tool, label, [], "", pageIndex, xPct, yPct);
      setTool(null);
    }
  }

  function renderHandles(kind: "zone" | "field", id: string, geometry: Geometry) {
    if (!selected || selected.kind !== kind || selected.id !== id) return null;
    const handles =
      kind === "zone"
        ? RESIZE_HANDLES
        : RESIZE_HANDLES.filter((h) => h.side === "w" || h.side === "e");
    return handles.map((handle) => (
      <div
        key={handle.side}
        onPointerDown={(e) => beginGesture(kind, id, "resize", handle.side, geometry, e)}
        title={handle.label}
        className={`absolute z-20 h-4 w-4 rounded-full border-2 border-white bg-slate-900 shadow-md ${handle.className}`}
      />
    ));
  }

  return (
    <div className="select-none">
      {/* 1. Barre supérieure : Signataires */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Signataire :
          </span>
          {localSigners.map((signer, i) => {
            const color = ZONE_COLORS[i % ZONE_COLORS.length];
            const placed = signer.page !== null;
            const isCurrent = signer.id === selectedId;
            return (
              <button
                key={signer.id}
                type="button"
                onClick={() => setSelectedId(signer.id)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  isCurrent
                    ? `${color.border} ${color.bg} ${color.text} font-semibold ring-2 ring-slate-900/10 shadow-xs`
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${color.solid}`} />
                <span>{signer.name || `Signataire ${i + 1}`}</span>
                <span className="text-[10px] opacity-70">
                  {placed ? "✓ signé" : "(à placer)"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Barre d'outils de placement */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {/* Ajouter du texte directement sur le PDF */}
        <button
          type="button"
          onClick={() => setTool((prev) => (prev === "pdf_text" ? null : "pdf_text"))}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            tool === "pdf_text"
              ? "border-brand-600 bg-brand-600 text-white font-semibold shadow-xs"
              : "border-brand-300 bg-brand-50/60 text-brand-800 hover:bg-brand-100/60"
          }`}
        >
          <span>✍️</span>
          <span>Ajouter du texte</span>
        </button>

        <span className="text-slate-300">|</span>

        {/* Zone de signature */}
        <button
          type="button"
          onClick={() => setTool((prev) => (prev === "signature" ? null : "signature"))}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            tool === "signature"
              ? "border-slate-900 bg-slate-900 text-white shadow-xs"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          <span>🖊️</span>
          <span>Zone de signature</span>
        </button>

        <span className="text-slate-300">|</span>

        {/* Champs interactifs */}
        <span className="text-xs text-slate-400">Champs :</span>
        {FIELD_TOOLS.map((item) => (
          <button
            key={item.type}
            type="button"
            onClick={() => setTool((prev) => (prev === item.type ? null : item.type))}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              tool === item.type
                ? "border-slate-900 bg-slate-900 text-white shadow-xs"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Bannière d'indication contextuelle quand un outil est armé */}
      {tool && (
        <div className="mt-2.5 flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs text-brand-800 animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="text-base">
              {tool === "pdf_text" ? "✍️" : tool === "signature" ? "🖊️" : "📝"}
            </span>
            <span>
              {tool === "pdf_text"
                ? "Cliquez à l'endroit désiré sur le PDF pour inscrire du texte."
                : tool === "signature"
                ? `Cliquez pour placer la signature de ${selectedSigner?.name || "ce signataire"}.`
                : `Cliquez pour placer un champ ${TYPE_LABEL[tool]} pour ${selectedSigner?.name || "le signataire"}.`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setTool(null)}
            className="rounded px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
          >
            ✕ Annuler
          </button>
        </div>
      )}

      {/* 3. Visualiseur PDF interactif */}
      <div
        ref={(el) => {
          if (el && el.clientWidth !== width) setWidth(el.clientWidth);
        }}
        className="mt-3 max-h-[64vh] overflow-auto rounded-xl bg-slate-100 p-4 flex flex-col items-center gap-4"
      >
        {width > 0 && (
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            loading={<div className="py-20 text-sm text-slate-400">Chargement du document…</div>}
            error={<div className="py-20 text-sm text-red-500">Impossible de charger le PDF.</div>}
          >
            {Array.from({ length: numPages }, (_, pageIndex) => (
              <div
                key={pageIndex}
                data-page={pageIndex}
                className="relative mb-4 overflow-hidden rounded border border-slate-300 bg-white shadow-sm last:mb-0"
              >
                <Page
                  pageNumber={pageIndex + 1}
                  width={Math.min(width - 32, 850)}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />

                {/* Zones de signature */}
                {localSigners.map((signer, i) => {
                  if (signer.page !== pageIndex || signer.xPct === null || signer.yPct === null)
                    return null;
                  const zoneColor = ZONE_COLORS[i % ZONE_COLORS.length];
                  const wPct = signer.widthPct ?? 0.26;
                  const hPct = signer.heightPct ?? (wPct * 0.24);
                  const geometry: Geometry = {
                    page: pageIndex,
                    xPct: signer.xPct,
                    yPct: signer.yPct,
                    widthPct: wPct,
                    heightPct: hPct,
                  };
                  const isSelected = selected?.kind === "zone" && selected.id === signer.id;

                  return (
                    <div
                      key={signer.id}
                      onPointerDown={(e) =>
                        beginGesture("zone", signer.id, "move", "e", geometry, e)
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected({ kind: "zone", id: signer.id });
                      }}
                      className={`absolute z-10 ${zoneColor.border} ${
                        isSelected ? "bg-teal-600/20 ring-2 ring-slate-900 shadow-lg" : zoneColor.bg
                      } cursor-move rounded border-2 ${
                        isSelected ? "border-solid" : "border-dashed"
                      } transition-colors overflow-hidden flex flex-col justify-between`}
                      style={{
                        left: `${signer.xPct * 100}%`,
                        top: `${signer.yPct * 100}%`,
                        width: `${wPct * 100}%`,
                        height: `${hPct * 100}%`,
                        transform: "translateX(-50%)",
                        touchAction: "none",
                      }}
                    >
                      {/* Mini barre d'action flottante sur sélection */}
                      {isSelected && (
                        <div
                          className="absolute -top-7 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-0.5 shadow-md text-[11px] whitespace-nowrap"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className={`font-semibold ${zoneColor.text}`}>{signer.name}</span>
                          <span className="text-slate-300">|</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {Math.round(wPct * 100)}% × {Math.round(hPct * 100)}%
                          </span>
                          <span className="text-slate-300">|</span>
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteZone(signer.id);
                              setSelected(null);
                            }}
                            className="text-red-500 hover:text-red-700"
                            title="Supprimer la zone de signature"
                          >
                            <Trash size={12} />
                          </button>
                        </div>
                      )}

                      <span
                        className={`absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${zoneColor.text}`}
                      >
                        {signer.name} — signature
                      </span>

                      {/* Aperçu responsive du contenu de la signature */}
                      <div className="flex h-full w-full flex-col items-center justify-center p-1 pointer-events-none select-none text-center">
                        <span className="font-serif italic text-slate-500/80 text-xs sm:text-sm truncate max-w-full">
                          ✍️ {signer.name}
                        </span>
                        <span className="text-[9px] text-slate-400/80 tracking-tight truncate max-w-full">
                          Zone de signature ({Math.round(wPct * 100)}% × {Math.round(hPct * 100)}%)
                        </span>
                      </div>

                      {isSelected && renderHandles("zone", signer.id, geometry)}
                    </div>
                  );
                })}

                {/* Champs et textes interactifs */}
                {localFields
                  .filter((f) => f.page === pageIndex)
                  .map((field) => {
                    const isPdfText = !field.signerId;
                    const signerIndex = isPdfText
                      ? -1
                      : localSigners.findIndex((s) => s.id === field.signerId);
                    const fieldColor =
                      signerIndex >= 0
                        ? ZONE_COLORS[signerIndex % ZONE_COLORS.length]
                        : ZONE_COLORS[0];

                    const geometry: Geometry = {
                      page: pageIndex,
                      xPct: field.xPct,
                      yPct: field.yPct,
                      widthPct: field.widthPct,
                    };
                    const isSelected = selected?.kind === "field" && selected.id === field.id;
                    const isInline = inlineEditingId === field.id;

                    // 1. TEXTE INTÉGRÉ DIRECTEMENT DANS LE PDF
                    if (isPdfText) {
                      return (
                        <div
                          key={field.id}
                          onPointerDown={(e) => {
                            if (!isInline) beginGesture("field", field.id, "move", "e", geometry, e);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected({ kind: "field", id: field.id });
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            startInlineEdit(field.id, field.presetValue || field.label);
                          }}
                          className={`absolute z-10 rounded px-2 py-0.5 text-xs transition-shadow ${
                            isInline
                              ? "z-30 ring-2 ring-brand-500 bg-white"
                              : isSelected
                              ? "cursor-move border border-solid border-slate-900 bg-white shadow-lg ring-2 ring-slate-900/10"
                              : "cursor-move border border-dashed border-slate-400/80 bg-white/80 hover:bg-white hover:border-slate-600"
                          }`}
                          style={{
                            left: `${field.xPct * 100}%`,
                            top: `${field.yPct * 100}%`,
                            width: `${field.widthPct * 100}%`,
                            minHeight: "24px",
                            transform: "translateX(-50%)",
                            touchAction: "none",
                          }}
                        >
                          {/* Mini barre d'action sur sélection */}
                          {isSelected && !isInline && (
                            <div
                              className="absolute -top-7 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-0.5 shadow-md text-[11px] whitespace-nowrap"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => startInlineEdit(field.id, field.presetValue || field.label)}
                                className="flex items-center gap-1 font-medium text-slate-700 hover:text-brand-600"
                              >
                                <PencilSimple size={12} />
                                <span>Modifier</span>
                              </button>
                              <span className="text-slate-300">|</span>
                              <button
                                type="button"
                                onClick={() => openFieldModal(field)}
                                className="font-medium text-slate-500 hover:text-slate-800"
                              >
                                Paramètres
                              </button>
                              <span className="text-slate-300">|</span>
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteField(field.id);
                                  setSelected(null);
                                }}
                                className="text-red-500 hover:text-red-700"
                                title="Supprimer ce texte"
                              >
                                <Trash size={12} />
                              </button>
                            </div>
                          )}

                          {isInline ? (
                            <input
                              ref={inlineInputRef}
                              type="text"
                              value={inlineValue}
                              onChange={(e) => setInlineValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitInlineEdit();
                                }
                              }}
                              onBlur={commitInlineEdit}
                              placeholder="Écrivez votre texte..."
                              className="w-full bg-transparent font-sans text-[12px] font-medium text-slate-900 outline-none"
                            />
                          ) : (
                            <div className="flex items-center justify-between gap-1 select-none">
                              <span className="truncate font-sans text-[12px] font-medium text-slate-900 leading-snug">
                                {field.presetValue || field.label}
                              </span>
                              <span
                                className="shrink-0 text-[10px] text-slate-400"
                                title="Double-cliquez pour éditer"
                              >
                                ✍️
                              </span>
                            </div>
                          )}

                          {isSelected && !isInline && renderHandles("field", field.id, geometry)}
                        </div>
                      );
                    }

                    // 2. CHAMP INTERACTIF POUR UN SIGNATAIRE
                    return (
                      <div
                        key={field.id}
                        onPointerDown={(e) =>
                          beginGesture("field", field.id, "move", "e", geometry, e)
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected({ kind: "field", id: field.id });
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          openFieldModal(field);
                        }}
                        className={`absolute z-10 ${fieldColor.border} ${fieldColor.bg} cursor-move rounded border border-dashed transition-shadow ${
                          isSelected ? "!border-solid !border-slate-900 shadow-md ring-2 ring-slate-900/10" : ""
                        }`}
                        style={{
                          left: `${field.xPct * 100}%`,
                          top: `${field.yPct * 100}%`,
                          width: `${field.widthPct * 100}%`,
                          height: `${FIELD_HEIGHT_PCT[field.type]}%`,
                          transform: "translateX(-50%)",
                          touchAction: "none",
                        }}
                      >
                        {/* Mini barre d'action sur sélection */}
                        {isSelected && (
                          <div
                            className="absolute -top-7 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-0.5 shadow-md text-[11px] whitespace-nowrap"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="font-semibold text-slate-700">{field.label}</span>
                            <span className="text-slate-300">|</span>
                            <button
                              type="button"
                              onClick={() => openFieldModal(field)}
                              className="flex items-center gap-1 font-medium text-slate-700 hover:text-brand-600"
                            >
                              <PencilSimple size={12} />
                              <span>Modifier</span>
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteField(field.id);
                                setSelected(null);
                              }}
                              className="text-red-500 hover:text-red-700"
                              title="Supprimer ce champ"
                            >
                              <Trash size={12} />
                            </button>
                          </div>
                        )}

                        <span
                          className={`absolute -top-4 left-0 whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-semibold ${fieldColor.text}`}
                        >
                          {field.label}{field.presetValue ? ` = "${field.presetValue}"` : ""}
                        </span>

                        {isSelected && renderHandles("field", field.id, geometry)}
                      </div>
                    );
                  })}

                {/* Zone de saisie directe pour nouveau texte */}
                {pendingNewText && pendingNewText.page === pageIndex && (
                  <div
                    className="absolute z-40 rounded-lg border-2 border-brand-500 bg-white px-2.5 py-1.5 shadow-2xl ring-4 ring-brand-500/20"
                    style={{
                      left: `${pendingNewText.xPct * 100}%`,
                      top: `${pendingNewText.yPct * 100}%`,
                      width: `${pendingNewText.widthPct * 100}%`,
                      minWidth: "200px",
                      transform: "translateX(-50%)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-1.5">
                      <input
                        ref={pendingInputRef}
                        type="text"
                        autoFocus
                        value={pendingNewText.text}
                        onChange={(e) =>
                          setPendingNewText({ ...pendingNewText, text: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitPendingNewText();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelPendingNewText();
                          }
                        }}
                        onBlur={commitPendingNewText}
                        placeholder="Écrivez votre texte ici..."
                        className="w-full bg-transparent font-sans text-xs font-semibold text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400"
                      />
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          commitPendingNewText();
                        }}
                        className="flex items-center gap-0.5 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-brand-700"
                        title="Valider"
                      >
                        <Check size={11} weight="bold" />
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          cancelPendingNewText();
                        }}
                        className="rounded p-0.5 text-slate-400 hover:text-slate-600"
                        title="Annuler"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[9px] text-slate-400 select-none">
                      <span>↵ Entrée pour valider</span>
                      <span>Échap pour annuler</span>
                    </div>
                  </div>
                )}

                {/* Zone de capture cliquable pour placement de nouvel élément */}
                <div
                  role="button"
                  tabIndex={-1}
                  aria-label={`Zone de placement en page ${pageIndex + 1}`}
                  className="absolute inset-0"
                  style={{
                    cursor: tool === "pdf_text" ? "text" : tool ? "crosshair" : "default",
                  }}
                  onClick={(e) => handlePageClick(e, pageIndex)}
                  onDoubleClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const xPct = clampX((e.clientX - rect.left) / rect.width);
                    const yPct = clampY((e.clientY - rect.top) / rect.height);
                    setPendingNewText({
                      page: pageIndex,
                      xPct,
                      yPct,
                      widthPct: 0.24,
                      text: "",
                    });
                    setTool(null);
                  }}
                />
              </div>
            ))}
          </Document>
        )}
      </div>

      {/* 4. Modal épuré pour modifier un champ (remplace window.prompt) */}
      {modalField && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                {modalField.signerId ? "Propriétés du champ" : "Texte intégré au PDF"}
              </h3>
              <button
                type="button"
                onClick={() => setModalField(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  {modalField.signerId ? "Libellé du champ" : "Texte à inscrire"}
                </label>
                <input
                  type="text"
                  value={modalDraft.label}
                  onChange={(e) => setModalDraft({ ...modalDraft, label: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                  autoFocus
                />
              </div>

              {modalField.signerId && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Type de champ</label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {FIELD_TOOLS.map((t) => (
                        <button
                          key={t.type}
                          type="button"
                          onClick={() => setModalDraft({ ...modalDraft, type: t.type })}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                            modalDraft.type === t.type
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Valeur préremplie (optionnel)
                    </label>
                    <input
                      type="text"
                      value={modalDraft.preset}
                      onChange={(e) => setModalDraft({ ...modalDraft, preset: e.target.value })}
                      placeholder="Laisser vide si à remplir par le signataire"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700">Attribution</label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {localSigners.map((s, i) => {
                        const color = ZONE_COLORS[i % ZONE_COLORS.length];
                        const active = modalDraft.signerId === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setModalDraft({ ...modalDraft, signerId: s.id })}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                              active
                                ? `${color.border} ${color.bg} ${color.text} font-semibold shadow-xs`
                                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                            }`}
                          >
                            {s.name}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setModalDraft({ ...modalDraft, signerId: null })}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                          modalDraft.signerId === null
                            ? "border-slate-900 bg-slate-900 text-white font-semibold"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        Texte direct (PDF)
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setModalField(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={saveModalField}
                disabled={!modalDraft.label.trim()}
                className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Accordéon récapitulatif compact */}
      {localFields.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setShowSummary((prev) => !prev)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            <div className="flex items-center gap-2">
              {showSummary ? <CaretDown size={14} /> : <CaretRight size={14} />}
              <span>📋 Éléments et champs placés sur le document ({localFields.length})</span>
            </div>
            <span className="text-[11px] text-slate-400">
              {showSummary ? "Replier" : "Voir la liste"}
            </span>
          </button>

          {showSummary && (
            <div className="border-t border-slate-100 p-3 bg-slate-50/50">
              <div className="grid gap-2 sm:grid-cols-2">
                {localFields.map((f) => {
                  const signer = localSigners.find((s) => s.id === f.signerId);
                  return (
                    <div
                      key={f.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-800 truncate">
                            {f.label}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            (Page {f.page + 1})
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {f.signerId ? `Signataire : ${signer?.name || "Assigné"}` : "✍️ Texte intégré au PDF"}
                          {f.presetValue ? ` • "${f.presetValue}"` : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openFieldModal(f)}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          title="Modifier"
                        >
                          <PencilSimple size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteField(f.id)}
                          className="rounded p-1 text-red-500 hover:bg-red-50"
                          title="Supprimer"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-400">
        <Eraser size={12} className="text-slate-400" />
        Double-cliquez sur un texte pour l'éditer en direct sur le PDF. Cliquez pour déplacer ou utiliser les poignées pour redimensionner.
      </p>
    </div>
  );
}
