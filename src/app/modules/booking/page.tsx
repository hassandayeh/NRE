// Server component: Booking list

import Link from "next/link";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs"; // ensure Node runtime for Prisma
export const dynamic = "force-dynamic"; // always fetch fresh data

// Prisma singleton (prevents too many connections during dev/HMR)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

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
      ? decodeURIComponent(searchParams!.error)
      : null;

  let bookings: BookingRow[] = [];
  try {
    bookings = await loadBookings();
  } catch {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-semibold">Bookings</h1>
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Failed to load bookings from the database.
        </p>

        <div className="mt-6">
          <Link
            href="/modules/booking/new"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            New booking
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      {/* Toast styles */}
      <style>{`
        .toast {
          position: fixed;
          right: 16px;
          bottom: 16px;
          max-width: 360px;
          border-radius: 12px;
          padding: 12px 14px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
          animation: slideIn 120ms ease-out;
        }
        .toast-title { font-weight: 600; margin-bottom: 2px; }
        .toast-desc { font-size: 0.875rem; }
        .toast-success { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
        .toast-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
        .toast a { text-decoration: underline; }
        @keyframes slideIn {
          from { transform: translateY(8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bookings</h1>
        <Link
          href="/modules/booking/new"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
        >
          New booking
        </Link>
      </div>

      {/* Toasts */}
      {created && (
        <div className="toast toast-success">
          <div className="toast-title">Booking created</div>
          <div className="toast-desc">Booking created successfully.</div>
          <div className="mt-1 text-xs">
            <Link href="/modules/booking">×</Link>
          </div>
        </div>
      )}

      {updated && (
        <div className="toast toast-success">
          <div className="toast-title">Booking updated</div>
          <div className="toast-desc">Booking updated successfully.</div>
          <div className="mt-1 text-xs">
            <Link href="/modules/booking">×</Link>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="toast toast-error">
          <div className="toast-title">Something went wrong</div>
          <div className="toast-desc">{errorMsg}</div>
          <div className="mt-1 text-xs">
            <Link href="/modules/booking">×</Link>
          </div>
        </div>
      )}

      {/* Empty state vs table */}
      {!bookings || bookings.length === 0 ? (
        <div className="rounded-xl border p-6">
          <p className="text-sm text-gray-600">No bookings yet.</p>
          <div className="mt-3">
            <Link href="/modules/booking/new" className="text-sm underline">
              Create your first booking
            </Link>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-600">
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Expert</th>
                <th className="px-4 py-3">Appearance</th>
                <th className="px-4 py-3">Start</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/modules/booking/${b.id}`}
                      className="font-medium underline"
                    >
                      {b.subject || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{b.expertName || "—"}</td>
                  <td className="px-4 py-3">
                    {b.appearanceType === "ONLINE" ? "Online" : "In-person"}
                  </td>
                  <td className="px-4 py-3">
                    {formatLocalDateTime(b.startAt)}
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
