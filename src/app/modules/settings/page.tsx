"use client";

/**
 * Settings (autosave)
 * - Org resolution: URL ?orgId → /api/auth/session (single-org policy)
 * - Probes /api/org/roles?orgId=...&probe=1 to decide show/hide Organization section
 * - Always shows the "Organization profile →" link when the section is visible
 * - Feature toggles / appearance remain unchanged
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function ForbiddenCard() {
  return (
    <section className="rounded-2xl border border-neutral-200 p-5 shadow-sm bg-white">
      {/* ...contents... */}
    </section>
  );
}

/* =========================================================
 * Page
 * =======================================================*/
export default function SettingsPage() {
  return <SettingsInner />;
}

/* ----------
 * Inner page
 * ---------- */
function SettingsInner() {
  // Platform-level CTA: check if a personal guest profile exists
  const [session, setSession] = React.useState<any | undefined>(undefined);
  React.useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const r = await fetch("/api/auth/session", { cache: "no-store" });
        const s = r.ok ? await r.json().catch(() => null) : null;
        if (!disposed) setSession(s);
      } catch {
        if (!disposed) setSession(null);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);
  const hasGuestProfile = Boolean(
    (session as any)?.guestProfileId ?? (session as any)?.user?.guestProfileId
  );

  // ========== OrgId discovery (fast) ==========
  const searchParams = useSearchParams();
  const orgIdFromUrl = searchParams.get("orgId");
  const [orgIdForProbe, setOrgIdForProbe] = React.useState<string | null>(
    () => orgIdFromUrl || null
  );

  // If we still don't have orgId (no LS & no URL), probe session once.
  React.useEffect(() => {
    if (orgIdForProbe) return;
    let disposed = false;
    (async () => {
      try {
        const r = await fetch("/api/auth/session", { cache: "no-store" });
        if (!r.ok) throw new Error("no session");
        const s: any = await r.json().catch(() => ({}));
        const id: string =
          (s?.orgId as string) ||
          (s?.user?.orgId as string) ||
          (s?.user?.org?.id as string) ||
          "";
        if (!disposed) setOrgIdForProbe(id || null);
      } catch {
        if (!disposed) setOrgIdForProbe(null);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [orgIdForProbe]);

  // Build ?orgId= for links synchronously (URL wins here so deep-links keep working)
  const orgQ = React.useMemo(() => {
    const id = orgIdFromUrl || orgIdForProbe || "";
    return id ? `?orgId=${encodeURIComponent(id)}` : "";
  }, [orgIdFromUrl, orgIdForProbe]);

  // ========== Fast permission probe ==========
  // null = probing, true = show section, false = hide
  const [canManageSettings, setCanManageSettings] = React.useState<
    boolean | null
  >(null);

  React.useEffect(() => {
    let disposed = false;
    (async () => {
      // If we have no orgId at all, hide quickly (no spinner)
      if (!orgIdForProbe) {
        setCanManageSettings(false);
        return;
      }
      try {
        // Fast path probe (no heavy role-slot loads)
        const res = await fetch(
          `/api/org/roles?orgId=${encodeURIComponent(orgIdForProbe)}&probe=1`,
          { cache: "no-store" }
        );
        if (disposed) return;
        if (res.status === 200) setCanManageSettings(true);
        else if (res.status === 403) setCanManageSettings(false);
        else setCanManageSettings(false);
      } catch {
        if (!disposed) setCanManageSettings(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [orgIdForProbe]);

  // Sync after a successful save

  // Local theme switch without a provider
  function chooseTheme(next: "light" | "dark") {
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (next === "dark") root.classList.add("dark");
      else root.classList.remove("dark");
      try {
        localStorage.setItem("theme", next);
      } catch {}
    }
  }

  // Autosave a single key (optimistic)

  const [portalReady, setPortalReady] = React.useState(false);
  React.useEffect(() => setPortalReady(true), []);

  return (
    <>
      {/* Title + Back */}
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>
        <Link
          href="/modules/bookings"
          className="mb-6 inline-block text-sm underline"
        >
          &larr; Back to bookings
        </Link>

        {/* Personal login (guest) CTA — platform-level */}
        {session !== undefined && !hasGuestProfile ? (
          <div className="mb-6 rounded-md border bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">
                  Add a personal login (recommended)
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  Link a personal email so you keep access if your work account
                  changes. We never copy org data—your personal login is
                  separate.
                </p>
              </div>
              <div className="mt-3 sm:mt-0">
                <Link
                  href="/account/prepare-guest"
                  className="inline-flex items-center rounded-md border bg-black px-3 py-1.5 text-sm text-white hover:bg-black/90"
                >
                  Set up personal login
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        {/* ========== Organization (fast gated by probe) ========== */}
        {canManageSettings ? (
          <section className="mb-6 rounded-lg border bg-white p-4 shadow-sm">
            <h2 className="mb-1 text-lg font-medium">Organization</h2>
            <p className="mb-3 text-sm text-neutral-600">
              Manage org users and profile.
            </p>

            <Link
              href={`/modules/settings/users${orgQ}`}
              className="mr-2 inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-gray-50"
            >
              Users &amp; Roles
            </Link>

            <Link
              href={`/modules/settings/modes-access${orgQ}`}
              className="mr-2 inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-gray-50"
            >
              Modes &amp; access
            </Link>

            <div className="mt-3">
              <Link
                href={`/modules/settings/org-profile${orgQ}`}
                className="text-sm underline"
              >
                Organization profile &rarr;
              </Link>
            </div>
          </section>
        ) : null}

        {/* ────────────────────────────────────────────────────────────
   Your account (not admin-gated)
   Shown to all users; the Privacy page itself already handles
   guest-only logic gracefully.
   ──────────────────────────────────────────────────────────── */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold tracking-wide text-gray-700">
            Your account
          </h2>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {/* Privacy (guest visibility) */}
            <a
              href="/modules/settings/privacy"
              className="block rounded-xl border border-gray-200 p-4 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
            >
              <div className="text-sm font-medium">Privacy</div>
              <div className="mt-1 text-xs text-gray-500">
                Control your public listing & visibility.
              </div>
            </a>
          </div>
        </section>

        {/* ========== Theme (local) ========== */}
        <section className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-lg font-medium">Appearance</h2>
          <p className="mb-3 text-sm text-neutral-600">
            Choose your theme for this device.
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => chooseTheme("light")}
              className="rounded-lg border bg-white px-3 py-2 text-sm shadow-sm hover:bg-gray-50"
            >
              Light (default)
            </button>
            <button
              onClick={() => chooseTheme("dark")}
              className="rounded-lg border bg-white px-3 py-2 text-sm shadow-sm hover:bg-gray-50"
            >
              Dark
            </button>
          </div>

          <p className="mt-2 text-xs text-neutral-500">
            Stored locally. We can wire this to your global provider later.
          </p>
        </section>
      </main>
    </>
  );
}
