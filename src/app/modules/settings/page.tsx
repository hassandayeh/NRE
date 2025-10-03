"use client";

/**
 * Settings (autosave)
 * - Renamed button: "Users & Roles" → /modules/settings/users (org auto-detected there)
 * - No dependency on ThemeProvider (props mismatch). Uses a safe local theme toggle.
 * - Toggles still autosave to /api/toggles and apply to <body data-*>.
 */

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";

// Minimal Alert (keep original style/compat if present)
import * as AlertModule from "../../../components/ui/Alert";
const Alert: React.ElementType =
  (AlertModule as any).Alert ??
  (AlertModule as any).default ??
  ((props: any) => <div {...props} />);

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
    <div className="fixed right-4 top-4 z-50 rounded-md bg-green-600 px-3 py-2 text-sm text-white shadow">
      {props.children}
      {props.onClose && (
        <button
          onClick={props.onClose}
          className="ml-3 rounded bg-white/20 px-2 py-0.5 text-xs"
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
 * ========================================================= */
export default function SettingsPage() {
  return <SettingsInner />;
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

  // Auto-hide toast
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  const [portalReady, setPortalReady] = React.useState(false);
  React.useEffect(() => setPortalReady(true), []);

  return (
    <main className="mx-auto max-w-3xl p-6">
      {/* Title + Back */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link
          href="/modules/booking"
          className="text-sm text-blue-600 underline"
        >
          ← Back to bookings
        </Link>
      </div>

      {/* ========== Organization (ALWAYS visible) ========== */}
      <section className="mb-8 rounded-xl border bg-white p-4">
        <h2 className="mb-1 text-lg font-medium">Organization</h2>
        <p className="mb-3 text-sm text-gray-600">
          Manage org users and profile.
        </p>

        {/* Users button goes to the unified Users & Roles page */}
        <Link
          href="/modules/settings/users"
          className="mr-3 inline-flex h-9 items-center rounded-lg border bg-white px-3 text-sm shadow-sm hover:bg-gray-50"
        >
          Users &amp; Roles
        </Link>

        {/* Org profile link is owner-only */}
        {canEditOrg && (
          <Link
            href="/modules/settings/org"
            className="inline-flex h-9 items-center rounded-lg border bg-white px-3 text-sm shadow-sm hover:bg-gray-50"
          >
            Open organization profile →
          </Link>
        )}
      </section>

      {/* ========== Org Feature Toggles (autosave) ========== */}
      <section className="mb-8 rounded-xl border bg-white p-4">
        <h2 className="mb-1 text-lg font-medium">Org Feature Toggles</h2>
        <p className="mb-3 text-sm text-gray-600">
          Control which optional fields appear on the booking form.
        </p>

        {loading ? (
          <div className="text-sm text-gray-600">Loading…</div>
        ) : (
          <>
            {loadError && (
              <Alert className="mb-3">
                <span className="text-sm text-red-700">{loadError}</span>
              </Alert>
            )}

            <div className="space-y-3">
              <ToggleRow
                label="Show program name"
                description="Display program name in booking details."
                checked={toggles.showProgramName}
                onChange={(v) => saveToggle("showProgramName", v)}
              />

              <ToggleRow
                label="Show host name"
                description="Display host name in booking details."
                checked={toggles.showHostName}
                onChange={(v) => saveToggle("showHostName", v)}
              />

              <ToggleRow
                label="Show talking points"
                description="Display talking points section."
                checked={toggles.showTalkingPoints}
                onChange={(v) => saveToggle("showTalkingPoints", v)}
              />

              <p className="mt-4 text-xs text-gray-500">
                Tip: Changes apply immediately. The Booking form reads flags
                from{" "}
                <code className="rounded bg-gray-100 px-1">
                  {"<body data-* >"}
                </code>{" "}
                on mount.
              </p>
            </div>
          </>
        )}
      </section>

      {/* ========== Appearance Types (autosave) ========== */}
      <section className="mb-8 rounded-xl border bg-white p-4">
        <h2 className="mb-1 text-lg font-medium">Appearance Types</h2>
        <p className="mb-3 text-sm text-gray-600">
          Choose which appearance types are available to your team.
        </p>

        <div className="space-y-3">
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
      <section className="mb-8 rounded-xl border bg-white p-4">
        <h2 className="mb-1 text-lg font-medium">Appearance</h2>
        <p className="mb-3 text-sm text-gray-600">
          Choose your theme for this device.
        </p>

        <div className="flex gap-3">
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

        <p className="mt-2 text-xs text-gray-500">
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
    </main>
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
    <div className="flex items-start justify-between rounded-lg border p-3">
      <div className="pr-3">
        <label htmlFor={id} className="block text-sm font-medium text-gray-900">
          {props.label}
        </label>
        {props.description && (
          <p className="mt-0.5 text-xs text-gray-600">{props.description}</p>
        )}
      </div>

      <button
        id={id}
        role="switch"
        aria-checked={local ? "true" : "false"}
        onClick={() => {
          const next = !local;
          setLocal(next);
          props.onChange(next);
        }}
        className={`h-6 w-11 rounded-full border transition ${
          local ? "bg-emerald-500" : "bg-gray-200"
        }`}
      >
        <span
          className={`block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition ${
            local ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}
