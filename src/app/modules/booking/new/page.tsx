"use client";

/**
 * Booking Create Form (DB-flag aware) — now submits to /api/bookings
 * - Reads feature flags from <body data-*="..."> (set by Root Layout)
 * - Validates with Zod (discriminated union) before submit
 * - POSTs to /api/bookings and redirects to /modules/booking on success
 */

import React from "react";
import { z } from "zod";
import { useRouter } from "next/navigation";

/** ---------- Flag reading ---------- */
function readBooleanDataset(key: string, fallback = true): boolean {
  if (typeof document === "undefined") return fallback;
  const raw = document.body.dataset[key as keyof DOMStringMap];
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

/** ---------- Dynamic schema builder ---------- */
function buildSchema(flags: Flags) {
  const common = z.object({
    guestName: z
      .string({ required_error: "Guest name is required" })
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
    appearanceType: z.literal("ONLINE"),
    meetingLink: z
      .string({ required_error: "Meeting link is required" })
      .url("Please enter a valid URL"),
  });

  const InPerson = z.object({
    appearanceType: z.literal("IN_PERSON"),
    venueAddress: z
      .string({ required_error: "Venue/address is required" })
      .min(5, "Please enter a longer address"),
  });

  return z.discriminatedUnion("appearanceType", [
    common.merge(Online),
    common.merge(InPerson),
  ]);
}

type FormShape = z.infer<ReturnType<typeof buildSchema>>;

/** ---------- Page ---------- */
export default function NewBookingPage() {
  const router = useRouter();

  // Flags from server (<body data-*>)
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

  // Local form state
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
      appearanceType,
      guestName,
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

    return appearanceType === "ONLINE"
      ? { ...base, meetingLink }
      : { ...base, venueAddress };
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

    // Validate first
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
        const body = await res.json().catch(() => ({}));
        const message =
          body?.error ||
          (res.status === 400
            ? "Validation error"
            : "Failed to create booking");
        setSubmitError(message);
        return;
      }

      // Success → redirect to list
      router.push("/modules/booking");
    } catch (err) {
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
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">New Booking</h1>
        <p className="text-sm text-gray-600">
          Fields are shown/hidden based on organization feature toggles (from
          the database).
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Appearance */}
        <div className="space-y-2">
          <label className="block text-sm font-medium">Appearance Type</label>
          <div className="flex gap-3">
            <button
              type="button"
              className={`rounded-lg border px-3 py-1 text-sm ${
                appearanceType === "ONLINE"
                  ? "bg-gray-900 text-white"
                  : "bg-white"
              }`}
              onClick={() => setAppearanceType("ONLINE")}
              aria-pressed={appearanceType === "ONLINE"}
            >
              Online
            </button>
            <button
              type="button"
              className={`rounded-lg border px-3 py-1 text-sm ${
                appearanceType === "IN_PERSON"
                  ? "bg-gray-900 text-white"
                  : "bg-white"
              }`}
              onClick={() => setAppearanceType("IN_PERSON")}
              aria-pressed={appearanceType === "IN_PERSON"}
            >
              In-person
            </button>
          </div>
        </div>

        {/* Guest name */}
        <div className="space-y-1">
          <label htmlFor="guestName" className="block text-sm font-medium">
            Guest name <span className="text-red-600">*</span>
          </label>
          <input
            id="guestName"
            type="text"
            className="w-full rounded-md border px-3 py-2"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            onBlur={validateAndPreview}
          />
          {errors.guestName && (
            <p className="text-sm text-red-600">{errors.guestName}</p>
          )}
        </div>

        {/* Online vs In-person specific */}
        {appearanceType === "ONLINE" ? (
          <div className="space-y-1">
            <label htmlFor="meetingLink" className="block text-sm font-medium">
              Meeting link <span className="text-red-600">*</span>
            </label>
            <input
              id="meetingLink"
              type="url"
              placeholder="https://…"
              className="w-full rounded-md border px-3 py-2"
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              onBlur={validateAndPreview}
            />
            {errors.meetingLink && (
              <p className="text-sm text-red-600">{errors.meetingLink}</p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <label htmlFor="venueAddress" className="block text-sm font-medium">
              Venue / address <span className="text-red-600">*</span>
            </label>
            <input
              id="venueAddress"
              type="text"
              className="w-full rounded-md border px-3 py-2"
              value={venueAddress}
              onChange={(e) => setVenueAddress(e.target.value)}
              onBlur={validateAndPreview}
            />
            {errors.venueAddress && (
              <p className="text-sm text-red-600">{errors.venueAddress}</p>
            )}
          </div>
        )}

        {/* Conditional (DB-flagged) fields */}
        {flags.showProgramName && (
          <div className="space-y-1">
            <label htmlFor="programName" className="block text-sm font-medium">
              Program name (optional)
            </label>
            <input
              id="programName"
              type="text"
              className="w-full rounded-md border px-3 py-2"
              value={programName}
              onChange={(e) => setProgramName(e.target.value)}
              onBlur={validateAndPreview}
            />
            {errors.programName && (
              <p className="text-sm text-red-600">{errors.programName}</p>
            )}
          </div>
        )}

        {flags.showHostName && (
          <div className="space-y-1">
            <label htmlFor="hostName" className="block text-sm font-medium">
              Host name (optional)
            </label>
            <input
              id="hostName"
              type="text"
              className="w-full rounded-md border px-3 py-2"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              onBlur={validateAndPreview}
            />
            {errors.hostName && (
              <p className="text-sm text-red-600">{errors.hostName}</p>
            )}
          </div>
        )}

        {flags.showTalkingPoints && (
          <div className="space-y-1">
            <label
              htmlFor="talkingPoints"
              className="block text-sm font-medium"
            >
              Talking points (optional)
            </label>
            <textarea
              id="talkingPoints"
              rows={5}
              className="w-full rounded-md border px-3 py-2"
              value={talkingPoints}
              onChange={(e) => setTalkingPoints(e.target.value)}
              onBlur={validateAndPreview}
            />
            {errors.talkingPoints && (
              <p className="text-sm text-red-600">{errors.talkingPoints}</p>
            )}
          </div>
        )}

        {/* Submit / Validate */}
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
