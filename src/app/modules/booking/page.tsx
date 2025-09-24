// src/app/modules/booking/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type BookingListItem = {
  id: string;
  subject: string | null;
  startAt: string; // ISO
  durationMins: number;
  appearanceType?: "ONLINE" | "IN_PERSON" | "PHONE" | null;
  expertName?: string | null;
  newsroomName?: string | null;
  programName?: string | null;
  hostName?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
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

// --- role helpers (robust to many session shapes) ---
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
  if (Array.isArray(mems)) {
    mems.forEach((m) => push(m?.role));
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

  const [sessionObj, setSessionObj] = useState<any | null>(null);
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
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bookings</h1>

        {/* Owners & Producers only */}
        {canCreate ? (
          <Link
            href="/modules/booking/new"
            className="inline-flex items-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black"
          >
            New booking
          </Link>
        ) : null}
      </div>

      {/* Success banner (after edit/save flows that redirect with ?updated=1) */}
      {updated && (
        <div
          role="status"
          className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          Booking updated successfully.
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-600" role="status">
          Loading…
        </div>
      )}

      {err && (
        <div
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {err}
        </div>
      )}

      {!loading && !err && items.length === 0 && (
        <div className="rounded-lg border p-6 text-sm text-gray-700">
          <p className="mb-2">No bookings yet.</p>
          {canCreate ? (
            <p>
              Create your first booking{" "}
              <Link href="/modules/booking/new" className="underline">
                here
              </Link>
              .
            </p>
          ) : (
            <p>When a newsroom invites you, you’ll see it here.</p>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {items.map((b) => {
          const ap = b.appearanceType;
          return (
            <li key={b.id}>
              {/* Whole card is a link → VIEW page */}
              <Link
                href={`/modules/booking/${b.id}`}
                className="block rounded-xl border bg-white px-4 py-3 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black"
              >
                <div className="flex items-start justify-between">
                  <h2 className="text-base font-medium">
                    {b.subject || "(no subject)"}
                  </h2>
                  {ap && (
                    <span className="text-xs text-gray-500">
                      {ap === "IN_PERSON"
                        ? "IN PERSON"
                        : ap === "ONLINE"
                        ? "ONLINE"
                        : "PHONE"}
                    </span>
                  )}
                </div>

                <div className="mt-1 text-sm text-gray-700">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span>{fmtDate(b.startAt)}</span>
                    <span>•</span>
                    <span>{b.durationMins}m</span>
                  </div>

                  {(b.expertName || b.newsroomName) && (
                    <div className="mt-1">
                      <span className="text-gray-500">Expert:</span>{" "}
                      <span>{b.expertName ?? "—"}</span>
                      <span className="mx-2 text-gray-400">•</span>
                      <span className="text-gray-500">Newsroom:</span>{" "}
                      <span>{b.newsroomName ?? "—"}</span>
                    </div>
                  )}

                  {(b.programName || b.hostName) && (
                    <div className="mt-1">
                      <span className="text-gray-500">Program:</span>{" "}
                      <span>{b.programName ?? "—"}</span>
                      <span className="mx-2 text-gray-400">•</span>
                      <span className="text-gray-500">Host:</span>{" "}
                      <span>{b.hostName ?? "—"}</span>
                    </div>
                  )}

                  {ap === "IN_PERSON" &&
                    (b.locationName || b.locationAddress) && (
                      <div className="mt-1">
                        <span className="text-gray-500">Location:</span>{" "}
                        <span>{b.locationName ?? ""}</span>
                        {b.locationAddress ? (
                          <span>{` — ${b.locationAddress}`}</span>
                        ) : null}
                      </div>
                    )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
