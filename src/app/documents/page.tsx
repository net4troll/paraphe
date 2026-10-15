import Link from "next/link";
import { CaretRight, PenNib, Plus } from "@phosphor-icons/react/ssr";
import { db } from "@/lib/db";
import StatusDot from "@/components/StatusDot";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const documents = await db.document.findMany({
    orderBy: { createdAt: "desc" },
    include: { signers: { orderBy: { createdAt: "asc" } } },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-slate-500">
            Conventions et contrats en attente de signature.
          </p>
        </div>
        <Link
          href="/documents/new"
          className="flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800"
        >
          <Plus size={16} /> Nouveau document
        </Link>
      </div>

      {documents.length === 0 ? (
        <div className="mt-8 flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-8 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
            <PenNib size={22} className="text-brand-700" />
          </span>
          <h2 className="mt-4 font-medium">Aucun document pour l&apos;instant</h2>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            Chargez un PDF, indiquez qui doit le signer, et Paraphe s&apos;occupe du reste —
            jusqu&apos;à l&apos;envoi du PDF final à tout le monde.
          </p>
          <Link
            href="/documents/new"
            className="mt-5 flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
          >
            <Plus size={15} /> Créer un premier document
          </Link>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <ul className="divide-y divide-slate-100">
            {documents.map((doc) => {
              const signedCount = doc.signers.filter((s) => s.status === "signed").length;
              const total = doc.signers.length;
              return (
                <li key={doc.id}>
                  <Link
                    href={`/documents/${doc.id}`}
                    className="group flex items-center gap-4 px-5 py-4 transition hover:bg-slate-50/70"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{doc.title}</p>
                      <p className="mt-0.5 truncate text-[13px] text-slate-500">
                        {doc.signers.map((s) => s.name).join(" · ") || "Aucun signataire"}
                      </p>
                    </div>
                    <div className="hidden shrink-0 items-center gap-1.5 sm:flex" title={`${signedCount}/${total} signatures`}>
                      {Array.from({ length: total }, (_, i) => (
                        <span
                          key={i}
                          className={`h-2 w-2 rounded-full ${
                            i < signedCount ? "bg-brand-600" : "bg-slate-200"
                          }`}
                        />
                      ))}
                      <span className="ml-1.5 text-xs tabular-nums text-slate-500">
                        {signedCount}/{total}
                      </span>
                    </div>
                    <div className="hidden w-44 shrink-0 md:block">
                      <StatusDot status={doc.status} />
                    </div>
                    <span className="hidden shrink-0 text-[13px] tabular-nums text-slate-400 sm:block">
                      {doc.createdAt.toLocaleDateString("fr-FR")}
                    </span>
                    <CaretRight
                      size={16}
                      className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
