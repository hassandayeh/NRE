"use client";

import * as React from "react";
import Link from "next/link";
import { useTheme } from "../../../components/theme-provider";

type Toggles = {
  showProgramName: boolean;
  showHostName: boolean;
  showTalkingPoints: boolean;
};

export default function SettingsPage() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const [toggles, setToggles] = React.useState<Toggles>({
    showProgramName: true,
    showHostName: true,
    showTalkingPoints: true,
  });

  // === User-level theme (light by default) ===
  const { theme, setTheme } = useTheme();

  // Load current toggles from API
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

  function setBodyDatasets(next: Toggles) {
    if (typeof document === "undefined") return;
    const ds = document.body.dataset as DOMStringMap;
    ds.showProgramName = String(next.showProgramName);
    ds.showHostName = String(next.showHostName);
    ds.showTalkingPoints = String(next.showTalkingPoints);
  }

  async function handleSave() {
    try {
      setSaving(true);
      setSuccess(null);
      setError(null);

      const res = await fetch("/api/toggles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toggles),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save toggles");

      // Sync so the Booking form will see fresh values on mount
      setBodyDatasets(toggles);
      setSuccess("Saved!");
    } catch (e: any) {
      setError(e?.message || "Failed to save toggles");
    } finally {
      setSaving(false);
      setTimeout(() => setSuccess(null), 1500);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Link
        href="/modules/booking"
        className="inline-flex w-fit items-center text-sm text-gray-600 hover:text-gray-900"
      >
        ← Back to bookings
      </Link>

      {/* ========== Org Feature Toggles (existing) ========== */}
      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-lg font-medium">Org Feature Toggles</h2>
        <p className="mb-4 text-sm text-gray-600">
          Control which optional fields appear on the booking form.
        </p>

        {loading ? (
          <p>Loading…</p>
        ) : error ? (
          <p className="text-red-600">{error}</p>
        ) : (
          <>
            <ToggleRow
              label="Program name"
              description="Show a free-text Program name field on the booking form."
              checked={toggles.showProgramName}
              onChange={(v) =>
                setToggles((t) => ({ ...t, showProgramName: v }))
              }
            />
            <ToggleRow
              label="Host name"
              description="Show a free-text Host name field on the booking form."
              checked={toggles.showHostName}
              onChange={(v) => setToggles((t) => ({ ...t, showHostName: v }))}
            />
            <ToggleRow
              label="Talking points"
              description="Show a multi-line Talking points field on the booking form."
              checked={toggles.showTalkingPoints}
              onChange={(v) =>
                setToggles((t) => ({ ...t, showTalkingPoints: v }))
              }
            />

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              {success && (
                <span className="text-sm text-green-700">{success}</span>
              )}
            </div>
          </>
        )}

        <h3 className="mt-6 text-sm font-medium">Tip</h3>
        <p className="text-sm text-gray-600">
          Changes apply immediately. The Booking form reads flags from{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">
            &lt;body data-*&gt;
          </code>{" "}
          on mount. After saving, just navigate to the form and it will use the
          new values.
        </p>
      </section>

      {/* ========== User Theme (new) ========== */}
      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-lg font-medium">Appearance</h2>
        <p className="mb-4 text-sm text-gray-600">
          Choose your theme for this device.
        </p>

        <fieldset className="space-y-2">
          <legend className="sr-only">Theme</legend>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="theme"
              value="light"
              checked={theme === "light"}
              onChange={() => setTheme("light")}
            />
            <span>Light (default)</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="theme"
              value="dark"
              checked={theme === "dark"}
              onChange={() => setTheme("dark")}
            />
            <span>Dark</span>
          </label>

          <p className="mt-3 text-sm text-gray-600">
            This preference is saved locally in your browser. We can move it to
            a DB-backed user setting later.
          </p>
        </fieldset>
      </section>
    </main>
  );
}

function ToggleRow(props: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start justify-between gap-4 border-t py-3 first:border-t-0">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium">
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
            props.checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}
