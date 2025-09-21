// src/app/modules/booking/page.tsx
// Server Component — Bookings list (tenancy-aware via /api/bookings)

import Link from "next/link";
import { headers } from "next/headers";

// Auth-scoped data: always render fresh.
export const dynamic = "force-dynamic";

type Booking = {
  id: string;
  subject: string;
  expertName: string;
  newsroomName: string;
  appearanceType: "ONLINE" | "IN_PERSON";
  status: "PENDING" | "CONFIRMED" | "CANCELLED";
  startAt: string; // ISO
  durationMins: number;
  locationName?: string | null;
  locationUrl?: string | null;
  programName?: string | null;
  hostName?: string | null;
  talkingPoints?: string | null;
  orgId?: string | null;
  createdAt: string;
  updatedAt: string;
};

function getBaseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

async function fetchBookings(): Promise<Booking[]> {
  const cookie = headers().get("cookie") ?? "";
  const url = `${getBaseUrl()}/api/bookings`;

  const res = await fetch(url, {
    method: "GET",
    // Forward auth cookies so the API recognizes the user
    headers: { cookie },
    // Auth/org-scoped → do NOT cache
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Fetch failed with ${res.status}`);
  }

  return (await res.json()) as Booking[];
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export default async function BookingsPage() {
  let bookings: Booking[] = [];
  let loadError = "";

  try {
    bookings = await fetchBookings();
  } catch {
    loadError = "Failed to load bookings from the server.";
  }

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        <Link
          href="/modules/booking/new"
          className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium shadow-sm bg-gray-900 text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900"
        >
          New booking
        </Link>
      </div>

      {loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"
        >
          {loadError}
        </div>
      ) : bookings.length === 0 ? (
        <div className="rounded-xl border p-6 text-gray-600">
          No bookings yet. Create your first one.
        </div>
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => (
            <li
              key={b.id}
              className="rounded-xl border p-4 hover:bg-gray-50 transition"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-base font-medium">{b.subject}</div>
                  <div className="mt-1 text-sm text-gray-600">
                    {fmtDate(b.startAt)} • {b.durationMins}m •{" "}
                    {b.appearanceType.replace("_", " ")}
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    Expert: <span className="font-medium">{b.expertName}</span>{" "}
                    • Newsroom:{" "}
                    <span className="font-medium">{b.newsroomName}</span>
                  </div>
                  {b.locationName ? (
                    <div className="mt-1 text-sm text-gray-600">
                      Location:{" "}
                      {b.locationUrl ? (
                        <a
                          href={b.locationUrl}
                          className="underline underline-offset-2"
                          target="_blank"
                        >
                          {b.locationName}
                        </a>
                      ) : (
                        b.locationName
                      )}
                    </div>
                  ) : null}
                  {b.programName || b.hostName ? (
                    <div className="mt-1 text-sm text-gray-600">
                      {b.programName ? (
                        <>
                          Program:{" "}
                          <span className="font-medium">{b.programName}</span>
                        </>
                      ) : null}
                      {b.programName && b.hostName ? " • " : null}
                      {b.hostName ? (
                        <>
                          Host:{" "}
                          <span className="font-medium">{b.hostName}</span>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <Link
                  href={`/modules/booking/${b.id}/edit`}
                  className="text-sm font-medium underline underline-offset-2"
                >
                  Edit
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
