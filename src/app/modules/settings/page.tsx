"use client";

/**
 * Settings (autosave)
 * - Toggles save IMMEDIATELY on switch (no Save buttons).
 * - Green toast appears on every successful change.
 * - Still resilient to GET failures and flat/legacy response shapes.
 * - Updates <body data-*> after successful save so booking UI reacts.
 * - Shows "Organization profile" link for Owners (200 from /api/org/profile).
 *
 * Fix: wrap the inner page with <ThemeProvider> so useTheme() has context.
 *      No UI/behavior changes otherwise.
 */

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
// ✅ FIX: ThemeProvider is the DEFAULT export; useTheme is named
import ThemeProvider, { useTheme } from "../../../components/theme-provider";

// Minimal Alert (kept)
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
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-emerald-600 px-4 py-2 text-white shadow-lg"
    >
      <div className="flex items-center gap-3">
        <span className="font-medium">{props.children}</span>
        {props.onClose && (
          <button
            onClick={props.onClose}
            className="rounded bg-white/15 px-2 py-1 text-xs"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/** ---------- helpers ---------- */
function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v.toLowerCase() === "true") return true;
    if (v.toLowerCase() === "false") return false;
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

  // Owner check → controls "Organization profile" section visibility
  const [canEditOrg, setCanEditOrg] = React.useState<boolean | null>(null);

  // Theme (original behavior)
  const themeApi = useTheme() as any;
  const theme: string | undefined = themeApi?.theme;
  const setTheme: ((v: "light" | "dark") => void) | undefined =
    themeApi?.setTheme;
  const toggleTheme: (() => void) | undefined = themeApi?.toggleTheme;

  function chooseTheme(next: "light" | "dark") {
    // Prefer provider if present
    if (setTheme) return setTheme(next);
    if (toggleTheme && typeof theme === "string") {
      const wantDark = next === "dark";
      const isDark = theme === "dark";
      if (wantDark !== isDark) toggleTheme();
      return;
    }
    // Fallback: DOM + localStorage (works even without provider)
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

  // Owner capability probe (silent): if GET /api/org/profile is 200 → show link
  React.useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const res = await fetch("/api/org/profile", { cache: "no-store" });
        if (disposed) return;
        setCanEditOrg(res.ok); // 200 => true; 401/403/404 => false
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
      setToast(null); // only green toast on success
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
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>

      <p className="mb-6">
        <Link href="/modules/booking" className="text-sm underline">
          ← Back to bookings
        </Link>
      </p>

      {/* ========== Organization (Owner-only link) ========== */}
      {canEditOrg ? (
        <section className="mb-10">
          <h2 className="mb-2 text-xl font-medium">Organization</h2>
          <p className="mb-3 text-sm text-gray-600">
            Edit your organization name and other profile details.
          </p>
          <Link
            href="/modules/org/profile"
            className="rounded bg-gray-900 px-3 py-1.5 text-white"
          >
            Open organization profile →
          </Link>
        </section>
      ) : null}

      {/* ========== Org Feature Toggles (autosave) ========== */}
      <section className="mb-10">
        <h2 className="mb-2 text-xl font-medium">Org Feature Toggles</h2>
        <p className="mb-4 text-sm text-gray-600">
          Control which optional fields appear on the booking form.
        </p>

        {loading ? (
          <div className="text-sm text-gray-600">Loading…</div>
        ) : (
          <>
            {loadError && (
              <Alert severity="error" className="mb-3">
                {loadError}
              </Alert>
            )}

            <ToggleRow
              label="Show Program Name"
              description="Display a 'Program Name' field on new bookings."
              checked={toggles.showProgramName}
              onChange={(v) => saveToggle("showProgramName", v)}
            />
            <ToggleRow
              label="Show Host Name (legacy textbox)"
              description="Keep the legacy free-text Host field visible."
              checked={toggles.showHostName}
              onChange={(v) => saveToggle("showHostName", v)}
            />
            <ToggleRow
              label="Show Talking Points"
              description="Expose 'Talking Points' on bookings."
              checked={toggles.showTalkingPoints}
              onChange={(v) => saveToggle("showTalkingPoints", v)}
            />

            <p className="mt-3 text-xs text-gray-500">
              Tip: Changes apply immediately. The Booking form reads flags from{" "}
              <code>&lt;body data-*&gt;</code> on mount.
            </p>
          </>
        )}
      </section>

      {/* ========== Appearance Types (autosave) ========== */}
      <section className="mb-10">
        <h2 className="mb-2 text-xl font-medium">Appearance Types</h2>
        <p className="mb-4 text-sm text-gray-600">
          Choose which appearance types are available to your team.
        </p>

        <ToggleRow
          label="Allow In-Person"
          checked={toggles.allowInPerson}
          onChange={(v) => saveToggle("allowInPerson", v)}
        />
        <ToggleRow
          label="Allow Online"
          checked={toggles.allowOnline}
          onChange={(v) => saveToggle("allowOnline", v)}
        />
      </section>

      {/* ========== Theme (original) ========== */}
      <section className="mb-10">
        <h2 className="mb-2 text-xl font-medium">Appearance</h2>
        <p className="mb-4 text-sm text-gray-600">
          Choose your theme for this device.
        </p>
        <div className="flex gap-3">
          <button
            className="rounded border px-3 py-1.5"
            onClick={() => chooseTheme("light")}
          >
            Light (default)
          </button>
          <button
            className="rounded border px-3 py-1.5"
            onClick={() => chooseTheme("dark")}
          >
            Dark
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
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
    </main>
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

  // keep local knob position in sync when parent changes (e.g., after revert)
  React.useEffect(() => setLocal(props.checked), [props.checked]);

  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block font-medium">
          {props.label}
        </label>
        {props.description && (
          <p className="text-xs text-gray-600">{props.description}</p>
        )}
      </div>

      <button
        id={id}
        type="button"
        aria-label={props.label}
        role="switch"
        aria-checked={local}
        className={`relative h-6 w-11 rounded-full transition ${
          local ? "bg-gray-900" : "bg-gray-300"
        }`}
        onClick={() => {
          const next = !local;
          setLocal(next); // instant UI
          props.onChange(next); // autosave
        }}
      >
        <span
          className={`absolute left-0 top-0 h-6 w-6 transform rounded-full bg-white shadow transition ${
            local ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}
