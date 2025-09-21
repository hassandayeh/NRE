// src/app/modules/booking/page.tsx

// Server component: Booking list (tag-based fetch + shared UI)
import prisma from "../../../lib/prisma"; // kept import if other pages rely on tree-shaking; not used here
import { formatDateTime } from "../../../lib/date";
import Button from "../../../components/ui/Button";
import Alert from "../../../components/ui/Alert";
import Link from "next/link";
import { headers } from "next/headers";

export const runtime = "nodejs"; // ensure Node runtime if needed for other server work
// NOTE: no `dynamic = "force-dynamic"` when using tag-based fetch

type BookingRow = {
  id: string;
  subject: string | null;
  newsroomName: string | null;
  expertName: string | null;
  appearanceType: "ONLINE" | "IN_PERSON";
  startAt: string | Date;
  durationMins: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

async function loadBookings(): Promise<BookingRow[]> {
  // Build absolute URL for robustness in dev/prod
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto =
    h.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");
  const url = `${proto}://${host}/api/bookings`;

  const res = await fetch(url, {
    next: { tags: ["bookings"] }, // 👈 tag-based caching
  });
  if (!res.ok) throw new Error("Failed to load bookings");

  const data = await res.json();
  // Accept {items: []} | {bookings: []} | [] to match existing API shapes
  const items: BookingRow[] =
    (data?.items as BookingRow[]) ??
    (data?.bookings as BookingRow[]) ??
    (Array.isArray(data) ? (data as BookingRow[]) : []);
  return items ?? [];
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
          <Button
            href="/modules/booking/new"
            variant="primary"
            size="md"
            className="rounded-lg"
          >
            New booking
          </Button>
        </div>

        <Alert
          variant="error"
          className="mt-6 rounded-lg"
          title="Failed to load bookings from the server."
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      {/* a11y live region for success/error messages */}
      <div className="sr-only" aria-live="polite" />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        <Button
          href="/modules/booking/new"
          variant="primary"
          size="md"
          className="rounded-lg"
        >
          New booking
        </Button>
      </div>

      {/* Banners */}
      {created && (
        <Alert
          variant="success"
          className="mt-4 rounded-lg"
          title="Booking created"
        >
          Booking created successfully.
        </Alert>
      )}
      {updated && (
        <Alert
          variant="success"
          className="mt-4 rounded-lg"
          title="Booking updated"
        >
          Booking updated successfully.
        </Alert>
      )}
      {errorMsg && (
        <Alert
          variant="error"
          className="mt-4 rounded-lg"
          title="Something went wrong"
        >
          {errorMsg}
        </Alert>
      )}

      {/* Empty state vs table */}
      {!bookings || bookings.length === 0 ? (
        <div className="mt-8 rounded-lg border p-6 text-center">
          <p className="text-sm text-gray-600">No bookings yet.</p>
          <Button
            href="/modules/booking/new"
            variant="outline"
            size="md"
            className="mt-3 rounded-lg"
          >
            Create your first booking
          </Button>
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
                  <td className="px-4 py-2">{formatDateTime(b.startAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      href={`/modules/booking/${b.id}`}
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                    >
                      View
                    </Button>
                    <Button
                      href={`/modules/booking/${b.id}/edit`}
                      variant="outline"
                      size="sm"
                      className="ml-2 rounded-lg"
                    >
                      Edit
                    </Button>
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
