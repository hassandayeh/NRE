// src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Public paths that never require auth
const PUBLIC_PREFIXES = [
  "/auth", // our custom sign-in UI lives here
  "/api/auth", // NextAuth's own routes must stay public
  "/entry", // public chooser (Admin / Invited / Guest)
  "/account/prepare-guest",
  "/api/guest", // guest verify/complete flow
  "/_next", // Next.js assets
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
];

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // 1) Allow public paths verbatim
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 2) Decode JWT (JWT strategy) — MUST pass the secret for Edge
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // 3) Unauthenticated handling
  if (!token) {
    // Make "/" the Entry page for visitors (no redirect flash)
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/entry";
      url.search = ""; // keep it clean
      return NextResponse.rewrite(url);
    }

    // For any other protected path, keep the sign-in redirect with return URL
    const url = req.nextUrl.clone();
    url.pathname = "/auth/signin";
    url.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(url);
  }

  // 4) Authenticated → allow
  return NextResponse.next();
}

// Apply to everything except static files; leave /api/auth to NextAuth
export const config = {
  matcher: [
    // Skip Next static/image and the NextAuth API explicitly (we also gated above)
    "/((?!_next/static|_next/image|favicon.ico|api/auth).*)",
  ],
};
