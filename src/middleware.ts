import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// We protect everything under /modules/*
const PROTECTED_PREFIX = "/modules/";

export async function middleware(req: NextRequest) {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  // Extra guard (config.matcher already limits this)
  if (!pathname.startsWith(PROTECTED_PREFIX)) {
    return NextResponse.next();
  }

  // Allow Next.js internals and auth endpoints through
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/public")
  ) {
    return NextResponse.next();
  }

  // Read NextAuth JWT on the edge
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Not signed in? -> redirect to NextAuth sign-in
  if (!token) {
    const signInUrl = new URL("/api/auth/signin", req.url);
    // After successful sign-in, send the user back to where they tried to go.
    signInUrl.searchParams.set(
      "callbackUrl",
      nextUrl.pathname + nextUrl.search
    );
    return NextResponse.redirect(signInUrl);
  }

  // Signed in -> allow
  return NextResponse.next();
}

// Apply only to /modules/* pages (App Router paths don't include /app in the URL)
export const config = {
  matcher: ["/modules/:path*"],
};
