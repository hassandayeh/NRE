"use client";

/**
 * Booking Create Form — Real fields + backward-compatible payload
 * - Adds Subject, Newsroom name, Start date/time, Duration (mins)
 * - Client-side validation (Zod)
 * - Sends legacy API fields as well so /api/bookings accepts it today
 * - On success, redirects to /modules/booking?created=1 (for banner)
 */

import React from "react";
import { z } from "zod";
import { useRouter } from "next/navigation";

/** ---------- Helpers: read server-driven feature flags ---------- */
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

/** ---------- Appearance types ---------- */
const AppearanceType = z.enum(["ONLINE", "IN_PERSON"]);
type TAppearanceType = z.infer<typeof AppearanceType>;

/** ---------- Datetime helpers ---------- */
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

/** ---------- Dynamic schema builder (respects flags) ---------- */
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

type FormShape = z.infer<ReturnType<typeof buildSchema>>;

/** ---------- Page ---------- */
export default function NewBookingPage() {
  const router = useRouter();

  // Flags from server (RootLayout writes them to <body data-*>)
  const [flags, setFlags] = React.useState<Flags>({
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

  // Local form state — new fields
  const [subject, setSubject] = React.useState("TV Interview");
  const [newsroomName, setNewsroomName] = React.useState("");
  const [startAtISO, setStartAtISO] = React.useState(nextFullHourLocalISO());
  const [durationMins, setDurationMins] = React.useState<number>(30);

  // Legacy fields (kept to satisfy today’s API)
  const [appearanceType, setAppearanceType] =
    React.useState<TAppearanceType>("ONLINE");
  const [guestName, setGuestName] = React.useState("");
  const [meetingLink, setMeetingLink] = React.useState("");
  const [venueAddress, setVenueAddress] = React.useState("");
  const [programName, setProgramName] = React.useState("");
  const [hostName, setHostName] = React.useState("");
  const [talkingPoints, setTalkingPoints] = React.useState("");

  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<FormShape | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  function currentPayload(): unknown {
    const base = {
      // New DB-aligned fields
      subject: subject.trim(),
      newsroomName: newsroomName.trim(),
      startAt: new Date(startAtISO).toISOString(),
      durationMins,

      // Legacy (for today’s API)
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
    setPreview(res.data);
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
        // Try to surface granular server error if present
        let message = "Failed to create booking";
        try {
          const body = await res.json();
          message =
            body?.error || (res.status === 400 ? "Validation error" : message);
        } catch {
          // ignore JSON parse error
        }
        setSubmitError(message);
        return;
      }

      // Success → redirect to list with success banner
      router.push("/modules/booking?created=1");
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
      delete copy.meetingLink;
      delete copy.venueAddress;
      return copy;
    });
    if (appearanceType === "ONLINE") setVenueAddress("");
    if (appearanceType === "IN_PERSON") setMeetingLink("");
  }, [appearanceType]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">New Booking</h1>
      <p className="text-sm text-gray-600">
        Real fields added. Flags still control optional fields. Validation runs
        on blur / preview / submit.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Subject */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Subject <span className="text-red-600">*</span>
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={validateAndPreview}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="e.g., TV Interview"
            maxLength={300}
            required
          />
          {errors.subject && (
            <p className="text-sm text-red-600">{errors.subject}</p>
          )}
        </div>

        {/* Newsroom name */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Newsroom name <span className="text-red-600">*</span>
          </label>
          <input
            type="text"
            value={newsroomName}
            onChange={(e) => setNewsroomName(e.target.value)}
            onBlur={validateAndPreview}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="e.g., Global Newsroom"
            maxLength={200}
            required
          />
          {errors.newsroomName && (
            <p className="text-sm text-red-600">{errors.newsroomName}</p>
          )}
        </div>

        {/* Start date/time & Duration */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Start date/time <span className="text-red-600">*</span>
            </label>
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(startAtISO)}
              onChange={(e) => {
                const v = e.target.value; // "YYYY-MM-DDTHH:mm"
                const asDate = new Date(v);
                setStartAtISO(asDate.toISOString());
              }}
              onBlur={validateAndPreview}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              required
            />
            {errors.startAt && (
              <p className="text-sm text-red-600">{errors.startAt}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Duration (minutes) <span className="text-red-600">*</span>
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={5}
              max={600}
              step={5}
              value={Number.isFinite(durationMins) ? durationMins : 30}
              onChange={(e) => setDurationMins(parseInt(e.target.value, 10))}
              onBlur={validateAndPreview}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              required
            />
            {errors.durationMins && (
              <p className="text-sm text-red-600">{errors.durationMins}</p>
            )}
          </div>
        </div>

        {/* Appearance */}
        <fieldset>
          <legend className="mb-1 block text-sm font-medium">
            Appearance Type
          </legend>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAppearanceType("ONLINE")}
              aria-pressed={appearanceType === "ONLINE"}
              className={`rounded-lg border px-3 py-2 text-sm ${
                appearanceType === "ONLINE" ? "bg-gray-900 text-white" : ""
              }`}
            >
              Online
            </button>
            <button
              type="button"
              onClick={() => setAppearanceType("IN_PERSON")}
              aria-pressed={appearanceType === "IN_PERSON"}
              className={`rounded-lg border px-3 py-2 text-sm ${
                appearanceType === "IN_PERSON" ? "bg-gray-900 text-white" : ""
              }`}
            >
              In-person
            </button>
          </div>
        </fieldset>

        {/* Guest name */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Guest name <span className="text-red-600">*</span>
          </label>
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            onBlur={validateAndPreview}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="e.g., Dr. Jane Doe"
            required
          />
          {errors.guestName && (
            <p className="text-sm text-red-600">{errors.guestName}</p>
          )}
        </div>

        {/* Online vs In-person specific */}
        {appearanceType === "ONLINE" ? (
          <div>
            <label className="mb-1 block text-sm font-medium">
              Meeting link <span className="text-red-600">*</span>
            </label>
            <input
              type="url"
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              onBlur={validateAndPreview}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="https://…"
              required
            />
            {errors.meetingLink && (
              <p className="text-sm text-red-600">{errors.meetingLink}</p>
            )}
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-sm font-medium">
              Venue / address <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={venueAddress}
              onChange={(e) => setVenueAddress(e.target.value)}
              onBlur={validateAndPreview}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="123 Main St, City…"
              required
            />
            {errors.venueAddress && (
              <p className="text-sm text-red-600">{errors.venueAddress}</p>
            )}
          </div>
        )}

        {/* Conditional (DB-flagged) fields */}
        {flags.showProgramName && (
          <div>
            <label className="mb-1 block text-sm font-medium">
              Program name (optional)
            </label>
            <input
              type="text"
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              onBlur={validateAndPreview}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="e.g., Nightly News"
            />
            {errors.programName && (
              <p className="text-sm text-red-600">{errors.programName}</p>
            )}
          </div>
        )}

        {flags.showHostName && (
          <div>
            <label className="mb-1 block text-sm font-medium">
              Host name (optional)
            </label>
            <input
              type="text"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              onBlur={validateAndPreview}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="e.g., John Smith"
            />
            {errors.hostName && (
              <p className="text-sm text-red-600">{errors.hostName}</p>
            )}
          </div>
        )}

        {flags.showTalkingPoints && (
          <div>
            <label className="mb-1 block text-sm font-medium">
              Talking points (optional)
            </label>
            <textarea
              value={talkingPoints}
              onChange={(e) => setTalkingPoints(e.target.value)}
              onBlur={validateAndPreview}
              className="h-28 w-full rounded-lg border px-3 py-2 text-sm"
              placeholder="Bullet points for the segment…"
            />
            {errors.talkingPoints && (
              <p className="text-sm text-red-600">{errors.talkingPoints}</p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>

          <button
            type="button"
            className="rounded-lg border px-4 py-2 text-sm"
            onClick={validateAndPreview}
          >
            Validate & Preview
          </button>

          <button
            type="button"
            className="rounded-lg border px-4 py-2 text-sm"
            onClick={() => {
              setSubject("TV Interview");
              setNewsroomName("");
              setStartAtISO(nextFullHourLocalISO());
              setDurationMins(30);
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
          </button>
        </div>

        {submitError && (
          <p className="text-sm text-red-600" role="alert">
            {submitError}
          </p>
        )}
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

      {/* Flags debug (non-interactive) */}
      <details className="rounded-xl border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Flags</summary>
        <div className="mt-2 grid grid-cols-1 gap-1 md:grid-cols-3">
          <div>
            Program name: <strong>{String(flags.showProgramName)}</strong>
          </div>
          <div>
            Host name: <strong>{String(flags.showHostName)}</strong>
          </div>
          <div>
            Talking points: <strong>{String(flags.showTalkingPoints)}</strong>
          </div>
        </div>
      </details>
    </main>
  );
}
