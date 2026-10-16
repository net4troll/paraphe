import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import DocumentDetail from "./DocumentDetail";
import type { FieldType, FieldView } from "@/components/ZoneEditor";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await db.document.findUnique({
    where: { id },
    include: {
      signers: { orderBy: { createdAt: "asc" } },
      fields: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!document) notFound();

  const fields: FieldView[] = document.fields.map((f) => ({
    id: f.id,
    signerId: f.signerId,
    label: f.label,
    type: f.type as FieldType,
    options: (() => {
      try {
        return JSON.parse(f.options ?? "[]") as string[];
      } catch {
        return [];
      }
    })(),
    presetValue: f.presetValue ?? "",
    page: f.page,
    xPct: f.xPct,
    yPct: f.yPct,
    widthPct: f.widthPct,
  }));

  return (
    <DocumentDetail
      document={{
        id: document.id,
        title: document.title,
        status: document.status,
        createdAt: document.createdAt.toISOString(),
        signers: document.signers.map((s) => ({
          id: s.id,
          name: s.name,
          email: s.email,
          role: s.role,
          token: s.token,
          status: s.status,
          page: s.page,
          xPct: s.xPct,
          yPct: s.yPct,
          widthPct: s.widthPct,
          heightPct: s.heightPct,
          signedAt: s.signedAt?.toISOString() ?? null,
        })),
      }}
      fields={fields}
    />
  );
}
