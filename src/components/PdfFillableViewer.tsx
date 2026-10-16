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
      ? "border border-brand-600/50 bg-brand-50/50 text-slate-900"
      : "border border-dashed border-slate-400 bg-white/95 text-slate-600 hover:border-brand-600/60"
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
  const [containerWidth, setContainerWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
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

  const pageWidth = containerWidth > 0 ? Math.min(containerWidth - 32, 900) : undefined;

  return (
    <div
      ref={containerRef}
      className="max-h-[74vh] overflow-auto bg-slate-100/70 p-4"
      onScroll={onScrollNearBottom}
    >
      {containerWidth > 0 && (
        <Document
          file={url}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={<div className="py-20 text-sm text-slate-400">Chargement du PDF…</div>}
          error={<div className="py-20 text-sm text-red-500">PDF illisible.</div>}
        >
          {Array.from({ length: numPages }, (_, pageIndex) => {
            const pageFields = fields.filter((f) => f.page === pageIndex);
            return (
              <div
                key={pageIndex}
                data-page={pageIndex}
                className="relative mb-4 overflow-hidden rounded-sm border border-slate-200 last:mb-0"
              >
                <Page
                  pageNumber={pageIndex + 1}
                  width={pageWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
                {pageFields.map((field) => {
                  const value = String(values[field.id] ?? field.presetValue ?? "");
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
