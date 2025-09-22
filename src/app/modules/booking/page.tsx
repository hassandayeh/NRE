// src/app/modules/booking/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { headers } from "next/headers";

type Booking = {
  id: string;
  subject: string | null;
  startAt: string | Date | null;
  durationMins: number | null;
  appearanceType: "ONLINE" | "IN_PERSON" | null;
  expertName: string | null;
  newsroomName: string | null;
  locationName: string | null;
  locationUrl: string | null;
  programName: string | null;
  hostName: string | null;
};

function formatWhen(d: string | Date | null) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleString([], {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadBookings(): Promise<Booking[]> {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}`;

  // Forward cookies so NextAuth sees the session on the API route
  const res = await fetch(`${base}/api/bookings`, {
    // don’t cache so changes appear immediately
    cache: "no-store",
    headers: {
      cookie: h.get("cookie") ?? "",
    },
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    return [];
  }
  const maybe = Array.isArray(json) ? json : json?.bookings;
  return Array.isArray(maybe) ? (maybe as Booking[]) : [];
}

export default async function BookingListPage() {
  const bookings = await loadBookings();

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        <Link
          href="/modules/booking/new"
          className="rounded-full bg-gray-900 px-4 py-2 text-sm text-white hover:bg-black focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          New booking
        </Link>
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-md border p-4 text-sm text-gray-700">
          No bookings yet.
          <Link href="/modules/booking/new" className="ml-2 underline">
            Create your first booking
          </Link>
          .
        </div>
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => (
            <li
              key={b.id}
              className="rounded-xl border p-4 transition hover:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {b.subject || "(no subject)"}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {formatWhen(b.startAt)} • {b.durationMins ?? "—"}m •{" "}
                    {b.appearanceType === "IN_PERSON" ? "IN PERSON" : "ONLINE"}
                  </p>
                  <p className="text-sm text-gray-600">
                    Expert:{" "}
                    <span className="font-medium">{b.expertName || "—"}</span> •
                    Newsroom:{" "}
                    <span className="font-medium">{b.newsroomName || "—"}</span>
                  </p>
                  {b.locationName && (
                    <p className="text-sm text-gray-600">
                      Location:{" "}
                      {b.locationUrl ? (
                        <a
                          href={b.locationUrl}
                          className="underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {b.locationName}
                        </a>
                      ) : (
                        b.locationName
                      )}
                    </p>
                  )}
                  {(b.programName || b.hostName) && (
                    <p className="text-sm text-gray-600">
                      Program:{" "}
                      <span className="font-medium">
                        {b.programName || "—"}
                      </span>{" "}
                      • Host:{" "}
                      <span className="font-medium">{b.hostName || "—"}</span>
                    </p>
                  )}
                </div>
                <Link
                  href={`/modules/booking/${b.id}/edit`}
                  className="text-sm underline"
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
