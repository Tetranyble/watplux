import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Cheap redirect boundary only. Better Auth session validation still happens
 * inside protected Server Components/Route Handlers through `lib/session.ts`.
 */
const PROTECTED_PREFIXES = ["/account", "/admin"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsSession = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!needsSession) return NextResponse.next();

  const sessionCookie = getSessionCookie(request, { cookiePrefix: "watplux" });
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/account/:path*", "/admin/:path*"],
};
