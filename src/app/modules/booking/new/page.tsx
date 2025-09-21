"use client";

/**
 * Booking Create Form — standardized UI (Button + Alert)
 * - Keeps existing schema & logic
 * - Redirects to /modules/booking?created=1 on success (Toast handled there)
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

/** ---------- UI components (namespace import + runtime fallback) ---------- */
// Works whether the module exports `default` or a named export.
import * as ButtonModule from "../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

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
  const [durationMins, setDurationMins] = React.useState(30);

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
  const [preview, setPreview] = React.useState<unknown | null>(null);
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

      // Success → redirect to list with success toast/banner
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
      delete (copy as any).meetingLink;
      delete (copy as any).venueAddress;
      return copy;
    });
    if (appearanceType === "ONLINE") setVenueAddress("");
    if (appearanceType === "IN_PERSON") setMeetingLink("");
  }, [appearanceType]);

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6">
      <h1 className="text-2xl font-semibold">New Booking</h1>
      <p className="text-sm text-gray-600">
        Real fields added. Flags still control optional fields. Validation runs
        on blur / preview / submit.
      </p>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {/* Subject */}
        <label className="block text-sm font-medium">
          Subject *
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={validateAndPreview}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="e.g., TV Interview"
            maxLength={300}
            required
          />
        </label>
        {errors.subject && <UIAlert variant="error">{errors.subject}</UIAlert>}

        {/* Newsroom name */}
        <label className="block text-sm font-medium">
          Newsroom name *
          <input
            value={newsroomName}
            onChange={(e) => setNewsroomName(e.target.value)}
            onBlur={validateAndPreview}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="e.g., Global Newsroom"
            maxLength={200}
            required
          />
        </label>
        {errors.newsroomName && (
          <UIAlert variant="error">{errors.newsroomName}</UIAlert>
        )}

        {/* Start date/time & Duration */}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium">
            Start date/time *
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(startAtISO)}
              onChange={(e) => {
                const v = e.target.value; // "YYYY-MM-DDTHH:mm"
                const asDate = new Date(v);
                setStartAtISO(asDate.toISOString());
              }}
              onBlur={validateAndPreview}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="block text-sm font-medium">
            Duration (minutes) *
            <input
              type="number"
              min={5}
              max={600}
              step={5}
              value={durationMins}
              onChange={(e) => setDurationMins(parseInt(e.target.value, 10))}
              onBlur={validateAndPreview}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              required
            />
          </label>
        </div>
        {errors.startAt && <UIAlert variant="error">{errors.startAt}</UIAlert>}
        {errors.durationMins && (
          <UIAlert variant="error">{errors.durationMins}</UIAlert>
        )}

        {/* Appearance */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Appearance Type</legend>
          <div className="flex gap-2">
            <UIButton
              type="button"
              aria-pressed={appearanceType === "ONLINE"}
              className={`rounded-lg border px-3 py-2 text-sm ${
                appearanceType === "ONLINE" ? "bg-gray-900 text-white" : ""
              }`}
              onClick={() => setAppearanceType("ONLINE")}
            >
              Online
            </UIButton>
            <UIButton
              type="button"
              aria-pressed={appearanceType === "IN_PERSON"}
              className={`rounded-lg border px-3 py-2 text-sm ${
                appearanceType === "IN_PERSON" ? "bg-gray-900 text-white" : ""
              }`}
              onClick={() => setAppearanceType("IN_PERSON")}
            >
              In-person
            </UIButton>
          </div>
        </fieldset>

        {/* Guest name */}
        <label className="block text-sm font-medium">
          Guest name *
          <input
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            onBlur={validateAndPreview}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="e.g., Dr. Jane Doe"
            required
          />
        </label>
        {errors.guestName && (
          <UIAlert variant="error">{errors.guestName}</UIAlert>
        )}

        {/* Online vs In-person specific */}
        {appearanceType === "ONLINE" ? (
          <>
            <label className="block text-sm font-medium">
              Meeting link *
              <input
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                onBlur={validateAndPreview}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="https://…"
                required
              />
            </label>
            {errors.meetingLink && (
              <UIAlert variant="error">{errors.meetingLink}</UIAlert>
            )}
          </>
        ) : (
          <>
            <label className="block text-sm font-medium">
              Venue / address *
              <input
                value={venueAddress}
                onChange={(e) => setVenueAddress(e.target.value)}
                onBlur={validateAndPreview}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="123 Main St, City…"
                required
              />
            </label>
            {errors.venueAddress && (
              <UIAlert variant="error">{errors.venueAddress}</UIAlert>
            )}
          </>
        )}

        {/* Conditional (DB-flagged) fields */}
        {flags.showProgramName && (
          <>
            <label className="block text-sm font-medium">
              Program name (optional)
              <input
                value={programName}
                onChange={(e) => setProgramName(e.target.value)}
                onBlur={validateAndPreview}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="e.g., Nightly News"
              />
            </label>
            {errors.programName && (
              <UIAlert variant="error">{errors.programName}</UIAlert>
            )}
          </>
        )}

        {flags.showHostName && (
          <>
            <label className="block text-sm font-medium">
              Host name (optional)
              <input
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                onBlur={validateAndPreview}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="e.g., John Smith"
              />
            </label>
            {errors.hostName && (
              <UIAlert variant="error">{errors.hostName}</UIAlert>
            )}
          </>
        )}

        {flags.showTalkingPoints && (
          <>
            <label className="block text-sm font-medium">
              Talking points (optional)
              <textarea
                value={talkingPoints}
                onChange={(e) => setTalkingPoints(e.target.value)}
                onBlur={validateAndPreview}
                className="mt-1 h-28 w-full rounded-lg border px-3 py-2 text-sm"
                placeholder="Bullet points for the segment…"
              />
            </label>
            {errors.talkingPoints && (
              <UIAlert variant="error">{errors.talkingPoints}</UIAlert>
            )}
          </>
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
            Validate &amp; Preview
          </UIButton>

          <UIButton
            type="button"
            className="border px-4 py-2 text-sm"
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
            Fill the form and click “Validate &amp; Preview” (or blur a field)
            to see validated data here.
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
