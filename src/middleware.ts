import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE_NAME = "signflow_session";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET doit être défini");
  }
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let authed = false;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, getSecret());
      authed = payload.role === "admin";
    } catch {
      authed = false;
    }
  }

  if (!authed) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/documents/:path*"],
};
