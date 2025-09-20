import React from "react";
import Link from "next/link";

/**
 * Route-segment layout for /modules/booking/new
 * Adds a small top bar with a “Back to bookings” link,
 * then renders the existing page unchanged.
 */
export default function NewBookingSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold">New Booking</h1>
          <Link
            href="/modules/booking"
            className="rounded-xl border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            ← Back to bookings
          </Link>
        </div>
      </div>
      <main>{children}</main>
    </>
  );
}
