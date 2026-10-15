import "server-only";

import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "signflow_session";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret === "changez-moi") {
    throw new Error("AUTH_SECRET doit être défini (openssl rand -base64 32)");
  }
  return new TextEncoder().encode(secret);
}

function sha256(input: string): Buffer {
  return createHash("sha256").update(input, "utf8").digest();
}

export function checkAdminPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD?.trim();
  if (!expected || expected === "changez-moi") return false;
  return timingSafeEqual(sha256(input), sha256(expected));
}

export async function createSession(): Promise<void> {
  const token = await new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.role === "admin";
  } catch {
    return false;
  }
}

/** Vérifie le JWT de session hors requête (utilisé par le middleware edge). */
export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.role === "admin";
  } catch {
    return false;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
