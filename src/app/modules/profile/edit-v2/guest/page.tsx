// src/app/modules/profile/edit-v2/guest/page.tsx
"use client";

import * as React from "react";

/**
 * G-Profile V2 — Guest Editor shell (UI-only slice)
 * ------------------------------------------------------------
 * Goals for this first slice:
 * - Ship a clean, sectioned editor UI for GUEST profiles.
 * - Keep it dependency-free (no custom components, no API calls yet).
 * - Accessible by default: labels, fieldsets, keyboard-friendly.
 * - Zero regression: new route only, not linked yet.
 *
 * Next slices will wire real data (session load, save -> API, Prisma).
 */

type FormState = {
  displayName: string;
  localName: string; // name in local script / pronunciation hint
  pronouns: string;
  languages: string[];
  timezone: string;
  city: string;
  countryCode: string;
  regions: string[];
  bio: string;
  topics: string[];
  formats: { tv: boolean; radio: boolean; online: boolean; phone: boolean };
  links: string[];
  additionalEmails: string[];
  phone: string; // private
  feeNote: string; // private
  visibility: "PUBLIC" | "PRIVATE";
  inviteable: boolean;
};

const LANGUAGE_OPTIONS = [
  "Arabic",
  "English",
  "French",
  "Spanish",
  "German",
  "Italian",
  "Turkish",
  "Kurdish",
];

const REGION_OPTIONS = [
  "MENA",
  "Europe",
  "North America",
  "Sub-Saharan Africa",
  "South Asia",
  "East Asia",
];

const COUNTRY_OPTIONS = [
  { code: "EG", name: "Egypt" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "FR", name: "France" },
];

const TIMEZONES = [
  "Africa/Cairo",
  "Europe/Paris",
  "Europe/London",
  "Asia/Dubai",
  "America/New_York",
];

const TOPIC_SUGGESTIONS = [
  "Politics",
  "Economy",
  "Tech",
  "Health",
  "Climate",
  "Culture",
  "Security",
];

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="rounded-full p-1 hover:bg-gray-100 focus:outline-none focus:ring"
      >
        ×
      </button>
    </span>
  );
}

export default function Page() {
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const disabled = saving || loading;

  const [state, setState] = React.useState<FormState>({
    displayName: "",
    localName: "",
    pronouns: "",
    languages: [],
    timezone: "Africa/Cairo",
    city: "",
    countryCode: "EG",
    regions: [],
    bio: "",
    topics: [],
    formats: { tv: true, radio: true, online: true, phone: true },
    links: [""],
    additionalEmails: [""],
    phone: "",
    feeNote: "",
    visibility: "PRIVATE",
    inviteable: false,
  });

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/profile/guest/me", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load profile");
        const json = await res.json();
        const p = json?.profile;
        if (!cancelled && p) {
          setState({
            displayName: p.displayName || "",
            localName: p.localName || "",
            pronouns: p.pronouns || "",
            languages: Array.isArray(p.languages) ? p.languages : [],
            timezone: p.timezone || "Africa/Cairo",
            city: p.city || "",
            countryCode: p.countryCode || "EG",
            regions: Array.isArray(p.regions) ? p.regions : [],
            bio: p.bio || "",
            topics: Array.isArray(p.topics) ? p.topics : [],
            formats: p.formats || {
              tv: true,
              radio: true,
              online: true,
              phone: true,
            },
            links: Array.isArray(p.links) ? p.links : [],
            additionalEmails: Array.isArray(p.additionalEmails)
              ? p.additionalEmails
              : [],
            phone: p.phone || "",
            feeNote: p.feeNote || "",
            visibility: p.visibility || "PRIVATE",
            inviteable: !!p.inviteable,
          });
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleArrayValue<K extends keyof FormState>(key: K, value: string) {
    setState((prev) => {
      const existing = new Set((prev[key] as unknown as string[]) || []);
      existing.has(value) ? existing.delete(value) : existing.add(value);
      return { ...prev, [key]: Array.from(existing) } as FormState;
    });
  }

  function updateArrayAt(
    key: keyof FormState,
    index: number,
    value: string,
    min = 1
  ) {
    setState((prev) => {
      const arr = [...((prev as any)[key] as string[])];
      arr[index] = value;
      if (arr.length < min) arr.push("");
      return { ...prev, [key]: arr } as FormState;
    });
  }

  function addArraySlot(key: keyof FormState) {
    setState((prev) => {
      const arr = [...((prev as any)[key] as string[])];
      arr.push("");
      return { ...prev, [key]: arr } as FormState;
    });
  }

  function removeArraySlot(key: keyof FormState, index: number) {
    setState((prev) => {
      const arr = [...((prev as any)[key] as string[])];
      arr.splice(index, 1);
      if (arr.length === 0) arr.push("");
      return { ...prev, [key]: arr } as FormState;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/guest/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.message || "Failed to save profile");
      }
      // Optimistic: state already reflects what we sent
      alert("Saved ✓");
    } catch (err: any) {
      setError(err?.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Profile · Guest · Edit
        </p>
        <h1 className="text-2xl font-semibold">Edit Guest Profile (V2)</h1>
        <p className="mt-1 text-sm text-gray-600">
          Build a great profile for a great directory. Changes here will power
          search & inviteability.
        </p>
      </header>

      {loading && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          Loading profile…
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-8">
        {/* Basics */}
        <section
          aria-labelledby="sec-basics"
          className="rounded-2xl border p-4"
        >
          <h2 id="sec-basics" className="text-lg font-medium">
            Basics
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm">Display name</span>
              <input
                className="rounded-lg border p-2"
                value={state.displayName}
                onChange={(e) =>
                  setState((s) => ({ ...s, displayName: e.target.value }))
                }
                placeholder="e.g., Dr. Lina Hassan"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm">
                Name (local script / pronunciation)
              </span>
              <input
                className="rounded-lg border p-2"
                value={state.localName}
                onChange={(e) =>
                  setState((s) => ({ ...s, localName: e.target.value }))
                }
                placeholder="e.g., توماس مكدونالد"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm">Pronouns (optional)</span>
              <input
                className="rounded-lg border p-2"
                value={state.pronouns}
                onChange={(e) =>
                  setState((s) => ({ ...s, pronouns: e.target.value }))
                }
                placeholder="she/her, he/him, they/them…"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm">Timezone</span>
              <select
                className="rounded-lg border p-2"
                value={state.timezone}
                onChange={(e) =>
                  setState((s) => ({ ...s, timezone: e.target.value }))
                }
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm">Country</span>
              <select
                className="rounded-lg border p-2"
                value={state.countryCode}
                onChange={(e) =>
                  setState((s) => ({ ...s, countryCode: e.target.value }))
                }
              >
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm">City</span>
              <input
                className="rounded-lg border p-2"
                value={state.city}
                onChange={(e) =>
                  setState((s) => ({ ...s, city: e.target.value }))
                }
                placeholder="e.g., Cairo"
              />
            </label>
          </div>
        </section>

        {/* Languages & Regions */}
        <section
          aria-labelledby="sec-lang"
          className="rounded-2xl border p-4"
          role="group"
        >
          <h2 id="sec-lang" className="text-lg font-medium">
            Languages & Regions
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm">Languages</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {LANGUAGE_OPTIONS.map((lang) => {
                  const checked = state.languages.includes(lang);
                  return (
                    <label
                      key={lang}
                      className="inline-flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={checked}
                        onChange={() => toggleArrayValue("languages", lang)}
                      />
                      {lang}
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-sm">Regions (coverage)</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {REGION_OPTIONS.map((r) => {
                  const checked = state.regions.includes(r);
                  return (
                    <label
                      key={r}
                      className="inline-flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={checked}
                        onChange={() => toggleArrayValue("regions", r)}
                      />
                      {r}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Topics & Formats */}
        <section
          aria-labelledby="sec-topics"
          className="rounded-2xl border p-4"
        >
          <h2 id="sec-topics" className="text-lg font-medium">
            Topics & Formats
          </h2>

          {/* Topics chips */}
          <div className="mt-4">
            <label className="text-sm">Beats / Topics</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {state.topics.map((t, i) =>
                t ? (
                  <Chip
                    key={t + i}
                    label={t}
                    onRemove={() =>
                      setState((s) => ({
                        ...s,
                        topics: s.topics.filter((x, idx) => idx !== i),
                      }))
                    }
                  />
                ) : null
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                aria-label="Add topic"
                className="w-full rounded-lg border p-2"
                placeholder="Type a topic and press Add"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                  }
                }}
                id="topicInput"
              />
              <button
                type="button"
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => {
                  const el = document.getElementById(
                    "topicInput"
                  ) as HTMLInputElement | null;
                  const val = (el?.value || "").trim();
                  if (val && !state.topics.includes(val)) {
                    setState((s) => ({ ...s, topics: [...s.topics, val] }));
                    if (el) el.value = "";
                  }
                }}
              >
                Add
              </button>
              <div className="hidden md:block">
                <span className="text-xs text-gray-500">
                  Suggestions: {TOPIC_SUGGESTIONS.join(", ")}
                </span>
              </div>
            </div>
          </div>

          {/* Formats */}
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              ["tv", "TV"],
              ["radio", "Radio"],
              ["online", "Online"],
              ["phone", "Phone"],
            ].map(([key, label]) => (
              <label key={key} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={(state.formats as any)[key]}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      formats: { ...s.formats, [key]: e.target.checked },
                    }))
                  }
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Visibility & Inviteability */}
        <section
          aria-labelledby="sec-vis"
          className="rounded-2xl border p-4"
          role="group"
        >
          <h2 id="sec-vis" className="text-lg font-medium">
            Visibility & Inviteability
          </h2>
          <p className="mt-1 text-xs text-gray-600">
            Availability signal comes from calendar & bookings (managed
            elsewhere).
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <fieldset className="rounded-xl border p-3">
              <legend className="text-sm font-medium">
                Profile visibility
              </legend>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="visibility"
                  className="h-4 w-4"
                  checked={state.visibility === "PUBLIC"}
                  onChange={() =>
                    setState((s) => ({ ...s, visibility: "PUBLIC" }))
                  }
                />
                Public (discoverable in directory)
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="visibility"
                  className="h-4 w-4"
                  checked={state.visibility === "PRIVATE"}
                  onChange={() =>
                    setState((s) => ({ ...s, visibility: "PRIVATE" }))
                  }
                />
                Private (hidden; share only via invite link)
              </label>
            </fieldset>

            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={state.inviteable}
                onChange={(e) =>
                  setState((s) => ({ ...s, inviteable: e.target.checked }))
                }
              />
              Inviteable (can be added to bookings)
            </label>
          </div>
        </section>

        {/* Bio & Links */}
        <section aria-labelledby="sec-bio" className="rounded-2xl border p-4">
          <h2 id="sec-bio" className="text-lg font-medium">
            Bio & Links
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-sm">Short bio</span>
              <textarea
                className="min-h-[96px] rounded-lg border p-2"
                value={state.bio}
                onChange={(e) =>
                  setState((s) => ({ ...s, bio: e.target.value }))
                }
                placeholder="One paragraph—experience, beats, highlights."
              />
            </label>

            <div className="flex flex-col gap-2">
              <span className="text-sm">
                Links (e.g., website, X, LinkedIn)
              </span>
              {state.links.map((url, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="w-full rounded-lg border p-2"
                    value={url}
                    onChange={(e) => updateArrayAt("links", i, e.target.value)}
                    placeholder="https://example.com"
                    inputMode="url"
                  />
                  <button
                    type="button"
                    className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                    onClick={() => removeArraySlot("links", i)}
                    aria-label="Remove link"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="w-fit rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => addArraySlot("links")}
              >
                + Add link
              </button>
            </div>
          </div>
        </section>

        {/* Contact & Private Notes */}
        <section
          aria-labelledby="sec-private"
          className="rounded-2xl border p-4"
          role="group"
        >
          <h2 id="sec-private" className="text-lg font-medium">
            Contact & Private Notes
          </h2>
          <p className="mt-1 text-xs text-gray-600">
            Primary email is your account email (auto-assigned). You can add
            private contact details that org staff with access may view.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm">Additional emails</label>
              {state.additionalEmails.map((em, i) => (
                <div key={i} className="mt-2 flex items-center gap-2">
                  <input
                    className="w-full rounded-lg border p-2"
                    value={em}
                    onChange={(e) =>
                      updateArrayAt("additionalEmails", i, e.target.value)
                    }
                    placeholder="name@example.com"
                    inputMode="email"
                  />
                  <button
                    type="button"
                    className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                    onClick={() => removeArraySlot("additionalEmails", i)}
                    aria-label="Remove email"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="mt-2 w-fit rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => addArraySlot("additionalEmails")}
              >
                + Add email
              </button>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-sm">Phone (private)</span>
              <input
                className="rounded-lg border p-2"
                value={state.phone}
                onChange={(e) =>
                  setState((s) => ({ ...s, phone: e.target.value }))
                }
                placeholder="+20…"
                inputMode="tel"
              />
            </label>

            <label className="md:col-span-2 flex flex-col gap-1">
              <span className="text-sm">Fee note (private)</span>
              <textarea
                className="min-h-[72px] rounded-lg border p-2"
                value={state.feeNote}
                onChange={(e) =>
                  setState((s) => ({ ...s, feeNote: e.target.value }))
                }
                placeholder="Optional range, constraints, or billing instructions."
              />
            </label>
          </div>
        </section>

        {/* Footer actions */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Tip: Equipment quality is parked (dropped for now). Availability is
            managed via calendar & bookings.
          </p>
          <button
            type="submit"
            disabled={disabled}
            className="rounded-2xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </main>
  );
}
