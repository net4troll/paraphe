"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Check } from "@phosphor-icons/react/ssr";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export type FillableField = {
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
  url: string;
  fields: FillableField[];
  values: Record<string, string | boolean>;
  onChange: (fieldId: string, value: string | boolean) => void;
  onRead?: () => void;
  /** { fieldId, nonce } : fait défiler jusqu'au champ et le focus. */
  focusRequest?: { fieldId: string; nonce: number } | null;
};

const HEIGHT_PCT: Record<string, number> = {
  text: 2.6,
  textarea: 5.5,
  date: 2.6,
  number: 2.6,
  checkbox: 2.4,
  select: 2.6,
};

const inputClasses = (filled: boolean) =>
  `w-full rounded-[3px] px-1 text-[11px] sm:text-[12px] outline-none transition ${
    filled
      ? "border border-brand-600/50 bg-white text-slate-900 shadow-xs"
      : "border border-dashed border-slate-400 bg-white text-slate-600 hover:border-brand-600/60"
  } focus:border-brand-700 focus:bg-white focus:ring-1 focus:ring-brand-600/30`;

/**
 * Visionneuse PDF interactive : les champs à remplir sont posés directement
 * sur les pages, aux positions choisies par l'admin — signature immersive.
 */
export default function PdfFillableViewer({
  url,
  fields,
  values,
  onChange,
  onRead,
  focusRequest,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const w = window.innerWidth;
      const est = w >= 1024 ? Math.min(w - 440, 860) : Math.min(w - 32, 860);
      return Math.max(est, 280);
    }
    return 0;
  });
  const [numPages, setNumPages] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Mesure immédiate au montage
    const measured = el.clientWidth;
    if (measured > 0) {
      setContainerWidth((prev) => (Math.abs(prev - measured) > 8 ? measured : prev));
    }

    let rafId: number;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        if (w > 0) {
          cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            setContainerWidth((prev) => {
              // Ignore les micro-variations (<= 20px comme apparition de scrollbar)
              // pour ne jamais détruire ni faire clignoter les canvas en cours
              if (Math.abs(prev - w) <= 20) return prev;
              return w;
            });
          });
        }
      }
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  // Focus d'un champ demandé par le parent (clic dans le récapitulatif / CTA)
  useEffect(() => {
    if (!focusRequest) return;
    const el = document.querySelector(
      `[data-field-input="${focusRequest.fieldId}"]`
    ) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    }
  }, [focusRequest]);

  const onScrollNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) onRead?.();
  }, [onRead]);

  const pageWidth =
    containerWidth > 0 ? Math.min(containerWidth - (containerWidth < 480 ? 16 : 32), 860) : 320;
  const pageHeight = Math.round(pageWidth * 1.414);

  return (
    <div
      ref={containerRef}
      className="h-[68vh] min-h-[480px] overflow-y-auto bg-slate-100/80 p-3 sm:p-4"
      onScroll={onScrollNearBottom}
    >
      {containerWidth > 0 && (
        <Document
          file={url}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 py-16 text-slate-400">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
              <p className="text-xs font-medium text-slate-500">Chargement du document PDF…</p>
            </div>
          }
          error={
            <div className="flex h-full min-h-[400px] items-center justify-center py-16 text-xs text-red-500">
              PDF indisponible ou illisible.
            </div>
          }
        >
          {Array.from({ length: numPages }, (_, pageIndex) => {
            const pageFields = fields.filter((f) => f.page === pageIndex);
            return (
              <div
                key={pageIndex}
                data-page={pageIndex}
                className="relative mb-4 overflow-hidden rounded-md border border-slate-200/90 bg-white shadow-2xs last:mb-0 transition-shadow"
                style={{
                  width: pageWidth,
                  minHeight: pageHeight,
                }}
              >
                <Page
                  pageNumber={pageIndex + 1}
                  width={pageWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={
                    <div
                      style={{ width: pageWidth, height: pageHeight }}
                      className="flex flex-col items-center justify-center gap-2.5 bg-white text-slate-400"
                    >
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
                      <span className="text-[11px] font-medium text-slate-400">Page {pageIndex + 1}</span>
                    </div>
                  }
                />
                {pageFields
                  .filter((f) => !f.presetValue)
                  .map((field) => {
                    const value = String(values[field.id] ?? "");
                    const filled = value.trim() !== "";
                  const hPct = HEIGHT_PCT[field.type] ?? 2.6;
                  const common = {
                    "data-field-input": field.id,
                    style: {
                      left: `${(field.xPct - field.widthPct / 2) * 100}%`,
                      top: `${field.yPct * 100}%`,
                      width: `${field.widthPct * 100}%`,
                      height: `${hPct}%`,
                      minHeight: 24,
                    },
                  };

                  if (field.type === "checkbox") {
                    const checked = values[field.id] === true;
                    return (
                      <div key={field.id} {...common} className="absolute" title={field.label}>
                        <button
                          type="button"
                          onClick={() => onChange(field.id, !checked)}
                          className={`flex h-full w-full items-center justify-center rounded-[3px] transition ${
                            checked
                              ? "border border-brand-600 bg-brand-600/15 text-brand-700"
                              : "border border-dashed border-slate-400 bg-white/95 hover:border-brand-600/60"
                          }`}
                        >
                          {checked && <Check size={13} weight="bold" />}
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div key={field.id} {...common} className="absolute" title={field.label}>
                      {field.type === "textarea" ? (
                        <textarea
                          rows={3}
                          title={field.label}
                          placeholder={field.label}
                          value={value}
                          onChange={(e) => onChange(field.id, e.target.value)}
                          className={`${inputClasses(filled)} resize-none leading-snug`}
                        />
                      ) : field.type === "select" ? (
                        <select
                          title={field.label}
                          value={value}
                          onChange={(e) => onChange(field.id, e.target.value)}
                          className={`${inputClasses(filled)} ${
                            value ? "" : "text-slate-400"
                          }`}
                        >
                          <option value="">{field.label}</option>
                          {field.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type === "date" ? "date" : "text"}
                          inputMode={field.type === "number" ? "decimal" : undefined}
                          title={field.label}
                          placeholder={field.label}
                          value={value}
                          onChange={(e) => onChange(field.id, e.target.value)}
                          className={inputClasses(filled)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </Document>
      )}
    </div>
  );
}
