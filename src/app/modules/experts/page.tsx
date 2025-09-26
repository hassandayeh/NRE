"use client";

/**
 * Experts Directory (UI-only tweaks)
 * - No prefilled defaults on load (all filters blank / "Any")
 * - Removed "Refresh" button (Search handles it)
 * - Proper <form> submit so pressing Enter anywhere runs Search
 * - Still supports slot-aware availability when checked
 *
 * Blast radius: this page only calls GET /api/experts/search.
 * No changes to APIs, bookings, hosts, or notes.
 */

import * as React from "react";

/* ---------- Small helpers ---------- */
function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
function nextFullHourISO(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

/* ---------- UI primitives with safe fallbacks ---------- */
import * as ButtonModule from "../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/* ---------- Types expected from /api/experts/search ---------- */
type ExpertRow = {
  id: string;
  name: string | null;
  bio?: string | null;
  city?: string | null;
  countryCode?: string | null;
  languages?: string[];
  tags?: string[];
  supportsOnline?: boolean | null;
  supportsInPerson?: boolean | null;
  avatarUrl?: string | null;
  availability?: {
    status: "AVAILABLE" | "BUSY" | "UNKNOWN";
    reasons?: string[];
  };
};

type ApiResponse = {
  items?: ExpertRow[];
  nextCursor?: string | null;
  total?: number | null;
  error?: string;
};

export default function ExpertsDirectoryPage() {
  /* =========================
   * Filters & local state
   * ========================= */
  const [mode, setMode] = React.useState<"public" | "org" | "both">("public");

  // All empty by default (no prefilled values)
  const [q, setQ] = React.useState("");
  const [languages, setLanguages] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [supportsOnline, setSupportsOnline] = React.useState<
    "any" | "yes" | "no"
  >("any");
  const [supportsInPerson, setSupportsInPerson] = React.useState<
    "any" | "yes" | "no"
  >("any");
  const [city, setCity] = React.useState("");
  const [countryCode, setCountryCode] = React.useState("");
  // Keep limit as a string so it can be empty
  const [limit, setLimit] = React.useState<string>("");

  // Availability (slot-aware)
  const [checkAvailability, setCheckAvailability] = React.useState(false);
  const [startAtISO] = React.useState<string>(() => nextFullHourISO());
  const [durationMins] = React.useState<number>(60);

  // Results
  const [items, setItems] = React.useState<ExpertRow[]>([]);
  const [total, setTotal] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hasSearched, setHasSearched] = React.useState(false);

  // Pagination (optional)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);

  /* =========================
   * Fetch logic
   * ========================= */
  async function runSearch(reset = true) {
    try {
      setLoading(true);
      setError(null);
      setHasSearched(true);
      if (reset) {
        setItems([]);
        setNextCursor(null);
      }

      const sp = new URLSearchParams();
      sp.set("visibility", mode); // "public" | "org" | "both"

      if (q.trim()) sp.set("q", q.trim());
      if (languages.trim()) sp.set("languages", languages.trim());
      if (tags.trim()) sp.set("tags", tags.trim());
      if (city.trim()) sp.set("city", city.trim());
      if (countryCode.trim()) sp.set("countryCode", countryCode.trim());

      // Limit only when user sets it (no implicit default)
      const limitNum = parseInt(limit, 10);
      if (!Number.isNaN(limitNum) && limitNum > 0)
        sp.set("take", String(limitNum));

      // Supports Online/In-Person: only pass when not "any"
      if (supportsOnline !== "any")
        sp.set("supportsOnline", supportsOnline === "yes" ? "true" : "false");
      if (supportsInPerson !== "any")
        sp.set(
          "supportsInPerson",
          supportsInPerson === "yes" ? "true" : "false"
        );

      // Slot-aware availability
      if (checkAvailability) {
        sp.set("startAt", new Date(startAtISO).toISOString());
        sp.set("durationMins", String(durationMins));
        // If your API supports it, you can also send onlyAvailable=true
        // sp.set("onlyAvailable", "false");
      }

      if (!reset && nextCursor) sp.set("cursor", nextCursor);

      const res = await fetch(`/api/experts/search?${sp.toString()}`, {
        credentials: "include",
      });
      const data: ApiResponse = await res
        .json()
        .catch(() => ({} as ApiResponse));
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`);

      setItems((prev) =>
        reset ? data.items || [] : [...prev, ...(data.items || [])]
      );
      setNextCursor(data.nextCursor || null);
      setTotal(data.total ?? null);
    } catch (err: any) {
      setError(err?.message || "Failed to search experts.");
    } finally {
      setLoading(false);
    }
  }

  // Optional: change Mode triggers a fresh search if the user already searched once
  React.useEffect(() => {
    if (hasSearched) void runSearch(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function onReset() {
    setQ("");
    setLanguages("");
    setTags("");
    setSupportsOnline("any");
    setSupportsInPerson("any");
    setCity("");
    setCountryCode("");
    setLimit("");
    setCheckAvailability(false);
    setTotal(null);
    setItems([]);
    setHasSearched(false);
    setNextCursor(null);
    setError(null);
  }

  /* =========================
   * Render
   * ========================= */
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Experts Directory</h1>
          <p className="mt-1 text-sm text-gray-600">
            Browse experts (PUBLIC). Switch to “Org” to include your org’s
            EXCLUSIVE experts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm">Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            className="rounded-md border px-2 py-1 text-sm"
          >
            <option value="public">Public</option>
            <option value="org">Org</option>
            <option value="both">Both</option>
          </select>
        </div>
      </div>

      {/* Search form */}
      <form
        className="space-y-4 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(true);
        }}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-sm font-medium">Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="name or bio…"
              className="w-full rounded-md border px-3 py-2"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Languages (comma)</span>
            <input
              value={languages}
              onChange={(e) => setLanguages(e.target.value)}
              placeholder="e.g. en,ar"
              className="w-full rounded-md border px-3 py-2"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Tags (comma)</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. technology,ai"
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-sm font-medium">Supports Online</span>
            <select
              value={supportsOnline}
              onChange={(e) => setSupportsOnline(e.target.value as any)}
              className="w-full rounded-md border px-3 py-2"
            >
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Supports In-Person</span>
            <select
              value={supportsInPerson}
              onChange={(e) => setSupportsInPerson(e.target.value as any)}
              className="w-full rounded-md border px-3 py-2"
            >
              <option value="any">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Country code</span>
            <input
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              placeholder="e.g. US"
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-sm font-medium">City</span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Beirut"
              className="w-full rounded-md border px-3 py-2"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm font-medium">Limit</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="12"
              className="w-full rounded-md border px-3 py-2"
            />
          </label>

          <label className="flex items-center gap-2 self-end">
            <input
              type="checkbox"
              checked={checkAvailability}
              onChange={(e) => setCheckAvailability(e.target.checked)}
            />
            <span className="text-sm">Show availability (slot-aware)</span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <UIButton type="submit">Search</UIButton>
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Reset
          </button>
        </div>

        {/* Availability note (informative only) */}
        {checkAvailability && (
          <div className="text-xs text-gray-600">
            Checking availability for{" "}
            <b>{new Date(startAtISO).toLocaleString()}</b> (+{durationMins}{" "}
            mins).
          </div>
        )}
      </form>

      {/* Results header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {!hasSearched
            ? "Use filters and click Search."
            : loading
            ? "Searching…"
            : error
            ? null
            : `Found ${items.length}${
                total != null ? ` of ${total}` : ""
              } results`}
        </div>
        {error && (
          <UIAlert
            className="bg-red-50 px-3 py-2 text-sm text-red-800"
            role="alert"
          >
            {error}
          </UIAlert>
        )}
      </div>

      {/* Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((e) => {
          const avail =
            e.availability?.status ??
            (checkAvailability
              ? "UNKNOWN"
              : undefined); /* hide when not asked */

          const availBadge =
            avail === "AVAILABLE"
              ? "bg-green-100 text-green-800"
              : avail === "BUSY"
              ? "bg-red-100 text-red-800"
              : "bg-gray-100 text-gray-700";

          return (
            <div key={e.id} className="rounded-xl border p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-gray-500">{e.id}</div>
                  <div className="truncate text-base font-semibold">
                    {e.name || "Unnamed"}
                  </div>
                </div>
                {avail && (
                  <span
                    className={clsx("rounded px-2 py-0.5 text-xs", availBadge)}
                  >
                    {avail}
                  </span>
                )}
              </div>

              {e.bio && (
                <p className="line-clamp-2 text-sm text-gray-700">{e.bio}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-700">
                {(e.languages || []).map((l) => (
                  <span key={l} className="rounded bg-gray-100 px-2 py-0.5">
                    {l}
                  </span>
                ))}
                {(e.tags || []).map((t) => (
                  <span key={t} className="rounded bg-blue-50 px-2 py-0.5">
                    #{t}
                  </span>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {e.city && <span>{e.city}</span>}
                {e.countryCode && (
                  <span className="rounded border px-1">{e.countryCode}</span>
                )}
                {e.supportsOnline ? (
                  <span className="rounded bg-gray-100 px-2 py-0.5">
                    Online
                  </span>
                ) : null}
                {e.supportsInPerson ? (
                  <span className="rounded bg-gray-100 px-2 py-0.5">
                    In-person
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cursor-based pagination (if API returns it) */}
      {nextCursor && !loading && hasSearched && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => void runSearch(false)}
            className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
