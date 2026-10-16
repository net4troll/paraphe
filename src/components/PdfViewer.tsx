"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export default function PdfViewer({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() => {
    if (typeof window !== "undefined") {
      return Math.min(window.innerWidth - 32, 900);
    }
    return 0;
  });
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
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

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
  }, []);

  const pageWidth = containerWidth > 0 ? Math.min(containerWidth - 32, 900) : 320;
  const pageHeight = Math.round(pageWidth * 1.414);

  return (
    <div
      ref={containerRef}
      className={
        className ?? "flex-1 min-h-0 overflow-auto bg-slate-100 flex flex-col items-center gap-4 p-4"
      }
    >
      {containerWidth > 0 && (
        <Document
          file={url}
          onLoadSuccess={onLoadSuccess}
          onLoadError={() => setError(true)}
          loading={
            <div className="flex h-64 flex-col items-center justify-center gap-3 py-16 text-slate-400">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
              <p className="text-xs font-medium text-slate-500">Chargement du document PDF…</p>
            </div>
          }
          error={
            <div className="flex h-64 items-center justify-center py-16 text-xs text-red-500">
              {error ? "Impossible d'afficher le PDF." : "PDF indisponible."}
            </div>
          }
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div
              key={i}
              className="relative mb-4 overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xs last:mb-0"
              style={{ width: pageWidth, minHeight: pageHeight }}
            >
              <Page
                pageNumber={i + 1}
                width={pageWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={
                  <div
                    style={{ width: pageWidth, height: pageHeight }}
                    className="flex flex-col items-center justify-center gap-2 bg-white text-slate-400"
                  >
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
                    <span className="text-[11px] font-medium text-slate-400">Page {i + 1}</span>
                  </div>
                }
              />
            </div>
          ))}
        </Document>
      )}
    </div>
  );
}
