// src/app/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Root route: always-on redirect.
 * - If a NextAuth session cookie exists → send to the authenticated home
 *   (safe default: /modules/settings, adjust later if you prefer a dashboard).
 * - If no session cookie → send to the Entry split (/entry).
 *
 * No feature flags. No schema reads. Minimal risk of regressions.
 */

export const dynamic = "force-dynamic"; // ensure per-request cookies are read

export default function RootRedirect() {
  const jar = cookies();

  // NextAuth v4 cookie names:
  // - "next-auth.session-token"
  // - "__Secure-next-auth.session-token" (when using secure cookies)
  const hasSession =
    Boolean(jar.get("next-auth.session-token")) ||
    Boolean(jar.get("__Secure-next-auth.session-token"));

  if (hasSession) {
    redirect("/modules/settings");
  } else {
    redirect("/entry");
  }
}
