// src/app/modules/booking/[id]/edit/page.tsx
import React from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../api/auth/[...nextauth]/route";
import prisma from "../../../../../lib/prisma";

export const dynamic = "force-dynamic";

type PageProps = { params: { id: string } };
type Role = "OWNER" | "ADMIN" | "PRODUCER" | "EXPERT";
const STAFF_ROLES: Role[] = ["OWNER", "ADMIN", "PRODUCER"];

function toLocalInputValue(date: Date) {
  const d = new Date(date);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default async function EditBookingPage({ params }: PageProps) {
  // ---- Session
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-4">
        <h1 className="text-xl font-semibold">Unauthorized</h1>
        <p className="text-gray-600">You must sign in to view this booking.</p>
        <div className="mt-4">
          <Link href="/modules/booking" className="text-blue-600 underline">
            Back to bookings
          </Link>
        </div>
      </main>
    );
  }

  // ---- Load booking (schema uses scalar FK: orgId)
  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      subject: true,
      startAt: true,
      durationMins: true,
      appearanceType: true,
      locationName: true,
      locationUrl: true,
      programName: true,
      hostName: true,
      talkingPoints: true,
      orgId: true,
      expertName: true,
      newsroomName: true,
    },
  });

  if (!booking) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-4">
        <p className="text-red-700">Booking not found.</p>
        <div className="mt-2">
          <Link href="/modules/booking" className="text-blue-600 underline">
            Back to bookings
          </Link>
        </div>
      </main>
    );
  }

  // ---- Resolve memberships (all rows), prefer activeOrgId when set
  const dbUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, activeOrgId: true },
  });
  const userId = dbUser?.id ?? null;

  const memberships = userId
    ? await prisma.organizationMembership.findMany({
        where: { userId },
        select: { orgId: true, role: true },
      })
    : [];

  const staffMembership =
    memberships.find((m) =>
      (STAFF_ROLES as string[]).includes(m.role as Role)
    ) ?? null;

  const staffOrgId = dbUser?.activeOrgId ?? staffMembership?.orgId ?? null;

  const isStaff = !!staffOrgId;
  const canEdit =
    isStaff && booking.orgId != null && booking.orgId === staffOrgId;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <Link href="/modules/booking" className="text-blue-600 underline">
          ← Back to bookings
        </Link>
      </div>

      <h1 className="text-2xl font-semibold">Edit Booking</h1>

      {!canEdit && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
        >
          <p className="font-medium">Read-only</p>
          <p className="text-sm">
            {isStaff
              ? "This booking belongs to a different organization. Only newsroom staff of the owning org can edit."
              : "You’re viewing this booking as an Expert. Fields are read-only; only newsroom staff can make changes."}
          </p>
        </div>
      )}

      <form className="space-y-4">
        <label className="block">
          <span className="block text-sm font-medium">Subject *</span>
          <input
            name="subject"
            defaultValue={booking.subject ?? ""}
            disabled={!canEdit}
            className="mt-1 w-full rounded-md border p-2"
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="block text-sm font-medium">Start date/time *</span>
            <input
              type="datetime-local"
              name="startAt"
              defaultValue={
                booking.startAt
                  ? toLocalInputValue(new Date(booking.startAt as any))
                  : ""
              }
              disabled={!canEdit}
              className="mt-1 w-full rounded-md border p-2"
            />
          </label>

          <label className="block">
            <span className="block text-sm font-medium">
              Duration (minutes) *
            </span>
            <input
              type="number"
              name="durationMins"
              min={1}
              defaultValue={booking.durationMins ?? 30}
              disabled={!canEdit}
              className="mt-1 w-full rounded-md border p-2"
            />
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Appearance Type</legend>
          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="appearanceType"
                value="ONLINE"
                defaultChecked={booking.appearanceType === "ONLINE"}
                disabled={!canEdit}
              />
              <span>Online</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="appearanceType"
                value="IN_PERSON"
                defaultChecked={booking.appearanceType === "IN_PERSON"}
                disabled={!canEdit}
              />
              <span>In-person</span>
            </label>
          </div>
        </fieldset>

        <label className="block">
          <span className="block text-sm font-medium">
            Location name <span className="text-gray-500">(optional)</span>
          </span>
          <input
            name="locationName"
            defaultValue={booking.locationName ?? ""}
            disabled={!canEdit}
            className="mt-1 w-full rounded-md border p-2"
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium">
            Location URL <span className="text-gray-500">(optional)</span>
          </span>
          <input
            name="locationUrl"
            defaultValue={booking.locationUrl ?? ""}
            disabled={!canEdit}
            className="mt-1 w-full rounded-md border p-2"
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium">
            Program name <span className="text-gray-500">(optional)</span>
          </span>
          <input
            name="programName"
            defaultValue={booking.programName ?? ""}
            disabled={!canEdit}
            className="mt-1 w-full rounded-md border p-2"
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium">
            Host name <span className="text-gray-500">(optional)</span>
          </span>
          <input
            name="hostName"
            defaultValue={booking.hostName ?? ""}
            disabled={!canEdit}
            className="mt-1 w-full rounded-md border p-2"
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium">
            Talking points <span className="text-gray-500">(optional)</span>
          </span>
          <textarea
            name="talkingPoints"
            defaultValue={booking.talkingPoints ?? ""}
            disabled={!canEdit}
            className="mt-1 w-full rounded-md border p-2"
            rows={6}
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
