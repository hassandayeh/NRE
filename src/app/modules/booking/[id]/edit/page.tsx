// src/app/modules/booking/[id]/edit/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { PrismaClient, AppearanceType } from "@prisma/client";

// Shared UI (client components are safe to render in a Server Component tree)
import Button from "../../../../../components/ui/Button";
import Alert from "../../../../../components/ui/Alert";

export const runtime = "nodejs";

// ---- Prisma singleton (no excess clients)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// util: Date -> value for <input type="datetime-local">
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export default async function EditBookingPage({
  params,
}: {
  params: { id: string };
}) {
  // Load current record (Server Component -> no client JS needed)
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
    },
  });

  if (!booking) {
    return (
      <main className="mx-auto max-w-2xl p-6 space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Edit Booking</h1>
          <Link
            href="/modules/booking"
            className="text-sm text-blue-600 underline"
          >
            ← Back to bookings
          </Link>
        </header>

        <Alert variant="error" title="Booking not found">
          The booking you’re trying to edit doesn’t exist.
        </Alert>
      </main>
    );
  }

  // --- Server Action: runs on the server on submit (no client JS, no GET) ---
  async function updateBooking(formData: FormData) {
    "use server";
    const id = String(formData.get("id") || "");
    if (!id) return;

    const subject = (formData.get("subject") as string | null)?.trim() || "";
    const startAtRaw = (formData.get("startAt") as string | null) || "";
    const durationRaw = (formData.get("durationMins") as string | null) || "0";
    const appearanceTypeRaw =
      (formData.get("appearanceType") as string | null) || "ONLINE";

    const locationName =
      (formData.get("locationName") as string | null)?.trim() || "";
    const locationUrl =
      (formData.get("locationUrl") as string | null)?.trim() || "";
    const programName =
      (formData.get("programName") as string | null)?.trim() || "";
    const hostName = (formData.get("hostName") as string | null)?.trim() || "";
    const talkingPoints =
      (formData.get("talkingPoints") as string | null)?.trim() || "";

    // Parse & coerce
    const durationMins = Number.parseInt(durationRaw, 10) || 0;
    const startAt = startAtRaw ? new Date(startAtRaw) : null;
    const appearanceType =
      appearanceTypeRaw === "IN_PERSON"
        ? AppearanceType.IN_PERSON
        : AppearanceType.ONLINE;

    // Update (send explicit values; coerce empty strings to null for optional fields)
    await prisma.booking.update({
      where: { id },
      data: {
        subject,
        startAt: startAt ?? undefined,
        durationMins: durationMins > 0 ? durationMins : undefined,
        appearanceType,
        locationName: locationName || null,
        locationUrl: locationUrl || null,
        programName: programName || null,
        hostName: hostName || null,
        talkingPoints: talkingPoints || null,
      },
    });

    // Success → go back to list; list page can show a toast/banner using ?updated=1
    redirect("/modules/booking?updated=1");
  }

  // Pre-fill defaults
  const subject = booking.subject ?? "";
  const durationMins = booking.durationMins ?? 30;
  const startAt = booking.startAt ? new Date(booking.startAt) : new Date();
  const appearanceType = booking.appearanceType ?? AppearanceType.ONLINE;
  const locationName = booking.locationName ?? "";
  const locationUrl = booking.locationUrl ?? "";
  const programName = booking.programName ?? "";
  const hostName = booking.hostName ?? "";
  const talkingPoints = booking.talkingPoints ?? "";

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit Booking</h1>
        <Link
          href="/modules/booking"
          className="text-sm text-blue-600 underline"
        >
          ← Back to bookings
        </Link>
      </header>

      <p className="text-sm text-gray-600">
        Update the minimal fields: subject, time, location, and extras.
      </p>

      {/* No client JS. Server Action handles everything on first click/Enter. */}
      <form action={updateBooking} className="space-y-4">
        {/* Important: include id so the action knows which record */}
        <input type="hidden" name="id" value={booking.id} />

        {/* Subject */}
        <label className="block text-sm font-medium">
          Subject *
          <input
            name="subject"
            defaultValue={subject}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            maxLength={300}
            required
          />
        </label>

        {/* Start date/time & Duration */}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium">
            Start date/time *
            <input
              type="datetime-local"
              name="startAt"
              defaultValue={toDatetimeLocalValue(startAt)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              required
            />
          </label>

          <label className="block text-sm font-medium">
            Duration (minutes) *
            <input
              type="number"
              name="durationMins"
              min={5}
              max={600}
              step={5}
              defaultValue={durationMins}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              required
            />
          </label>
        </div>

        {/* Appearance */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Appearance Type</legend>
          <div className="flex gap-2">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="appearanceType"
                value="ONLINE"
                defaultChecked={appearanceType === AppearanceType.ONLINE}
              />
              <span>Online</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="appearanceType"
                value="IN_PERSON"
                defaultChecked={appearanceType === AppearanceType.IN_PERSON}
              />
              <span>In-person</span>
            </label>
          </div>
        </fieldset>

        {/* Location fields */}
        <label className="block text-sm font-medium">
          Location name
          <input
            name="locationName"
            defaultValue={locationName}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-sm font-medium">
          Location URL (map / meeting link)
          <input
            name="locationUrl"
            defaultValue={locationUrl}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="https://…"
          />
        </label>

        {/* Optional extras */}
        <label className="block text-sm font-medium">
          Program name (optional)
          <input
            name="programName"
            defaultValue={programName}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-sm font-medium">
          Host name (optional)
          <input
            name="hostName"
            defaultValue={hostName}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-sm font-medium">
          Talking points (optional)
          <textarea
            name="talkingPoints"
            defaultValue={talkingPoints}
            className="mt-1 h-28 w-full rounded-lg border px-3 py-2 text-sm"
          />
        </label>

        {/* Actions */}
        <div className="mt-2 flex items-center gap-3">
          <Button variant="primary" size="md" type="submit">
            Save changes
          </Button>

          <Button href={`/modules/booking/${booking.id}`} size="md">
            Cancel
          </Button>
        </div>
      </form>
    </main>
  );
}
