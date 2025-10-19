// src/lib/profile/view-format.ts

/**
 * Shared, UI-agnostic format helpers for Guest Profile rendering.
 * Phase A: Extracted so the new <GuestProfileRenderer /> can import ONLY from here.
 *
 * Notes:
 * - Pure functions; no React imports here.
 * - Keep outputs predictable and locale-stable unless a locale is passed in.
 */

export type MonthYearMode = "auto" | "month-year" | "year";

/**
 * formatMonthYear
 * Accepts "YYYY", "YYYY-MM", or full ISO "YYYY-MM-DD".
 * Returns "MMM YYYY" (e.g., "Oct 2025") when month is present, otherwise "YYYY".
 */
export function formatMonthYear(
  input?: string | null,
  opts?: { locale?: string; fallback?: string }
): string {
  if (!input) return opts?.fallback ?? "—";

  const s = String(input).trim();

  // Year-only ("2025")
  const yearOnly = /^(\d{4})$/;
  // Year-month ("2025-10")
  const yearMonth = /^(\d{4})-(\d{2})$/;
  // Full ISO date
  const fullIso = /^(\d{4})-(\d{2})-(\d{2})/;

  try {
    if (yearOnly.test(s)) return s;

    if (yearMonth.test(s) || fullIso.test(s)) {
      // Normalize to a date so Intl can format Month name safely.
      // Use day=01 if missing.
      const normalized = yearMonth.test(s) ? `${s}-01` : s;
      const d = new Date(normalized);
      if (Number.isNaN(d.getTime())) return opts?.fallback ?? "—";

      return new Intl.DateTimeFormat(opts?.locale ?? "en", {
        month: "short",
        year: "numeric",
      }).format(d);
    }
  } catch {
    // no-op, fall through
  }
  return opts?.fallback ?? "—";
}

/**
 * formatDateRange
 * Formats a from/to pair into a concise human string.
 * - Detects granularity automatically (YYYY vs YYYY-MM vs ISO date).
 * - Uses "Present" for open ranges (when `to` is falsy).
 */
export function formatDateRange(
  from?: string | null,
  to?: string | null,
  opts?: {
    locale?: string;
    presentLabel?: string; // default "Present"
    mode?: MonthYearMode; // default "auto"
    dash?: "—" | "-" | "to"; // default "—"
  }
): string {
  const present = (opts?.presentLabel ?? "Present").trim();
  const dash = opts?.dash === "to" ? " to " : ` ${opts?.dash ?? "—"} `;

  const hasMonth = (s?: string | null) =>
    !!s && /^\d{4}-\d{2}(-\d{2})?$/.test(s);
  const onlyYear = (s?: string | null) => !!s && /^\d{4}$/.test(s);

  const mode: MonthYearMode =
    opts?.mode && opts.mode !== "auto"
      ? opts.mode
      : hasMonth(from) || hasMonth(to)
      ? "month-year"
      : "year";

  const part = (s?: string | null) =>
    mode === "year" || onlyYear(s)
      ? s
        ? s.slice(0, 4)
        : "—"
      : formatMonthYear(s, { locale: opts?.locale });

  const left = part(from);
  const right = to ? part(to) : present;

  if (!from && !to) return "—";
  if (from && !to) return `${left}${dash}${right}`;
  if (!from && to) return `${part(undefined)}${dash}${right}`;
  return `${left}${dash}${right}`;
}

/**
 * initialsFromName
 * "Jane Doe" -> "JD", "madonna" -> "M", "Jean-Luc Picard" -> "JP"
 */
export function initialsFromName(name?: string | null, max = 2): string {
  const n = (name ?? "").trim();
  if (!n) return "•";
  const tokens = n.replace(/\s+/g, " ").split(/[\s]+/).filter(Boolean);

  if (tokens.length === 1) {
    const word = tokens[0];
    // Grab first two visible letters for single-word names if max >= 2
    const letters = Array.from(word).filter((c) => /\p{L}/u.test(c));
    return letters.slice(0, Math.max(1, max)).join("").toUpperCase();
  }

  const first = Array.from(tokens[0]).find((c) => /\p{L}/u.test(c)) ?? "";
  const last =
    Array.from(tokens[tokens.length - 1]).find((c) => /\p{L}/u.test(c)) ?? "";
  return (first + last).toUpperCase().slice(0, Math.max(1, max));
}

/**
 * stripCacheBust
 * Removes common cache-buster query params (v, ver, t, ts, cb, _, cacheBuster).
 * Preserves other query params; does not alter hash.
 */
export function stripCacheBust(url?: string | null): string {
  if (!url) return "";
  const s = url.trim();
  // Allow relative paths by providing a dummy base; we'll remove origin again.
  const isAbsolute = /^[a-z]+:\/\//i.test(s);
  const base = "https://x.invalid";
  let u: URL;
  try {
    u = new URL(s, isAbsolute ? undefined : base);
  } catch {
    return s;
  }

  const keys = new Set(["v", "ver", "t", "ts", "cb", "_", "cacheBuster"]);
  for (const k of Array.from(u.searchParams.keys())) {
    if (keys.has(k)) u.searchParams.delete(k);
  }

  const cleaned = u.toString();
  if (isAbsolute) return cleaned;
  // Remove the dummy origin for relative inputs
  return cleaned.replace(/^https:\/\/x\.invalid/, "");
}

/**
 * safeLink
 * Normalizes a user-supplied URL to a safe, clickable href.
 * - Adds https:// if protocol is missing (for domain-like inputs).
 * - Only allows http/https protocols.
 * - Returns null when invalid/unsafe.
 */
export function safeLink(input?: string | null): string | null {
  if (!input) return null;
  let s = input.trim();

  // If no scheme and looks like a domain, add https://
  const looksLikeDomain = /^(?:www\.)?[a-z0-9\-]+(\.[a-z0-9\-]+)+([\/?#].*)?$/i;
  if (!/^[a-z]+:\/\//i.test(s) && looksLikeDomain.test(s)) {
    s = "https://" + s.replace(/^\/+/, "");
  }

  try {
    const u = new URL(s);
    const protocol = u.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * asLangChip
 * Lightweight helper for displaying language + level in a consistent short label.
 * UI can decide chip styling; this function just returns text + ARIA-friendly label.
 *
 * Example:
 *   const chip = asLangChip("en", "C2")
 *   // chip.text => "EN · C2"
 *   // chip.aria => "Language EN, level C2"
 */
export function asLangChip(
  code?: string | null,
  level?: string | null,
  opts?: { uppercase?: boolean; separator?: string }
): { text: string; aria: string; code: string; level: string } {
  const sep = opts?.separator ?? " · ";
  const c = (code ?? "").trim();
  const l = (level ?? "").trim();
  const safeCode = opts?.uppercase ?? true ? c.toUpperCase() : c || "—";
  const safeLevel = l || "—";
  return {
    text: `${safeCode}${sep}${safeLevel}`,
    aria: `Language ${safeCode}, level ${safeLevel}`,
    code: safeCode,
    level: safeLevel,
  };
}
