"use client";

/**
 * Edit Booking — API-aligned
 * - Loads via GET /api/bookings/:id which returns { ok, booking, canEdit }
 * - Converts UI location fields → API fields:
 *     ONLINE   => locationUrl (from meetingLink)
 *     IN_PERSON=> locationName (from venueAddress)
 * - PUT /api/bookings/:id delegates to PATCH server route
 */

import React from "react";
import { z } from "zod";
import { useParams } from "next/navigation";

/* ---------- Flags from <body data-*> ---------- */
function readBooleanDataset(key: string, fallback = true): boolean {
  if (typeof document === "undefined") return fallback;
  const raw = (document.body.dataset as DOMStringMap)[key];
  if (raw == null) return fallback;
  return raw === "true";
}
type Flags = {
  showProgramName: boolean;
  showHostName: boolean;
  showTalkingPoints: boolean;
};

/* ---------- Enums & helpers ---------- */
const AppearanceType = z.enum(["ONLINE", "IN_PERSON"]);
type TAppearanceType = z.infer<typeof AppearanceType>;

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ---------- Validation ---------- */
function buildSchema(flags: Flags) {
  const base = z.object({
    subject: z
      .string({ required_error: "Subject is required" })
      .trim()
      .min(2)
      .max(300),
    newsroomName: z
      .string({ required_error: "Newsroom name is required" })
      .trim()
      .min(2)
      .max(200),
    startAt: z.preprocess(
      (v) => (typeof v === "string" ? new Date(v) : v instanceof Date ? v : v),
      z.date({ required_error: "Start date/time is required" })
    ),
    durationMins: z
      .number({ required_error: "Duration is required" })
      .int()
      .min(5)
      .max(600),
    // API still uses expertName (FK to come); expertUserId is optional client-only state
    expertUserId: z.string().optional(),
    expertName: z.string().trim().max(200).optional(),
  });

  const common = z.object({
    guestName: z
      .string({ required_error: "Guest name is required" })
      .trim()
      .min(2),
    programName: flags.showProgramName
      ? z.string().trim().max(120).optional()
      : z.undefined(),
    hostName: flags.showHostName
      ? z.string().trim().max(120).optional()
      : z.undefined(),
    talkingPoints: flags.showTalkingPoints
      ? z.string().trim().max(2000).optional()
      : z.undefined(),
  });

  const Online = z.object({
    appearanceType: z.literal(AppearanceType.Enum.ONLINE),
    meetingLink: z.string({ required_error: "Meeting link is required" }).url(),
  });
  const InPerson = z.object({
    appearanceType: z.literal(AppearanceType.Enum.IN_PERSON),
    venueAddress: z
      .string({ required_error: "Venue/address is required" })
      .min(5),
  });

  return z.intersection(
    base,
    z.discriminatedUnion("appearanceType", [
      common.merge(Online),
      common.merge(InPerson),
    ])
  );
}

/* ---------- UI components ---------- */
import * as ButtonModule from "../../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/* ======================= Expert Combobox (multi) ======================= */
type ExpertRow = {
  id: string;
  name: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  kind?: "EXPERT" | "REPORTER";
  city?: string | null;
  countryCode?: string | null;
  tags?: string[];
  availability?: {
    status: "AVAILABLE" | "BUSY" | "UNKNOWN";
    reasons?: string[];
  };
};
type Picked = { id: string; name: string };

function useDebounce<T>(value: T, ms = 250): T {
  const [v, setV] = React.useState<T>(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ExpertCombobox(props: {
  startAtISO: string;
  durationMins: number;
  values: Picked[];
  onChange: (next: Picked[]) => void;
}) {
  const { startAtISO, durationMins, values, onChange } = props;

  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [visibility, setVisibility] = React.useState<"org" | "public" | "both">(
    "org"
  );
  const [onlyAvailable, setOnlyAvailable] = React.useState(false);

  const [items, setItems] = React.useState<ExpertRow[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>("");
  const [activeIndex, setActiveIndex] = React.useState<number>(-1);

  const debouncedQ = useDebounce(q, 250);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debouncedQ, visibility, onlyAvailable, startAtISO, durationMins]);

  async function fetchPage(reset = false) {
    try {
      setLoading(true);
      setError("");

      const sp = new URLSearchParams({ visibility, take: "20" });
      if (debouncedQ) sp.set("q", debouncedQ);
      if (startAtISO && durationMins > 0) {
        sp.set("startAt", new Date(startAtISO).toISOString());
        sp.set("durationMins", String(durationMins));
        if (onlyAvailable) sp.set("onlyAvailable", "true");
      }
      if (!reset && nextCursor) sp.set("cursor", nextCursor);

      const res = await fetch(`/api/experts/search?${sp.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to fetch experts (${res.status})`);
      }
      const j = (await res.json()) as
        | { items: ExpertRow[]; count?: number; nextCursor?: string | null }
        | ExpertRow[];
      const itemsArr = Array.isArray(j) ? j : j.items || [];
      setItems((prev) => (reset ? itemsArr : [...prev, ...itemsArr]));
      setNextCursor((Array.isArray(j) ? null : j.nextCursor) || null);
      setActiveIndex((x) => (reset ? (itemsArr.length ? 0 : -1) : x));
    } catch (err: any) {
      setError(err?.message || "Failed to load experts.");
      if (reset) {
        setItems([]);
        setNextCursor(null);
      }
    } finally {
      setLoading(false);
    }
  }

  function togglePick(row: ExpertRow) {
    const exists = values.some((v) => v.id === row.id);
    if (exists) onChange(values.filter((v) => v.id !== row.id));
    else onChange([...values, { id: row.id, name: row.name || "Unknown" }]);
  }

  function setPrimary(id: string) {
    const idx = values.findIndex((v) => v.id === id);
    if (idx <= 0) return;
    const next = [...values];
    const [item] = next.splice(idx, 1);
    next.unshift(item);
    onChange(next);
  }

  function clearAll() {
    onChange([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex])
        togglePick(items[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <label className="mb-1 block text-sm font-medium">
        Select experts (search)
      </label>

      {/* Selected chips */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {values.map((v, i) => (
          <span
            key={v.id}
            className="inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs"
          >
            <img
              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(
                v.name
              )}`}
              alt={v.name}
              className="h-5 w-5 rounded-full"
            />
            {v.name}
            {i === 0 ? (
              <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] text-yellow-900">
                primary
              </span>
            ) : (
              <button
                type="button"
                className="rounded px-1 py-0.5 text-[10px] hover:bg-gray-100"
                onClick={() => setPrimary(v.id)}
                title="Make primary"
              >
                ☆ primary
              </button>
            )}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x.id !== v.id))}
              className="rounded p-0.5 text-gray-500 hover:bg-gray-100"
              aria-label={`Remove ${v.name}`}
            >
              ×
            </button>
          </span>
        ))}
        {values.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Input + browse */}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search experts…"
          className="min-w-[240px] flex-1 rounded-md border px-3 py-2"
          aria-expanded={open}
          aria-controls="expert-combobox-listbox"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-lg border bg-white shadow-lg">
          {/* Controls */}
          <div className="flex items-center justify-between gap-2 border-b p-2">
            <div className="flex items-center gap-1">
              {(["org", "public", "both"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={clsx(
                    "rounded-md border px-2 py-1 text-xs capitalize",
                    visibility === v
                      ? "bg-black text-white"
                      : "hover:bg-gray-50"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
              />
              Only available for this slot
            </label>
          </div>

          {/* Results */}
          <div
            id="expert-combobox-listbox"
            role="listbox"
            className="max-h-80 overflow-auto p-1"
          >
            {loading && (
              <div className="p-3 text-sm text-gray-600">Loading experts…</div>
            )}
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-800">
                {error}
              </div>
            )}
            {!loading && !error && items.length === 0 && (
              <div className="p-3 text-sm text-gray-600">No matches.</div>
            )}

            <ul className="space-y-1">
              {items.map((e, idx) => {
                const selected = values.some((v) => v.id === e.id);
                const active = idx === activeIndex;
                const badge =
                  e.availability?.status === "AVAILABLE"
                    ? "bg-green-100 text-green-800"
                    : e.availability?.status === "BUSY"
                    ? "bg-red-100 text-red-800"
                    : "bg-gray-100 text-gray-700";
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={clsx(
                        "flex w-full items-start gap-3 rounded-md border px-2 py-2 text-left",
                        selected ? "ring-2 ring-black" : "",
                        active ? "bg-gray-50" : ""
                      )}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => togglePick(e)}
                    >
                      <img
                        src={
                          e.avatarUrl ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(
                            e.name || "E"
                          )}`
                        }
                        alt={e.name || "Expert"}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <p className="truncate text-sm font-medium">
                            {e.name || "Unnamed"}
                          </p>
                          <span
                            className={clsx(
                              "ml-2 rounded px-2 py-0.5 text-[10px]",
                              badge
                            )}
                          >
                            {e.availability?.status ?? "UNKNOWN"}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-gray-600">
                          {e.kind && (
                            <span className="rounded border px-1 py-0.5">
                              {e.kind.toLowerCase()}
                            </span>
                          )}
                          {e.city && <span>{e.city}</span>}
                          {e.countryCode && (
                            <span className="rounded border px-1 py-0.5">
                              {e.countryCode}
                            </span>
                          )}
                          {(e.tags || []).slice(0, 2).map((t) => (
                            <span
                              key={t}
                              className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-800"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                        {e.bio && (
                          <p className="mt-1 line-clamp-2 text-[11px] text-gray-600">
                            {e.bio}
                          </p>
                        )}
                      </div>
                      <input
                        type="checkbox"
                        readOnly
                        checked={selected}
                        className="mt-1 h-4 w-4"
                        aria-hidden
                      />
                    </button>
                  </li>
                );
              })}
            </ul>

            {nextCursor && !loading && (
              <div className="p-2">
                <button
                  type="button"
                  onClick={() => fetchPage(false)}
                  className="w-full rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
                >
                  Load more
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t p-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ======================= Page ======================= */
export default function EditBookingPage() {
  const params = useParams();
  const bookingId = Array.isArray((params as any)?.id)
    ? (params as any).id[0]
    : (params as any)?.id;

  // Flags
  const [flags, setFlags] = React.useState({
    showProgramName: true,
    showHostName: true,
    showTalkingPoints: true,
  });
  React.useEffect(() => {
    setFlags({
      showProgramName: readBooleanDataset("showProgramName", true),
      showHostName: readBooleanDataset("showHostName", true),
      showTalkingPoints: readBooleanDataset("showTalkingPoints", true),
    });
  }, []);
  const schema = React.useMemo(() => buildSchema(flags), [flags]);

  // Form state
  const [subject, setSubject] = React.useState("");
  const [newsroomName, setNewsroomName] = React.useState("");
  const [startAtISO, setStartAtISO] = React.useState<string>(
    new Date().toISOString()
  );
  const [durationMins, setDurationMins] = React.useState<number>(30);

  const [selected, setSelected] = React.useState<
    Array<{ id: string; name: string }>
  >([]);
  const primary = selected[0];

  const [appearanceType, setAppearanceType] =
    React.useState<TAppearanceType>("ONLINE");
  const [guestName, setGuestName] = React.useState("");
  const [meetingLink, setMeetingLink] = React.useState("");
  const [venueAddress, setVenueAddress] = React.useState("");
  const [programName, setProgramName] = React.useState("");
  const [hostName, setHostName] = React.useState("");
  const [talkingPoints, setTalkingPoints] = React.useState("");

  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Load booking
  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!bookingId) {
        setLoadError("Missing booking ID in URL.");
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setLoadError(null);

        // 1) Preferred: GET /api/bookings/:id → { ok, booking, canEdit }
        let booking: any | null = null;
        try {
          const r = await fetch(
            `/api/bookings/${encodeURIComponent(bookingId)}`,
            { credentials: "include" }
          );
          if (r.ok) {
            const j = await r.json();
            booking = j?.booking ?? (j?.ok ? j?.booking : j);
          }
        } catch {
          /* noop */
        }

        // 2) Fallback: GET /api/bookings (various shapes)
        if (!booking) {
          const r2 = await fetch(`/api/bookings?take=200`, {
            credentials: "include",
          });
          if (r2.ok) {
            const j2 = await r2.json();
            const items: any[] = Array.isArray(j2?.items)
              ? j2.items
              : Array.isArray(j2?.data)
              ? j2.data
              : Array.isArray(j2)
              ? j2
              : [];
            booking =
              items.find((x) => String(x?.id) === String(bookingId)) ?? null;
          }
        }

        if (!booking) throw new Error("Booking not found.");

        if (cancelled) return;

        // Map into form
        setSubject(booking.subject ?? "");
        setNewsroomName(booking.newsroomName ?? "");
        setStartAtISO(new Date(booking.startAt || Date.now()).toISOString());
        setDurationMins(
          Number.isFinite(booking.durationMins) ? booking.durationMins : 30
        );

        if (booking.expertUserId) {
          setSelected([
            {
              id: String(booking.expertUserId),
              name: booking.expertName || "Expert",
            },
          ]);
          setGuestName(booking.guestName || booking.expertName || "");
        } else {
          setSelected([]);
          setGuestName(booking.guestName || "");
        }

        const ap = (booking.appearanceType as TAppearanceType) || "ONLINE";
        setAppearanceType(ap);
        // Reverse-map API location fields into UI
        setMeetingLink(booking.locationUrl || "");
        setVenueAddress(booking.locationName || "");
        setProgramName(booking.programName || "");
        setHostName(booking.hostName || "");
        setTalkingPoints(booking.talkingPoints || "");
      } catch (err: any) {
        setLoadError(err?.message || "Failed to load booking.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  // Keep legacy guest name filled from primary if empty
  React.useEffect(() => {
    if (primary) setGuestName((g) => (g ? g : primary.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    // Build payload in the server route's expected shape
    const base: any = {
      subject: subject.trim(),
      newsroomName: newsroomName.trim(),
      startAt: new Date(startAtISO).toISOString(),
      durationMins,
      ...(primary ? { expertName: primary.name } : {}), // route still uses expertName; FK coming later
      appearanceType,
      guestName: guestName.trim(),
      ...(flags.showProgramName && programName.trim()
        ? { programName: programName.trim() }
        : {}),
      ...(flags.showHostName && hostName.trim()
        ? { hostName: hostName.trim() }
        : {}),
      ...(flags.showTalkingPoints && talkingPoints.trim()
        ? { talkingPoints: talkingPoints.trim() }
        : {}),
    };

    // Map UI location → API
    if (appearanceType === "ONLINE") {
      base.locationUrl = meetingLink.trim();
      base.locationName = null;
    } else {
      base.locationName = venueAddress.trim();
      base.locationUrl = null;
    }

    const parsed = schema.safeParse({
      ...base,
      // schema still validates these UI fields for UX
      meetingLink: appearanceType === "ONLINE" ? meetingLink.trim() : undefined,
      venueAddress:
        appearanceType === "IN_PERSON" ? venueAddress.trim() : undefined,
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") || "form";
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch(
        `/api/bookings/${encodeURIComponent(bookingId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(base),
        }
      );
      if (!res.ok) {
        let message = "Failed to update booking";
        try {
          const body = await res.json();
          message =
            body?.error || (res.status === 400 ? "Validation error" : message);
        } catch {}
        setSubmitError(message);
        return;
      }
      window.location.href = "/modules/booking?updated=1";
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edit Booking</h1>
        <a href="/modules/booking" className="text-sm underline">
          Back to bookings
        </a>
      </div>

      {loading ? (
        <div className="rounded-lg border p-4 text-sm text-gray-600">
          Loading booking…
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {loadError}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Subject */}
          <label className="block">
            <span className="text-sm font-medium">Subject *</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="e.g., TV Interview"
              maxLength={300}
              required
            />
          </label>

          {/* Newsroom name */}
          <label className="block">
            <span className="text-sm font-medium">Newsroom name *</span>
            <input
              value={newsroomName}
              onChange={(e) => setNewsroomName(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="e.g., Global Newsroom"
              maxLength={200}
              required
            />
          </label>

          {/* Start date/time & Duration */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Start date/time *</span>
              <input
                type="datetime-local"
                value={toDatetimeLocalValue(startAtISO)}
                onChange={(e) =>
                  setStartAtISO(new Date(e.target.value).toISOString())
                }
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                required
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Duration (minutes) *</span>
              <input
                type="number"
                value={durationMins}
                onChange={(e) => setDurationMins(parseInt(e.target.value, 10))}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                required
              />
            </label>
          </div>

          {/* MULTI: Expert Combobox */}
          <ExpertCombobox
            startAtISO={startAtISO}
            durationMins={durationMins}
            values={selected}
            onChange={(next) => setSelected(next)}
          />

          {/* Appearance */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Appearance Type</legend>
            <label className="mr-4 inline-flex items-center gap-2">
              <input
                type="radio"
                name="appearance"
                checked={appearanceType === "ONLINE"}
                onChange={() => setAppearanceType("ONLINE")}
              />
              Online
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="appearance"
                checked={appearanceType === "IN_PERSON"}
                onChange={() => setAppearanceType("IN_PERSON")}
              />
              In-person
            </label>
          </fieldset>

          {/* Guest name */}
          <label className="block">
            <span className="text-sm font-medium">Guest name *</span>
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="e.g., Dr. Jane Doe"
              required
            />
          </label>

          {/* Online vs In-person */}
          {appearanceType === "ONLINE" ? (
            <label className="block">
              <span className="text-sm font-medium">Meeting link *</span>
              <input
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="https://…"
                required
              />
            </label>
          ) : (
            <label className="block">
              <span className="text-sm font-medium">Venue / address *</span>
              <input
                value={venueAddress}
                onChange={(e) => setVenueAddress(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="123 Main St, City…"
                required
              />
            </label>
          )}

          {/* Optional fields */}
          {flags.showProgramName && (
            <label className="block">
              <span className="text-sm font-medium">
                Program name (optional)
              </span>
              <input
                value={programName}
                onChange={(e) => setProgramName(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="e.g., Nightly News"
              />
            </label>
          )}

          {flags.showHostName && (
            <label className="block">
              <span className="text-sm font-medium">Host name (optional)</span>
              <input
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="e.g., John Smith"
              />
            </label>
          )}

          {flags.showTalkingPoints && (
            <label className="block">
              <span className="text-sm font-medium">
                Talking points (optional)
              </span>
              <textarea
                value={talkingPoints}
                onChange={(e) => setTalkingPoints(e.target.value)}
                className="mt-1 h-28 w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="Bullet points for the segment…"
              />
            </label>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <UIButton
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm"
            >
              {submitting ? "Saving…" : "Save changes"}
            </UIButton>
            <a href="/modules/booking" className="border px-4 py-2 text-sm">
              Cancel
            </a>
          </div>

          {submitError && <UIAlert variant="error">{submitError}</UIAlert>}
        </form>
      )}
    </main>
  );
}
