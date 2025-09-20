// src/app/modules/booking/page.tsx
import React from "react";

/**
 * Booking module scaffolding (routes, components, and types)
 * Route: /modules/booking
 * - Types: Booking, AppearanceType, BookingStatus
 * - Basic UI: list of booking cards + empty state
 * - Dummy data for now (no DB). Will be replaced by Prisma later.
 */

// ===== Types =====
export type AppearanceType = "IN_PERSON" | "ONLINE";
export type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export interface Booking {
  id: string;
  subject: string; // topic or segment title
  expertName: string;
  newsroomName: string;
  appearanceType: AppearanceType;
  status: BookingStatus;
  // ISO string for now; will move to Date with Prisma
  startAt: string;
  durationMins: number;
  // in-person optional fields
  locationName?: string;
  locationUrl?: string; // e.g., Google Maps for IN_PERSON or video link for ONLINE
  createdAt: string;
}

// ===== Temporary placeholder data (to be replaced with DB later) =====
const sampleBookings: Booking[] = [
  {
    id: "bk_001",
    subject: "Inflation outlook Q4",
    expertName: "Dr. Lina Haddad",
    newsroomName: "City Newsroom",
    appearanceType: "ONLINE",
    status: "CONFIRMED",
    startAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // +1 day
    durationMins: 20,
    locationUrl: "https://meet.example.com/xyz",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), // -6h
  },
  {
    id: "bk_002",
    subject: "Studio interview: Renewable policy",
    expertName: "Prof. Omar Farouk",
    newsroomName: "Metro TV",
    appearanceType: "IN_PERSON",
    status: "PENDING",
    startAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(), // +2 days
    durationMins: 30,
    locationName: "Studio A — Downtown HQ",
    locationUrl: "https://maps.google.com/?q=Studio+A+Downtown+HQ",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // -1d
  },
];

// ===== Small UI bits =====
function StatusBadge({ status }: { status: BookingStatus }) {
  const label =
    status === "CONFIRMED"
      ? "Confirmed"
      : status === "PENDING"
      ? "Pending"
      : "Cancelled";
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1";
  const cls =
    status === "CONFIRMED"
      ? `${base} bg-green-50 ring-green-200 text-green-700`
      : status === "PENDING"
      ? `${base} bg-amber-50 ring-amber-200 text-amber-700`
      : `${base} bg-rose-50 ring-rose-200 text-rose-700`;
  return <span className={cls}>{label}</span>;
}

function AppearanceChip({ type }: { type: AppearanceType }) {
  const label = type === "IN_PERSON" ? "In-person" : "Online";
  const cls =
    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium text-gray-700";
  return <span className={cls}>{label}</span>;
}

function BookingCard({ b }: { b: Booking }) {
  const start = new Date(b.startAt);
  const startStr = start.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <li
      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md focus-within:shadow-md"
      role="article"
      aria-labelledby={`booking-${b.id}-subject`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            id={`booking-${b.id}-subject`}
            className="text-base font-semibold text-gray-900"
          >
            {b.subject}
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            <span className="font-medium">{b.expertName}</span> •{" "}
            {b.newsroomName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AppearanceChip type={b.appearanceType} />
          <StatusBadge status={b.status} />
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-sm text-gray-700">
        <div>
          <span className="font-medium">Starts:</span> {startStr} (
          {b.durationMins} mins)
        </div>
        {b.appearanceType === "IN_PERSON" && b.locationName && (
          <div>
            <span className="font-medium">Location:</span>{" "}
            {b.locationUrl ? (
              <a
                className="underline underline-offset-2 hover:no-underline"
                href={b.locationUrl}
                target="_blank"
                rel="noreferrer"
              >
                {b.locationName}
              </a>
            ) : (
              b.locationName
            )}
          </div>
        )}
        {b.appearanceType === "ONLINE" && b.locationUrl && (
          <div>
            <span className="font-medium">Meeting link:</span>{" "}
            <a
              className="underline underline-offset-2 hover:no-underline"
              href={b.locationUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open call
            </a>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label={`View booking ${b.subject}`}
        >
          View
        </button>
        <p className="text-xs text-gray-500">
          Created{" "}
          {new Date(b.createdAt).toLocaleString(undefined, {
            dateStyle: "medium",
          })}
        </p>
      </div>
    </li>
  );
}

// ===== Page =====
export default function BookingsPage() {
  const bookings = sampleBookings; // later: fetch from DB/API
  const hasAny = bookings.length > 0;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bookings</h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage upcoming expert appearances (online & in-person).
          </p>
        </div>
        <a
          href="/modules/booking/new"
          className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          New booking
        </a>
      </header>

      {!hasAny ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-4" role="list" aria-label="Booking list">
          {bookings.map((b) => (
            <BookingCard key={b.id} b={b} />
          ))}
        </ul>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <section
      className="rounded-2xl border border-dashed border-gray-300 p-10 text-center"
      aria-label="No bookings yet"
    >
      <h2 className="text-lg font-semibold">No bookings yet</h2>
      <p className="mt-2 text-sm text-gray-600">
        Create your first booking to schedule an expert appearance.
      </p>
      <div className="mt-5">
        <a
          href="/modules/booking/new"
          className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          New booking
        </a>
      </div>
    </section>
  );
}
