import { APP_NAME } from "@/lib/app";

/** Logo en trait uniquement (pas de fond plein) — hérite de la couleur du texte. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="8.5"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M8 20.5c3.2-1.4 4.2-9.5 7.8-9.5 2.7 0 2.2 6 4.9 6 1.7 0 2.6-1.5 2.9-2.7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ company }: { company?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-slate-900">
      <LogoMark />
      <div className="leading-tight">
        <p className="text-[15px] font-semibold tracking-tight">{APP_NAME}</p>
        {company && (
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
            {company}
          </p>
        )}
      </div>
    </div>
  );
}
