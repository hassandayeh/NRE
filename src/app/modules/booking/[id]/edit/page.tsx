"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type AppearanceType = "ONLINE" | "IN_PERSON" | "PHONE";
type AppearanceScope = "UNIFIED" | "PER_GUEST";
type AccessProvisioning = "SHARED" | "PER_GUEST";
type ParticipantKind = "EXPERT" | "REPORTER";

type BookingGuest = {
  id: string;
  bookingId: string;
  userId: string | null;
  name: string;
  kind: ParticipantKind;
  order: number;
  appearanceType: AppearanceType;
  joinUrl: string | null;
  venueName: string | null;
  venueAddress: string | null;
  dialInfo: string | null;
};

type Booking = {
  id: string;
  subject: string;
  newsroomName: string;
  programName: string | null;
  hostName: string | null;
  talkingPoints: string | null;

  appearanceScope: AppearanceScope;
  appearanceType: AppearanceType | null;
  accessProvisioning: AccessProvisioning;

  startAt: string;
  durationMins: number;

  // Booking defaults
  locationUrl: string | null;
  locationName: string | null;
  locationAddress: string | null;
  dialInfo: string | null;

  expertUserId: string | null; // legacy mirror
  expertName: string; // legacy mirror
  orgId: string | null;

  guests: BookingGuest[];
};

type ApiGet =
  | { ok: true; booking: Booking; canEdit: boolean }
  | { ok: false; error: string };

type ApiPut = { ok: true; booking: Booking } | { ok: false; error: string };

function typeIcon(t: AppearanceType) {
  if (t === "ONLINE") return "☁️";
  if (t === "IN_PERSON") return "🏢";
  return "📞";
}

function required(s?: string | null) {
  return !!(s && s.trim());
}

export default function EditBookingPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<number | null>(null);
  const [data, setData] = useState<ApiGet | null>(null);

  // editor state
  const [subject, setSubject] = useState("");
  const [appearanceScope, setAppearanceScope] =
    useState<AppearanceScope>("UNIFIED");
  const [appearanceType, setAppearanceType] = useState<AppearanceType | null>(
    "ONLINE"
  );
  const [accessProvisioning, setAccessProvisioning] =
    useState<AccessProvisioning>("SHARED");

  const [locationUrl, setLocationUrl] = useState<string>("");
  const [locationName, setLocationName] = useState<string>("");
  const [locationAddress, setLocationAddress] = useState<string>("");
  const [dialInfo, setDialInfo] = useState<string>("");

  const [guests, setGuests] = useState<BookingGuest[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const canEdit = data && data.ok ? data.canEdit : false;
  const booking = data && data.ok ? data.booking : null;

  // Load booking
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setStatus(null);
      setData(null);
      setSaveMsg(null);
      try {
        const res = await fetch(`/api/bookings/${id}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (cancelled) return;
        setStatus(res.status);
        const json = (await res.json()) as ApiGet;
        if (cancelled) return;
        setData(json);

        if (json && "ok" in json && json.ok) {
          const b = json.booking;
          setSubject(b.subject ?? "");
          setAppearanceScope(b.appearanceScope);
          setAppearanceType(
            b.appearanceScope === "UNIFIED"
              ? b.appearanceType ?? "ONLINE"
              : null
          );
          setAccessProvisioning(b.accessProvisioning);

          setLocationUrl(b.locationUrl ?? "");
          setLocationName(b.locationName ?? "");
          setLocationAddress(b.locationAddress ?? "");
          setDialInfo(b.dialInfo ?? "");

          setGuests(b.guests.slice().sort((a, x) => a.order - x.order));
        }
      } catch {
        if (cancelled) return;
        setStatus(500);
        setData({ ok: false, error: "Network error" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (id) load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // banners
  const banner = useMemo(() => {
    if (loading) return null;
    if (!data || data.ok) return null;
    if (status === 401)
      return { tone: "error", text: "Unauthorized. Please sign in." };
    if (status === 403)
      return {
        tone: "error",
        text: "You don’t have permission to view this booking.",
      };
    if (status === 404) return { tone: "error", text: "Booking not found." };
    return {
      tone: "error",
      text: (data as any).error || "Server error. Please try again.",
    };
  }, [loading, data, status]);

  // local validation mirroring server rules
  function validate(): string | null {
    if (!booking) return "Missing booking context.";
    if (appearanceScope === "UNIFIED") {
      if (!appearanceType) return "Choose a unified appearance type.";
      if (appearanceType === "ONLINE" && !required(locationUrl))
        return "UNIFIED+ONLINE requires a default link.";
      if (
        appearanceType === "IN_PERSON" &&
        !(required(locationName) || required(locationAddress))
      )
        return "UNIFIED+IN_PERSON requires location name or address.";
      if (appearanceType === "PHONE" && !required(dialInfo))
        return "UNIFIED+PHONE requires dial info.";
    } else {
      // PER_GUEST → must have at least one guest
      if (!guests.length) return "At least one guest is required.";
      // If access is PER_GUEST, each must have its own field.
      // If SHARED, allow fallback to defaults.
      for (const g of guests) {
        const hasOwn =
          (g.appearanceType === "ONLINE" && required(g.joinUrl)) ||
          (g.appearanceType === "IN_PERSON" &&
            (required(g.venueName) || required(g.venueAddress))) ||
          (g.appearanceType === "PHONE" && required(g.dialInfo));
        if (!hasOwn) {
          if (accessProvisioning === "PER_GUEST") {
            return `Guest "${g.name}" is missing required access details.`;
          } else {
            // must fallback to defaults of matching type
            if (g.appearanceType === "ONLINE" && !required(locationUrl))
              return `Guest "${g.name}" requires a joinUrl or booking default link.`;
            if (
              g.appearanceType === "IN_PERSON" &&
              !(required(locationName) || required(locationAddress))
            )
              return `Guest "${g.name}" requires venue fields or booking default venue.`;
            if (g.appearanceType === "PHONE" && !required(dialInfo))
              return `Guest "${g.name}" requires dial info or booking default dial.`;
          }
        }
      }
    }
    return null;
  }

  async function onSave() {
    setSaveMsg(null);
    const err = validate();
    if (err) {
      setSaveMsg({ tone: "error", text: err });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        subject,
        appearanceScope,
        appearanceType: appearanceScope === "UNIFIED" ? appearanceType : null,
        accessProvisioning,
        locationUrl: locationUrl || null,
        locationName: locationName || null,
        locationAddress: locationAddress || null,
        dialInfo: dialInfo || null,
        guests: guests.map((g, idx) => ({
          id: g.id, // server replaces in a transaction; id is not required but harmless
          userId: g.userId,
          name: g.name,
          kind: g.kind,
          order: typeof g.order === "number" ? g.order : idx,
          appearanceType:
            appearanceScope === "UNIFIED"
              ? (appearanceType as AppearanceType)
              : g.appearanceType,
          joinUrl: g.joinUrl,
          venueName: g.venueName,
          venueAddress: g.venueAddress,
          dialInfo: g.dialInfo,
        })),
      };

      const res = await fetch(`/api/bookings/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as ApiPut;
      if (!res.ok || !json.ok) {
        const message = (json as any)?.error || `Save failed (${res.status}).`;
        setSaveMsg({ tone: "error", text: message });
        return;
      }
      // refresh local state from server response
      const b = json.booking;
      setAppearanceScope(b.appearanceScope);
      setAppearanceType(
        b.appearanceScope === "UNIFIED" ? b.appearanceType ?? "ONLINE" : null
      );
      setAccessProvisioning(b.accessProvisioning);
      setLocationUrl(b.locationUrl ?? "");
      setLocationName(b.locationName ?? "");
      setLocationAddress(b.locationAddress ?? "");
      setDialInfo(b.dialInfo ?? "");
      setGuests(b.guests.slice().sort((a, x) => a.order - x.order));
      setSaveMsg({ tone: "success", text: "Saved." });
    } catch (e) {
      setSaveMsg({ tone: "error", text: "Network error while saving." });
    } finally {
      setSaving(false);
    }
  }

  function updateGuest<K extends keyof BookingGuest>(
    gid: string,
    key: K,
    value: BookingGuest[K]
  ) {
    setGuests((prev) =>
      prev.map((g) => (g.id === gid ? { ...g, [key]: value } : g))
    );
  }

  function editorForDefaults() {
    // Which blocks to show depends on either unified type (UNIFIED) or
    // on possible fallbacks (PER_GUEST) — for PER_GUEST we simply show all three,
    // since any may be used as fallback.
    const showOnline =
      appearanceScope === "UNIFIED" ? appearanceType === "ONLINE" : true;
    const showInPerson =
      appearanceScope === "UNIFIED" ? appearanceType === "IN_PERSON" : true;
    const showPhone =
      appearanceScope === "UNIFIED" ? appearanceType === "PHONE" : true;

    return (
      <div className="space-y-3">
        {showOnline && (
          <label className="block">
            <span className="text-sm font-medium">
              Default link (for Online)
            </span>
            <input
              className="mt-1 w-full rounded border px-2 py-1"
              placeholder="https://…"
              value={locationUrl}
              onChange={(e) => setLocationUrl(e.target.value)}
              disabled={!canEdit}
            />
          </label>
        )}
        {showInPerson && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">
                Default venue name (for In-person)
              </span>
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                placeholder="Studio A"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                disabled={!canEdit}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">
                Default venue address (for In-person)
              </span>
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                placeholder="123 Main St, City"
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                disabled={!canEdit}
              />
            </label>
          </div>
        )}
        {showPhone && (
          <label className="block">
            <span className="text-sm font-medium">
              Default dial info (for Phone)
            </span>
            <input
              className="mt-1 w-full rounded border px-2 py-1"
              placeholder="Producer will call… or +1 (555)… PIN…"
              value={dialInfo}
              onChange={(e) => setDialInfo(e.target.value)}
              disabled={!canEdit}
            />
          </label>
        )}
      </div>
    );
  }

  function guestEditor(g: BookingGuest) {
    const isShared = accessProvisioning === "SHARED";
    const effectiveType =
      appearanceScope === "UNIFIED"
        ? (appearanceType as AppearanceType)
        : g.appearanceType;

    return (
      <li key={g.id} className="rounded border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-medium">
            {typeIcon(effectiveType)} {g.name}{" "}
            <span className="text-xs text-gray-500">
              ({g.kind.toLowerCase()})
            </span>
          </div>
          <div className="text-xs text-gray-500">#{g.order}</div>
        </div>

        {/* Per-guest type only when PER_GUEST scope */}
        {appearanceScope === "PER_GUEST" && (
          <label className="block">
            <span className="text-sm">Appearance type</span>
            <select
              className="mt-1 rounded border px-2 py-1"
              value={g.appearanceType}
              onChange={(e) =>
                updateGuest(
                  g.id,
                  "appearanceType",
                  e.target.value as AppearanceType
                )
              }
              disabled={!canEdit}
            >
              <option value="ONLINE">ONLINE</option>
              <option value="IN_PERSON">IN_PERSON</option>
              <option value="PHONE">PHONE</option>
            </select>
          </label>
        )}

        {/* Access editors */}
        {isShared ? (
          <div className="text-sm text-gray-600">
            Uses shared booking defaults for access.
          </div>
        ) : (
          <>
            {effectiveType === "ONLINE" && (
              <label className="block">
                <span className="text-sm">Join link</span>
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  placeholder="https://…"
                  value={g.joinUrl ?? ""}
                  onChange={(e) => updateGuest(g.id, "joinUrl", e.target.value)}
                  disabled={!canEdit}
                />
              </label>
            )}
            {effectiveType === "IN_PERSON" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm">Venue name</span>
                  <input
                    className="mt-1 w-full rounded border px-2 py-1"
                    placeholder="Studio A"
                    value={g.venueName ?? ""}
                    onChange={(e) =>
                      updateGuest(g.id, "venueName", e.target.value)
                    }
                    disabled={!canEdit}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-sm">Venue address</span>
                  <input
                    className="mt-1 w-full rounded border px-2 py-1"
                    placeholder="123 Main St, City"
                    value={g.venueAddress ?? ""}
                    onChange={(e) =>
                      updateGuest(g.id, "venueAddress", e.target.value)
                    }
                    disabled={!canEdit}
                  />
                </label>
              </div>
            )}
            {effectiveType === "PHONE" && (
              <label className="block">
                <span className="text-sm">Dial info</span>
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  placeholder="+1 (555)… PIN… or 'Producer will call'"
                  value={g.dialInfo ?? ""}
                  onChange={(e) =>
                    updateGuest(g.id, "dialInfo", e.target.value)
                  }
                  disabled={!canEdit}
                />
              </label>
            )}
          </>
        )}
      </li>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Edit Booking</h1>
        <div className="flex items-center gap-3">
          {/* NEW: View link */}
          {booking && (
            <Link
              href={`/modules/booking/${booking.id}`}
              className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50"
            >
              View
            </Link>
          )}
          <Link href="/modules/booking" className="text-blue-600 underline">
            Back to bookings
          </Link>
        </div>
      </div>

      {loading && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-gray-700">
          Loading…
        </div>
      )}

      {banner && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">
          {banner.text}
        </div>
      )}

      {saveMsg && (
        <div
          className={`rounded-md border p-3 ${
            saveMsg.tone === "success"
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {saveMsg.text}
        </div>
      )}

      {booking && (
        <section className="space-y-5 rounded-lg border p-4 bg-white">
          {!canEdit && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
              Read-only: Hosts can view and add notes. Editing booking fields is
              restricted to Owner/Admin/Producer.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            <label className="block">
              <span className="text-sm font-medium">Subject</span>
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={!canEdit}
              />
            </label>

            {/* Scope + Access switches */}
            <div className="flex flex-wrap gap-6">
              <label className="block">
                <span className="text-sm font-medium">Appearance scope</span>
                <select
                  className="mt-1 rounded border px-2 py-1"
                  value={appearanceScope}
                  onChange={(e) =>
                    setAppearanceScope(e.target.value as AppearanceScope)
                  }
                  disabled={!canEdit}
                >
                  <option value="UNIFIED">UNIFIED (single)</option>
                  <option value="PER_GUEST">PER_GUEST (per guest)</option>
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium">Access provisioning</span>
                <select
                  className="mt-1 rounded border px-2 py-1"
                  value={accessProvisioning}
                  onChange={(e) =>
                    setAccessProvisioning(e.target.value as AccessProvisioning)
                  }
                  disabled={!canEdit}
                >
                  <option value="SHARED">SHARED</option>
                  <option value="PER_GUEST">PER_GUEST</option>
                </select>
              </label>

              {appearanceScope === "UNIFIED" && (
                <label className="block">
                  <span className="text-sm font-medium">Unified type</span>
                  <select
                    className="mt-1 rounded border px-2 py-1"
                    value={appearanceType ?? "ONLINE"}
                    onChange={(e) =>
                      setAppearanceType(e.target.value as AppearanceType)
                    }
                    disabled={!canEdit}
                  >
                    <option value="ONLINE">ONLINE</option>
                    <option value="IN_PERSON">IN_PERSON</option>
                    <option value="PHONE">PHONE</option>
                  </select>
                </label>
              )}
            </div>

            {/* Booking defaults */}
            <div>
              <div className="mb-2 text-sm font-medium">Booking defaults</div>
              <div className={`${!canEdit ? "opacity-60" : ""}`}>
                {editorForDefaults()}
              </div>
            </div>

            {/* Guests */}
            <div className="space-y-2">
              <div className="text-sm font-medium">Guests</div>
              <ul className="space-y-3">
                {guests.map((g) => (
                  <div key={g.id} className={`${!canEdit ? "opacity-60" : ""}`}>
                    {guestEditor(g)}
                  </div>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              className={`rounded-md border px-4 py-2 ${
                canEdit ? "hover:bg-gray-50" : "opacity-50 cursor-not-allowed"
              }`}
              onClick={onSave}
              disabled={!canEdit || saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <span className="text-sm text-gray-500">
              {appearanceScope === "PER_GUEST"
                ? "Tip: per-guest fields override defaults when Access is PER_GUEST; otherwise guests fall back to booking defaults."
                : "Tip: when UNIFIED, only the unified type’s default fields are required."}
            </span>
          </div>
        </section>
      )}
    </main>
  );
}
