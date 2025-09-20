"use client";

import * as React from "react";

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
      // Sync <body data-*> so the Booking form will see fresh values on mount
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
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <a
          href="/modules/booking"
          className="rounded-lg border px-4 py-2 text-sm"
        >
          Back to bookings
        </a>
      </div>

      <section className="space-y-4 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">Org Feature Toggles</h2>
        <p className="text-sm text-gray-600">
          Control which optional fields appear on the booking form.
        </p>

        {loading ? (
          <p className="text-sm text-gray-600">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : (
          <>
            <ToggleRow
              label="Show Program Name"
              description="Display an optional Program name input on the booking form."
              checked={toggles.showProgramName}
              onChange={(v) =>
                setToggles((t) => ({ ...t, showProgramName: v }))
              }
            />
            <ToggleRow
              label="Show Host Name"
              description="Display an optional Host name input on the booking form."
              checked={toggles.showHostName}
              onChange={(v) => setToggles((t) => ({ ...t, showHostName: v }))}
            />
            <ToggleRow
              label="Show Talking Points"
              description="Display an optional Talking points textarea on the booking form."
              checked={toggles.showTalkingPoints}
              onChange={(v) =>
                setToggles((t) => ({ ...t, showTalkingPoints: v }))
              }
            />

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>

              {success && (
                <span className="text-sm text-green-700">{success}</span>
              )}
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border p-4 text-sm text-gray-600">
        <h3 className="mb-2 font-medium">Tip</h3>
        <p>
          Changes apply immediately. The Booking form reads flags from{" "}
          <code>&lt;body data-*&gt;</code> on mount. After saving, just navigate
          to the form and it will use the new values.
        </p>
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
    <div className="flex items-start justify-between rounded-lg border p-3">
      <div className="pr-4">
        <label htmlFor={id} className="block text-sm font-medium">
          {props.label}
        </label>
        {props.description && (
          <p className="mt-1 text-xs text-gray-600">{props.description}</p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={props.checked}
        onClick={() => props.onChange(!props.checked)}
        className={`h-6 w-11 rounded-full transition ${
          props.checked ? "bg-gray-900" : "bg-gray-300"
        }`}
      >
        <span
          className={`block h-5 w-5 translate-y-0.5 transform rounded-full bg-white shadow transition ${
            props.checked ? "translate-x-6" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
