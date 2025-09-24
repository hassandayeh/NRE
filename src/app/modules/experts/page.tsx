// src/app/modules/experts/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";

/** Minimal client-side types to match our API */
type Availability = {
  status: "AVAILABLE" | "BUSY" | "UNKNOWN";
  reasons?: string[];
};
type ExpertItem = {
  id: string;
  name: string | null;
  slug?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  languages?: string[];
  tags?: string[];
  timezone?: string;
  countryCode?: string | null;
  city?: string | null;
  supportsOnline?: boolean;
  supportsInPerson?: boolean;
  expertStatus?: "PUBLIC" | "EXCLUSIVE" | null;
  exclusiveOrgId?: string | null;
  rankBoost?: number;
  kind?: "EXPERT" | "REPORTER";
  availability?: Availability;
};

export default function ExpertsDirectoryPage() {
  // ---- Filters (Mode-1 by default) ----
  const [mode, setMode] = useState<"public" | "org">("public");
  const [q, setQ] = useState<string>("");
  const [languages, setLanguages] = useState<string>(""); // comma separated
  const [tags, setTags] = useState<string>(""); // comma separated
  const [supportsOnline, setSupportsOnline] = useState<"" | "true" | "false">(
    ""
  );
  const [supportsInPerson, setSupportsInPerson] = useState<
    "" | "true" | "false"
  >("");
  const [countryCode, setCountryCode] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [limit, setLimit] = useState<number>(12);

  // Optional slot-aware (demo/preview)
  const [slotAware, setSlotAware] = useState<boolean>(false);
  const [startAt, setStartAt] = useState<string>(""); // datetime-local
  const [durationMins, setDurationMins] = useState<number>(60);

  // ---- Data state ----
  const [items, setItems] = useState<ExpertItem[]>([]);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const controllerRef = useRef<AbortController | null>(null);

  /** Build a query URL from the provided values (or current state if omitted) */
  function buildUrl(
    overrides?: Partial<{
      mode: "public" | "org";
      q: string;
      languages: string;
      tags: string;
      supportsOnline: "" | "true" | "false";
      supportsInPerson: "" | "true" | "false";
      countryCode: string;
      city: string;
      limit: number;
      slotAware: boolean;
      startAt: string;
      durationMins: number;
    }>
  ) {
    const v = {
      mode,
      q,
      languages,
      tags,
      supportsOnline,
      supportsInPerson,
      countryCode,
      city,
      limit,
      slotAware,
      startAt,
      durationMins,
      ...overrides,
    };

    const sp = new URLSearchParams();
    sp.set("mode", v.mode);
    if (v.q) sp.set("q", v.q);
    if (v.languages) sp.set("languages", v.languages);
    if (v.tags) sp.set("tags", v.tags);
    if (v.supportsOnline) sp.set("supportsOnline", v.supportsOnline);
    if (v.supportsInPerson) sp.set("supportsInPerson", v.supportsInPerson);
    if (v.countryCode) sp.set("countryCode", v.countryCode.toUpperCase());
    if (v.city) sp.set("city", v.city);
    sp.set("limit", String(v.limit));

    if (v.slotAware && v.startAt && (v.durationMins || 0) > 0) {
      sp.set("startAt", new Date(v.startAt).toISOString());
      sp.set("durationMins", String(v.durationMins));
    }

    return `/api/experts/search?${sp.toString()}`;
  }

  /** Fetch using the current state, or an override URL (used by Reset) */
  async function fetchExperts(urlOverride?: string) {
    try {
      setLoading(true);
      setError("");

      controllerRef.current?.abort();
      const ac = new AbortController();
      controllerRef.current = ac;

      const url = urlOverride ?? buildUrl();
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { items: ExpertItem[]; count: number };
      setItems(data.items ?? []);
      setCount(data.count ?? 0);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setError(err?.message || "Failed to load experts.");
      setItems([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }

  // Load on first mount
  useEffect(() => {
    fetchExperts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-query when switching mode
  useEffect(() => {
    fetchExperts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---- Reset in ONE click: clear state AND fetch clean results immediately
  function resetFilters() {
    // 1) Clear UI state
    setQ("");
    setLanguages("");
    setTags("");
    setSupportsOnline("");
    setSupportsInPerson("");
    setCountryCode("");
    setCity("");
    setLimit(12);
    setSlotAware(false);
    setStartAt("");
    setDurationMins(60);

    // 2) Immediately fetch with clean params (no need to wait for state re-render)
    const freshUrl = buildUrl({
      q: "",
      languages: "",
      tags: "",
      supportsOnline: "",
      supportsInPerson: "",
      countryCode: "",
      city: "",
      limit: 12,
      slotAware: false,
      startAt: "",
      durationMins: 60,
    });
    fetchExperts(freshUrl);
  }

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Experts Directory
          </h1>
          <p className="text-sm text-gray-600">
            Browse experts (PUBLIC). Switch to “Org” to view your org’s
            EXCLUSIVE experts and reporters.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium" htmlFor="mode-select">
            Mode
          </label>
          <select
            id="mode-select"
            value={mode}
            onChange={(e) => setMode(e.target.value as "public" | "org")}
            className="rounded-md border px-2 py-1 text-sm"
            aria-label="Directory mode"
          >
            <option value="public">Public</option>
            <option value="org">Org</option>
          </select>
        </div>
      </header>

      {/* Filters */}
      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="block text-sm font-medium">Search</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="name or bio…"
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">
              Languages (comma)
            </label>
            <input
              value={languages}
              onChange={(e) => setLanguages(e.target.value)}
              placeholder="en,ar"
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Tags (comma)</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="technology,ai"
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Supports Online</label>
            <select
              value={supportsOnline}
              onChange={(e) =>
                setSupportsOnline(e.target.value as "" | "true" | "false")
              }
              className="mt-1 w-full rounded-md border px-2 py-2"
            >
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium">
              Supports In-Person
            </label>
            <select
              value={supportsInPerson}
              onChange={(e) =>
                setSupportsInPerson(e.target.value as "" | "true" | "false")
              }
              className="mt-1 w-full rounded-md border px-2 py-2"
            >
              <option value="">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium">Country code</label>
            <input
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              placeholder="US"
              className="mt-1 w-full rounded-md border px-3 py-2 uppercase"
              maxLength={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium">City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Beirut"
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Limit</label>
            <input
              type="number"
              value={limit}
              onChange={(e) =>
                setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
              }
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </div>

          {/* Optional: slot-aware preview */}
          <div className="md:col-span-3 rounded-md border p-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={slotAware}
                onChange={(e) => setSlotAware(e.target.checked)}
              />
              Show availability (slot-aware)
            </label>

            {slotAware && (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium">Start</label>
                  <input
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="mt-1 w-full rounded-md border px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium">
                    Duration (mins)
                  </label>
                  <input
                    type="number"
                    value={durationMins}
                    onChange={(e) =>
                      setDurationMins(Math.max(1, Number(e.target.value) || 60))
                    }
                    className="mt-1 w-full rounded-md border px-3 py-2"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <button
                    onClick={() => fetchExperts()}
                    className="mt-1 inline-flex items-center rounded-md border bg-black px-4 py-2 text-white hover:opacity-90"
                    aria-label="Search"
                  >
                    Search
                  </button>
                  <button
                    onClick={resetFilters}
                    className="mt-1 inline-flex items-center rounded-md border px-4 py-2 hover:bg-gray-50"
                    aria-label="Reset"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {!slotAware && (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => fetchExperts()}
              className="inline-flex items-center rounded-md border bg-black px-4 py-2 text-white hover:opacity-90"
              aria-label="Search"
            >
              Search
            </button>
            <button
              onClick={resetFilters}
              className="inline-flex items-center rounded-md border px-4 py-2 hover:bg-gray-50"
              aria-label="Reset"
            >
              Reset
            </button>
          </div>
        )}
      </section>

      {/* Results */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {loading
              ? "Loading…"
              : `Found ${count} result${count === 1 ? "" : "s"}`}
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="rounded-lg border bg-white p-6 text-center text-gray-600">
            No experts match your filters.
          </div>
        )}

        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((e) => (
            <li key={e.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <img
                  src={
                    e.avatarUrl ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(
                      e.name || "E"
                    )}`
                  }
                  alt={e.name || "Expert"}
                  className="h-12 w-12 rounded-full object-cover"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-semibold">
                      {e.name || "Unnamed"}{" "}
                      {e.kind && (
                        <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
                          {e.kind.toLowerCase()}
                        </span>
                      )}
                    </h3>
                    {slotAware && e.availability && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          e.availability.status === "AVAILABLE"
                            ? "bg-green-100 text-green-800"
                            : e.availability.status === "BUSY"
                            ? "bg-red-100 text-red-800"
                            : "bg-gray-100 text-gray-700"
                        }`}
                        title={e.availability.reasons?.join(", ")}
                      >
                        {e.availability.status}
                      </span>
                    )}
                  </div>

                  {e.bio && (
                    <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                      {e.bio}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {e.languages?.map((l) => (
                      <span
                        key={l}
                        className="rounded-full bg-gray-100 px-2 py-0.5 text-xs"
                      >
                        {l}
                      </span>
                    ))}
                    {e.tags?.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    {e.city && <span>{e.city}</span>}
                    {e.countryCode && (
                      <span className="rounded border px-1.5 py-0.5">
                        {e.countryCode}
                      </span>
                    )}
                    {e.supportsOnline && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5">
                        Online
                      </span>
                    )}
                    {e.supportsInPerson && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5">
                        In-person
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
