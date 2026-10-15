"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Check, Eraser, PencilSimple, Trash } from "@phosphor-icons/react/ssr";

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
};

export type FieldType = "text" | "textarea" | "date" | "number" | "checkbox" | "select";

export type FieldView = {
  id: string;
  signerId: string;
  label: string;
  type: FieldType;
  options: string[];
  presetValue: string;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
};

type Tool = "signature" | FieldType;
type Selection = { kind: "zone" | "field"; id: string } | null;

const ZONE_COLORS = [
  { border: "border-teal-600", bg: "bg-teal-600/10", text: "text-teal-700" },
  { border: "border-amber-500", bg: "bg-amber-500/10", text: "text-amber-600" },
  { border: "border-violet-500", bg: "bg-violet-500/10", text: "text-violet-600" },
  { border: "border-rose-500", bg: "bg-rose-500/10", text: "text-rose-600" },
];

const FIELD_TOOLS: { type: FieldType; label: string }[] = [
  { type: "text", label: "Texte" },
  { type: "textarea", label: "Commentaire" },
  { type: "date", label: "Date" },
  { type: "number", label: "Nombre" },
  { type: "checkbox", label: "Case" },
  { type: "select", label: "Liste" },
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
  checkbox: 2,
  select: 2.6,
};

/** Poignées de largeur, HORS des limites de l'élément (comme dans efawtara) :
 *  saisir l'élément déplace toujours, saisir une poignée redimensionne. */
const WIDTH_HANDLES = [
  { side: "w" as const, className: "-left-2.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
  { side: "e" as const, className: "-right-2.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
];

type Geometry = { page: number; xPct: number; yPct: number; widthPct: number };

type Gesture = {
  kind: "zone" | "field";
  id: string;
  mode: "move" | "resize";
  side: "w" | "e";
  pageEl: HTMLElement;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startW: number;
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
  onPlace: (signerId: string, page: number, xPct: number, yPct: number) => void;
  onAddField: (
    signerId: string,
    type: FieldType,
    label: string,
    options: string[],
    presetValue: string,
    page: number,
    xPct: number,
    yPct: number
  ) => void;
  onDeleteField: (fieldId: string) => void;
  onReassignField: (fieldId: string, signerId: string) => void;
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
  /** Outil armé ; revenu à null après chaque placement (un ajout par sélection d'outil). */
  const [tool, setTool] = useState<Tool | null>("signature");
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldPreset, setFieldPreset] = useState("");
  const [fieldOptions, setFieldOptions] = useState("");
  const [selected, setSelected] = useState<Selection>(null);

  // Copies locales : gestes de drag/resize fluides, synchronisées avec les props serveur.
  const [localSigners, setLocalSigners] = useState<ZoneSigner[]>(signers);
  const [localFields, setLocalFields] = useState<FieldView[]>(fields);
  useEffect(() => setLocalSigners(signers), [signers]);
  useEffect(() => setLocalFields(fields), [fields]);

  const gestureRef = useRef<Gesture | null>(null);
  /** Stop du geste actif : un nouveau pointerdown annule toujours le précédent. */
  const activeCleanupRef = useRef<(() => void) | null>(null);
  /** Menu contextuel d'attribution : { champ, position écran }. */
  const [menu, setMenu] = useState<{ fieldId: string; x: number; y: number } | null>(null);
  /** Édition complète d'un champ (libellé, type, options, préremplissage). */
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    label: string;
    type: FieldType;
    options: string;
    preset: string;
  } | null>(null);

  function startEditField(fieldId: string) {
    const field = localFields.find((f) => f.id === fieldId);
    if (!field) return;
    setEditingFieldId(fieldId);
    setEditDraft({
      label: field.label,
      type: field.type,
      options: field.options.join(", "),
      preset: field.presetValue,
    });
    setMenu(null);
  }

  function renameFieldPrompt(fieldId: string) {
    const field = localFields.find((f) => f.id === fieldId);
    if (!field) return;
    const next = prompt(`Nouveau libellé du champ :`, field.label);
    if (next === null) return;
    const label = next.trim();
    if (!label || label === field.label) return;
    onRenameField(fieldId, label);
    setMenu(null);
  }

  function saveEditField(fieldId: string) {
    if (!editDraft || !editDraft.label.trim()) return;
    const options =
      editDraft.type === "select"
        ? editDraft.options
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : [];
    onUpdateField(fieldId, {
      label: editDraft.label.trim(),
      type: editDraft.type,
      options,
      presetValue: editDraft.preset.trim(),
    });
    setEditingFieldId(null);
    setEditDraft(null);
  }

  const selectedSigner =
    localSigners.find((s) => s.id === selectedId) ?? localSigners[0];
  const selectedSignerIndex = localSigners.findIndex((s) => s.id === selectedSigner?.id);

  function clampX(v: number) {
    return Math.min(0.97, Math.max(0.03, v));
  }
  function clampY(v: number) {
    return Math.min(0.97, Math.max(0.03, v));
  }
  function clampW(v: number) {
    return Math.min(0.6, Math.max(0.08, v));
  }

  function beginGesture(
    kind: "zone" | "field",
    id: string,
    mode: "move" | "resize",
    side: "w" | "e",
    start: Geometry,
    event: GestureEvent
  ) {
    event.stopPropagation();
    event.preventDefault();
    activeCleanupRef.current?.();
    activeCleanupRef.current = null;
    setMenu(null);
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
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // pointeur sans capture : le geste reste géré par les listeners fenêtre
    }

    const move = (moveEvent: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      // Garde-fou anti-listener zombie : bouton relâché = fin du geste
      if (!(moveEvent.buttons & 1)) {
        stop();
        return;
      }
      const rect = gesture.pageEl.getBoundingClientRect();
      const dxPx = moveEvent.clientX - gesture.startClientX;
      const dyPx = moveEvent.clientY - gesture.startClientY;
      if (Math.hypot(dxPx, dyPx) > 4) gesture.moved = true;
      const dxPct = dxPx / rect.width;
      if (gesture.mode === "resize") {
        const dir = gesture.side === "w" ? -1 : 1;
        const widthPct = clampW(gesture.startW + 2 * dxPct * dir);
        gesture.lastGeometry = {
          page: Number(gesture.pageEl.dataset.page ?? 0),
          xPct: gesture.startX,
          yPct: gesture.startY,
          widthPct,
        };
        if (gesture.kind === "zone") {
          setLocalSigners((prev) =>
            prev.map((s) => (s.id === gesture.id ? { ...s, widthPct } : s))
          );
        } else {
          setLocalFields((prev) =>
            prev.map((f) => (f.id === gesture.id ? { ...f, widthPct } : f))
          );
        }
        return;
      }
      const dyPct = (moveEvent.clientY - gesture.startClientY) / rect.height;
      const geometry: Geometry = {
        page: Number(gesture.pageEl.dataset.page ?? 0),
        xPct: clampX(gesture.startX + dxPct),
        yPct: clampY(gesture.startY + dyPct),
        widthPct: gesture.startW,
      };
      gesture.lastGeometry = geometry;
      if (gesture.kind === "zone") {
        setLocalSigners((prev) =>
          prev.map((s) =>
            s.id === gesture.id
              ? { ...s, page: geometry.page, xPct: geometry.xPct, yPct: geometry.yPct }
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

    const stop = (upEvent?: PointerEvent) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (activeCleanupRef.current === stop) activeCleanupRef.current = null;
      if (!gesture?.lastGeometry) {
        // Clic sans déplacement sur un champ → menu contextuel d'attribution
        if (gesture && gesture.kind === "field" && gesture.mode === "move") {
          setSelected({ kind: "field", id: gesture.id });
          setMenu({ fieldId: gesture.id, x: upEvent?.clientX ?? 0, y: upEvent?.clientY ?? 0 });
        }
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

  // Échap = désélectionner
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handlePageClick(event: React.MouseEvent<HTMLDivElement>, pageIndex: number) {
    if (!tool || !selectedSigner) {
      setSelected(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const xPct = clampX((event.clientX - rect.left) / rect.width);
    const yPct = clampY((event.clientY - rect.top) / rect.height);

    if (tool === "signature") {
      onPlace(selectedSigner.id, pageIndex, xPct, yPct);
    } else {
      const existing = localFields.filter((f) => f.signerId === selectedSigner.id).length;
      const label = fieldLabel.trim() || `${TYPE_LABEL[tool]} ${existing + 1}`;
      const options =
        tool === "select"
          ? fieldOptions
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : [];
      onAddField(selectedSigner.id, tool, label, options, fieldPreset.trim(), pageIndex, xPct, yPct);
    }
    setFieldLabel("");
    setFieldPreset("");
    setTool(null); // un ajout par sélection d'outil
  }

  const selectedFields = localFields.filter((f) => f.signerId === selectedId);

  function renderHandles(kind: "zone" | "field", id: string, geometry: Geometry) {
    if (!selected || selected.kind !== kind || selected.id !== id) return null;
    return WIDTH_HANDLES.map((handle) => (
      <div
        key={handle.side}
        onPointerDown={(e) => beginGesture(kind, id, "resize", handle.side, geometry, e)}
        className={`absolute z-20 h-4 w-4 rounded-full border-2 border-white bg-slate-900 shadow ${handle.className}`}
      />
    ));
  }

  return (
    <div>
      {/* Sélecteur de signataire */}
      <div className="flex flex-wrap gap-2">
        {localSigners.map((signer, i) => {
          const color = ZONE_COLORS[i % ZONE_COLORS.length];
          const placed = signer.page !== null;
          return (
            <button
              key={signer.id}
              type="button"
              onClick={() => setSelectedId(signer.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                signer.id === selectedId
                  ? `${color.border} ${color.bg} ${color.text} font-semibold`
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {signer.name || `Signataire ${i + 1}`}
              <span className="ml-2 text-xs font-normal">
                {placed ? "✓ signature placée" : "— à placer"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Outil armé */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTool((prev) => (prev === "signature" ? null : "signature"))}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            tool === "signature"
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-600 hover:text-slate-900"
          }`}
        >
          Zone de signature
        </button>
        <span className="text-xs text-slate-300">|</span>
        {FIELD_TOOLS.map((item) => (
          <button
            key={item.type}
            type="button"
            onClick={() => setTool((prev) => (prev === item.type ? null : item.type))}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              tool === item.type
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:text-slate-900"
            }`}
          >
            {item.label}
          </button>
        ))}
        {tool && tool !== "signature" && (
          <input
            value={fieldLabel}
            onChange={(e) => setFieldLabel(e.target.value)}
            placeholder={`Libellé (défaut : ${TYPE_LABEL[tool]} ${
              localFields.filter((f) => f.signerId === selectedId).length + 1
            })`}
            className="w-52 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-brand-600"
          />
        )}
        {tool && tool !== "signature" && tool !== "checkbox" && (
          <input
            value={fieldPreset}
            onChange={(e) => setFieldPreset(e.target.value)}
            placeholder="Valeur préremplie (optionnel)"
            className="w-52 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-brand-600"
          />
        )}
        {tool === "select" && (
          <input
            value={fieldOptions}
            onChange={(e) => setFieldOptions(e.target.value)}
            placeholder="Options séparées par des virgules"
            className="w-56 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-brand-600"
          />
        )}
        {tool === null && (
          <span className="text-xs text-slate-400">
            Cliquez sur un élément pour le déplacer / redimensionner
          </span>
        )}
      </div>

      {/* PDF + éléments */}
      <div
        ref={(el) => {
          if (el && el.clientWidth !== width) setWidth(el.clientWidth);
        }}
        className="mt-3 max-h-[62vh] overflow-auto rounded-xl bg-slate-100 p-4 flex flex-col items-center gap-4"
      >
        {width > 0 && (
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            loading={<div className="py-20 text-sm text-slate-400">Chargement du PDF…</div>}
            error={<div className="py-20 text-sm text-red-500">PDF illisible.</div>}
          >
            {Array.from({ length: numPages }, (_, pageIndex) => {
              const color = ZONE_COLORS[selectedSignerIndex % ZONE_COLORS.length];
              return (
                <div
                  key={pageIndex}
                  data-page={pageIndex}
                  className="relative mb-4 overflow-hidden rounded-sm border border-slate-200 last:mb-0"
                >
                  <Page
                    pageNumber={pageIndex + 1}
                    width={Math.min(width - 32, 850)}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />

                  {/* Zones de signature (tous signataires) */}
                  {localSigners.map((signer, i) => {
                    if (signer.page !== pageIndex || signer.xPct === null || signer.yPct === null)
                      return null;
                    const zoneColor = ZONE_COLORS[i % ZONE_COLORS.length];
                    const wPct = signer.widthPct ?? 0.26;
                    const geometry: Geometry = {
                      page: pageIndex,
                      xPct: signer.xPct,
                      yPct: signer.yPct,
                      widthPct: wPct,
                    };
                    const isSelected =
                      selected?.kind === "zone" && selected.id === signer.id;
                    return (
                      <div
                        key={signer.id}
                        onPointerDown={(e) =>
                          beginGesture("zone", signer.id, "move", "e", geometry, e)
                        }
                        onClick={(e) => e.stopPropagation()}
                        className={`absolute z-10 ${zoneColor.border} ${
                          isSelected ? "bg-teal-600/20" : zoneColor.bg
                        } cursor-move rounded-md border-2 ${
                          isSelected ? "border-solid border-slate-900" : "border-dashed"
                        }`}
                        style={{
                          left: `${signer.xPct * 100}%`,
                          top: `${signer.yPct * 100}%`,
                          width: `${wPct * 100}%`,
                          height: `${wPct * 23.6}%`,
                          transform: "translateX(-50%)",
                          touchAction: "none",
                        }}
                      >
                        <span
                          className={`absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${zoneColor.text}`}
                        >
                          {signer.name} — signature
                        </span>
                        <button
                          type="button"
                          title="Supprimer la zone de signature"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteZone(signer.id);
                            setSelected(null);
                          }}
                          className="absolute -top-2.5 -right-2.5 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-red-600 text-white opacity-75 shadow transition hover:opacity-100"
                        >
                          <Trash size={10} />
                        </button>
                        {isSelected &&
                          renderHandles("zone", signer.id, geometry)}
                      </div>
                    );
                  })}

                  {/* Champs (du signataire sélectionné) */}
                  {localFields
                    .filter((f) => f.signerId === selectedId && f.page === pageIndex)
                    .map((field) => {
                      const geometry: Geometry = {
                        page: pageIndex,
                        xPct: field.xPct,
                        yPct: field.yPct,
                        widthPct: field.widthPct,
                      };
                      const isSelected =
                        selected?.kind === "field" && selected.id === field.id;
                      return (
                        <div
                          key={field.id}
                          onPointerDown={(e) =>
                            beginGesture("field", field.id, "move", "e", geometry, e)
                          }
                          onClick={(e) => e.stopPropagation()}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelected({ kind: "field", id: field.id });
                            setMenu({ fieldId: field.id, x: e.clientX, y: e.clientY });
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            const next = prompt(`Nouveau libellé du champ :`, field.label);
                            if (next === null) return;
                            const label = next.trim();
                            if (label && label !== field.label) onRenameField(field.id, label);
                          }}
                          className={`absolute z-10 ${color.border} ${color.bg} cursor-move rounded border border-dashed`}
                          style={{
                            left: `${field.xPct * 100}%`,
                            top: `${field.yPct * 100}%`,
                            width: `${field.widthPct * 100}%`,
                            height: `${FIELD_HEIGHT_PCT[field.type]}%`,
                            transform: "translateX(-50%)",
                            touchAction: "none",
                          }}
                        >
                          <span
                            className={`absolute -top-4 left-0 whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-semibold ${color.text}`}
                          >
                            {field.label}
                          </span>
                          <button
                            type="button"
                            title="Supprimer le champ"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteField(field.id);
                              setSelected(null);
                            }}
                            className="absolute -top-2.5 -right-2.5 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-red-600 text-white opacity-75 shadow transition hover:opacity-100"
                          >
                            <Trash size={10} />
                          </button>
                          {isSelected && renderHandles("field", field.id, geometry)}
                        </div>
                      );
                    })}

                  {/* Zone de capture : placement (outil armé) ou désélection */}
                  <div
                    role="button"
                    aria-label={`Zone de placement en page ${pageIndex + 1}`}
                    className="absolute inset-0"
                    style={{ cursor: tool ? "crosshair" : "default" }}
                    onClick={(e) => handlePageClick(e, pageIndex)}
                  />
                </div>
              );
            })}
          </Document>
        )}
      </div>

      {/* Champs placés (tous signataires) */}
      {localFields.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Champs placés
          </p>
          <ul className="mt-2 space-y-1.5">
            {localFields.map((field) => {
              const signerIndex = localSigners.findIndex((s) => s.id === field.signerId);
              const signer = localSigners[signerIndex];
              return (
                <li key={field.id} className="text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-slate-600">
                      <span
                        className={`font-semibold ${
                          ZONE_COLORS[signerIndex % ZONE_COLORS.length].text
                        }`}
                      >
                        {signer?.name ?? "?"}
                      </span>{" "}
                      — {field.label}{" "}
                      <span className="text-slate-400">
                        ({TYPE_LABEL[field.type]}
                        {field.type === "select" ? ` : ${field.options.join(", ")}` : ""} · page{" "}
                        {field.page + 1}
                        {field.presetValue ? ` · prérempli : ${field.presetValue}` : ""})
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <select
                        value={field.signerId}
                        onChange={(e) => onReassignField(field.id, e.target.value)}
                        title="Réassigner à un autre signataire"
                        className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 outline-none focus:border-brand-600"
                      >
                        {localSigners.map((s, si) => (
                          <option key={s.id} value={s.id}>
                            {s.name || `Signataire ${si + 1}`}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => startEditField(field.id)}
                        title="Modifier le champ (libellé, type, préremplissage)"
                        className={`rounded-md p-1 transition ${
                          editingFieldId === field.id
                            ? "bg-slate-900 text-white"
                            : "text-slate-300 hover:bg-white hover:text-slate-700"
                        }`}
                      >
                        <PencilSimple size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteField(field.id);
                          setEditingFieldId((cur) => (cur === field.id ? null : cur));
                        }}
                        title="Supprimer le champ"
                        className="rounded-md p-1 text-slate-300 transition hover:bg-white hover:text-red-600"
                      >
                        <Trash size={13} />
                      </button>
                    </span>
                  </div>

                  {editingFieldId === field.id && editDraft && (
                    <div className="mt-2 grid gap-2.5 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
                      <label className="text-xs text-slate-500 sm:col-span-2">
                        Libellé
                        <input
                          value={editDraft.label}
                          onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-600"
                        />
                      </label>
                      <label className="text-xs text-slate-500">
                        Type
                        <select
                          value={editDraft.type}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, type: e.target.value as FieldType })
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-600"
                        >
                          {FIELD_TOOLS.map((t) => (
                            <option key={t.type} value={t.type}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {editDraft.type === "select" ? (
                        <label className="text-xs text-slate-500">
                          Options (séparées par des virgules)
                          <input
                            value={editDraft.options}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, options: e.target.value })
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-600"
                          />
                        </label>
                      ) : editDraft.type === "checkbox" ? null : (
                        <label className="text-xs text-slate-500">
                          Valeur préremplie (optionnel)
                          <input
                            value={editDraft.preset}
                            onChange={(e) => setEditDraft({ ...editDraft, preset: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-600"
                          />
                        </label>
                      )}
                      <div className="flex items-center justify-end gap-2 sm:col-span-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFieldId(null);
                            setEditDraft(null);
                          }}
                          className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800"
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEditField(field.id)}
                          disabled={!editDraft.label.trim()}
                          className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
                        >
                          Enregistrer
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Menu contextuel d'attribution d'un champ */}
      {menu &&
        (() => {
          const field = localFields.find((f) => f.id === menu.fieldId);
          if (!field) return null;
          const menuW = 230;
          const menuH = localSigners.length * 42 + 172;
          const left = Math.min(menu.x, window.innerWidth - menuW - 10);
          const top = Math.min(menu.y, window.innerHeight - menuH - 10);
          return (
            <>
              <div
                className="fixed inset-0 z-40"
                onPointerDown={() => setMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu(null);
                }}
              />
              <div
                className="fixed z-50 w-[230px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg"
                style={{ left, top }}
              >
                <div className="flex w-full items-center gap-2.5 px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <span className="truncate">{field.label}</span>
                  <span className="shrink-0 text-slate-300">·</span>
                  <span className="shrink-0 normal-case text-slate-300">
                    {TYPE_LABEL[field.type]}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => renameFieldPrompt(field.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  <PencilSimple size={14} className="text-slate-400" /> Renommer
                </button>
                <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                  Attribuer à
                </div>
                {localSigners.map((signer, i) => {
                  const current = field.signerId === signer.id;
                  return (
                    <button
                      key={signer.id}
                      type="button"
                      onClick={() => {
                        onReassignField(field.id, signer.id);
                        setMenu(null);
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition hover:bg-slate-50 ${
                        current ? "bg-brand-50/60" : ""
                      }`}
                    >
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                          ZONE_COLORS[i % ZONE_COLORS.length].border.replace("border-", "bg-")
                        }`}
                      />
                      <span className="truncate font-medium text-slate-700">{signer.name}</span>
                      {current && (
                        <Check size={14} className="ml-auto shrink-0 text-brand-700" weight="bold" />
                      )}
                    </button>
                  );
                })}
                <div className="my-1 border-t border-slate-100" />
                <button
                  type="button"
                  onClick={() => {
                    const next = prompt(
                      `Valeur préremplie pour « ${field.label} » (vide = laisser au signataire) :`,
                      field.presetValue
                    );
                    if (next === null) return;
                    onPresetField(field.id, next.trim());
                    setMenu(null);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                >
                  <PencilSimple size={14} className="text-slate-400" />
                  {field.presetValue ? "Modifier la valeur préremplie" : "Préremplir la valeur"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteField(field.id);
                    setMenu(null);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-600 transition hover:bg-red-50"
                >
                  <Trash size={14} /> Supprimer le champ
                </button>
              </div>
            </>
          );
        })()}

      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
        <Eraser size={12} className="text-slate-400" />
        Choisissez un outil puis cliquez (un placement par outil). Cliquez sur un élément pour le
        déplacer, les poignées latérales pour redimensionner, et cliquez sur un champ (ou clic
        droit) pour lui choisir un signataire.
      </p>
    </div>
  );
}
