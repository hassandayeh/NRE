// src/lib/session.ts
import "server-only";

/**
 * App-wide, minimal session shape we rely on in pages.
 * We read from multiple possible fields to be compatible with v4/v5 setups.
 */
export type AppSession = {
  userId: string | null;
  email?: string | null;
  orgId?: string | null;
  roleSlot?: number | null; // 1..10
  roleLabel?: string | null;
};

/**
 * Try several auth entry points without assuming your exact export:
 * - next-auth v5 style:   auth()
 * - custom helper:        getServerAuthSession()
 * - next-auth v4 style:   getServerSession(authOptions)
 * - bare getServerSession() if configured globally
 */
async function fetchRawSession(): Promise<any> {
  // Try loading your local auth module (whatever it exports)
  try {
    const mod: any = await import("./auth"); // DO NOT change to alias; keep relative
    if (typeof mod.auth === "function") {
      return await mod.auth();
    }
    if (typeof mod.getServerAuthSession === "function") {
      return await mod.getServerAuthSession();
    }
    if (mod.authOptions) {
      try {
        const nextAuth: any = await import("next-auth");
        if (typeof nextAuth.getServerSession === "function") {
          return await nextAuth.getServerSession(mod.authOptions);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore if ./auth doesn't exist or has different shape
  }

  // Last resort: try getServerSession() with no options
  try {
    const nextAuth: any = await import("next-auth");
    if (typeof nextAuth.getServerSession === "function") {
      return await nextAuth.getServerSession();
    }
  } catch {
    // ignore
  }

  return null;
}

/** Normalize the session into our small shape. */
export async function getSession(): Promise<AppSession> {
  const s: any = await fetchRawSession();

  return {
    userId: s?.user?.id ?? s?.userId ?? null,
    email: s?.user?.email ?? s?.email ?? null,
    orgId: s?.orgId ?? s?.user?.orgId ?? null,
    roleSlot: s?.roleSlot ?? s?.user?.roleSlot ?? null,
    roleLabel: s?.roleLabel ?? s?.user?.roleLabel ?? null,
  };
}

export function isAdminLike(session: AppSession): boolean {
  // Treat Role 1–2 as admins; adjust if your policy differs.
  return !!session.roleSlot && session.roleSlot <= 2;
}

/**
 * Resolve effective orgId for a page:
 * - Prefer session.orgId
 * - Allow ?orgId= override ONLY if admin/dev
 * - Optionally validate membership via opts.validateOverride(orgId, session)
 * - Never throw: returns null orgId if none
 */
export async function resolveOrgContext(
  searchParams?: { orgId?: string | string[] },
  opts?: {
    /** Optional async validation that returns true if the user is a member of the override org. */
    validateOverride?: (orgId: string, session: AppSession) => Promise<boolean>;
  }
): Promise<{
  session: AppSession;
  orgId: string | null;
  adminOverrideUsed: boolean;
}> {
  const session = await getSession();

  // Start with session org (preferred)
  let effectiveOrgId: string | null = session.orgId ?? null;
  let adminOverrideUsed = false;

  // Optional override (admin/dev only)
  const rawOverride = searchParams?.orgId;
  const override = Array.isArray(rawOverride)
    ? rawOverride[0]
    : rawOverride || null;

  const isDev = process.env.NODE_ENV !== "production";

  if (override && (isDev || isAdminLike(session))) {
    let ok = false;

    if (opts?.validateOverride) {
      try {
        ok = await opts.validateOverride(override, session);
      } catch {
        ok = false;
      }
    } else {
      // If no validator was supplied:
      // - In dev: allow override (to simplify testing)
      // - In prod: require validator (ignored if missing)
      ok = isDev;
    }

    if (ok) {
      effectiveOrgId = override;
      adminOverrideUsed = true;
    }
  }

  return {
    session,
    orgId: effectiveOrgId,
    adminOverrideUsed,
  };
}
