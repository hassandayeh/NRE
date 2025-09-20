// Server component: Booking list rendered directly from DB (Prisma)
// Replaces success banner (?created=1) with a bottom-right toast (also supports ?error=...).
import Link from "next/link";
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
  const errorMsg =
    typeof searchParams?.error === "string"
      ? decodeURIComponent(searchParams!.error)
      : null;

  let bookings: BookingRow[] = [];
  try {
    bookings = await loadBookings();
  } catch (e) {
    return (
      <main className="mx-auto max-w-4xl p-6 space-y-4">
        <Header />
        <div className="rounded-lg border p-4 text-red-700 bg-red-50">
          Failed to load bookings from the database.
        </div>
        <div>
          <Link
            href="/modules/booking/new"
            className="inline-flex items-center rounded-lg bg-black px-4 py-2 text-white hover:opacity-90"
          >
            New booking
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-4">
      {/* Inline styles for the toast animation; no client component needed */}
      <style>{`
        @keyframes toast-in { from { transform: translateY(8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes toast-out { to { opacity: 0; transform: translateY(8px) } }
        .toast {
          position: fixed; right: 16px; bottom: 16px; z-index: 50;
          min-width: 260px; max-width: 420px; border-radius: 0.75rem;
          box-shadow: 0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -2px rgba(0,0,0,.05);
          padding: 12px 14px; display: flex; gap: 10px; align-items: start;
          animation: toast-in 200ms ease-out, toast-out 300ms ease-in 4s forwards;
        }
        .toast-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
        .toast-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
        .toast-title { font-weight: 600; }
        .toast-actions { margin-left: auto; }
        .toast-close {
          background: transparent; border: 0; cursor: pointer; padding: 2px 6px;
          font-size: 14px; line-height: 1; color: inherit;
        }
      `}</style>

      <Header />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        <Link
          href="/modules/booking/new"
          className="inline-flex items-center rounded-lg bg-black px-4 py-2 text-white hover:opacity-90"
        >
          New booking
        </Link>
      </div>

      {/* Toasts (query driven). We prefer a link to remove the query instantly. */}
      {created && (
        <div role="status" aria-live="polite" className="toast toast-success">
          <div>
            <div className="toast-title">Booking created</div>
            <div>Booking created successfully.</div>
          </div>
          <div className="toast-actions">
            <Link
              href="/modules/booking"
              aria-label="Dismiss notification"
              className="toast-close"
            >
              ×
            </Link>
          </div>
        </div>
      )}
      {errorMsg && (
        <div role="alert" aria-live="assertive" className="toast toast-error">
          <div>
            <div className="toast-title">Something went wrong</div>
            <div>{errorMsg}</div>
          </div>
          <div className="toast-actions">
            <Link
              href="/modules/booking"
              aria-label="Dismiss notification"
              className="toast-close"
            >
              ×
            </Link>
          </div>
        </div>
      )}

      {!bookings || bookings.length === 0 ? (
        <div className="rounded-lg border p-4">
          <p className="text-gray-700 mb-3">No bookings yet.</p>
          <Link
            href="/modules/booking/new"
            className="inline-flex items-center rounded-lg bg-black px-4 py-2 text-white hover:opacity-90"
          >
            Create your first booking
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border">
          <div className="grid grid-cols-4 gap-2 border-b px-4 py-3 text-sm font-semibold">
            <div>SUBJECT</div>
            <div>EXPERT</div>
            <div>APPEARANCE</div>
            <div>START</div>
          </div>
          {bookings.map((b) => (
            <div
              key={b.id}
              className="grid grid-cols-4 gap-2 px-4 py-3 border-t"
            >
              <div className="font-medium">
                <Link
                  href={`/modules/booking/${b.id}`}
                  className="underline hover:opacity-80"
                >
                  {b.subject}
                </Link>
              </div>
              <div>{b.expertName}</div>
              <div>
                {b.appearanceType === "ONLINE" ? "Online" : "In-person"}
              </div>
              <div>{formatLocalDateTime(b.startAt)}</div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function Header() {
  return null; // page keeps your global header from layout.tsx; local header not needed here
}
