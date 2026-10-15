const STATUS_MAP: Record<string, { label: string; dot: string }> = {
  draft: { label: "Brouillon", dot: "bg-slate-300" },
  pending: { label: "En attente de signature", dot: "bg-amber-500" },
  completed: { label: "Signé", dot: "bg-brand-600" },
};

export default function StatusDot({ status, className }: { status: string; className?: string }) {
  const conf = STATUS_MAP[status] ?? STATUS_MAP.draft;
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${conf.dot}`} />
      <span className="text-sm text-slate-600">{conf.label}</span>
    </span>
  );
}
