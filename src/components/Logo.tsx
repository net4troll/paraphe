import { APP_NAME } from "@/lib/app";

/** Logo en trait uniquement (pas de fond plein) — hérite de la couleur du texte. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      aria-hidden
    >
      <path d="M8 40H40V8H14V34H34V14H20V28H28V20" />
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
