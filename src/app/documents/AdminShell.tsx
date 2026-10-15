"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Plus, SignOut } from "@phosphor-icons/react/ssr";
import { Logo } from "@/components/Logo";

const NAV = [
  { href: "/documents", label: "Documents", icon: FileText, exact: true },
  { href: "/documents/new", label: "Nouveau document", icon: Plus, exact: false },
];

export default function AdminShell({
  company,
  documentCount,
  children,
}: {
  company: string;
  documentCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  function isActive(item: (typeof NAV)[number]) {
    return item.exact ? pathname === item.href : pathname.startsWith(item.href);
  }

  async function logout() {
    await fetch("/api/auth/login", { method: "DELETE" });
    window.location.href = "/login";
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="px-5 pb-6 pt-6">
          <Logo company={company} />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Espace de signature
          </p>
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-brand-50 font-medium text-brand-800"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon size={16} className={active ? "text-brand-700" : "text-slate-400"} />
                  {item.label}
                </span>
                {item.exact && documentCount > 0 && (
                  <span className="text-xs tabular-nums text-slate-400">{documentCount}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center justify-between rounded-lg px-2 py-1.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                AD
              </span>
              <div className="leading-tight">
                <p className="text-sm font-medium text-slate-700">Administrateur</p>
                <p className="text-xs text-slate-400">Accès complet</p>
              </div>
            </div>
            <button
              type="button"
              onClick={logout}
              title="Se déconnecter"
              className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
            >
              <SignOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Link href="/documents">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/documents/new"
            className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Nouveau
          </Link>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500"
            title="Se déconnecter"
          >
            <SignOut size={14} />
          </button>
        </div>
      </div>

      <main className="min-w-0 flex-1 px-4 pb-16 pt-16 lg:pl-72 lg:pr-10 lg:pt-10">{children}</main>
    </div>
  );
}
