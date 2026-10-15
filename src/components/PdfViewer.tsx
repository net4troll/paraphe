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
  const [containerWidth, setContainerWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState(false);

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

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
  }, []);

  const pageWidth = containerWidth > 0 ? Math.min(containerWidth - 32, 900) : undefined;

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
            <div className="py-20 text-sm text-slate-400">Chargement du PDF…</div>
          }
          error={
            <div className="py-20 text-sm text-red-500">
              {error ? "Impossible d'afficher le PDF." : "PDF indisponible."}
            </div>
          }
        >
          {Array.from({ length: numPages }, (_, i) => (
            <Page
              key={i}
              pageNumber={i + 1}
              width={pageWidth}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              className="mb-4 overflow-hidden rounded-sm border border-slate-200 last:mb-0"
            />
          ))}
        </Document>
      )}
    </div>
  );
}
