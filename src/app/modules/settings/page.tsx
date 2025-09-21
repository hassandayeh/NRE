"use client";

/**
 * Settings — resilient save feedback
 * - Preserves: /api/toggles (GET/PUT), <body data-*> sync, and useTheme()
 * - Standardizes: Button, Alert
 * - Feedback: portal ToastBox + inline chip + ARIA live region
 */

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useTheme } from "../../../components/theme-provider";

/** ---------- Shared UI components (default or named exports) ---------- */
import * as ButtonModule from "../../../components/ui/Button";
const Button: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../components/ui/Alert";
const Alert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/** ---------- Types ---------- */
type Toggles = {
  showProgramName: boolean;
  showHostName: boolean;
  showTalkingPoints: boolean;
};

/** ---------- Minimal in-file Toast (works even if shared Toast is non-renderable) ---------- */
function ToastBox(props: {
  kind?: "success" | "error";
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const kind = props.kind ?? "success";
  return (
    <div
      role="status"
      className="pointer-events-auto min-w-[220px] max-w-[360px] rounded-xl border bg-white/95 p-3 shadow-2xl backdrop-blur"
      style={{ borderColor: kind === "success" ? "#16a34a" : "#dc2626" }}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
            kind === "success" ? "bg-green-600" : "bg-red-600"
          }`}
          aria-hidden
        />
        <div className="text-sm text-gray-900">{props.children}</div>
        {props.onClose && (
          <button
            type="button"
            aria-label="Close"
            onClick={props.onClose}
            className="ml-auto rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null); // drives toast/chip

  const [toggles, setToggles] = React.useState<Toggles>({
    showProgramName: true,
    showHostName: true,
    showTalkingPoints: true,
  });

  // === User-level theme (light by default) ===
  const { theme, setTheme } = useTheme();

  // Load current toggles from API (preserved)
  React.useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/toggles", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load toggles");
        const data = (await res.json()) as {
          toggles?: Toggles;
          error?: string;
        };
        if (ignore) return;
        if (!data.toggles) throw new Error(data.error || "Invalid response");
        setToggles(data.toggles);
        setError(null);
      } catch (e: any) {
        if (!ignore) setError(e?.message || "Failed to load toggles");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  // Sync flags into <body data-*> so booking pages can read them on mount (preserved)
  function setBodyDatasets(next: Toggles) {
    if (typeof document === "undefined") return;
    const ds = document.body.dataset as DOMStringMap;
    ds.showProgramName = String(next.showProgramName);
    ds.showHostName = String(next.showHostName);
    ds.showTalkingPoints = String(next.showTalkingPoints);
  }

  // Save toggles (preserved logic) + resilient feedback
  async function handleSave(e?: React.FormEvent) {
    if (e) e.preventDefault();
    try {
      setSaving(true);
      setSuccess(null);
      setError(null);

      const res = await fetch("/api/toggles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toggles),
      });
      // Some setups return empty body; handle safely.
      let data: any = {};
      try {
        data = await res.json();
      } catch {
        // ignore empty body
      }
      if (!res.ok) throw new Error(data?.error || "Failed to save toggles");

      setBodyDatasets(toggles);

      // Visible feedback
      setSuccess("Saved!");
    } catch (e: any) {
      setError(e?.message || "Failed to save toggles");
      setSuccess(null);
    } finally {
      setSaving(false);
    }
  }

  // Auto-hide success toast after 1.8s
  React.useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 1800);
    return () => clearTimeout(t);
  }, [success]);

  // Portal root (mounted only in browser)
  const [portalReady, setPortalReady] = React.useState(false);
  React.useEffect(() => setPortalReady(true), []);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      {/* SR live region for success messages */}
      <div aria-live="polite" className="sr-only">
        {success ? "Saved" : ""}
      </div>

      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <Link
          href="/modules/booking"
          className="text-sm text-blue-600 underline"
        >
          ← Back to bookings
        </Link>
      </header>

      {/* ========== Org Feature Toggles (existing) ========== */}
      <form onSubmit={handleSave} className="space-y-3 rounded-xl border p-4">
        <h2 className="text-lg font-medium">Org Feature Toggles</h2>
        <p className="text-sm text-gray-600">
          Control which optional fields appear on the booking form.
        </p>

        {loading ? (
          <p className="text-sm text-gray-600">Loading…</p>
        ) : error ? (
          <Alert variant="error">{error}</Alert>
        ) : (
          <>
            <ToggleRow
              label="Program name"
              description="Show 'Program name' on booking form"
              checked={toggles.showProgramName}
              onChange={(v) =>
                setToggles((t) => ({ ...t, showProgramName: v }))
              }
            />
            <ToggleRow
              label="Host name"
              description="Show 'Host name' on booking form"
              checked={toggles.showHostName}
              onChange={(v) => setToggles((t) => ({ ...t, showHostName: v }))}
            />
            <ToggleRow
              label="Talking points"
              description="Show 'Talking points' on booking form"
              checked={toggles.showTalkingPoints}
              onChange={(v) =>
                setToggles((t) => ({ ...t, showTalkingPoints: v }))
              }
            />

            <div className="mt-3 flex items-center gap-3">
              <Button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm"
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>

              <Button
                type="button"
                className="border px-4 py-2 text-sm"
                onClick={() =>
                  setToggles({
                    showProgramName: true,
                    showHostName: true,
                    showTalkingPoints: true,
                  })
                }
              >
                Reset to defaults
              </Button>

              {/* Inline chip so there is ALWAYS a visible signal even if a toast is clipped */}
              {success && (
                <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700 ring-1 ring-green-200">
                  Saved!
                </span>
              )}
            </div>
          </>
        )}

        <div className="pt-2">
          <h3 className="mb-1 text-sm font-semibold">Tip</h3>
          <p className="text-sm text-gray-600">
            Changes apply immediately. The Booking form reads flags from{" "}
            <code>&lt;body data-*&gt;</code> on mount. After saving, navigate to
            the form and it will use the new values.
          </p>
        </div>
      </form>

      {/* ========== User Theme (existing) ========== */}
      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-lg font-medium">Appearance</h2>
        <p className="text-sm text-gray-600">
          Choose your theme for this device.
        </p>

        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="theme"
              value="light"
              checked={theme === "light"}
              onChange={() => setTheme("light")}
            />
            <span>Light (default)</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="theme"
              value="dark"
              checked={theme === "dark"}
              onChange={() => setTheme("dark")}
            />
            <span>Dark</span>
          </label>
        </div>

        <p className="text-sm text-gray-600">
          This preference is saved locally in your browser. We can move it to a
          DB-backed user setting later.
        </p>
      </section>

      {/* Portal toast (escapes stacking/overflow issues) */}
      {portalReady && success
        ? createPortal(
            <div className="pointer-events-none fixed bottom-4 right-4 z-[9999]">
              <ToastBox onClose={() => setSuccess(null)}>{success}</ToastBox>
            </div>,
            document.body
          )
        : null}
    </main>
  );
}

/** ---------- Small presentational toggle row (preserved) ---------- */
function ToggleRow(props: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="mr-4">
        <label htmlFor={id} className="font-medium">
          {props.label}
        </label>
        {props.description && (
          <p className="text-sm text-gray-600">{props.description}</p>
        )}
      </div>

      <button
        id={id}
        type="button"
        onClick={() => props.onChange(!props.checked)}
        className={`relative h-6 w-11 rounded-full transition ${
          props.checked ? "bg-gray-900" : "bg-gray-300"
        }`}
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
      >
        <span
          className={`absolute left-0 top-0 h-6 w-6 rounded-full bg-white shadow transition ${
            props.checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
