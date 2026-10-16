"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowCounterClockwise,
  ArrowsIn,
  ArrowsOut,
  Check,
  DeviceMobile,
  Eraser,
  Keyboard,
  Pen,
  Sparkle,
  X,
} from "@phosphor-icons/react/ssr";
import SignaturePadLib from "signature_pad";
import { SIGNATURE_STYLES } from "@/lib/fonts";

const INK_COLORS = [
  { id: "navy", label: "Bleu nuit", hex: "#1e3a8a", bg: "bg-blue-900" },
  { id: "black", label: "Noir profond", hex: "#0f172a", bg: "bg-slate-900" },
  { id: "royal", label: "Bleu royal", hex: "#0284c7", bg: "bg-sky-600" },
] as const;

export default function SignaturePad({
  ref,
  name,
  consent,
  loading,
  onConsentChange,
  blockSubmit = false,
  onInkChange,
  onSubmit,
}: {
  ref?: React.Ref<{ submit: () => void }>;
  name: string;
  consent: boolean;
  loading: boolean;
  onConsentChange?: (consent: boolean) => void;
  blockSubmit?: boolean;
  onInkChange?: (hasInk: boolean) => void;
  onSubmit: (dataUrl: string) => void;
}) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typedName, setTypedName] = useState(name || "");
  const [selectedStyleId, setSelectedStyleId] = useState<string>("caveat");
  const [penColor, setPenColor] = useState<string>("#1e3a8a");
  const [hasInk, setHasInk] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padInstanceRef = useRef<SignaturePadLib | null>(null);
  const savedStrokesRef = useRef<ReturnType<SignaturePadLib["toData"]>>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Synchronise typedName si le nom change depuis l'extérieur
  useEffect(() => {
    if (name && !typedName) setTypedName(name);
  }, [name, typedName]);

  // Initialisation et mise à l'échelle Retina du canvas
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Sauvegarde des traits existants avant redimensionnement
    let currentData = savedStrokesRef.current;
    if (padInstanceRef.current && !padInstanceRef.current.isEmpty()) {
      currentData = padInstanceRef.current.toData();
      savedStrokesRef.current = currentData;
    }

    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(ratio, ratio);

    if (!padInstanceRef.current) {
      const pad = new SignaturePadLib(canvas, {
        minWidth: 1.2,
        maxWidth: 3.6,
        throttle: 16,
        velocityFilterWeight: 0.7,
        penColor: penColor,
        backgroundColor: "rgba(255, 255, 255, 0)", // Transparent pour signature propre
      });

      pad.addEventListener("endStroke", () => {
        const empty = pad.isEmpty();
        setHasInk(!empty);
        onInkChange?.(!empty);
        savedStrokesRef.current = pad.toData();
      });

      padInstanceRef.current = pad;
    } else {
      padInstanceRef.current.penColor = penColor;
    }

    if (mode === "draw") {
      padInstanceRef.current.clear();
      if (currentData && currentData.length > 0) {
        padInstanceRef.current.fromData(currentData);
        setHasInk(true);
        onInkChange?.(true);
      }
    } else {
      renderTypedToCanvas(typedName, selectedStyleId, penColor);
    }
  }, [mode, penColor, selectedStyleId, typedName, onInkChange]);

  // Rendu de la signature tapée sur le canvas
  const renderTypedToCanvas = useCallback(
    (text: string, styleId: string, color: string) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;

      ctx.clearRect(0, 0, width, height);
      if (!text.trim()) {
        setHasInk(false);
        onInkChange?.(false);
        return;
      }

      const styleObj = SIGNATURE_STYLES.find((s) => s.id === styleId) || SIGNATURE_STYLES[0];
      const fontDeclaration = `italic ${Math.min(52, Math.max(26, width / (text.length * 0.5)))}px ${styleObj.cssFamily}`;

      ctx.save();
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = fontDeclaration;
      ctx.fillText(text.trim(), width / 2, height / 2);
      ctx.restore();

      setHasInk(true);
      onInkChange?.(true);
    },
    [onInkChange]
  );

  // Redimensionnement réactif (rotation d'écran, ouverture plein écran)
  useEffect(() => {
    const timer = setTimeout(() => setupCanvas(), 50);
    const onResize = () => setupCanvas();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [setupCanvas, expanded, mode]);

  // Mise à jour de la couleur d'encre
  function changePenColor(hex: string) {
    setPenColor(hex);
    if (padInstanceRef.current) {
      padInstanceRef.current.penColor = hex;
    }
    if (mode === "type") {
      renderTypedToCanvas(typedName, selectedStyleId, hex);
    }
  }

  // Annuler le dernier trait (Undo)
  function handleUndo() {
    if (mode !== "draw" || !padInstanceRef.current) return;
    const data = padInstanceRef.current.toData();
    if (data.length > 0) {
      data.pop();
      padInstanceRef.current.fromData(data);
      savedStrokesRef.current = data;
      const empty = padInstanceRef.current.isEmpty();
      setHasInk(!empty);
      onInkChange?.(!empty);
    }
  }

  // Effacer tout
  function handleClear() {
    if (mode === "draw") {
      padInstanceRef.current?.clear();
      savedStrokesRef.current = [];
    } else {
      setTypedName("");
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        ctx?.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
      }
    }
    setHasInk(false);
    onInkChange?.(false);
  }

  // Sélection d'un style typographique
  function selectStyle(styleId: string) {
    setSelectedStyleId(styleId);
    renderTypedToCanvas(typedName, styleId, penColor);
  }

  // Fermeture / Plein écran
  function openModal() {
    if (padInstanceRef.current && !padInstanceRef.current.isEmpty()) {
      savedStrokesRef.current = padInstanceRef.current.toData();
    }
    setExpanded(true);
  }

  function closeModal() {
    if (padInstanceRef.current && !padInstanceRef.current.isEmpty()) {
      savedStrokesRef.current = padInstanceRef.current.toData();
    }
    setExpanded(false);
  }

  // Gestion touche Échap
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Empêche le défilement d'arrière-plan en mode modal
  useEffect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
    };
  }, [expanded]);

  // Validation / export de la signature
  function submit() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    if (expanded) closeModal();
    onSubmit(canvas.toDataURL("image/png"));
  }

  useEffect(() => {
    if (ref && typeof ref === "object") {
      ref.current = { submit };
    }
  });

  const submitDisabled =
    loading || !consent || !name.trim() || !hasInk || blockSubmit;

  // Rendu de l'onglet Dessiner vs Taper
  const contentBody = (
    <div className="flex flex-col gap-4">
      {mode === "type" ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Votre nom ou prénom</label>
            <input
              type="text"
              value={typedName}
              onChange={(e) => {
                setTypedName(e.target.value);
                renderTypedToCanvas(e.target.value, selectedStyleId, penColor);
              }}
              placeholder="Tapez votre nom…"
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-1 focus:ring-slate-900/20"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-700">Choisissez votre style :</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {SIGNATURE_STYLES.map((st) => {
                const isSelected = selectedStyleId === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => selectStyle(st.id)}
                    className={`group relative flex flex-col items-center justify-center rounded-2xl border p-3 text-center transition ${
                      isSelected
                        ? "border-slate-900 bg-slate-900/5 shadow-xs ring-1 ring-slate-900"
                        : "border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className="truncate text-xl transition group-hover:scale-105"
                      style={{ fontFamily: st.cssFamily, color: penColor }}
                    >
                      {typedName.trim() || "Signature"}
                    </span>
                    <span className="mt-1 text-[11px] font-medium text-slate-500">{st.label}</span>
                    {isSelected && (
                      <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-white">
                        <Check size={10} weight="bold" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* Zone Canvas */}
      <div className="relative">
        <div
          className={`relative w-full rounded-2xl border-2 border-slate-200 bg-white transition-shadow focus-within:border-slate-900 focus-within:shadow-md ${
            expanded ? "h-64 sm:h-72" : "h-44 sm:h-48"
          }`}
        >
          {/* Ligne repère sous le canvas */}
          <div className="pointer-events-none absolute inset-x-6 bottom-7 z-0 flex items-end gap-2">
            <span className="select-none text-base font-semibold leading-none text-slate-300">✕</span>
            <span className="mb-[2px] h-[1.5px] flex-1 bg-slate-200" />
          </div>

          {/* Indication visuelle si vide */}
          {!hasInk && mode === "draw" && (
            <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center text-xs font-medium text-slate-400 select-none">
              Signez ici avec votre doigt, stylet ou souris
            </div>
          )}

          <canvas
            ref={canvasRef}
            className="relative z-10 h-full w-full touch-none select-none rounded-2xl cursor-crosshair"
            style={{ backgroundColor: "#ffffff" }}
          />
        </div>

        {/* Barre d'outils sous le canvas */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Choix des encres */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-400 mr-1">Encre :</span>
            {INK_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => changePenColor(c.hex)}
                title={c.label}
                className={`flex h-6 w-6 items-center justify-center rounded-full transition ${c.bg} ${
                  penColor === c.hex ? "ring-2 ring-offset-2 ring-slate-900 scale-110" : "opacity-80 hover:opacity-100"
                }`}
              >
                {penColor === c.hex && <Check size={11} weight="bold" className="text-white" />}
              </button>
            ))}
          </div>

          {/* Actions d'effacement */}
          <div className="flex items-center gap-1.5">
            {mode === "draw" && (
              <button
                type="button"
                onClick={handleUndo}
                disabled={!hasInk}
                title="Annuler le dernier trait"
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                <ArrowCounterClockwise size={13} />
                <span>Annuler</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleClear}
              disabled={!hasInk}
              title="Effacer la signature"
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              <Eraser size={13} />
              <span>Effacer</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Vue modale pleine écran (Dialog modal responsive centré)
  if (expanded && mounted && typeof document !== "undefined") {
    return createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
        {/* Backdrop sombre flouté */}
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
          aria-hidden="true"
          onClick={closeModal}
        />

        {/* Boîte de dialogue Signature (Pure White Card) */}
        <div
          data-signature-pad="modal"
          className="relative z-10 flex w-full max-w-2xl flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150"
          style={{ backgroundColor: "#ffffff" }}
        >
          {/* Header de la modale */}
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0 bg-white">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-900">
                <Pen size={16} weight="bold" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Créer votre signature</h3>
                <p className="text-[11px] text-slate-400">Dessinez au doigt ou choisissez un style manuscrit</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Onglets Dessiner / Taper */}
              <div className="flex rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setMode("draw")}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    mode === "draw" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  <Pen size={13} /> Dessiner
                </button>
                <button
                  type="button"
                  onClick={() => setMode("type")}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    mode === "type" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  <Keyboard size={13} /> Taper
                </button>
              </div>

              <button
                type="button"
                onClick={closeModal}
                title="Fermer (Échap)"
                className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={16} weight="bold" />
              </button>
            </div>
          </div>

          {/* Corps de la modale */}
          <div className="p-5 sm:p-6 bg-slate-50/50 overflow-y-auto">
            {contentBody}

            {/* Note mobile discrète */}
            <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
              <DeviceMobile size={13} className="text-slate-400" />
              <span>Sur smartphone, tournez votre appareil en paysage pour un espace de dessin élargi.</span>
            </div>
          </div>

          {/* Footer d'action */}
          <div className="flex flex-col gap-3 border-t border-slate-100 bg-white px-5 py-4 shrink-0 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-start gap-2 text-xs leading-snug text-slate-600 select-none">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => onConsentChange?.(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-slate-900 rounded"
              />
              <span>
                Je confirme que cette signature électronique m&apos;engage légalement sur ce document.
              </span>
            </label>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitDisabled}
                className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? "Signature en cours…" : "Valider la signature"}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // Vue compacte (dans la barre latérale du document)
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-white">
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          <button
            type="button"
            onClick={() => setMode("draw")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              mode === "draw" ? "bg-white text-slate-900 shadow-xs font-semibold" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Pen size={12} /> Dessiner
          </button>
          <button
            type="button"
            onClick={() => setMode("type")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              mode === "type" ? "bg-white text-slate-900 shadow-xs font-semibold" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Keyboard size={12} /> Taper
          </button>
        </div>

        <button
          type="button"
          onClick={openModal}
          title="Signer en grand format"
          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-slate-900 shadow-2xs"
        >
          <ArrowsOut size={13} />
          <span>Plein écran</span>
        </button>
      </div>

      <div className="p-4 bg-white">{contentBody}</div>
    </div>
  );
}
