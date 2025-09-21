// src/app/modules/booking/page.tsx

// Server component: Booking list
import Link from "next/link";
import prisma from "../../../lib/prisma"; // ✅ centralized Prisma singleton

export const runtime = "nodejs"; // ensure Node runtime for Prisma
export const dynamic = "force-dynamic"; // always fetch fresh data

type BookingRow = {
  id: string;
  subject: string | null;
  newsroomName: string | null;
  expertName: string | null;
  appearanceType: "ONLINE" | "IN_PERSON";
  startAt: Date;
  durationMins: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function formatLocalDateTime(value: Date | string) {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

async function loadBookings(): Promise<BookingRow[]> {
  return prisma.booking.findMany({
    orderBy: { startAt: "desc" },
    select: {
      id: true,
      subject: true,
      newsroomName: true,
      expertName: true,
      appearanceType: true,
      startAt: true,
      durationMins: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export default async function BookingListPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const created = searchParams?.created === "1";
  const updated = searchParams?.updated === "1";
  const errorMsg =
    typeof searchParams?.error === "string"
      ? decodeURIComponent(searchParams!.error as string)
      : null;

  let bookings: BookingRow[] = [];
  try {
    bookings = await loadBookings();
  } catch {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
          <Link
            href="/modules/booking/new"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            New booking
          </Link>
        </div>

        <div
          className="mt-6 rounded-lg border bg-red-50 p-4 text-sm text-red-700"
          role="status"
        >
          Failed to load bookings from the database.
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      {/* a11y live region for success/error messages */}
      <div className="sr-only" aria-live="polite" />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        <Link
          href="/modules/booking/new"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
        >
          New booking
        </Link>
      </div>

      {/* Toasts (non-interactive in Server Component) */}
      {created && (
        <div className="mt-4 rounded-lg border bg-green-50 p-4" role="status">
          <div className="text-sm font-medium text-green-800">
            Booking created
          </div>
          <div className="text-sm text-green-700">
            Booking created successfully.
          </div>
        </div>
      )}
      {updated && (
        <div className="mt-4 rounded-lg border bg-green-50 p-4" role="status">
          <div className="text-sm font-medium text-green-800">
            Booking updated
          </div>
          <div className="text-sm text-green-700">
            Booking updated successfully.
          </div>
        </div>
      )}
      {errorMsg && (
        <div className="mt-4 rounded-lg border bg-red-50 p-4" role="status">
          <div className="text-sm font-medium text-red-800">
            Something went wrong
          </div>
          <div className="text-sm text-red-700">{errorMsg}</div>
        </div>
      )}

      {/* Empty state vs table */}
      {!bookings || bookings.length === 0 ? (
        <div className="mt-8 rounded-lg border p-6 text-center">
          <p className="text-sm text-gray-600">No bookings yet.</p>
          <Link
            href="/modules/booking/new"
            className="mt-3 inline-block rounded-lg border px-4 py-2 text-sm"
          >
            Create your first booking
          </Link>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Expert</th>
                <th className="px-4 py-2 font-medium">Appearance</th>
                <th className="px-4 py-2 font-medium">Start</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2">{b.subject || "—"}</td>
                  <td className="px-4 py-2">{b.expertName || "—"}</td>
                  <td className="px-4 py-2">
                    {b.appearanceType === "ONLINE" ? "Online" : "In-person"}
                  </td>
                  <td className="px-4 py-2">
                    {formatLocalDateTime(b.startAt)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/modules/booking/${b.id}`}
                      className="rounded-lg border px-3 py-1 text-xs"
                    >
                      View
                    </Link>
                    <Link
                      href={`/modules/booking/${b.id}/edit`}
                      className="ml-2 rounded-lg border px-3 py-1 text-xs"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
