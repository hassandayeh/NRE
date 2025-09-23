// src/app/modules/booking/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { headers } from "next/headers";
import { resolveViewer, canEditBooking } from "../../../lib/viewer";

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
  // Some older API responses may omit orgId. Handle both cases gracefully.
  orgId?: string | null;
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
    cache: "no-store",
    headers: { cookie: h.get("cookie") ?? "" },
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

export default async function BookingListPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const [viewer, bookings] = await Promise.all([
    resolveViewer(),
    loadBookings(),
  ]);
  const isStaffAnywhere = viewer.staffOrgIds.length > 0;

  const updated =
    (typeof searchParams?.updated === "string" ? searchParams?.updated : "") ===
    "1";

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        {isStaffAnywhere && (
          <Link
            href="/modules/booking/new"
            className="rounded-md bg-blue-600 px-3 py-2 text-white hover:bg-blue-700"
          >
            New booking
          </Link>
        )}
      </div>

      {updated && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-green-800">
          Booking updated successfully.
        </div>
      )}

      {bookings.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <p className="text-gray-700">
            No bookings yet.&nbsp;
            {isStaffAnywhere ? (
              <>
                <Link
                  href="/modules/booking/new"
                  className="text-blue-700 underline"
                >
                  Create your first booking
                </Link>
                .
              </>
            ) : (
              "When a newsroom invites you, you’ll see it here."
            )}
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {bookings.map((b) => {
            const editAllowed =
              b.orgId !== undefined
                ? canEditBooking(viewer, b.orgId ?? null)
                : isStaffAnywhere;

            return (
              <li key={b.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold">
                      {b.subject || "(no subject)"}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {formatWhen(b.startAt)} • {b.durationMins ?? "—"}m •{" "}
                      {b.appearanceType === "IN_PERSON"
                        ? "IN PERSON"
                        : "ONLINE"}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Expert:</span>{" "}
                      {b.expertName || "—"} •{" "}
                      <span className="font-medium">Newsroom:</span>{" "}
                      {b.newsroomName || "—"}
                    </p>
                    {b.locationName && (
                      <p className="text-sm text-gray-600">
                        <span className="font-medium">Location:</span>{" "}
                        {b.locationUrl ? (
                          <a
                            href={b.locationUrl}
                            className="text-blue-700 underline"
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
                        <span className="font-medium">Program:</span>{" "}
                        {b.programName || "—"} •{" "}
                        <span className="font-medium">Host:</span>{" "}
                        {b.hostName || "—"}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0">
                    {editAllowed ? (
                      <Link
                        href={`/modules/booking/${b.id}/edit`}
                        className="rounded-md bg-blue-600 px-3 py-2 text-white hover:bg-blue-700"
                      >
                        Edit
                      </Link>
                    ) : (
                      <Link
                        href={`/modules/booking/${b.id}/edit`}
                        className="rounded-md border px-3 py-2 text-gray-800 hover:bg-gray-50"
                        title="Open (read-only)"
                      >
                        Open
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
