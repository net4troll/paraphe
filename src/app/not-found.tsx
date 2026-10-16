import Link from "next/link";
import { ArrowLeft, EnvelopeSimple, FileX, House } from "@phosphor-icons/react/ssr";
import { LogoMark } from "@/components/Logo";
import { APP_NAME } from "@/lib/app";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-6 bg-slate-50/50">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 sm:p-10 shadow-xl shadow-slate-100/60 text-center">
        {/* En-tête marque */}
        <div className="flex items-center justify-center gap-2.5 text-slate-900 mb-8">
          <LogoMark size={32} />
          <span className="text-base font-bold tracking-tight">{APP_NAME}</span>
        </div>

        {/* Badge 404 & icône */}
        <div className="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-100/80 text-slate-700 ring-8 ring-slate-50">
          <FileX size={40} weight="duotone" className="text-slate-800" />
          <span className="absolute -bottom-2 -right-2 rounded-full border-2 border-white bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
            404
          </span>
        </div>

        {/* Titre & Message */}
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
          Page ou document introuvable
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-slate-500">
          Le lien que vous avez suivi est incorrect, le document a été déplacé ou votre lien de
          signature a expiré.
        </p>

        {/* Bloc d'aide pour signataires */}
        <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 text-left text-xs leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-800 flex items-center gap-1.5 mb-1">
            <EnvelopeSimple size={15} className="text-slate-500" /> Vous deviez signer un document ?
          </p>
          <p className="text-slate-500">
            Vérifiez l&apos;adresse dans votre email d&apos;invitation ou contactez l&apos;expéditeur
            pour obtenir un nouveau lien de signature sécurisé.
          </p>
        </div>

        {/* Actions */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/"
            className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            <House size={15} />
            <span>Retour à l&apos;accueil</span>
          </Link>
          <Link
            href="/login"
            className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
          >
            <ArrowLeft size={15} />
            <span>Espace administrateur</span>
          </Link>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        {APP_NAME} — Plateforme de signature électronique sécurisée (P12)
      </p>
    </main>
  );
}
