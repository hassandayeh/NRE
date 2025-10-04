"use client";

/**
 * Settings (autosave)
 * - FIX: derive ?orgId=... synchronously from the current URL using useSearchParams()
 *   and append it to BOTH:
 *     • Users & Roles
 *     • Modes & access
 * - No effects/refs/profile calls are used to build these hrefs.
 * - Everything else is unchanged.
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
    <div className="fixed right-4 top-4 z-50 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 shadow-sm">
      {props.children}
      {props.onClose && (
        <button
          type="button"
          onClick={props.onClose}
          className="ml-3 inline-flex rounded-md px-1 text-emerald-900/70 hover:text-emerald-900"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
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
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <SettingsInner />
    </main>
  );
}

/* ----------
 * Inner page
 * ---------- */
function SettingsInner() {
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [toggles, setToggles] = React.useState<Toggles>({
    showProgramName: true,
    showHostName: true,
    showTalkingPoints: true,
    allowInPerson: true,
    allowOnline: true,
  });

  // Show one green toast for any successful change
  const [toast, setToast] = React.useState<string | null>(null);

  // Prevent double-submit per key
  const savingRef = React.useRef<Set<keyof Toggles>>(new Set());

  // Owner check → only controls "Organization profile" link visibility
  const [canEditOrg, setCanEditOrg] = React.useState(false);

  // ========== Synchronous orgId passthrough for links ==========
  const searchParams = useSearchParams();
  const orgQ = React.useMemo(() => {
    const id = searchParams.get("orgId");
    return id ? `?orgId=${encodeURIComponent(id)}` : "";
  }, [searchParams]);
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

  // Owner capability probe (silent): if GET /api/org/profile is 200 → show org-profile link
  React.useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const res = await fetch("/api/org/profile", { cache: "no-store" });
        if (disposed) return;
        setCanEditOrg(res.ok);
      } catch {
        if (!disposed) setCanEditOrg(false);
      }
    })();
    return () => {
      disposed = true;
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

  // Local theme switch without relying on a provider
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
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <div className="mt-2">
          <Link
            href="/modules/bookings"
            className="text-sm text-neutral-600 underline underline-offset-4 hover:text-neutral-800"
          >
            ← Back to bookings
          </Link>
        </div>
      </header>

      {/* ========== Organization (ALWAYS visible) ========== */}
      <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">Organization</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Manage org users and profile.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          {/* Users & Roles — appends ?orgId=... if present on current URL */}
          <Link
            href={`/modules/settings/users${orgQ}`}
            className="inline-flex h-9 items-center rounded-xl border border-neutral-200 bg-white px-3 text-sm hover:bg-neutral-50"
          >
            Users &amp; Roles
          </Link>

          {/* Modes & access — mirrors the exact same ?orgId=... derivation */}
          <Link
            href={`/modules/settings/modes-access${orgQ}`}
            className="inline-flex h-9 items-center rounded-xl border border-neutral-200 bg-white px-3 text-sm hover:bg-neutral-50"
          >
            Modes & access
          </Link>
          {/* Org profile link is owner-only */}
          {canEditOrg && (
            <Link
              href="/modules/settings/org-profile"
              className="inline-flex h-9 items-center rounded-xl border border-neutral-200 bg-white px-3 text-sm hover:bg-neutral-50"
            >
              Open organization profile →
            </Link>
          )}
        </div>
      </section>

      {/* ========== Org Feature Toggles (autosave) ========== */}
      <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">
          Org Feature Toggles
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Control which optional fields appear on the booking form.
        </p>

        {loading ? (
          <p className="mt-3 text-sm text-neutral-600">Loading…</p>
        ) : (
          <>
            {loadError && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {loadError}
              </div>
            )}

            <div className="mt-2 space-y-3">
              <ToggleRow
                label="Show program name"
                description="Display the program name on booking forms."
                checked={toggles.showProgramName}
                onChange={(v) => saveToggle("showProgramName", v)}
              />

              <ToggleRow
                label="Show host name"
                description="Display the host name on booking forms."
                checked={toggles.showHostName}
                onChange={(v) => saveToggle("showHostName", v)}
              />

              <ToggleRow
                label="Show talking points"
                description="Display an area for talking points."
                checked={toggles.showTalkingPoints}
                onChange={(v) => saveToggle("showTalkingPoints", v)}
              />
            </div>

            <p className="mt-3 text-xs text-neutral-500">
              Tip: Changes apply immediately. The Booking form reads flags from{" "}
              <code>document.body.dataset</code> on mount.
            </p>
          </>
        )}
      </section>

      {/* ========== Appearance Types (autosave) ========== */}
      <section className="mb-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">
          Appearance Types
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Choose which appearance types are available to your team.
        </p>

        <div className="mt-3 space-y-3">
          <ToggleRow
            label="Allow in-person"
            checked={toggles.allowInPerson}
            onChange={(v) => saveToggle("allowInPerson", v)}
          />
          <ToggleRow
            label="Allow online"
            checked={toggles.allowOnline}
            onChange={(v) => saveToggle("allowOnline", v)}
          />
        </div>
      </section>

      {/* ========== Theme (local) ========== */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">Appearance</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Choose your theme for this device.
        </p>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => chooseTheme("light")}
            className="rounded-lg border bg-white px-3 py-2 text-sm shadow-sm hover:bg-gray-50"
          >
            Light (default)
          </button>
          <button
            type="button"
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
    <div className="flex items-start justify-between gap-6 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-neutral-900">
          {props.label}
        </label>
        {props.description && (
          <p className="mt-1 text-xs text-neutral-600">{props.description}</p>
        )}
      </div>
      <button
        id={id}
        type="button"
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
          className={`block h-5 w-5 translate-x-0 rounded-full bg-white transition ${
            local ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}
