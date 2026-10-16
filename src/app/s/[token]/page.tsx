import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { companyName } from "@/lib/mail";
import SigningClient from "./SigningClient";

export const dynamic = "force-dynamic";

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const signer = await db.signer.findUnique({
    where: { token },
    include: { document: true },
  });
  if (!signer) notFound();

  const fields = await db.field.findMany({
    where: {
      documentId: signer.documentId,
      signerId: signer.id,
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <SigningClient
      token={signer.token}
      docId={signer.document.id}
      docTitle={signer.document.title}
      docStatus={signer.document.status}
      signerName={signer.name}
      signerRole={signer.role}
      signerStatus={signer.status}
      signedAt={signer.signedAt?.toISOString() ?? null}
      company={companyName()}
      fields={fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type as "text" | "textarea" | "date" | "number" | "checkbox" | "select",
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
      }))}
    />
  );
}
