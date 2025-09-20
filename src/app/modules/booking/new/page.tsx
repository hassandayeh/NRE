"use client";

import React from "react";
import { z } from "zod";

/**
 * /modules/booking/new
 * Zod-powered form for creating a booking with in-person & online appearances.
 * No backend yet: on submit we validate and render a confirmation preview.
 *
 * Accessibility:
 * - Labels connect to inputs via htmlFor / id
 * - aria-invalid on invalid fields
 * - role="alert" for error messages
 */

const AppearanceEnum = z.enum(["IN_PERSON", "ONLINE"]);
type AppearanceType = z.infer<typeof AppearanceEnum>;

const BaseSchema = z.object({
  subject: z.string().min(2, "Subject must be at least 2 characters"),
  expertName: z.string().min(2, "Expert name is required"),
  newsroomName: z.string().min(2, "Newsroom name is required"),
  startAt: z
    .string()
    .refine((v) => !!v, "Start date & time is required")
    .transform((v) => new Date(v))
    .refine((d) => !isNaN(d.getTime()), "Invalid date/time")
    .refine(
      (d) => d.getTime() > Date.now() - 60_000,
      "Start time must be in the future"
    ),
  durationMins: z
    .string()
    .refine((v) => /^\d+$/.test(v), "Duration must be a number")
    .transform((v) => parseInt(v, 10))
    .refine(
      (n) => n >= 5 && n <= 240,
      "Duration must be between 5 and 240 minutes"
    ),
});

const InPersonSchema = BaseSchema.extend({
  appearanceType: z.literal("IN_PERSON"),
  locationName: z.string().min(2, "Location name is required for in-person"),
  locationUrl: z
    .string()
    .url("Provide a valid URL (e.g., Google Maps link)")
    .optional()
    .or(z.literal("")),
});

const OnlineSchema = BaseSchema.extend({
  appearanceType: z.literal("ONLINE"),
  locationUrl: z
    .string()
    .url("Provide a valid meeting URL (e.g., https://)")
    .min(3),
  locationName: z.string().optional(),
});

const BookingSchema = z.discriminatedUnion("appearanceType", [
  InPersonSchema,
  OnlineSchema,
]);
type BookingInput = z.infer<typeof BookingSchema>;

export default function NewBookingPage() {
  const [appearanceType, setAppearanceType] =
    React.useState<AppearanceType>("ONLINE");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [result, setResult] = React.useState<BookingInput | null>(null);

  // Provide a default datetime-local value ~ tomorrow 10:00
  const defaultStart = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
      d.getDate()
    )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  function handleSubmit(form: HTMLFormElement) {
    const formData = new FormData(form);

    const shape: Record<string, unknown> = {
      appearanceType,
      subject: String(formData.get("subject") || ""),
      expertName: String(formData.get("expertName") || ""),
      newsroomName: String(formData.get("newsroomName") || ""),
      startAt: String(formData.get("startAt") || ""),
      durationMins: String(formData.get("durationMins") || ""),
      locationName: String(formData.get("locationName") || ""),
      locationUrl: String(formData.get("locationUrl") || ""),
    };

    const parsed = BookingSchema.safeParse(shape);
    if (!parsed.success) {
      // Map Zod issues into a flat record
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!e[key]) e[key] = issue.message;
      }
      setErrors(e);
      setResult(null);
      return;
    }

    setErrors({});
    setResult(parsed.data);
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">New booking</h1>
        <p className="mt-1 text-sm text-gray-600">
          Create an expert appearance (online or in-person).
        </p>
      </header>

      <form
        className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit(e.currentTarget);
        }}
        noValidate
      >
        {/* Appearance type */}
        <fieldset className="mb-6">
          <legend className="mb-2 text-sm font-medium text-gray-900">
            Appearance type
          </legend>
          <div className="flex gap-3">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="appearanceType"
                value="ONLINE"
                checked={appearanceType === "ONLINE"}
                onChange={() => setAppearanceType("ONLINE")}
                className="h-4 w-4"
                aria-describedby="appearance-help"
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
                className="h-4 w-4"
                aria-describedby="appearance-help"
              />
              <span>In-person</span>
            </label>
          </div>
          <p id="appearance-help" className="mt-1 text-xs text-gray-500">
            Choose the appearance mode to see the relevant fields.
          </p>
        </fieldset>

        {/* Subject */}
        <Field
          label="Subject"
          name="subject"
          placeholder="Segment title (e.g., Inflation outlook Q4)"
          error={errors.subject}
          required
        />

        {/* Names */}
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Expert name"
            name="expertName"
            placeholder="e.g., Dr. Lina Haddad"
            error={errors.expertName}
            required
          />
          <Field
            label="Newsroom name"
            name="newsroomName"
            placeholder="e.g., City Newsroom"
            error={errors.newsroomName}
            required
          />
        </div>

        {/* Timing */}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field
            label="Start date & time"
            name="startAt"
            type="datetime-local"
            defaultValue={defaultStart}
            error={errors.startAt}
            required
          />
          <Field
            label="Duration (mins)"
            name="durationMins"
            type="number"
            inputMode="numeric"
            placeholder="20"
            min={5}
            max={240}
            error={errors.durationMins}
            required
          />
        </div>

        {/* Conditional fields */}
        {appearanceType === "IN_PERSON" ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field
              label="Location name"
              name="locationName"
              placeholder="Studio A — Downtown HQ"
              error={errors.locationName}
              required
            />
            <Field
              label="Location URL (optional)"
              name="locationUrl"
              placeholder="Google Maps link"
              error={errors.locationUrl}
            />
          </div>
        ) : (
          <div className="mt-4">
            <Field
              label="Meeting link"
              name="locationUrl"
              placeholder="https://meet.example.com/xyz"
              error={errors.locationUrl}
              required
            />
          </div>
        )}

        {/* Form-level error (fallback) */}
        {"form" in errors && (
          <p role="alert" className="mt-4 text-sm text-rose-600">
            {errors.form}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="submit"
            className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Validate & preview
          </button>
          <a
            href="/modules/booking"
            className="rounded-2xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Cancel
          </a>
        </div>
      </form>

      {/* Preview card */}
      {result && (
        <section
          aria-label="Validated booking preview"
          className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-5"
        >
          <h2 className="text-base font-semibold text-green-800">
            Looks good ✓
          </h2>
          <p className="mt-1 text-sm text-green-900">
            This is a preview. Next step will be wiring it to persistence
            (Prisma/DB).
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-white p-4 text-xs leading-relaxed text-gray-800 ring-1 ring-green-200">
            {JSON.stringify(
              {
                ...result,
                startAt: result.startAt.toISOString(),
              },
              null,
              2
            )}
          </pre>
        </section>
      )}
    </main>
  );
}

/** Reusable text/number/date field */
function Field(props: {
  label: string;
  name: string;
  placeholder?: string;
  type?: string;
  inputMode?: React.InputHTMLAttributes<HTMLInputElement>["inputMode"];
  defaultValue?: string | number;
  min?: number;
  max?: number;
  required?: boolean;
  error?: string;
}) {
  const id = React.useId();
  const {
    label,
    name,
    placeholder,
    type = "text",
    inputMode,
    defaultValue,
    min,
    max,
    required,
    error,
  } = props;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-900">
        {label}{" "}
        {required && (
          <span className="text-rose-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue}
        placeholder={placeholder}
        min={min}
        max={max}
        className="mt-1 block w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1 text-xs text-rose-600"
        >
          {error}
        </p>
      )}
    </div>
  );
}
