// src/lib/profile/guestSchema.ts
import { z } from "zod";

/**
 * G-Profile V2 (Guest) — constants, schema, and normalizers
 * ---------------------------------------------------------
 * Safe to import from:
 * - API routes (validate input before DB)
 * - Client components (derive option lists, preflight validation)
 */

// ----- Option lists (exported for UI reuse) -----
export const LANGUAGE_OPTIONS = [
  "Arabic",
  "English",
  "French",
  "Spanish",
  "German",
  "Italian",
  "Turkish",
  "Kurdish",
] as const;

export const REGION_OPTIONS = [
  "MENA",
  "Europe",
  "North America",
  "Sub-Saharan Africa",
  "South Asia",
  "East Asia",
] as const;

// Minimal ISO2 set for MVP (schema checks "2 letters" for forward-compat)
export const COUNTRY_OPTIONS = [
  { code: "EG", name: "Egypt" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "FR", name: "France" },
] as const;

export const TIMEZONE_OPTIONS = [
  "Africa/Cairo",
  "Europe/Paris",
  "Europe/London",
  "Asia/Dubai",
  "America/New_York",
] as const;

export const TOPIC_SUGGESTIONS = [
  "Politics",
  "Economy",
  "Tech",
  "Health",
  "Climate",
  "Culture",
  "Security",
] as const;

// ----- helpers -----
const toUrl = (s: string) => {
  const v = s.trim();
  if (!v) return v;
  try {
    const withProto = /^(https?:)?\/\//i.test(v) ? v : `https://${v}`;
    const u = new URL(withProto);
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return v; // let zod url() catch invalid values
  }
};
const toEmail = (s: string) => s.trim().toLowerCase();
const uniqCaseInsensitive = (arr: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    const k = v.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
};

// ----- schema -----
const zFormats = z.object({
  tv: z.boolean(),
  radio: z.boolean(),
  online: z.boolean(),
  phone: z.boolean(),
});

export const zGuestProfileV2 = z
  .object({
    displayName: z.string().trim().min(1, "Display name is required").max(120),

    localName: z.string().trim().max(120).default(""),

    pronouns: z.string().trim().max(40).default(""),

    languages: z
      .array(z.enum(LANGUAGE_OPTIONS))
      .nonempty("Pick at least one language")
      .transform(uniqCaseInsensitive),

    timezone: z.string().trim().max(64),

    city: z.string().trim().max(120).default(""),

    // Accept any 2-letter code for forward-compat; UI should use COUNTRY_OPTIONS
    countryCode: z
      .string()
      .trim()
      .length(2, "Use ISO-2 country code")
      .transform((s) => s.toUpperCase()),

    regions: z
      .array(z.enum(REGION_OPTIONS))
      .max(8)
      .transform(uniqCaseInsensitive),

    bio: z.string().trim().max(600).default(""),

    topics: z
      .array(z.string().trim().min(2).max(40))
      .max(20)
      .transform(uniqCaseInsensitive),

    formats: zFormats,

    links: z
      .array(
        z.preprocess(
          (v) => (typeof v === "string" ? toUrl(v) : v),
          z.string().url("Invalid URL").max(300)
        )
      )
      .max(10)
      .transform(uniqCaseInsensitive),

    additionalEmails: z
      .array(
        z.preprocess(
          (v) => (typeof v === "string" ? toEmail(v) : v),
          z.string().email("Invalid email").max(200)
        )
      )
      .max(5)
      .transform(uniqCaseInsensitive),

    phone: z.string().trim().max(50).default(""),

    feeNote: z.string().trim().max(300).default(""),

    visibility: z.enum(["PUBLIC", "PRIVATE"]),
    inviteable: z.boolean(),
  })
  .strict();

/** Inferred DTO type exported for convenience */
export type GuestProfileV2DTO = z.infer<typeof zGuestProfileV2>;

// ----- public helpers -----
export function validateGuestProfileV2(input: unknown): GuestProfileV2DTO {
  return zGuestProfileV2.parse(input);
}

export function safeParseGuestProfileV2(
  input: unknown
): { ok: true; data: GuestProfileV2DTO } | { ok: false; issues: string[] } {
  const r = zGuestProfileV2.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const issues = r.error.issues.map((i) => i.message);
  return { ok: false, issues };
}
