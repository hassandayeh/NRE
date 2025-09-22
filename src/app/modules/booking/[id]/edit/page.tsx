"use client";

// src/app/modules/booking/[id]/edit/page.tsx
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

type WhoAmI = {
  sessionEmail: string | null;
  user: { id: string; activeOrgId: string | null } | null;
  memberships: Array<{
    orgId: string;
    role: "OWNER" | "ADMIN" | "PRODUCER" | "EXPERT";
  }>;
  activeOrgId: string | null;
  bookingOrgId: string | null;
  staffMembership: { orgId: string; role: "OWNER" | "PRODUCER" } | null;
};

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

  const canEdit = useMemo(() => {
    if (!booking || !who) return false;
    const staffOrgId = who.activeOrgId || who.staffMembership?.orgId || null;
    const isStaff = Boolean(staffOrgId);
    return Boolean(isStaff && booking.orgId && staffOrgId === booking.orgId);
  }, [booking, who]);

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
            throw new Error("Unauthorized. Please sign in.");
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
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || "Invalid data.");
        }
        if (res.status === 403)
          throw new Error("You don’t have permission to edit this booking.");
        if (res.status === 404) throw new Error("Booking not found.");
        if (res.status === 401)
          throw new Error("Unauthorized. Please sign in.");
        throw new Error("Failed to update booking.");
      }

      router.push("/modules/booking?updated=1");
    } catch (err: any) {
      setSaveError(err?.message || "Failed to update booking.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <div className="mb-4">
          <Link href="/modules/booking" className="text-blue-600 underline">
            ← Back to bookings
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit Booking</h1>
        <p className="text-gray-600 mt-4">Loading booking…</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-4">
        <div className="mb-2">
          <Link href="/modules/booking" className="text-blue-600 underline">
            ← Back to bookings
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit Booking</h1>
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
          {loadError}
        </div>
      </main>
    );
  }

  if (!booking) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <div className="mb-2">
          <Link href="/modules/booking" className="text-blue-600 underline">
            ← Back to bookings
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit Booking</h1>
        <p className="text-gray-600">Booking not found.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-2">
        <Link href="/modules/booking" className="text-blue-600 underline">
          ← Back to bookings
        </Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">Edit Booking</h1>

      {!canEdit && (
        <div className="mt-4 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-yellow-900">
          <strong className="block mb-1">Read-only</strong>
          {who?.staffMembership
            ? "This booking belongs to a different organization. Only newsroom staff of the owning org can edit."
            : "You’re viewing this booking as an Expert. Fields are read-only; only newsroom staff can make changes."}
        </div>
      )}

      <form
        onSubmit={onSave}
        className="mt-6 space-y-5"
        aria-disabled={!canEdit}
      >
        <div>
          <label className="block text-sm font-medium">
            Subject <span className="text-red-600">*</span>
            <input
              type="text"
              required
              className="mt-1 w-full rounded-md border p-2"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={!canEdit || saving}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium">
            Start date/time <span className="text-red-600">*</span>
            <input
              type="datetime-local"
              required
              className="mt-1 w-full rounded-md border p-2"
              value={startAtLocal}
              onChange={(e) => setStartAtLocal(e.target.value)}
              disabled={!canEdit || saving}
            />
          </label>

          <label className="block text-sm font-medium">
            Duration (minutes) <span className="text-red-600">*</span>
            <input
              type="number"
              min={1}
              required
              className="mt-1 w-full rounded-md border p-2"
              value={durationMins}
              onChange={(e) => setDurationMins(Number(e.target.value || 0))}
              disabled={!canEdit || saving}
            />
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Appearance Type</legend>
          <div className="flex gap-6 mt-1">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="appearanceType"
                value="ONLINE"
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
                value="IN_PERSON"
                checked={appearanceType === "IN_PERSON"}
                onChange={() => setAppearanceType("IN_PERSON")}
                disabled={!canEdit || saving}
              />
              <span>In-person</span>
            </label>
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium">
            Location name (optional)
            <input
              type="text"
              className="mt-1 w-full rounded-md border p-2"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              disabled={!canEdit || saving}
            />
          </label>

          <label className="block text-sm font-medium">
            Location URL (optional)
            <input
              type="url"
              className="mt-1 w-full rounded-md border p-2"
              value={locationUrl}
              onChange={(e) => setLocationUrl(e.target.value)}
              disabled={!canEdit || saving}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium">
            Program name (optional)
            <input
              type="text"
              className="mt-1 w-full rounded-md border p-2"
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              disabled={!canEdit || saving}
            />
          </label>

          <label className="block text-sm font-medium">
            Host name (optional)
            <input
              type="text"
              className="mt-1 w-full rounded-md border p-2"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              disabled={!canEdit || saving}
            />
          </label>
        </div>

        <label className="block text-sm font-medium">
          Talking points (optional)
          <textarea
            rows={5}
            className="mt-1 w-full rounded-md border p-2"
            value={talkingPoints}
            onChange={(e) => setTalkingPoints(e.target.value)}
            disabled={!canEdit || saving}
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
