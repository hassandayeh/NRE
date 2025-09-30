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

export default function BookingsPage() {
  const qs = useSearchParams();
  const updated = qs.get("updated") === "1";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<BookingListItem[]>([]);
  const [sessionObj, setSessionObj] = useState<any>(null);

  const roles = useMemo(
    () => (sessionObj ? extractRoles(sessionObj) : new Set<string>()),
    [sessionObj]
  );
  const canCreate = roles.has("OWNER") || roles.has("PRODUCER"); // Hosts & Experts => false

  useEffect(() => {
    let cancelled = false;

    async function loadList() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/api/bookings", {
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

    loadList();
    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Bookings</h1>
        {/* Owners & Producers only */}
        {canCreate ? (
          <Link
            href="/modules/booking/new"
            className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
          >
            New booking
          </Link>
        ) : null}
      </div>

      {/* Success banner (after edit/save flows that redirect with ?updated=1) */}
      {updated && (
        <div
          role="status"
          className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm"
        >
          Booking updated successfully.
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-500" role="status">
          Loading…
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm">
          {err}
        </div>
      )}

      {!loading && !err && items.length === 0 && (
        <div className="rounded-lg border px-3 py-4">
          <p className="text-sm">No bookings yet.</p>
          {canCreate ? (
            <p className="mt-1 text-sm">
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
            <p className="mt-1 text-sm">
              When a newsroom invites you, you’ll see it here.
            </p>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {items.map((b) => {
          const ap = b.appearanceType;
          const multiHost =
            typeof b.hostsCount === "number" && b.hostsCount > 1;

          return (
            <li key={b.id} className="rounded-lg border p-3 hover:bg-gray-50">
              {/* Whole card is a link → VIEW page */}
              <Link href={`/modules/booking/${b.id}`} className="block">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-medium">
                    {b.subject || "(no subject)"}
                  </h2>

                  {ap && (
                    <span
                      className="rounded-md border px-2 py-0.5 text-xs"
                      aria-label="appearance type"
                    >
                      {ap === "IN_PERSON"
                        ? "IN PERSON"
                        : ap === "ONLINE"
                        ? "ONLINE"
                        : "PHONE"}
                    </span>
                  )}
                </div>

                <div className="mt-1 text-sm text-gray-600">
                  {fmtDate(b.startAt)} • {b.durationMins}m
                  {/* NEW: Multi-host hint, only when hostsCount > 1 */}
                  {multiHost && (
                    <span
                      className="ml-2 rounded-md border px-1.5 py-0.5 text-xs"
                      title="Multiple hosts"
                      aria-label="multiple hosts"
                    >
                      Hosts ×{b.hostsCount}
                    </span>
                  )}
                </div>

                {(b.expertName || b.newsroomName) && (
                  <div className="mt-1 text-sm">
                    <span className="text-gray-500">Expert:</span>{" "}
                    {b.expertName ?? "—"}{" "}
                    <span className="text-gray-400">•</span>{" "}
                    <span className="text-gray-500">Newsroom:</span>{" "}
                    {b.newsroomName ?? "—"}
                  </div>
                )}

                {(b.programName || b.hostName) && (
                  <div className="mt-1 text-sm">
                    <span className="text-gray-500">Program:</span>{" "}
                    {b.programName ?? "—"}{" "}
                    <span className="text-gray-400">•</span>{" "}
                    <span className="text-gray-500">Host:</span>{" "}
                    {b.hostName ?? "—"}
                  </div>
                )}

                {ap === "IN_PERSON" &&
                  (b.locationName || b.locationAddress) && (
                    <div className="mt-1 text-sm text-gray-600">
                      <span className="text-gray-500">Location:</span>{" "}
                      {b.locationName ?? ""}
                      {b.locationAddress ? (
                        <span>{` — ${b.locationAddress}`}</span>
                      ) : null}
                    </div>
                  )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
