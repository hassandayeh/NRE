// src/app/modules/booking/view/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/**
 * NOTE: We added an optional `hostsCount?: number` so we can
 * show a "multi-host" hint when the API provides it. If the field
 * is absent (older payloads), nothing shows — zero regression.
 */
type BookingListItem = {
  id: string;
  startAt: string; // ISO
  createdAt?: string; // ISO (optional: shown/used when present)
  durationMins: number;
  appearanceType?: "ONLINE" | "IN_PERSON" | "PHONE" | null;
  expertName?: string | null;
  newsroomName?: string | null;
  programName?: string | null;
  // Legacy, still displayed if present
  hostName?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  // NEW (optional, safe): how many HOST participants exist
  hostsCount?: number;
};

type ApiList =
  | { ok: true; bookings: BookingListItem[] }
  | { ok: false; error: string };

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ---------- role helpers (robust to many session shapes) ---------- */
function normalizeRole(r: unknown): string | null {
  if (!r) return null;
  const s = String(r).trim();
  if (!s) return null;
  return s.toUpperCase().replace(/\s+/g, "_");
}

function extractRoles(s: any): Set<string> {
  const roles = new Set<string>();
  const push = (val: unknown) => {
    const nr = normalizeRole(val);
    if (nr) roles.add(nr);
  };

  // common shapes
  push(s?.user?.role);
  (s?.user?.roles ?? []).forEach(push);
  push(s?.role);
  (s?.roles ?? []).forEach(push);

  // membership-based shapes
  const mems =
    s?.user?.orgMemberships ??
    s?.user?.memberships ??
    s?.orgMemberships ??
    s?.memberships ??
    [];
  if (Array.isArray(mems)) mems.forEach((m: any) => push(m?.role));

  // last-resort heuristic (dev seeds often encode role in name)
  if (roles.size === 0 && typeof s?.user?.name === "string") {
    const n = s.user.name.toLowerCase();
    if (n.startsWith("owner")) roles.add("OWNER");
    if (n.startsWith("producer")) roles.add("PRODUCER");
    if (n.startsWith("host")) roles.add("HOST");
    if (n.includes("expert")) roles.add("EXPERT");
  }
  return roles;
}

/* ---------- org context helpers on the client ---------- */
function getSessionOrgId(s: any): string | null {
  return (
    (s?.orgId as string | undefined) ??
    (s?.user?.orgId as string | undefined) ??
    null
  );
}

export default function BookingsViewPage() {
  // URL params (no next/navigation hooks to avoid context issues)
  const [updated, setUpdated] = useState(false);
  const [overrideOrgId, setOverrideOrgId] = useState<string | null>(null);

  // data
  const [loading, setLoading] = useState(true); // bookings loading
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<BookingListItem[]>([]);
  // List sort mode: "booking" (by startAt, ascending) or "created" (by createdAt, descending)
  const [sortMode, setSortMode] = useState<"booking" | "created">("booking");
  // IMPORTANT: undefined = not loaded yet, null = loaded + no session
  const [sessionObj, setSessionObj] = useState<any | undefined>(undefined);

  // read query once on mount
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    setUpdated(qs.get("updated") === "1");
    setOverrideOrgId(qs.get("orgId"));
  }, []);

  const sessionReady = sessionObj !== undefined;

  const roles = useMemo(
    () => (sessionReady ? extractRoles(sessionObj) : new Set<string>()),
    [sessionReady, sessionObj]
  );

  // Treat OWNER/PRODUCER as admin-like in current UI
  const isAdminLike = roles.has("OWNER") || roles.has("PRODUCER");
  const isDev = process.env.NODE_ENV !== "production";
  const overrideAllowed = !!overrideOrgId && (isDev || isAdminLike);

  // Resolve the effective org id (only meaningful once session is ready)
  const sessionOrgId = sessionReady ? getSessionOrgId(sessionObj) : null;
  const effectiveOrgId = overrideAllowed ? overrideOrgId : sessionOrgId;

  /* Load session */
  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        const r = await fetch("/api/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        if (!r.ok) {
          if (!cancelled) setSessionObj(null);
          return;
        }
        const s = await r.json();
        if (!cancelled) setSessionObj(s);
      } catch {
        if (!cancelled) setSessionObj(null);
      }
    }
    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Load bookings — wait until session is known to avoid banner flash */
  useEffect(() => {
    let cancelled = false;

    async function loadList() {
      // Wait for session to be known (prevents "no org" flash)
      if (!sessionReady) {
        setLoading(true);
        setErr(null);
        return;
      }

      // If we know there's no org, stop loading and show the banner
      if (!effectiveOrgId) {
        setItems([]);
        setErr(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr(null);

      try {
        // Always include the effective orgId (session by default; override if allowed)
        const url = `/api/bookings?orgId=${encodeURIComponent(effectiveOrgId)}`;

        const res = await fetch(url, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        const json = (await res.json()) as ApiList;
        if (cancelled) return;

        if (res.ok && (json as any).ok) {
          setItems((json as any).bookings as BookingListItem[]);
        } else {
          setErr((json as any)?.error || "Failed to load bookings.");
        }
      } catch {
        if (!cancelled) setErr("Network error while loading bookings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadList();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady, effectiveOrgId]);

  // Spinner logic: show while session OR bookings are loading
  const showSpinner = !sessionReady || loading;

  // Does the payload include createdAt?
  const hasCreatedAt = useMemo(
    () =>
      items.some(
        (i) => typeof (i as any).createdAt === "string" && (i as any).createdAt
      ),
    [items]
  );

  // Group + sort helpers (memoized)
  const groups = useMemo(() => {
    if (!items.length)
      return [] as Array<{
        key: string;
        label: string;
        items: BookingListItem[];
      }>;

    const getDate = (b: BookingListItem) => {
      const iso =
        sortMode === "created"
          ? ((b as any).createdAt as string | undefined) || b.startAt
          : b.startAt;
      const d = iso ? new Date(iso) : null;
      return d && isFinite(d.valueOf()) ? d : null;
    };

    // Sort: booking → ascending; created → descending
    const sorted = [...items].sort((a, b) => {
      const da = getDate(a);
      const db = getDate(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return sortMode === "created"
        ? db.getTime() - da.getTime()
        : da.getTime() - db.getTime();
    });

    // Group by day (YYYY-MM-DD) of the active date
    const toKey = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const labelFor = (key: string) => {
      if (key === "unknown") return "Other";
      const d = new Date(key + "T00:00:00");
      const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Tomorrow";
      if (diffDays === -1) return "Yesterday";
      return d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
      });
    };

    const map = new Map<string, BookingListItem[]>();
    for (const it of sorted) {
      const d = getDate(it);
      const key = d ? toKey(d) : "unknown";
      (map.get(key) ?? map.set(key, []).get(key)!).push(it);
    }

    return Array.from(map.entries()).map(([key, arr]) => ({
      key,
      label: labelFor(key),
      items: arr,
    }));
  }, [items, sortMode]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bookings</h1>

        <div className="flex items-center gap-3">
          {/* Sort toggle */}
          <div
            role="tablist"
            aria-label="Sort bookings"
            className="inline-flex overflow-hidden rounded-lg border"
          >
            <button
              role="tab"
              aria-selected={sortMode === "booking"}
              onClick={() => setSortMode("booking")}
              className={`px-3 py-1.5 text-sm ${
                sortMode === "booking"
                  ? "bg-gray-100 font-medium"
                  : "hover:bg-gray-50"
              }`}
            >
              Booking date
            </button>
            <button
              role="tab"
              aria-selected={sortMode === "created"}
              onClick={() => hasCreatedAt && setSortMode("created")}
              disabled={!hasCreatedAt}
              className={`border-l px-3 py-1.5 text-sm ${
                sortMode === "created"
                  ? "bg-gray-100 font-medium"
                  : "hover:bg-gray-50"
              } ${!hasCreatedAt ? "cursor-not-allowed opacity-50" : ""}`}
              title={
                hasCreatedAt ? "" : "Created date not present in this dataset"
              }
            >
              Created
            </button>
          </div>

          {/* New booking */}
          <Link
            href="/modules/booking/new"
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            New booking
          </Link>
        </div>
      </div>

      {/* Success banner (after edit/save flows that redirect with ?updated=1) */}
      {updated && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Booking updated successfully.
        </div>
      )}

      {/* No-org inline banner — only after session is known */}
      {sessionReady && !effectiveOrgId && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <div className="flex items-center justify-between gap-3">
            <span>No organization selected.</span>
            <Link
              href="/modules/settings" // safer hub page (doesn't require orgId)
              className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
            >
              Choose org
            </Link>
          </div>
        </div>
      )}

      {showSpinner && (
        <div className="text-sm text-gray-600" role="status">
          Loading…
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      )}

      {!showSpinner && !err && effectiveOrgId && items.length === 0 && (
        <div className="rounded-lg border bg-white px-4 py-8 text-center text-sm text-gray-600">
          <p className="mb-2">No bookings yet.</p>
          <p>
            Create your first booking{" "}
            <Link
              className="underline underline-offset-2"
              href="/modules/booking/new"
            >
              here
            </Link>
            .
          </p>
        </div>
      )}

      {/* List */}
      {!showSpinner &&
        effectiveOrgId &&
        groups.map((g) => (
          <div key={g.key} className="mb-4">
            <div className="mb-2 rounded-md bg-gray-50 px-2 py-1 text-sm font-medium text-gray-600">
              {g.label}
            </div>

            {g.items.map((b) => {
              const ap = b.appearanceType;
              const multiHost =
                typeof b.hostsCount === "number" && b.hostsCount > 1;

              return (
                <Link
                  key={b.id}
                  href={`/modules/booking/${b.id}`}
                  className="mb-3 block rounded-xl border bg-white p-4 hover:bg-gray-50"
                >
                  {/* Whole card is a link → VIEW page */}
                  <div className="mb-1 flex items-center justify-between">
                    <h2 className="text-base font-medium">
                      {b.programName ?? "(no title)"}
                    </h2>
                    {ap && (
                      <span className="rounded-md border px-2 py-0.5 text-xs">
                        {ap === "IN_PERSON"
                          ? "IN PERSON"
                          : ap === "ONLINE"
                          ? "ONLINE"
                          : "PHONE"}
                      </span>
                    )}
                  </div>

                  <div className="mb-1 text-sm text-gray-600">
                    {fmtDate(b.startAt)} • {b.durationMins}m
                    {multiHost && (
                      <span className="ml-2 rounded-md border px-1.5 py-0.5 text-xs">
                        Hosts ×{b.hostsCount}
                      </span>
                    )}
                  </div>
                  {sortMode === "created" && (
                    <div className="text-xs text-gray-500">
                      Created{" "}
                      {fmtDate(
                        ((b as any).createdAt as string | undefined) ??
                          b.startAt
                      )}
                    </div>
                  )}

                  {(b.expertName || b.newsroomName) && (
                    <div className="text-sm text-gray-600">
                      <span className="font-medium">Expert:</span>{" "}
                      {b.expertName ?? "—"}{" "}
                      <span className="mx-1.5 text-gray-400">•</span>{" "}
                      <span className="font-medium">Newsroom:</span>{" "}
                      {b.newsroomName ?? "—"}
                    </div>
                  )}

                  {(b.programName || b.hostName) && (
                    <div className="text-sm text-gray-600">
                      <span className="font-medium">Program:</span>{" "}
                      {b.programName ?? "—"}{" "}
                      <span className="mx-1.5 text-gray-400">•</span>{" "}
                      <span className="font-medium">Host:</span>{" "}
                      {b.hostName ?? "—"}
                    </div>
                  )}

                  {ap === "IN_PERSON" &&
                    (b.locationName || b.locationAddress) && (
                      <div className="mt-1 text-sm text-gray-600">
                        <span className="font-medium">Location:</span>{" "}
                        {b.locationName ?? ""}{" "}
                        {b.locationAddress ? (
                          <span className="text-gray-500">
                            {` — ${b.locationAddress}`}
                          </span>
                        ) : null}
                      </div>
                    )}
                </Link>
              );
            })}
          </div>
        ))}
    </div>
  );
}
