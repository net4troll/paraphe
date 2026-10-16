"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowCounterClockwise,
  ArrowsOut,
  Check,
  DeviceMobile,
  Eraser,
  Keyboard,
  Pen,
  Sparkle,
  Trash,
  X,
} from "@phosphor-icons/react/ssr";
import SignaturePadLib from "signature_pad";
import { SIGNATURE_STYLES } from "@/lib/fonts";

const INK_COLORS = [
  { id: "navy", label: "Bleu nuit (juridique)", hex: "#1e3a8a", bg: "bg-blue-900" },
  { id: "black", label: "Noir formel", hex: "#0f172a", bg: "bg-slate-900" },
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typedName, setTypedName] = useState(name || "");
  const [selectedStyleId, setSelectedStyleId] = useState<string>("caveat");
  const [penColor, setPenColor] = useState<string>("#1e3a8a");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [mounted, setMounted] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const savedStrokesRef = useRef<ReturnType<SignaturePadLib["toData"]>>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Synchronise le nom si mis à jour depuis le parent
  useEffect(() => {
    if (name && !typedName) {
      setTypedName(name);
    }
  }, [name, typedName]);

function trimSignatureCanvas(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.toDataURL("image/png");

  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  let hasInk = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 15) {
        hasInk = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!hasInk || maxX <= minX || maxY <= minY) {
    return canvas.toDataURL("image/png");
  }

  const pad = 16;
  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropW = Math.min(width - cropX, maxX - minX + 1 + pad * 2);
  const cropH = Math.min(height - cropY, maxY - minY + 1 + pad * 2);

  const cropped = document.createElement("canvas");
  cropped.width = cropW;
  cropped.height = cropH;
  const croppedCtx = cropped.getContext("2d");
  if (!croppedCtx) return canvas.toDataURL("image/png");

  croppedCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return cropped.toDataURL("image/png");
}

  // Génération PNG pour le mode "Taper"
  const renderTypedToDataUrl = useCallback(
    (text: string, styleId: string, color: string): string => {
      if (typeof document === "undefined" || !text.trim()) return "";
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 300;
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";

      const styleObj = SIGNATURE_STYLES.find((s) => s.id === styleId) || SIGNATURE_STYLES[0];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const textLen = Math.max(text.trim().length, 1);
      const fontSize = Math.min(68, Math.max(30, Math.floor(820 / (textLen * 0.45))));
      ctx.font = `italic ${fontSize}px ${styleObj.cssFamily}`;
      ctx.fillText(text.trim(), canvas.width / 2, canvas.height / 2);
      ctx.restore();

      return trimSignatureCanvas(canvas);
    },
    []
  );

  // Initialisation du SignaturePad lors de l'ouverture de la modale en mode dessin
  useEffect(() => {
    if (!isModalOpen || mode !== "draw") return;

    let padInstance: SignaturePadLib | null = null;
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      if (width === 0 || height === 0) return;

      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(ratio, ratio);

      padInstance = new SignaturePadLib(canvas, {
        minWidth: 1.2,
        maxWidth: 3.6,
        penColor: penColor,
        throttle: 16,
        velocityFilterWeight: 0.7,
        backgroundColor: "rgba(0,0,0,0)",
      });

      padInstance.addEventListener("endStroke", () => {
        if (!padInstance) return;
        const empty = padInstance.isEmpty();
        setHasDrawn(!empty);
        savedStrokesRef.current = padInstance.toData();
      });

      padRef.current = padInstance;

      // Restaure d'éventuels traits déjà tracés
      if (savedStrokesRef.current && savedStrokesRef.current.length > 0) {
        padInstance.fromData(savedStrokesRef.current);
        setHasDrawn(true);
      }
    }, 60);

    return () => {
      clearTimeout(timer);
      if (padInstance) {
        padInstance.off();
      }
      padRef.current = null;
    };
  }, [isModalOpen, mode, penColor]);

  // Changement de couleur d'encre
  function handlePenColorChange(hex: string) {
    setPenColor(hex);
    if (padRef.current) {
      padRef.current.penColor = hex;
    }
  }

  // Annuler le dernier trait
  function handleUndo() {
    if (!padRef.current) return;
    const data = padRef.current.toData();
    if (data.length > 0) {
      data.pop();
      padRef.current.fromData(data);
      savedStrokesRef.current = data;
      setHasDrawn(!padRef.current.isEmpty());
    }
  }

  // Effacer le tracé
  function handleClearDrawing() {
    if (padRef.current) {
      padRef.current.clear();
    }
    savedStrokesRef.current = [];
    setHasDrawn(false);
  }

  // Effacer complètement la signature existante
  function handleResetSignature() {
    setSignatureDataUrl(null);
    savedStrokesRef.current = [];
    setHasDrawn(false);
    onInkChange?.(false);
  }

  // Valider / Adopter la signature créée dans la modale
  function handleAdoptSignature() {
    let finalUrl = "";
    if (mode === "draw") {
      if (!padRef.current || padRef.current.isEmpty()) return;
      finalUrl = canvasRef.current ? trimSignatureCanvas(canvasRef.current) : padRef.current.toDataURL("image/png");
      savedStrokesRef.current = padRef.current.toData();
    } else {
      if (!typedName.trim()) return;
      finalUrl = renderTypedToDataUrl(typedName, selectedStyleId, penColor);
    }

    if (!finalUrl) return;

    setSignatureDataUrl(finalUrl);
    onInkChange?.(true);
    setIsModalOpen(false);
  }

  // Soumission finale vers le parent (bouton signer)
  function submit() {
    if (!signatureDataUrl) {
      // Si aucune signature n'a encore été adoptée, on ouvre la modale
      setIsModalOpen(true);
      return;
    }
    onSubmit(signatureDataUrl);
  }

  useEffect(() => {
    if (ref && typeof ref === "object") {
      ref.current = { submit };
    }
  });

  // Gestion de la touche Échap pour fermer la modale
  useEffect(() => {
    if (!isModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isModalOpen]);

  // Blocage du scroll arrière-plan quand la modale est ouverte
  useEffect(() => {
    if (!isModalOpen) return;
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
    };
  }, [isModalOpen]);

  const canAdopt = mode === "draw" ? hasDrawn : Boolean(typedName.trim());

  // MODALE : Studio de création de signature
  const modalContent =
    isModalOpen && mounted && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
            {/* Voile sombre d'arrière-plan */}
            <div
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
              aria-hidden="true"
              onClick={() => setIsModalOpen(false)}
            />

            {/* Boîte de dialogue Signature */}
            <div
              data-signature-pad="modal"
              className="relative z-10 flex w-full max-w-2xl flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-150"
              style={{ backgroundColor: "#ffffff" }}
            >
              {/* En-tête */}
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 shrink-0 bg-white">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-900">
                    <Pen size={17} weight="bold" />
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Créer votre signature</h3>
                    <p className="text-[11px] text-slate-400">
                      Dessinez au doigt ou choisissez un style manuscrit
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Onglets Dessiner / Taper */}
                  <div className="flex rounded-xl bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setMode("draw")}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        mode === "draw"
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      <Pen size={13} /> Dessiner
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("type")}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        mode === "type"
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      <Keyboard size={13} /> Taper
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    title="Fermer (Échap)"
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X size={16} weight="bold" />
                  </button>
                </div>
              </div>

              {/* Corps de la modale */}
              <div className="p-5 sm:p-6 bg-slate-50/50">
                {mode === "draw" ? (
                  /* MODE DESSINER */
                  <div className="space-y-3">
                    <div className="relative h-60 sm:h-64 w-full rounded-2xl border-2 border-slate-200 bg-white shadow-xs overflow-hidden focus-within:border-slate-900">
                      {/* Ligne repère sous le tracé */}
                      <div className="pointer-events-none absolute inset-x-8 bottom-8 z-0 flex items-end gap-2">
                        <span className="select-none text-base font-semibold leading-none text-slate-300">
                          ✕
                        </span>
                        <span className="mb-[2px] h-[1.5px] flex-1 bg-slate-200" />
                      </div>

                      {!hasDrawn && (
                        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center text-xs font-medium text-slate-400 select-none">
                          Signez ici avec votre doigt, stylet ou souris
                        </div>
                      )}

                      <canvas
                        ref={canvasRef}
                        className="relative z-10 h-full w-full touch-none select-none cursor-crosshair rounded-2xl"
                        style={{ backgroundColor: "#ffffff" }}
                      />
                    </div>

                    {/* Barre d'outils dessin */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      {/* Couleurs d'encre */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-slate-400">Encre :</span>
                        {INK_COLORS.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handlePenColorChange(c.hex)}
                            title={c.label}
                            className={`flex h-6 w-6 items-center justify-center rounded-full transition ${c.bg} ${
                              penColor === c.hex
                                ? "ring-2 ring-offset-2 ring-slate-900 scale-110"
                                : "opacity-75 hover:opacity-100"
                            }`}
                          >
                            {penColor === c.hex && (
                              <Check size={11} weight="bold" className="text-white" />
                            )}
                          </button>
                        ))}
                      </div>

                      {/* Annuler / Effacer */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleUndo}
                          disabled={!hasDrawn}
                          title="Annuler le dernier trait"
                          className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                        >
                          <ArrowCounterClockwise size={13} />
                          <span>Annuler trait</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleClearDrawing}
                          disabled={!hasDrawn}
                          title="Effacer le tracé"
                          className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                        >
                          <Eraser size={13} />
                          <span>Effacer</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* MODE TAPER (Aucun canvas sous les cartes, UI ultra nette) */
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700">
                        Votre nom ou texte de signature
                      </label>
                      <input
                        type="text"
                        value={typedName}
                        onChange={(e) => setTypedName(e.target.value)}
                        placeholder="Tapez votre nom…"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-1 focus:ring-slate-900/20"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-700">
                          Sélectionnez votre style manuscrit :
                        </p>
                        {/* Sélecteur de couleur pour le texte */}
                        <div className="flex items-center gap-1.5">
                          {INK_COLORS.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setPenColor(c.hex)}
                              title={c.label}
                              className={`h-5 w-5 rounded-full transition ${c.bg} ${
                                penColor === c.hex
                                  ? "ring-2 ring-offset-1 ring-slate-900 scale-110"
                                  : "opacity-70 hover:opacity-100"
                              }`}
                            />
                          ))}
                        </div>
                      </div>

                      {/* 4 styles calligraphiques prévisualisés en direct */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {SIGNATURE_STYLES.map((st) => {
                          const isSelected = selectedStyleId === st.id;
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => setSelectedStyleId(st.id)}
                              className={`group relative flex flex-col justify-between rounded-2xl border p-4 text-left transition ${
                                isSelected
                                  ? "border-slate-900 bg-white shadow-sm ring-1 ring-slate-900"
                                  : "border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50/80"
                              }`}
                            >
                              <div className="flex items-center justify-between w-full mb-1">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                  {st.label}
                                </span>
                                {isSelected ? (
                                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-white">
                                    <Check size={10} weight="bold" />
                                  </span>
                                ) : (
                                  <span className="h-4 w-4 rounded-full border border-slate-300 group-hover:border-slate-400" />
                                )}
                              </div>
                              <div className="py-2 overflow-hidden text-ellipsis">
                                <span
                                  className="text-2xl sm:text-3xl leading-tight block truncate"
                                  style={{ fontFamily: st.cssFamily, color: penColor }}
                                >
                                  {typedName.trim() || "Signature"}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Astuce mobile */}
                <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                  <DeviceMobile size={13} />
                  <span>Sur smartphone, tournez votre appareil en paysage si vous souhaitez plus d&apos;espace.</span>
                </div>
              </div>

              {/* Footer de la modale */}
              <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-white px-5 py-4 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleAdoptSignature}
                  disabled={!canAdopt}
                  className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Adopter et utiliser cette signature
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  // VUE LATÉRALE COMPACTE (Dans le rail droit du document)
  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        {signatureDataUrl ? (
          /* Signature prête : aperçu net et boutons d'action */
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-900">
              <span className="flex items-center gap-1.5 text-emerald-700">
                <Check size={14} weight="bold" /> Signature prête
              </span>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1 text-slate-500 hover:text-slate-900 transition"
              >
                <Pen size={12} /> Modifier
              </button>
            </div>

            {/* Cadre d'aperçu de la signature */}
            <div className="relative flex h-28 w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50/50 p-2">
              <div className="pointer-events-none absolute inset-x-4 bottom-4 z-0 flex items-end gap-1.5">
                <span className="text-xs text-slate-300">✕</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
              <img
                src={signatureDataUrl}
                alt="Votre signature"
                className="relative z-10 max-h-20 max-w-full object-contain"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleResetSignature}
                className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 transition"
              >
                <Trash size={13} />
                <span>Effacer</span>
              </button>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <ArrowsOut size={12} />
                <span>Plein écran</span>
              </button>
            </div>
          </div>
        ) : (
          /* Aucune signature : invitation claire à signer */
          <div className="p-4">
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="group flex flex-col items-center justify-center w-full h-36 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-4 text-center transition hover:border-slate-900 hover:bg-white"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white border border-slate-200 text-slate-700 shadow-2xs group-hover:bg-slate-900 group-hover:text-white transition">
                <Pen size={18} weight="bold" />
              </div>
              <p className="mt-2.5 text-xs font-bold text-slate-900">
                Cliquez pour créer votre signature
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Dessinez au doigt ou tapez votre nom
              </p>
            </button>
          </div>
        )}
      </div>

      {modalContent}
    </>
  );
}
