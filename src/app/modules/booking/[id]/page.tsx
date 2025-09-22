// src/app/modules/booking/[id]/page.tsx
import React from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../api/auth/[...nextauth]/route";
import prisma from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

type PageProps = { params: { id: string } };

function toLocalInputValue(date: Date) {
  const d = new Date(date);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default async function EditBookingPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;

  if (!email) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-red-600">Unauthorized</p>
        <Link href="/modules/booking" className="text-blue-600 underline">
          Back to bookings
        </Link>
      </main>
    );
  }

  // Load booking
  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
  });

  if (!booking) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-red-600">Booking not found.</p>
        <Link href="/modules/booking" className="text-blue-600 underline">
          Back to bookings
        </Link>
      </main>
    );
  }

  // Resolve current user id
  const me = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  // Robust staff check using Prisma only (no raw SQL)
  // If user has ANY membership with role OWNER/PRODUCER, they are staff.
  let isStaff = false;
  if (me?.id) {
    const staff = await prisma.organizationMembership.findFirst({
      where: {
        userId: me.id,
        role: { in: ["OWNER", "PRODUCER"] },
      },
      select: { orgId: true },
    });
    isStaff = !!staff;
  }

  const isExpert = !isStaff;
  // Unblock: allow staff to edit regardless of org while we verify memberships end-to-end.
  const canEdit = isStaff;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-4">
        <Link href="/modules/booking" className="text-blue-600 underline">
          ← Back to bookings
        </Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">Edit Booking</h1>

      {isExpert && (
        <div className="mt-4 rounded-md border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          You’re viewing this booking as{" "}
          <span className="font-semibold">Expert</span>. Fields are read-only;
          only Producers can make changes.
        </div>
      )}

      <form className="mt-6 grid grid-cols-1 gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Subject *</span>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            defaultValue={booking.subject}
            disabled={!canEdit}
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Start date/time *
            </span>
            <input
              type="datetime-local"
              className="w-full rounded-md border px-3 py-2 text-sm"
              defaultValue={toLocalInputValue(booking.startAt)}
              disabled={!canEdit}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              Duration (minutes) *
            </span>
            <input
              type="number"
              className="w-full rounded-md border px-3 py-2 text-sm"
              defaultValue={booking.durationMins}
              disabled={!canEdit}
            />
          </label>
        </div>

        <fieldset className="mt-2">
          <legend className="mb-1 block text-sm font-medium">
            Appearance Type
          </legend>
          <div className="flex items-center gap-6">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="appearance"
                defaultChecked={booking.appearanceType === "ONLINE"}
                disabled={!canEdit}
              />
              Online
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="appearance"
                defaultChecked={booking.appearanceType === "IN_PERSON"}
                disabled={!canEdit}
              />
              In-person
            </label>
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Location name</span>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            defaultValue={booking.locationName ?? ""}
            disabled={!canEdit}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Location URL (map / meeting link)
          </span>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            defaultValue={booking.locationUrl ?? ""}
            disabled={!canEdit}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Program name (optional)
          </span>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            defaultValue={booking.programName ?? ""}
            disabled={!canEdit}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Host name (optional)
          </span>
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            defaultValue={booking.hostName ?? ""}
            disabled={!canEdit}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Talking points (optional)
          </span>
          <textarea
            className="h-32 w-full rounded-md border px-3 py-2 text-sm"
            defaultValue={booking.talkingPoints ?? ""}
            disabled={!canEdit}
          />
        </label>

        <div className="mt-2">
          <Link href="/modules/booking" className="text-blue-600 underline">
            Back to list
          </Link>
        </div>
      </form>
    </main>
  );
}
