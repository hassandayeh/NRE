// src/app/modules/booking/[id]/edit/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../api/auth/[...nextauth]/route";
import prisma from "../../../../../lib/prisma";

type PageParams = { params: { id: string } };

function formatLocal(dt: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(dt);
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

// ---- helpers
async function getViewer() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return {
      session,
      user: null as null | { id: string; activeOrgId: string | null },
    };
  }
  // Load the full user from DB by email (session may not contain id/activeOrgId)
  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, activeOrgId: true },
  });
  return {
    session,
    user: dbUser ?? null,
  };
}

function canEditRole(role: string) {
  return role === "OWNER" || role === "PRODUCER";
}

async function getRoleInActiveOrg(
  userId: string | null,
  activeOrgId: string | null
) {
  if (!userId || !activeOrgId) return "GUEST" as const;
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId, orgId: activeOrgId },
    select: { role: true },
  });
  return (membership?.role ?? "GUEST") as
    | "OWNER"
    | "PRODUCER"
    | "EXPERT"
    | "GUEST";
}

export default async function EditBookingPage({ params }: PageParams) {
  const { session, user } = await getViewer();
  if (!session?.user || !user) {
    redirect("/auth/signin?callbackUrl=/modules/booking");
  }

  const { id: userId, activeOrgId } = user;

  // Load booking
  const booking = await prisma.booking.findUnique({ where: { id: params.id } });
  if (!booking) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-red-600">Booking not found.</p>
        <Link href="/modules/booking" className="text-blue-600 underline">
          Back to bookings
        </Link>
      </main>
    );
  }

  const role = await getRoleInActiveOrg(userId, activeOrgId);
  const canEdit =
    canEditRole(role) && !!activeOrgId && booking.orgId === activeOrgId;
  const canDelete = canEdit;

  // ---------- server actions ----------
  async function saveAction(formData: FormData) {
    "use server";
    const viewer = await getViewer();
    if (!viewer.user) throw new Error("Unauthorized");
    const role = await getRoleInActiveOrg(
      viewer.user.id,
      viewer.user.activeOrgId
    );
    if (!canEditRole(role) || !viewer.user.activeOrgId)
      throw new Error("Forbidden");

    const subject = String(formData.get("subject") || "");
    const startAtStr = String(formData.get("startAt") || "");
    const durationMins = Number(formData.get("durationMins") || 0);
    const appearanceType = String(formData.get("appearanceType") || "ONLINE");
    const locationName = String(formData.get("locationName") || "");
    const locationUrl = String(formData.get("locationUrl") || "");
    const programName = String(formData.get("programName") || "");
    const hostName = String(formData.get("hostName") || "");
    const talkingPoints = String(formData.get("talkingPoints") || "");

    const startAt = new Date(startAtStr);
    if (
      !subject ||
      Number.isNaN(startAt.getTime()) ||
      !durationMins ||
      durationMins <= 0
    ) {
      throw new Error("Invalid form");
    }

    const existing = await prisma.booking.findUnique({
      where: { id: params.id },
    });
    if (!existing || existing.orgId !== viewer.user.activeOrgId)
      throw new Error("Forbidden");

    await prisma.booking.update({
      where: { id: params.id },
      data: {
        subject,
        startAt,
        durationMins,
        appearanceType: appearanceType as any,
        locationName,
        locationUrl,
        programName,
        hostName,
        talkingPoints,
      },
    });

    revalidatePath("/modules/booking");
    redirect("/modules/booking");
  }

  async function deleteAction() {
    "use server";
    const viewer = await getViewer();
    if (!viewer.user) throw new Error("Unauthorized");
    const role = await getRoleInActiveOrg(
      viewer.user.id,
      viewer.user.activeOrgId
    );
    if (!canEditRole(role) || !viewer.user.activeOrgId)
      throw new Error("Forbidden");

    const existing = await prisma.booking.findUnique({
      where: { id: params.id },
    });
    if (!existing || existing.orgId !== viewer.user.activeOrgId)
      throw new Error("Forbidden");

    await prisma.booking.delete({ where: { id: params.id } });
    revalidatePath("/modules/booking");
    redirect("/modules/booking");
  }

  // ---------- UI ----------
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Edit Booking</h1>
        <Link href="/modules/booking" className="text-blue-600 underline">
          ← Back to bookings
        </Link>
      </div>

      {!canEdit && (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          You’re viewing this booking as <strong>Expert</strong>. Fields are
          read-only; only Producers can make changes.
        </div>
      )}

      <form action={saveAction} className="space-y-5">
        <fieldset disabled={!canEdit} className={!canEdit ? "opacity-70" : ""}>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Subject *
            </label>
            <input
              name="subject"
              defaultValue={booking.subject ?? ""}
              placeholder="Interview topic"
              required
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                Start date/time *
              </label>
              <input
                type="datetime-local"
                name="startAt"
                defaultValue={formatLocal(booking.startAt ?? new Date())}
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                Duration (minutes) *
              </label>
              <input
                type="number"
                name="durationMins"
                min={5}
                step={5}
                defaultValue={booking.durationMins ?? 30}
                required
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Appearance Type
            </label>
            <div>
              <label className="mr-4 inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="appearanceType"
                  value="ONLINE"
                  defaultChecked={booking.appearanceType === "ONLINE"}
                />
                Online
              </label>
              <label className="mr-4 inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="appearanceType"
                  value="IN_PERSON"
                  defaultChecked={booking.appearanceType === "IN_PERSON"}
                />
                In-person
              </label>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Location name
            </label>
            <input
              name="locationName"
              defaultValue={booking.locationName ?? ""}
              placeholder="Studio 1"
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Location URL (map / meeting link)
            </label>
            <input
              name="locationUrl"
              defaultValue={booking.locationUrl ?? ""}
              placeholder="https://maps.example/studio-1"
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Program name (optional)
            </label>
            <input
              name="programName"
              defaultValue={booking.programName ?? ""}
              placeholder="Evening Desk"
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Host name (optional)
            </label>
            <input
              name="hostName"
              defaultValue={booking.hostName ?? ""}
              placeholder="Maya"
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              Talking points (optional)
            </label>
            <textarea
              name="talkingPoints"
              rows={6}
              defaultValue={booking.talkingPoints ?? ""}
              placeholder="Key bullets…"
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {canEdit ? (
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-sm text-white hover:bg-black focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                Save changes
              </button>
              <Link href="/modules/booking" className="text-sm underline">
                Cancel
              </Link>
              <div className="ml-auto" />
              {canDelete && (
                <button
                  formAction={deleteAction}
                  className="inline-flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  Delete booking
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link href="/modules/booking" className="text-sm underline">
                Back to list
              </Link>
            </div>
          )}
        </fieldset>
      </form>
    </main>
  );
}
