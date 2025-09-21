// src/app/modules/booking/[id]/edit/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { PrismaClient, AppearanceType } from "@prisma/client";

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
      <main className="mx-auto max-w-3xl p-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Edit Booking</h1>
        <p>Booking not found.</p>
        <Link href="/modules/booking" className="text-sm underline">
          ← Back to bookings
        </Link>
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
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Edit Booking</h1>
      <p className="text-gray-600">
        Update the minimal fields: subject, time, location, and extras.
      </p>

      {/* No client JS. Server Action handles everything on first click/Enter. */}
      <form
        action={updateBooking}
        method="post"
        className="space-y-4"
        noValidate
      >
        {/* Important: include id so the action knows which record */}
        <input type="hidden" name="id" value={booking.id} />

        <div>
          <label htmlFor="subject" className="block text-sm font-medium">
            Subject <span className="text-red-600">*</span>
          </label>
          <input
            id="subject"
            name="subject"
            type="text"
            required
            defaultValue={subject}
            className="mt-1 w-full rounded-lg border p-2"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="startAt" className="block text-sm font-medium">
              Start date/time <span className="text-red-600">*</span>
            </label>
            <input
              id="startAt"
              name="startAt"
              type="datetime-local"
              required
              defaultValue={toDatetimeLocalValue(startAt)}
              className="mt-1 w-full rounded-lg border p-2"
            />
          </div>

          <div>
            <label htmlFor="durationMins" className="block text-sm font-medium">
              Duration (minutes) <span className="text-red-600">*</span>
            </label>
            <input
              id="durationMins"
              name="durationMins"
              type="number"
              min={1}
              required
              defaultValue={durationMins}
              className="mt-1 w-full rounded-lg border p-2"
            />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Appearance Type</legend>
          <div className="flex gap-6">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="appearanceType"
                value="ONLINE"
                defaultChecked={appearanceType === "ONLINE"}
              />
              <span>Online</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="appearanceType"
                value="IN_PERSON"
                defaultChecked={appearanceType === "IN_PERSON"}
              />
              <span>In-person</span>
            </label>
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="locationName" className="block text-sm font-medium">
              Location name
            </label>
            <input
              id="locationName"
              name="locationName"
              type="text"
              defaultValue={locationName}
              className="mt-1 w-full rounded-lg border p-2"
            />
          </div>

          <div>
            <label htmlFor="locationUrl" className="block text-sm font-medium">
              Location URL (map / meeting link)
            </label>
            <input
              id="locationUrl"
              name="locationUrl"
              type="url"
              defaultValue={locationUrl}
              className="mt-1 w-full rounded-lg border p-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="programName" className="block text-sm font-medium">
              Program name (optional)
            </label>
            <input
              id="programName"
              name="programName"
              type="text"
              defaultValue={programName}
              className="mt-1 w-full rounded-lg border p-2"
            />
          </div>

          <div>
            <label htmlFor="hostName" className="block text-sm font-medium">
              Host name (optional)
            </label>
            <input
              id="hostName"
              name="hostName"
              type="text"
              defaultValue={hostName}
              className="mt-1 w-full rounded-lg border p-2"
            />
          </div>
        </div>

        <div>
          <label htmlFor="talkingPoints" className="block text-sm font-medium">
            Talking points (optional)
          </label>
          <textarea
            id="talkingPoints"
            name="talkingPoints"
            rows={4}
            defaultValue={talkingPoints}
            className="mt-1 w-full rounded-lg border p-2"
          />
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            Save changes
          </button>
          <Link
            href={`/modules/booking/${booking.id}`}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
