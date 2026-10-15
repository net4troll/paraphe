import { NextResponse } from "next/server";
import { checkAdminPassword, createSession, destroySession } from "@/lib/auth";

export async function POST(request: Request) {
  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  if (!checkAdminPassword(password)) {
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }

  await createSession();
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await destroySession();
  return NextResponse.json({ ok: true });
}
