"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type BookingListItem = {
  id: string;
  subject: string;
  startAt: string; // ISO
  durationMins: number;

  // Display fields used in the list
  appearanceScope?: "UNIFIED" | "PER_GUEST" | null;
  appearanceType?: "ONLINE" | "IN_PERSON" | "PHONE" | null;

  expertName?: string | null; // legacy mirror
  newsroomName?: string | null;
  programName?: string | null;
  hostName?: string | null;

  // Optional location hints for summary lines
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

export default function BookingsPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<BookingListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
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
        if (res.ok && json.ok) {
          setItems(json.bookings);
        } else {
          setErr((json as any)?.error || "Failed to load bookings.");
        }
      } catch {
        if (!cancelled) setErr("Network error while loading bookings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>

      {loading && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-gray-700">
          Loading…
        </div>
      )}

      {err && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
          {err}
        </div>
      )}

      {!loading && !err && items.length === 0 && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-gray-700">
          No bookings yet.
        </div>
      )}

      <ul className="space-y-4">
        {items.map((b) => (
          <li key={b.id} className="relative">
            {/* Card */}
            <div className="group rounded-lg border p-4 hover:shadow-sm transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-medium">{b.subject}</h2>
                  <div className="mt-1 text-sm text-gray-600">
                    {fmtDate(b.startAt)} • {b.durationMins}m
                    {b.appearanceType ? (
                      <>
                        {" "}
                        • <span className="uppercase">{b.appearanceType}</span>
                      </>
                    ) : null}
                  </div>

                  <div className="mt-1 text-sm text-gray-700 space-y-0.5">
                    {(b.expertName || b.newsroomName) && (
                      <div>
                        Expert: {b.expertName ?? "—"} • Newsroom:{" "}
                        {b.newsroomName ?? "—"}
                      </div>
                    )}
                    {(b.programName || b.hostName) && (
                      <div>
                        Program: {b.programName ?? "—"} • Host:{" "}
                        {b.hostName ?? "—"}
                      </div>
                    )}
                    {b.appearanceType === "IN_PERSON" &&
                      (b.locationName || b.locationAddress) && (
                        <div>
                          Location: {b.locationName ?? ""}{" "}
                          {b.locationAddress ? `— ${b.locationAddress}` : ""}
                        </div>
                      )}
                  </div>
                </div>

                {/* subtle affordance to indicate clickability */}
                <div className="ml-3 text-sm text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  View →
                </div>
              </div>

              {/* Make the whole card clickable to the VIEW page */}
              <Link
                href={`/modules/booking/${b.id}`}
                className="absolute inset-0"
                aria-label={`Open ${b.subject}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
