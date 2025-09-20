// Server component: Booking list rendered directly from DB (Prisma)
// Adds success banner via ?created=1 search param.

import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic"; // ensure fresh data on every request (no caching)

const prisma = new PrismaClient();

type BookingRow = {
  id: string;
  subject: string;
  newsroomName: string;
  expertName: string;
  appearanceType: "ONLINE" | "IN_PERSON";
  startAt: Date;
  durationMins: number;
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

  let bookings: BookingRow[] = [];
  try {
    bookings = await loadBookings();
  } catch (e) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-bold">Bookings</h1>
        <p className="mt-2 text-sm text-red-600">
          Failed to load bookings from the database.
        </p>
        <div className="mt-6">
          <a
            href="/modules/booking/new"
            className="inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            New booking
          </a>
        </div>
      </main>
    );
  }

  if (!bookings || bookings.length === 0) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Bookings</h1>
          <a
            href="/modules/booking/new"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            New booking
          </a>
        </div>

        {created && (
          <div className="mt-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
            Booking created successfully.
          </div>
        )}

        <div className="mt-8 rounded-xl border p-8 text-center">
          <p className="text-sm text-gray-600">No bookings yet.</p>
          <a
            href="/modules/booking/new"
            className="mt-4 inline-block rounded-lg border px-4 py-2 text-sm"
          >
            Create your first booking
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Bookings</h1>
        <a
          href="/modules/booking/new"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
        >
          New booking
        </a>
      </div>

      {created && (
        <div className="mt-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          Booking created successfully.
        </div>
      )}

      <div className="mt-6 overflow-x-auto rounded-xl border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
            <tr>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Expert</th>
              <th className="px-4 py-3">Appearance</th>
              <th className="px-4 py-3">Start</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {bookings.map((b) => (
              <tr key={b.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{b.subject}</td>
                <td className="px-4 py-3">{b.expertName}</td>
                <td className="px-4 py-3">
                  {b.appearanceType === "ONLINE" ? "Online" : "In-person"}
                </td>
                <td className="px-4 py-3">{formatLocalDateTime(b.startAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
