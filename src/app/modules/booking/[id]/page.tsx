// src/app/modules/booking/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { AppearanceType } from "@prisma/client";
import prisma from "../../../../lib/prisma"; // ✅ centralized Prisma singleton

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
  const updated = searchParams?.updated === "1"; // boolean

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      {/* Top actions */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Booking details
        </h1>
        <Link
          href={`/modules/booking/${booking.id}/edit`}
          className="rounded-lg border px-3 py-1 text-sm"
        >
          Edit booking
        </Link>
      </div>

      {/* Success banner after edit */}
      {updated ? (
        <div className="rounded-lg border bg-green-50 p-4" role="status">
          <div className="text-sm font-medium text-green-800">
            Booking updated successfully.
          </div>
        </div>
      ) : null}

      <div>
        <Link href="/modules/booking" className="text-sm underline">
          ← Back to bookings
        </Link>
      </div>

      {/* Core fields */}
      <section className="space-y-3">
        <Field label="Subject" value={booking.subject ?? "—"} />
        <Field label="Expert" value={booking.expertName ?? "—"} />
        <Field label="Appearance" value={pretty(booking.appearanceType)} />
        <Field
          label="Start"
          value={new Date(booking.startAt).toLocaleString()}
        />
        <Field
          label="Duration (mins)"
          value={String(booking.durationMins ?? "—")}
        />
      </section>

      {/* Location */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Location</h2>
        {isOnline ? (
          <Field
            label="Meeting link"
            value={booking.locationUrl ?? "—"}
            isLink
          />
        ) : (
          <Field label="Venue" value={booking.locationName ?? "—"} />
        )}
      </section>

      {/* Extras */}
      {(booking.programName || booking.hostName || booking.talkingPoints) && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Extras</h2>
          {booking.programName && (
            <Field label="Program" value={booking.programName} />
          )}
          {booking.hostName && <Field label="Host" value={booking.hostName} />}
          {booking.talkingPoints && (
            <FieldText label="Talking points" value={booking.talkingPoints} />
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
  const text = value || "—";
  return (
    <div className="flex items-start gap-3">
      <div className="w-40 shrink-0 text-sm text-gray-600">{label}</div>
      <div className="text-sm">
        {isLink && text && text !== "—" ? (
          <a href={text} className="underline" target="_blank" rel="noreferrer">
            {text}
          </a>
        ) : (
          text
        )}
      </div>
    </div>
  );
}

function FieldText({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-40 shrink-0 text-sm text-gray-600">{label}</div>
      <div className="whitespace-pre-wrap text-sm">{value}</div>
    </div>
  );
}
