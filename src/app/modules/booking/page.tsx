// src/app/modules/booking/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * NOTE: We added an optional `hostsCount?: number` so we can
 * show a "multi-host" hint when the API provides it. If the field
 * is absent (older payloads), nothing shows — zero regression.
 */
type BookingListItem = {
  id: string;
  subject: string | null;
  startAt: string; // ISO
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

// Keep return type intentionally loose to match the original file’s tolerance
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
  if (Array.isArray(mems)) {
    mems.forEach((m: any) => push(m?.role));
  }

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

/* ---------- new: org context helpers on the client ---------- */
function getSessionOrgId(s: any): string | null {
  return (
    (s?.orgId as string | undefined) ??
    (s?.user?.orgId as string | undefined) ??
    null
  );
}

export default function BookingsPage() {
  const qs = useSearchParams();
  const updated = qs.get("updated") === "1";
  const overrideOrgId = qs.get("orgId"); // optional admin/dev override

  const [loading, setLoading] = useState(true); // bookings loading
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<BookingListItem[]>([]);
  // IMPORTANT: undefined = not loaded yet, null = loaded + no session
  const [sessionObj, setSessionObj] = useState<any | undefined>(undefined);

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

  const canCreate = isAdminLike; // Hosts & Experts => false

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

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bookings</h1>

        {/* Owners & Producers only */}
        {canCreate ? (
          <Link
            href="/modules/booking/new"
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            New booking
          </Link>
        ) : null}
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
          {canCreate ? (
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
          ) : (
            <p>When a newsroom invites you, you’ll see it here.</p>
          )}
        </div>
      )}

      {/* List */}
      {!showSpinner &&
        effectiveOrgId &&
        items.map((b) => {
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
                  {b.subject || "(no subject)"}
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
                {/* NEW: Multi-host hint, only when hostsCount > 1 */}
                {multiHost && (
                  <span className="ml-2 rounded-md border px-1.5 py-0.5 text-xs">
                    Hosts ×{b.hostsCount}
                  </span>
                )}
              </div>

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
                  <span className="font-medium">Host:</span> {b.hostName ?? "—"}
                </div>
              )}

              {ap === "IN_PERSON" && (b.locationName || b.locationAddress) && (
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
    </>
  );
}
