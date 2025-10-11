// src/app/page.tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * getSession()
 * Tries to read the NextAuth session in a tolerant way:
 * 1) If "@/lib/auth" exports `auth()` (Auth.js v5), use it.
 * 2) Else, if "@/lib/auth" exports `authOptions`, use next-auth's getServerSession().
 * 3) Else, fall back to calling /api/auth/session with request cookies.
 */
async function getSession() {
  // Try Auth.js v5 style: `auth()` from "@/lib/auth"
  try {
    const authMod: any = await import("../lib/auth");
    if (authMod && typeof authMod.auth === "function") {
      return await authMod.auth();
    }
  } catch {
    // ignore and try next
  }

  // Try classic getServerSession(authOptions)
  try {
    const authMod: any = await import("../lib/auth");
    if (authMod && authMod.authOptions) {
      const nextAuth: any = await import("next-auth");
      if (typeof nextAuth.getServerSession === "function") {
        return await nextAuth.getServerSession(authMod.authOptions);
      }
    }
  } catch {
    // ignore and try next
  }

  // Fallback: call /api/auth/session with request cookies
  try {
    const cookieHeader = cookies()
      .getAll()
      .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
      .join("; ");
    const res = await fetch("/api/auth/session", {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (res.ok) return await res.json();
  } catch {
    // swallow — final fallback is "no session"
  }

  return null;
}

/**
 * Extract orgId and guestProfileId from the session, tolerating shape differences.
 */
function readContext(session: any) {
  const orgId =
    session?.orgId ??
    session?.user?.orgId ??
    session?.org?.id ??
    session?.organizationId ??
    session?.organization?.id ??
    null;

  const guestProfileId =
    session?.guestProfileId ?? session?.user?.guestProfileId ?? null;

  return { orgId, guestProfileId };
}

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function Home(props: PageProps) {
  const session = await getSession();

  // 1) Unauthenticated → /auth/signin
  if (!session) {
    redirect("/auth/signin");
  }

  const { orgId, guestProfileId } = readContext(session);

  // 2) Staff (has org context) → ensure the URL carries ?orgId=<session org>
  if (orgId) {
    const currentOrgId = (() => {
      const sp = props?.searchParams;
      if (!sp) return undefined;
      const v = sp.orgId;
      return Array.isArray(v) ? v[0] : v;
    })();

    if (currentOrgId !== orgId) {
      redirect(`/?orgId=${encodeURIComponent(String(orgId))}`);
    }
    // Already correct → render nothing (layout/nav will show).
    return null;
  }

  // 3) Guest (guestProfileId only) → stay on "/", render nothing (Settings hidden in nav).
  if (guestProfileId) {
    return null;
  }

  // 4) Defensive fallback for any other authenticated shape.
  return null;
}
