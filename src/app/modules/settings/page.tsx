"use client";

/**
 * Settings (autosave)
 * - Toggles save IMMEDIATELY on switch (no Save buttons).
 * - Green toast appears on every successful change.
 * - Still resilient to GET failures and flat/legacy response shapes.
 * - Updates after successful save so booking UI reacts.
 * - "Organization" section now ALWAYS shows.
 *   - "Users (Org access)" button links to /modules/settings/users (dedicated users page).
 *   - "Organization profile" link appears only if GET /api/org/profile is 200.
 */

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";

// ThemeProvider default export, useTheme is named export
import ThemeProvider, { useTheme } from "../../../components/theme-provider";

// Minimal Alert (kept style)
import * as AlertModule from "../../../components/ui/Alert";
const Alert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/** ---------- Types ---------- */
type Toggles = {
  showProgramName: boolean;
  showHostName: boolean;
  showTalkingPoints: boolean;
  allowInPerson: boolean;
  allowOnline: boolean;
};

type PartialTogglesFromApi = Partial<Toggles> & { [k: string]: unknown };

/** ---------- Toast ---------- */
function ToastBox(props: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-x-0 top-3 z-50 mx-auto w-fit rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white shadow-md">
      {props.children}
      {props.onClose && (
        <button
          type="button"
          onClick={props.onClose}
          className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-white/20"
          aria-label="Close"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** ---------- helpers ---------- */
function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  return fallback;
}

/** =========================================================
 * Wrapper component: provides Theme context for the inner page
 * ========================================================= */
export default function SettingsPage() {
  return (
    <ThemeProvider>
      <SettingsInner />
    </ThemeProvider>
  );
}

/** ----------
 * Inner page (original UI/logic lives here)
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
  const [canEditOrg, setCanEditOrg] = React.useState<boolean>(false);

  // Theme (original behavior)
  const themeApi = useTheme() as any;
  const theme: string | undefined = themeApi?.theme;
  const setTheme: ((v: "light" | "dark") => void) | undefined =
    themeApi?.setTheme;
  const toggleTheme: (() => void) | undefined = themeApi?.toggleTheme;

  function chooseTheme(next: "light" | "dark") {
    if (setTheme) return setTheme(next);
    if (toggleTheme && typeof theme === "string") {
      const wantDark = next === "dark";
      const isDark = theme === "dark";
      if (wantDark !== isDark) toggleTheme();
      return;
    }
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (next === "dark") root.classList.add("dark");
      else root.classList.remove("dark");
      try {
        localStorage.setItem("theme", next);
      } catch {}
    }
  }

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
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <div className="mt-2">
        <Link
          href="/modules/booking"
          className="inline-flex items-center gap-1 text-sm text-gray-600 underline-offset-2 hover:underline"
        >
          ← Back to bookings
        </Link>
      </div>

      {/* ========== Organization (ALWAYS visible) ========== */}
      <section className="mt-6 rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Organization</h2>
        <p className="mt-1 text-xs text-gray-600">
          Manage org users and profile.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Users button goes to the dedicated Users page */}
          <Link
            href="/modules/settings/users"
            className="rounded-lg bg-black px-3 py-2 text-sm text-white shadow-sm"
          >
            Users (Org access)
          </Link>

          {/* Org profile link is owner-only */}
          {canEditOrg && (
            <Link
              href="/modules/settings/org-profile"
              className="rounded-lg border bg-white px-3 py-2 text-sm shadow-sm"
            >
              Open organization profile →
            </Link>
          )}
        </div>
      </section>

      {/* ========== Org Feature Toggles (autosave) ========== */}
      <section className="mt-6 rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Org Feature Toggles</h2>
        <p className="mt-1 text-xs text-gray-600">
          Control which optional fields appear on the booking form.
        </p>

        {loading ? (
          <div className="mt-3 text-sm text-gray-600">Loading…</div>
        ) : (
          <>
            {loadError && (
              <div className="mt-3">
                <Alert intent="danger">{loadError}</Alert>
              </div>
            )}

            <div className="mt-3 divide-y">
              <ToggleRow
                label="Show program name"
                description="Display the program name field on the booking form."
                checked={toggles.showProgramName}
                onChange={(v) => saveToggle("showProgramName", v)}
              />
              <ToggleRow
                label="Show host name"
                description="Display the host name field on the booking form."
                checked={toggles.showHostName}
                onChange={(v) => saveToggle("showHostName", v)}
              />
              <ToggleRow
                label="Show talking points"
                description="Display a talking points textarea on the booking form."
                checked={toggles.showTalkingPoints}
                onChange={(v) => saveToggle("showTalkingPoints", v)}
              />
            </div>

            <p className="mt-2 text-xs text-gray-600">
              Tip: Changes apply immediately. The Booking form reads flags from{" "}
              <code>&lt;body data-* &gt;</code> on mount.
            </p>
          </>
        )}
      </section>

      {/* ========== Appearance Types (autosave) ========== */}
      <section className="mt-6 rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Appearance Types</h2>
        <p className="mt-1 text-xs text-gray-600">
          Choose which appearance types are available to your team.
        </p>
        <div className="mt-3 divide-y">
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

      {/* ========== Theme (original) ========== */}
      <section className="mt-6 rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Appearance</h2>
        <p className="mt-1 text-xs text-gray-600">
          Choose your theme for this device.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => chooseTheme("light")}
            className="rounded-lg border bg-white px-3 py-2 text-sm shadow-sm"
          >
            Light (default)
          </button>
          <button
            type="button"
            onClick={() => chooseTheme("dark")}
            className="rounded-lg border bg-white px-3 py-2 text-sm shadow-sm"
          >
            Dark
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-600">
          Stored locally (or via provider). We can persist per-user later.
        </p>
      </section>

      {/* Green toast only */}
      {portalReady && toast
        ? createPortal(
            <ToastBox onClose={() => setToast(null)}>{toast}</ToastBox>,
            document.body
          )
        : null}
    </div>
  );
}

/** ---------- Toggle row ---------- */
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
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium">
          {props.label}
        </label>
        {props.description && (
          <p className="mt-0.5 text-xs text-gray-600">{props.description}</p>
        )}
      </div>

      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={local ? "true" : "false"}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          local ? "bg-black" : "bg-gray-300"
        }`}
        onClick={() => {
          const next = !local;
          setLocal(next);
          props.onChange(next);
        }}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            local ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
