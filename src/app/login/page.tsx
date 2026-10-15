import LoginForm from "./LoginForm";
import { LogoMark } from "@/components/Logo";
import { APP_NAME } from "@/lib/app";
import { PaperPlaneTilt, PenNib, ShieldCheck } from "@phosphor-icons/react/ssr";

const POINTS = [
  { icon: PenNib, text: "Placement des signatures à la souris, directement sur le PDF" },
  { icon: PaperPlaneTilt, text: "Invitations par email, signature au doigt sur mobile via QR code" },
  { icon: ShieldCheck, text: "Chaque signature scellée par un certificat numérique P12" },
];

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white md:grid-cols-2">
        <div className="flex flex-col justify-between border-b border-slate-100 bg-slate-50 p-8 max-md:hidden md:border-b-0 md:border-r">
          <div className="flex items-center gap-3">
            <LogoMark size={36} />
            <div className="leading-tight">
              <p className="text-lg font-semibold tracking-tight">{APP_NAME}</p>
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-brand-700">
                Signature de documents
              </p>
            </div>
          </div>
          <ul className="my-8 space-y-4">
            {POINTS.map((point) => (
              <li key={point.text} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white">
                  <point.icon size={15} weight="duotone" className="text-brand-700" />
                </span>
                <p className="text-[13px] leading-snug text-slate-600">{point.text}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400">
            Conventions partenaires & intervenants — signatures parallèles, PDF final envoyé à
            tous.
          </p>
        </div>
        <div className="p-8 md:p-10">
          <h1 className="text-xl font-semibold tracking-tight">Connexion</h1>
          <p className="mt-1 text-sm text-slate-500">
            Espace administrateur — gestion des documents et des signatures.
          </p>
          <LoginForm redirectTo="/documents" />
        </div>
      </div>
    </main>
  );
}
