"use client";

/**
 * Booking Create Form + Async, Slot-Aware Expert Combobox (MULTI-SELECT)
 * - Source switcher: Org / Public / Both
 * - "Only available for this slot" filter (uses startAt + durationMins)
 * - Debounced search, pagination via nextCursor, keyboard nav (↑/↓/Enter/Escape)
 * - Multi-select: chips with "set primary" (first item is primary)
 * - Primary maps to expertUserId/expertName for current API; others are UI-only for now
 */

import React from "react";
import { z } from "zod";
import { useRouter } from "next/navigation";

/* ---------- Helpers: read server-driven feature flags ---------- */
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

/* ---------- Appearance types ---------- */
const AppearanceType = z.enum(["ONLINE", "IN_PERSON"]);
type TAppearanceType = z.infer<typeof AppearanceType>;

/* ---------- Datetime helpers ---------- */
function nextFullHourLocalISO(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/* ---------- Dynamic schema builder (respects flags) ---------- */
function buildSchema(flags: Flags) {
  const base = z.object({
    subject: z
      .string({ required_error: "Subject is required" })
      .trim()
      .min(2, "Please enter a longer subject")
      .max(300, "Subject is too long"),
    newsroomName: z
      .string({ required_error: "Newsroom name is required" })
      .trim()
      .min(2, "Please enter a longer newsroom name")
      .max(200, "Newsroom name is too long"),
    startAt: z
      .preprocess((v) => {
        if (typeof v === "string") return new Date(v);
        if (v instanceof Date) return v;
        return v;
      }, z.date({ required_error: "Start date/time is required" }))
      .refine((d) => d.getTime() > Date.now(), {
        message: "Start time must be in the future",
      }),
    durationMins: z
      .number({ required_error: "Duration is required" })
      .int("Duration must be a whole number")
      .min(5, "Duration must be at least 5 minutes")
      .max(600, "Duration seems too long"),
    /** FIX: allow cuid/any string — UUID check was blocking submit */
    expertUserId: z.string().optional(),
    expertName: z.string().trim().max(200).optional(),
  });

  const legacyCommon = z.object({
    guestName: z
      .string({ required_error: "Guest name is required" })
      .trim()
      .min(2, "Please enter at least 2 characters"),
    programName: flags.showProgramName
      ? z.string().trim().max(120, "Program name is too long").optional()
      : z.undefined(),
    hostName: flags.showHostName
      ? z.string().trim().max(120, "Host name is too long").optional()
      : z.undefined(),
    talkingPoints: flags.showTalkingPoints
      ? z.string().trim().max(2000, "Talking points are too long").optional()
      : z.undefined(),
  });

  const Online = z.object({
    appearanceType: z.literal(AppearanceType.Enum.ONLINE),
    meetingLink: z
      .string({ required_error: "Meeting link is required" })
      .url("Please enter a valid URL"),
  });
  const InPerson = z.object({
    appearanceType: z.literal(AppearanceType.Enum.IN_PERSON),
    venueAddress: z
      .string({ required_error: "Venue/address is required" })
      .min(5, "Please enter a longer address"),
  });

  return z.intersection(
    base,
    z.discriminatedUnion("appearanceType", [
      legacyCommon.merge(Online),
      legacyCommon.merge(InPerson),
    ])
  );
}

/* ---------- UI components (namespace import + runtime fallback) ---------- */
import * as ButtonModule from "../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/* ---------- Small utilities ---------- */
function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ===============================================================
 * Async Expert Combobox (MULTI-SELECT)
 * ===============================================================*/
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

function ExpertCombobox(props: {
  startAtISO: string;
  durationMins: number;
  values: Picked[];
  onChange: (next: Picked[]) => void; // full array
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
      const j = (await res.json()) as {
        items: ExpertRow[];
        count: number;
        nextCursor: string | null;
      };
      setItems((prev) =>
        reset ? j.items || [] : [...prev, ...(j.items || [])]
      );
      setNextCursor(j.nextCursor || null);
      setActiveIndex((x) => (reset ? (j.items?.length ? 0 : -1) : x));
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
    if (exists) {
      onChange(values.filter((v) => v.id !== row.id));
    } else {
      onChange([...values, { id: row.id, name: row.name || "Unknown" }]);
    }
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
                      onClick={() => togglePick(e)} // MULTI: toggle, do not close
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

/** Debounce hook */
function useDebounce<T>(value: T, ms = 250): T {
  const [v, setV] = React.useState<T>(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ===============================================================
 * Page
 * ===============================================================*/
export default function NewBookingPage() {
  const router = useRouter();

  // Flags from server (RootLayout writes them to <body data-*>)
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

  // Local form state
  const [subject, setSubject] = React.useState("TV Interview");
  const [newsroomName, setNewsroomName] = React.useState("");

  const [startAtISO, setStartAtISO] = React.useState(nextFullHourLocalISO());
  const [durationMins, setDurationMins] = React.useState(30);

  // MULTI: selected experts (first item is primary)
  const [selected, setSelected] = React.useState<
    Array<{ id: string; name: string }>
  >([]);

  // Derived mapping to API fields today (primary only)
  const primary = selected[0];
  const [appearanceType, setAppearanceType] =
    React.useState<TAppearanceType>("ONLINE");
  const [guestName, setGuestName] = React.useState("");
  const [meetingLink, setMeetingLink] = React.useState("");
  const [venueAddress, setVenueAddress] = React.useState("");
  const [programName, setProgramName] = React.useState("");
  const [hostName, setHostName] = React.useState("");
  const [talkingPoints, setTalkingPoints] = React.useState("");

  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<any>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // Keep API fields & legacy guestName in sync with current selection
  React.useEffect(() => {
    if (primary) {
      setGuestName((g) => (g ? g : primary.name)); // fill if empty
    }
  }, [primary?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function currentPayload(): unknown {
    const base: any = {
      subject: subject.trim(),
      newsroomName: newsroomName.trim(),
      startAt: new Date(startAtISO).toISOString(),
      durationMins,
      // Primary mapping (compat)
      ...(primary
        ? { expertUserId: primary.id, expertName: primary.name }
        : {}),
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
      ...(appearanceType === "ONLINE"
        ? { meetingLink: meetingLink.trim() }
        : { venueAddress: venueAddress.trim() }),
    };
    return base;
  }

  function validateAndPreview(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const payload = currentPayload();
    const res = schema.safeParse(payload);
    if (!res.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of res.error.issues) {
        const path = issue.path.join(".") || "form";
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
      }
      setErrors(fieldErrors);
      setPreview(null);
      return;
    }
    setErrors({});
    // Show the whole selection in preview (even if API gets only primary)
    setPreview({ ...res.data, selectedExperts: selected });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const payload = currentPayload();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") || "form";
        if (!fieldErrors[path]) fieldErrors[path] = issue.message;
      }
      setErrors(fieldErrors);
      setPreview(null);
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        let message = "Failed to create booking";
        try {
          const body = await res.json();
          message =
            body?.error || (res.status === 400 ? "Validation error" : message);
        } catch {
          // ignore
        }
        setSubmitError(message);
        return;
      }
      // Success → redirect to list
      window.location.href = "/modules/booking?created=1";
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Clear opposite-side field + errors on appearance switch
  React.useEffect(() => {
    setErrors((prev) => {
      const copy = { ...prev };
      delete (copy as any).meetingLink;
      delete (copy as any).venueAddress;
      return copy;
    });
    if (appearanceType === "ONLINE") setVenueAddress("");
    if (appearanceType === "IN_PERSON") setMeetingLink("");
  }, [appearanceType]);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">New Booking</h1>
      <p className="text-sm text-gray-600">
        Pick experts from your Org or Public directory. Availability is
        slot-aware.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Subject */}
        <label className="block">
          <span className="text-sm font-medium">Subject *</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={validateAndPreview}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="e.g., TV Interview"
            maxLength={300}
            required
          />
          {errors.subject && (
            <UIAlert variant="error">{errors.subject}</UIAlert>
          )}
        </label>

        {/* Newsroom name */}
        <label className="block">
          <span className="text-sm font-medium">Newsroom name *</span>
          <input
            value={newsroomName}
            onChange={(e) => setNewsroomName(e.target.value)}
            onBlur={validateAndPreview}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="e.g., Global Newsroom"
            maxLength={200}
            required
          />
          {errors.newsroomName && (
            <UIAlert variant="error">{errors.newsroomName}</UIAlert>
          )}
        </label>

        {/* Start date/time & Duration */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Start date/time *</span>
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(startAtISO)}
              onChange={(e) => {
                const v = e.target.value;
                const asDate = new Date(v);
                setStartAtISO(asDate.toISOString());
              }}
              onBlur={validateAndPreview}
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
              onBlur={validateAndPreview}
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
            onBlur={validateAndPreview}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="e.g., Dr. Jane Doe"
            required
          />
          {errors.guestName && (
            <UIAlert variant="error">{errors.guestName}</UIAlert>
          )}
        </label>

        {/* Online vs In-person specific */}
        {appearanceType === "ONLINE" ? (
          <label className="block">
            <span className="text-sm font-medium">Meeting link *</span>
            <input
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              onBlur={validateAndPreview}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="https://…"
              required
            />
            {errors.meetingLink && (
              <UIAlert variant="error">{errors.meetingLink}</UIAlert>
            )}
          </label>
        ) : (
          <label className="block">
            <span className="text-sm font-medium">Venue / address *</span>
            <input
              value={venueAddress}
              onChange={(e) => setVenueAddress(e.target.value)}
              onBlur={validateAndPreview}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="123 Main St, City…"
              required
            />
            {errors.venueAddress && (
              <UIAlert variant="error">{errors.venueAddress}</UIAlert>
            )}
          </label>
        )}

        {/* Conditional (DB-flagged) fields */}
        {flags.showProgramName && (
          <label className="block">
            <span className="text-sm font-medium">Program name (optional)</span>
            <input
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              onBlur={validateAndPreview}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="e.g., Nightly News"
            />
            {errors.programName && (
              <UIAlert variant="error">{errors.programName}</UIAlert>
            )}
          </label>
        )}

        {flags.showHostName && (
          <label className="block">
            <span className="text-sm font-medium">Host name (optional)</span>
            <input
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              onBlur={validateAndPreview}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="e.g., John Smith"
            />
            {errors.hostName && (
              <UIAlert variant="error">{errors.hostName}</UIAlert>
            )}
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
              onBlur={validateAndPreview}
              className="mt-1 h-28 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="Bullet points for the segment…"
            />
            {errors.talkingPoints && (
              <UIAlert variant="error">{errors.talkingPoints}</UIAlert>
            )}
          </label>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <UIButton
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm"
          >
            {submitting ? "Submitting…" : "Submit"}
          </UIButton>
          <UIButton
            type="button"
            className="border px-4 py-2 text-sm"
            onClick={validateAndPreview}
          >
            Validate & Preview
          </UIButton>
          <UIButton
            type="button"
            className="border px-4 py-2 text-sm"
            onClick={() => {
              setSubject("TV Interview");
              setNewsroomName("");
              setStartAtISO(nextFullHourLocalISO());
              setDurationMins(30);
              setSelected([]);
              setGuestName("");
              setMeetingLink("");
              setVenueAddress("");
              setProgramName("");
              setHostName("");
              setTalkingPoints("");
              setErrors({});
              setPreview(null);
              setSubmitError(null);
            }}
          >
            Reset
          </UIButton>
        </div>

        {submitError && <UIAlert variant="error">{submitError}</UIAlert>}
      </form>

      {/* Preview */}
      <section className="rounded-xl border p-4">
        <h2 className="mb-2 text-lg font-semibold">Preview</h2>
        {preview ? (
          <pre className="overflow-auto rounded bg-gray-50 p-3 text-xs">
            {JSON.stringify(preview, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-gray-600">
            Fill the form and click “Validate & Preview” (or blur a field) to
            see validated data here.
          </p>
        )}
      </section>
    </main>
  );
}
