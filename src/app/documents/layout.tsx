import { db } from "@/lib/db";
import { companyName } from "@/lib/mail";
import AdminShell from "./AdminShell";

export const dynamic = "force-dynamic";

export default async function DocumentsLayout({ children }: { children: React.ReactNode }) {
  let count = 0;
  try {
    count = await db.document.count();
  } catch {
    count = 0;
  }
  return (
    <AdminShell company={companyName()} documentCount={count}>
      {children}
    </AdminShell>
  );
}
