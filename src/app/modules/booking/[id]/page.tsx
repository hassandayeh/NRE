// src/app/modules/booking/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { PrismaClient, AppearanceType } from "@prisma/client";

// Prisma singleton (server-side safe)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

type PageProps = {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function BookingDetailsPage({
  params,
  searchParams,
}: PageProps) {
  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
  });

  if (!booking) return notFound();

  const isOnline = booking.appearanceType === AppearanceType.ONLINE;
  const updated = searchParams?.updated === "1";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Top actions */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Booking details</h1>

        {/* NEW: Edit button */}
        <Link
          href={`/modules/booking/${booking.id}/edit`}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
        >
          Edit booking
        </Link>
      </div>

      {/* Optional success banner after edit */}
      {updated && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          Booking updated successfully.
        </div>
      )}

      <p>
        <Link href="/modules/booking" className="text-sm underline">
          ← Back to bookings
        </Link>
      </p>

      {/* Core fields */}
      <section className="rounded-xl border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Subject" value={booking.subject || "—"} />
          <Field
            label="Appearance"
            value={pretty(booking.appearanceType || "—")}
          />
          <Field
            label="Start at"
            value={
              booking.startAt ? new Date(booking.startAt).toLocaleString() : "—"
            }
          />
          <Field
            label="Duration"
            value={
              booking.durationMins != null
                ? `${booking.durationMins} mins`
                : "—"
            }
          />
        </div>
      </section>

      {/* Location */}
      <section className="rounded-xl border p-4">
        <h2 className="mb-2 text-lg font-semibold">Location</h2>
        {isOnline ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldText
              label="Location name"
              value={booking.locationName || "—"}
            />
            <Field
              label="Location URL"
              value={booking.locationUrl || "—"}
              isLink
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldText
              label="Location name"
              value={booking.locationName || "—"}
            />
            <Field
              label="Location URL"
              value={booking.locationUrl || "—"}
              isLink
            />
          </div>
        )}
      </section>

      {/* Extras */}
      {(booking.programName || booking.hostName || booking.talkingPoints) && (
        <section className="rounded-xl border p-4">
          <h2 className="mb-2 text-lg font-semibold">Extras</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {booking.programName && (
              <FieldText label="Program name" value={booking.programName} />
            )}
            {booking.hostName && (
              <FieldText label="Host name" value={booking.hostName} />
            )}
          </div>
          {booking.talkingPoints && (
            <div className="mt-3">
              <FieldText label="Talking points" value={booking.talkingPoints} />
            </div>
          )}
        </section>
      )}
    </main>
  );
}

/* ---------- helpers ---------- */

function pretty(s: string) {
  return s
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function Field({
  label,
  value,
  isLink = false,
}: {
  label: string;
  value: string;
  isLink?: boolean;
}) {
  return (
    <div className="text-sm">
      <div className="text-gray-600">{label}</div>
      <div className="truncate font-medium">
        {isLink && value && value !== "—" ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {value}
          </a>
        ) : (
          value || "—"
        )}
      </div>
    </div>
  );
}

function FieldText({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <div className="text-gray-600">{label}</div>
      <div className="whitespace-pre-wrap font-medium">{value}</div>
    </div>
  );
}
