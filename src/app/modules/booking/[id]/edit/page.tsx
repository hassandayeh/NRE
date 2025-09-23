"use client"; // src/app/modules/booking/[id]/edit/page.tsx

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

export const dynamic = "force-dynamic";

type AppearanceType = "ONLINE" | "IN_PERSON";

type Booking = {
  id: string;
  subject: string;
  startAt: string; // ISO
  durationMins: number;
  appearanceType: AppearanceType;
  locationName: string | null;
  locationUrl: string | null;
  programName: string | null;
  hostName: string | null;
  talkingPoints: string | null;
  orgId: string | null;
  expertName?: string | null;
  newsroomName?: string | null;
};

type Role = "OWNER" | "ADMIN" | "PRODUCER" | "EXPERT";

type WhoAmI = {
  sessionEmail: string | null;
  user: { id: string; activeOrgId: string | null } | null;
  memberships: Array<{ orgId: string; role: Role }>;
  activeOrgId: string | null;
  bookingOrgId: string | null;
  // NOTE: we no longer rely on this single membership to infer edit rights
  staffMembership: { orgId: string; role: "OWNER" | "PRODUCER" } | null;
};

const STAFF_ROLES: ReadonlySet<Role> = new Set(["OWNER", "ADMIN", "PRODUCER"]);

function pad(n: number) {
  return `${n}`.padStart(2, "0");
}
function toLocalInputValue(dateish: string | Date) {
  const d = new Date(dateish);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function EditBookingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // NEW: field-level errors (we only map Duration for now)
  const [fieldErrors, setFieldErrors] = useState<{ durationMins?: string }>({});

  const [booking, setBooking] = useState<Booking | null>(null);
  const [who, setWho] = useState<WhoAmI | null>(null);

  const [subject, setSubject] = useState("");
  const [startAtLocal, setStartAtLocal] = useState("");
  const [durationMins, setDurationMins] = useState<number>(30);
  const [appearanceType, setAppearanceType] =
    useState<AppearanceType>("ONLINE");
  const [locationName, setLocationName] = useState("");
  const [locationUrl, setLocationUrl] = useState("");
  const [programName, setProgramName] = useState("");
  const [hostName, setHostName] = useState("");
  const [talkingPoints, setTalkingPoints] = useState("");

  // Compute staff-ness from ALL memberships; ignore activeOrgId entirely.
  const isNewsroomStaffAnywhere = useMemo(() => {
    if (!who?.memberships) return false;
    return who.memberships.some((m) => STAFF_ROLES.has(m.role));
  }, [who]);

  const isStaffOfBookingOrg = useMemo(() => {
    if (!who?.memberships || !booking?.orgId) return false;
    return who.memberships.some(
      (m) => STAFF_ROLES.has(m.role) && m.orgId === booking.orgId
    );
  }, [who, booking]);

  const canEdit = isStaffOfBookingOrg; // single source of truth for UI editability

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setLoadError(null);
        const [bRes, wRes] = await Promise.all([
          fetch(`/api/bookings/${id}`, {
            cache: "no-store",
            credentials: "include",
          }),
          fetch(`/api/whoami?bookingId=${id}`, {
            cache: "no-store",
            credentials: "include",
          }),
        ]);

        if (!bRes.ok) {
          if (bRes.status === 401)
            throw new Error("Unauthorized.\nPlease sign in.");
          if (bRes.status === 404) throw new Error("Booking not found.");
          throw new Error("Failed to load booking.");
        }

        const bJson = (await bRes.json()) as { ok: boolean; booking: Booking };
        const wJson = wRes.ok ? ((await wRes.json()) as WhoAmI) : null;

        if (cancelled) return;

        setBooking(bJson.booking);
        setWho(wJson);
        setSubject(bJson.booking.subject ?? "");
        setStartAtLocal(toLocalInputValue(bJson.booking.startAt));
        setDurationMins(bJson.booking.durationMins ?? 30);
        setAppearanceType(bJson.booking.appearanceType ?? "ONLINE");
        setLocationName(bJson.booking.locationName ?? "");
        setLocationUrl(bJson.booking.locationUrl ?? "");
        setProgramName(bJson.booking.programName ?? "");
        setHostName(bJson.booking.hostName ?? "");
        setTalkingPoints(bJson.booking.talkingPoints ?? "");
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || "Failed to load booking.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setFieldErrors({}); // clear field-level errors before submit
    setSaving(true);

    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          startAt: startAtLocal,
          durationMins: Number(durationMins),
          appearanceType,
          locationName: locationName || null,
          locationUrl: locationUrl || null,
          programName: programName || null,
          hostName: hostName || null,
          talkingPoints: talkingPoints || null,
        }),
      });

      if (!res.ok) {
        if (res.status === 400) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          const msg = j?.error || "Invalid data.";

          // Map known duration errors to field-level inline errors
          if (
            msg === "durationMins must be > 0" ||
            msg === "durationMins must be a number"
          ) {
            setFieldErrors({ durationMins: msg });
            return; // handled → don't show page-level error
          }

          // Unknown 400s fall back to page-level error
          throw new Error(msg);
        }
        if (res.status === 403)
          throw new Error("You don’t have permission to edit this booking.");
        if (res.status === 404) throw new Error("Booking not found.");
        if (res.status === 401)
          throw new Error("Unauthorized.\nPlease sign in.");
        throw new Error("Failed to update booking.");
      }

      // Success → list with toast
      router.push("/modules/booking?updated=1");
    } catch (err: any) {
      setSaveError(err?.message || "Failed to update booking.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-4">
        <Link href="/modules/booking" className="text-sm underline">
          ← Back to bookings
        </Link>
        <h1 className="text-2xl font-semibold">Edit Booking</h1>
        <p>Loading booking…</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-4">
        <Link href="/modules/booking" className="text-sm underline">
          ← Back to bookings
        </Link>
        <h1 className="text-2xl font-semibold">Edit Booking</h1>
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
          {loadError}
        </div>
      </main>
    );
  }

  if (!booking) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-4">
        <Link href="/modules/booking" className="text-sm underline">
          ← Back to bookings
        </Link>
        <h1 className="text-2xl font-semibold">Edit Booking</h1>
        <p>Booking not found.</p>
      </main>
    );
  }

  const readOnlyMessage = !canEdit
    ? isNewsroomStaffAnywhere
      ? "This booking belongs to a different organization. Only newsroom staff of the owning org can edit."
      : "You’re viewing this booking as an Expert. Fields are read-only; only newsroom staff can make changes."
    : null;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <Link href="/modules/booking" className="text-sm underline">
        ← Back to bookings
      </Link>
      <h1 className="text-2xl font-semibold">Edit Booking</h1>

      {!canEdit && readOnlyMessage && (
        <div
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
        >
          <strong>Read-only — </strong>
          {readOnlyMessage}
        </div>
      )}

      <form onSubmit={onSave} className="space-y-4" noValidate>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Subject *</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={!canEdit || saving}
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Start date/time *
          </span>
          <input
            type="datetime-local"
            value={startAtLocal}
            onChange={(e) => setStartAtLocal(e.target.value)}
            disabled={!canEdit || saving}
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Duration (minutes) *
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={Number.isFinite(durationMins) ? durationMins : 0}
            onChange={(e) => setDurationMins(Number(e.target.value || 0))}
            disabled={!canEdit || saving}
            aria-invalid={fieldErrors.durationMins ? true : undefined}
            aria-describedby={
              fieldErrors.durationMins ? "duration-error" : undefined
            }
            className={`w-full rounded-md border px-3 py-2 ${
              fieldErrors.durationMins ? "border-red-500" : ""
            }`}
            required
          />
          {fieldErrors.durationMins && (
            <p id="duration-error" className="mt-1 text-sm text-red-600">
              {fieldErrors.durationMins}
            </p>
          )}
        </label>

        <fieldset className="space-y-2">
          <legend className="mb-1 block text-sm font-medium">
            Appearance Type
          </legend>
          <label className="mr-4 inline-flex items-center gap-2">
            <input
              type="radio"
              name="appearanceType"
              checked={appearanceType === "ONLINE"}
              onChange={() => setAppearanceType("ONLINE")}
              disabled={!canEdit || saving}
            />
            <span>Online</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="appearanceType"
              checked={appearanceType === "IN_PERSON"}
              onChange={() => setAppearanceType("IN_PERSON")}
              disabled={!canEdit || saving}
            />
            <span>In-person</span>
          </label>
        </fieldset>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Location name (optional)
          </span>
          <input
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            disabled={!canEdit || saving}
            className="w-full rounded-md border px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Location URL (optional)
          </span>
          <input
            value={locationUrl}
            onChange={(e) => setLocationUrl(e.target.value)}
            disabled={!canEdit || saving}
            className="w-full rounded-md border px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Program name (optional)
          </span>
          <input
            value={programName}
            onChange={(e) => setProgramName(e.target.value)}
            disabled={!canEdit || saving}
            className="w-full rounded-md border px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Host name (optional)
          </span>
          <input
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
            disabled={!canEdit || saving}
            className="w-full rounded-md border px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            Talking points (optional)
          </span>
          <textarea
            value={talkingPoints}
            onChange={(e) => setTalkingPoints(e.target.value)}
            disabled={!canEdit || saving}
            className="w-full rounded-md border px-3 py-2"
            rows={4}
          />
        </label>

        {saveError && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
            {saveError}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={!canEdit || saving}
            className={`rounded-md px-4 py-2 text-white ${
              !canEdit || saving
                ? "bg-gray-400"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
            aria-disabled={!canEdit || saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <Link href="/modules/booking" className="text-gray-700 underline">
            Cancel
          </Link>
        </div>
      </form>

      <div className="mt-4">
        <p className="text-xs text-gray-500">
          Tip: After saving, you’ll be redirected to the list and see a success
          toast.
        </p>
      </div>
    </main>
  );
}
