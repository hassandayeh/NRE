// src/lib/date.ts

/**
 * Shared date/time formatting utilities.
 * Keep all display formatting here so pages/components stay consistent.
 */

export type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type DateTimeFormatOptions = {
  /**
   * Browser/Node locale hint. Usually leave undefined to respect user/OS.
   */
  locale?: string | string[];
  /**
   * See Intl.DateTimeFormat options.
   * Defaults align with our UI: medium date + short time.
   */
  dateStyle?: "full" | "long" | "medium" | "short";
  timeStyle?: "full" | "long" | "medium" | "short";
};

/**
 * Format a value as a local date-time string for display.
 * Default example: "Sep 21, 2025, 03:00 PM"
 */
export function formatDateTime(
  value: DateInput,
  opts: DateTimeFormatOptions = {}
): string {
  const d = toDate(value);
  if (!d) return "—";
  const { locale, dateStyle = "medium", timeStyle = "short" } = opts;
  return new Intl.DateTimeFormat(locale, { dateStyle, timeStyle }).format(d);
}

/**
 * Format a value as a local date-only string.
 * Example (medium): "Sep 21, 2025"
 */
export function formatDate(
  value: DateInput,
  opts: Omit<DateTimeFormatOptions, "timeStyle"> = {}
): string {
  const d = toDate(value);
  if (!d) return "—";
  const { locale, dateStyle = "medium" } = opts;
  return new Intl.DateTimeFormat(locale, { dateStyle }).format(d);
}

/**
 * Format a value as a local time-only string.
 * Example (short): "03:00 PM"
 */
export function formatTime(
  value: DateInput,
  opts: Omit<DateTimeFormatOptions, "dateStyle"> = {}
): string {
  const d = toDate(value);
  if (!d) return "—";
  const { locale, timeStyle = "short" } = opts;
  return new Intl.DateTimeFormat(locale, { timeStyle }).format(d);
}
