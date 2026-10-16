"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowsIn, ArrowsOut, DeviceMobile, Eraser, Keyboard, Pen, X } from "@phosphor-icons/react/ssr";

const CANVAS_W = 600;
const CANVAS_H = 200;
const INK_COLOR = "#1e3a5f";

const TYPED_FONT = `italic 56px "Segoe Script", "Bradley Hand", "Brush Script MT", "Lucida Handwriting", cursive`;

type Point = { x: number; y: number };

/**
 * Pad de signature : onglets Dessiner / Taper, ligne de base, micro-copy légale.
 * En mode carte, il est rendu sur place (dans le rail). Le bouton plein écran
 * bascule via un portal sur document.body (grand format horizontal, échappe aux
 * contextes d'empilement) ; les traits sont mémorisés et redessinés, donc l'encre
 * survit aux changements de mode.
 * expose ref.submit() : valide la signature (utilisé par la barre d'action parente).
 */
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
  const [typed, setTyped] = useState("");
  const [hasInk, setHasInk] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [isPortrait, setIsPortrait] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const strokesRef = useRef<Point[][]>([]);
  const currentStrokeRef = useRef<Point[] | null>(null);

  useEffect(() => setMounted(true), []);

  // Détection continue de l'orientation et des dimensions du viewport
  useEffect(() => {
    const updateSize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setViewport({ w, h });
      setIsPortrait(h > w);
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    window.addEventListener("orientationchange", updateSize);
    return () => {
      window.removeEventListener("resize", updateSize);
      window.removeEventListener("orientationchange", updateSize);
    };
  }, []);

  const isRotated = expanded && isPortrait;

  // Activation plein écran et orientation paysage
  async function enterFullscreen() {
    setExpanded(true);

    // 1. Tente le plein écran natif de l'élément racine
    try {
      const docEl = document.documentElement as any;
      if (docEl.requestFullscreen && !document.fullscreenElement) {
        await docEl.requestFullscreen().catch(() => {});
      } else if (docEl.webkitRequestFullscreen && !(document as any).webkitFullscreenElement) {
        await docEl.webkitRequestFullscreen().catch(() => {});
      }
    } catch {}

    // 2. Verrouille l'orientation en paysage (Screen Orientation API)
    try {
      const orientation =
        (screen as any).orientation ||
        (screen as any).mozOrientation ||
        (screen as any).msOrientation;
      if (orientation && typeof orientation.lock === "function") {
        await orientation.lock("landscape").catch(() => {});
      }
    } catch {}
  }

  // Sortie du plein écran et déverrouillage
  async function exitFullscreen() {
    setExpanded(false);

    // 1. Déverrouille l'orientation
    try {
      const orientation =
        (screen as any).orientation ||
        (screen as any).mozOrientation ||
        (screen as any).msOrientation;
      if (orientation && typeof orientation.unlock === "function") {
        orientation.unlock();
      }
    } catch {}

    // 2. Quitte le plein écran natif si actif
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {});
      } else if ((document as any).webkitFullscreenElement && (document as any).webkitExitFullscreen) {
        await (document as any).webkitExitFullscreen().catch(() => {});
      }
    } catch {}
  }

  // Échap quitte le plein écran
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Désactive ce qui est derrière (scroll, interactions, sélection)
  useEffect(() => {
    if (!expanded) return;

    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyTouchAction = document.body.style.touchAction;
    const prevBodyUserSelect = document.body.style.userSelect;
    const prevBodyWebkitUserSelect = (document.body.style as any).webkitUserSelect;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    document.body.style.userSelect = "none";
    (document.body.style as any).webkitUserSelect = "none";
    document.documentElement.style.overflow = "hidden";

    const preventBgTouch = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-signature-pad]")) {
        e.preventDefault();
      }
    };
    document.addEventListener("touchmove", preventBgTouch, { passive: false });

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.touchAction = prevBodyTouchAction;
      document.body.style.userSelect = prevBodyUserSelect;
      (document.body.style as any).webkitUserSelect = prevBodyWebkitUserSelect;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.removeEventListener("touchmove", preventBgTouch);
    };
  }, [expanded]);

  /** Redessine tout : traits mémorisés (mode dessiner) ou nom tapé (mode taper). */
  function redraw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.strokeStyle = INK_COLOR;
    ctx.fillStyle = INK_COLOR;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (mode === "type") {
      if (typed.trim()) {
        ctx.font = TYPED_FONT;
        ctx.textBaseline = "middle";
        ctx.fillText(typed.trim(), 16, CANVAS_H / 2, CANVAS_W - 32);
        setHasInk(true);
        return;
      }
      setHasInk(false);
      return;
    }

    for (const stroke of strokesRef.current) {
      if (stroke.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke[0].x, stroke[0].y, 1.8, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (const point of stroke.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    setHasInk(strokesRef.current.length > 0);
  }

  // Redessine au montage et à chaque bascule (onglet, plein écran) — l'encre suit.
  useEffect(() => {
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, typed, expanded, mounted]);

  useEffect(() => {
    onInkChange?.(hasInk);
  }, [hasInk, onInkChange]);

  function canvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();

    if (isRotated) {
      // Rotation de 90° horaire en mode paysage automatique sur mobile portrait :
      // L'axe X local correspond au déplacement de haut en bas sur l'écran physique (clientY)
      // L'axe Y local correspond au déplacement de droite à gauche sur l'écran physique (clientX)
      const localX = ((e.clientY - rect.top) / rect.height) * CANVAS_W;
      const localY = ((rect.right - e.clientX) / rect.width) * CANVAS_H;
      return {
        x: Math.max(0, Math.min(CANVAS_W, localX)),
        y: Math.max(0, Math.min(CANVAS_H, localY)),
      };
    }

    return {
      x: Math.max(0, Math.min(CANVAS_W, ((e.clientX - rect.left) / rect.width) * CANVAS_W)),
      y: Math.max(0, Math.min(CANVAS_H, ((e.clientY - rect.top) / rect.height) * CANVAS_H)),
    };
  }

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const point = canvasPoint(e);
    currentStrokeRef.current = [point];
    strokesRef.current.push(currentStrokeRef.current);
    lastPointRef.current = point;
    setHasInk(true);
  }

  function moveDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !currentStrokeRef.current) return;
    const point = canvasPoint(e);
    const stroke = currentStrokeRef.current;
    const from = stroke[stroke.length - 1];
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    stroke.push(point);
    lastPointRef.current = point;
  }

  function endDraw() {
    drawingRef.current = false;
    currentStrokeRef.current = null;
    lastPointRef.current = null;
  }

  function clear() {
    setTyped("");
    strokesRef.current = [];
    currentStrokeRef.current = null;
    redraw();
  }

  function submit() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    if (expanded) exitFullscreen();
    onSubmit(canvas.toDataURL("image/png"));
  }

  // La barre d'action du parent déclenche submit() via la ref.
  useEffect(() => {
    if (ref && typeof ref === "object") {
      ref.current = { submit };
    }
  });

  const submitDisabled =
    loading || !consent || !name.trim() || !hasInk || blockSubmit;

  const surface = (
    <div
      data-signature-pad="root"
      className={
        expanded
          ? "fixed flex flex-col bg-white select-none overscroll-none shadow-2xl z-[9999]"
          : "overflow-hidden rounded-2xl border border-slate-200 bg-white select-none"
      }
      style={
        expanded
          ? isRotated && viewport.w > 0 && viewport.h > 0
            ? {
                position: "fixed",
                top: "50%",
                left: "50%",
                width: `${viewport.h}px`,
                height: `${viewport.w}px`,
                transform: "translate(-50%, -50%) rotate(90deg)",
                zIndex: 9999,
              }
            : {
                position: "fixed",
                inset: 0,
                width: "100vw",
                height: "100vh",
                zIndex: 9999,
              }
          : undefined
      }
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* Backdrop sombre bloquant tout ce qui se trouve derrière */}
      {expanded && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm -z-10 pointer-events-auto"
          aria-hidden="true"
        />
      )}

      {/* Header */}
      <div
        className={
          expanded
            ? "mx-auto flex w-full max-w-6xl items-center justify-between border-b border-slate-100 px-4 py-3 shrink-0"
            : "flex items-center justify-between border-b border-slate-100 px-3 py-2.5"
        }
      >
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setMode("draw")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                mode === "draw" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              <Pen size={13} /> Dessiner
            </button>
            <button
              type="button"
              onClick={() => setMode("type")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                mode === "type" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              <Keyboard size={13} /> Taper
            </button>
          </div>

          {expanded && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-50 border border-brand-200/80 px-2 py-1 text-[11px] font-medium text-brand-700">
              <DeviceMobile size={13} className="rotate-90" /> Mode paysage actif
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={clear}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:text-slate-800"
          >
            <Eraser size={13} /> Effacer
          </button>
          {expanded ? (
            <button
              type="button"
              onClick={exitFullscreen}
              title="Réduire (Échap)"
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              <ArrowsIn size={14} /> Réduire
            </button>
          ) : (
            <button
              type="button"
              onClick={enterFullscreen}
              title="Signer en plein écran (paysage automatique)"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:text-brand-800"
            >
              <ArrowsOut size={13} /> Plein écran
            </button>
          )}
        </div>
      </div>

      {/* Zone centrale du pad */}
      <div
        className={
          expanded
            ? "mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-3 p-4 min-h-0 overflow-y-auto"
            : "p-4"
        }
      >
        {mode === "type" && (
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Tapez votre nom…"
            className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-600 ${
              expanded ? "max-w-3xl" : ""
            }`}
          />
        )}

        <div className={`relative ${expanded ? "w-full max-w-6xl flex-1 max-h-[60vh] flex flex-col justify-center" : "w-full"}`}>
          {/* Ligne de base + repère sous le canvas */}
          <div className="pointer-events-none absolute inset-x-5 bottom-8 z-0 flex items-end gap-2">
            <span className="select-none text-sm leading-none text-slate-300">✕</span>
            <span className="mb-[3px] h-px flex-1 bg-slate-300" />
          </div>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
            className="relative z-10 w-full touch-none select-none bg-slate-50/50 rounded-xl border border-slate-200"
            style={{ aspectRatio: "3 / 1", cursor: mode === "draw" ? "crosshair" : "default" }}
          />
        </div>

        <p
          className={`text-[11px] leading-snug text-slate-400 select-none ${
            expanded ? "max-w-3xl text-center" : ""
          }`}
        >
          En signant, je confirme que cette signature électronique est la représentation légale de
          ma signature manuscrite.
        </p>
      </div>

      {/* Barre d'action inférieure en plein écran */}
      {expanded && (
        <div className="mx-auto mt-auto flex w-full max-w-6xl flex-col items-center gap-2.5 border-t border-slate-100 p-4 shrink-0 bg-white">
          <label className="flex items-start gap-2.5 text-xs leading-snug text-slate-600 select-none">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => onConsentChange?.(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-700"
            />
            <span>
              Je certifie mon identité et j&apos;accepte que cette signature électronique
              m&apos;engage sur le présent document.
            </span>
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={submitDisabled}
            className="w-full max-w-3xl rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Signature en cours…" : "Signer le document"}
          </button>
          {blockSubmit && (
            <p className="text-center text-xs text-slate-400 select-none">
              Complétez d&apos;abord tous les champs dans le panneau « Champs à compléter ».
            </p>
          )}
        </div>
      )}
    </div>
  );

  // Mode carte : rendu sur place, dans le rail. Plein écran : portal sur body
  // (échappe aux contextes d'empilement des parents sticky). Les traits sont
  // rejoués à chaque bascule, l'encre est donc conservée.
  if (!mounted || typeof document === "undefined") {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-3 py-2.5 text-xs text-slate-400">
          Signature
        </div>
        <div className="p-4 text-sm text-slate-300" style={{ aspectRatio: "3 / 1" }} />
      </div>
    );
  }
  if (expanded) {
    return createPortal(surface, document.body);
  }
  return surface;
}
