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
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";

/* ---------- Types ---------- */
type Toggles = {
  showProgramName: boolean;
  showHostName: boolean;
  showTalkingPoints: boolean;
  allowInPerson: boolean;
  allowOnline: boolean;
};
type PartialTogglesFromApi = Partial<Toggles> & { [k: string]: unknown };

/* ---------- Toast ---------- */
function ToastBox(props: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed right-4 top-4 z-50 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 shadow">
      {props.children}
      {props.onClose && (
        <button
          onClick={props.onClose}
          className="ml-3 rounded border px-2 py-0.5 text-xs text-emerald-900 hover:bg-emerald-100"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function ForbiddenCard() {
  return (
    <section className="rounded-2xl border border-neutral-200 p-5 shadow-sm bg-white">
      {/* ...contents... */}
    </section>
  );
}

/* ---------- helpers ---------- */
function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  return fallback;
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

  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [toggles, setToggles] = React.useState<Toggles>({
    showProgramName: true,
    showHostName: true,
    showTalkingPoints: true,
    allowInPerson: true,
    allowOnline: true,
  });

  // Green toast for successful change
  const [toast, setToast] = React.useState<string | null>(null);

  // Prevent double-submit per key
  const savingRef = React.useRef<Set<keyof Toggles>>(new Set());

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

  // ============================================================
  // Load toggles (accepts flat or { toggles } shapes)
  React.useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/toggles", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load toggles");
        const raw = await res.json();
        const data: PartialTogglesFromApi =
          (raw && typeof raw === "object" && "toggles" in raw
            ? (raw as any).toggles
            : raw) ?? {};
        const next: Toggles = {
          showProgramName: toBool(data.showProgramName, true),
          showHostName: toBool(data.showHostName, true),
          showTalkingPoints: toBool(data.showTalkingPoints, true),
          allowInPerson: toBool((data as any).allowInPerson, true),
          allowOnline: toBool((data as any).allowOnline, true),
        };
        if (!ignore) {
          setToggles(next);
          setLoadError(null);
          applyBodyDatasets(next);
        }
      } catch (e: any) {
        if (!ignore) setLoadError(e?.message || "Failed to load toggles");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  // Sync after a successful save
  function applyBodyDatasets(next: Toggles) {
    if (typeof document === "undefined") return;
    const ds = document.body.dataset as DOMStringMap;
    ds.showProgramName = String(next.showProgramName);
    ds.showHostName = String(next.showHostName);
    ds.showTalkingPoints = String(next.showTalkingPoints);
    ds.allowInPerson = String(next.allowInPerson);
    ds.allowOnline = String(next.allowOnline);
  }

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
  async function saveToggle<K extends keyof Toggles>(
    key: K,
    value: Toggles[K]
  ) {
    if (savingRef.current.has(key)) return;
    savingRef.current.add(key);

    // Optimistic UI
    setToggles((t) => ({ ...t, [key]: value }));

    try {
      const res = await fetch("/api/toggles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const ok = res.ok;
      try {
        await res.json();
      } catch {
        /* empty body ok */
      }
      if (!ok) throw new Error("Failed to save");

      // Success → sync body dataset + toast
      const next = { ...toggles, [key]: value } as Toggles;
      applyBodyDatasets(next);
      setToast("Saved!");
    } catch {
      // Revert if failed
      setToggles((t) => ({
        ...t,
        [key]: !value as unknown as Toggles[typeof key],
      }));
      setToast(null);
    } finally {
      savingRef.current.delete(key);
    }
  }

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

      {/* Green toast only */}
      {portalReady && toast
        ? createPortal(
            <ToastBox onClose={() => setToast(null)}>{toast}</ToastBox>,
            document.body
          )
        : null}
    </>
  );
}

/* ---------- Toggle row ---------- */
function ToggleRow(props: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  const id = React.useId();
  const [local, setLocal] = React.useState(props.checked);
  React.useEffect(() => setLocal(props.checked), [props.checked]);

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium">
          {props.label}
        </label>
        {props.description && (
          <p className="mt-0.5 text-xs text-neutral-600">{props.description}</p>
        )}
      </div>

      <button
        id={id}
        onClick={() => {
          const next = !local;
          setLocal(next);
          props.onChange(next);
        }}
        className={`h-6 w-11 rounded-full border transition ${
          local ? "bg-emerald-500" : "bg-gray-200"
        }`}
        aria-pressed={local}
      >
        <span
          className={`block h-5 w-5 translate-x-0.5 rounded-full bg-white transition ${
            local ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}
