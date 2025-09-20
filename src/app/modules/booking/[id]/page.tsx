// src/app/modules/booking/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { PrismaClient } from "@prisma/client";

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
};

export default async function BookingDetailsPage({ params }: PageProps) {
  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
  });

  if (!booking) return notFound();

  const isOnline = booking.appearanceType === "ONLINE";

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Booking details
        </h1>
        <Link
          href="/modules/booking"
          className="text-sm underline hover:opacity-80"
        >
          ← Back to bookings
        </Link>
      </div>

      <div className="rounded-lg border p-4">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Subject" value={booking.subject} />
          <Field label="Expert" value={booking.expertName} />
          <Field label="Newsroom" value={booking.newsroomName} />
          <Field
            label="Appearance type"
            value={pretty(booking.appearanceType)}
          />
          <Field label="Status" value={pretty(booking.status)} />
          <Field
            label="Start at"
            value={new Date(booking.startAt).toLocaleString()}
          />
          <Field label="Duration (mins)" value={String(booking.durationMins)} />

          {/* Location */}
          {isOnline ? (
            <Field
              label="Meeting link"
              value={booking.locationUrl ?? "—"}
              isLink
            />
          ) : (
            <Field
              label="Venue / Location"
              value={booking.locationName ?? "—"}
            />
          )}

          {/* New extras (optional) */}
          {booking.programName && (
            <Field label="Program name" value={booking.programName} />
          )}
          {booking.hostName && (
            <Field label="Host name" value={booking.hostName} />
          )}
          {booking.talkingPoints && (
            <FieldText label="Talking points" value={booking.talkingPoints} />
          )}

          {/* Org scope (optional) */}
          <Field label="Org ID" value={booking.orgId ?? "—"} />
          <Field
            label="Created"
            value={new Date(booking.createdAt).toLocaleString()}
          />
          <Field
            label="Updated"
            value={new Date(booking.updatedAt).toLocaleString()}
          />
        </dl>
      </div>
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
    <div className="flex flex-col">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="text-base font-medium break-words">
        {isLink && value && value !== "—" ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {value}
          </a>
        ) : (
          value || "—"
        )}
      </dd>
    </div>
  );
}

function FieldText({ label, value }: { label: string; value: string }) {
  return (
    <div className="sm:col-span-2">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="whitespace-pre-wrap text-base font-medium">{value}</dd>
    </div>
  );
}
