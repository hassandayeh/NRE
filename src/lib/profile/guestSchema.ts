// src/lib/profile/guestSchema.ts
// G-Profile V2 (guest-owned fields only) — DTO + Zod validation
// Scope: S1–S6 + S7.F1–F3. Org overlays (assistant notes, disclosures, etc.) are excluded.
// All fields are optional to keep updates additive and non-breaking.

import { z } from "zod";

/* ──────────────────────────────────────────────────────────────────────────
 * Enums (mirror Prisma; keep strings stable)
 * ────────────────────────────────────────────────────────────────────────── */

export const HonorificLiterals = [
  "DR",
  "PROF",
  "ENG",
  "MR",
  "MS",
  "MRS",
  "AMB",
  "GEN",
  "OTHER",
] as const;
export type Honorific = (typeof HonorificLiterals)[number];

export const PronounsLiterals = [
  "SHE_HER",
  "HE_HIM",
  "THEY_THEM",
  "SELF_DESCRIBE",
  "PREFER_NOT",
] as const;
export type Pronouns = (typeof PronounsLiterals)[number];

export const CEFRLiterals = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CEFRLevel = (typeof CEFRLiterals)[number];

export const AppearanceTypeLiterals = ["IN_PERSON", "ONLINE", "PHONE"] as const;
export type AppearanceType = (typeof AppearanceTypeLiterals)[number];

export const TravelReadinessLiterals = ["LOCAL", "REGIONAL", "GLOBAL"] as const;
export type TravelReadiness = (typeof TravelReadinessLiterals)[number];

export const MediaTypeLiterals = [
  "TV",
  "RADIO",
  "ONLINE",
  "PRINT",
  "PODCAST",
] as const;
export type MediaType = (typeof MediaTypeLiterals)[number];

export const ContactVisibilityLiterals = [
  "PUBLIC",
  "INTERNAL",
  "PRIVATE",
] as const;
export type ContactVisibility = (typeof ContactVisibilityLiterals)[number];

export const ContactTypeLiterals = [
  "PHONE",
  "WHATSAPP",
  "TELEGRAM",
  "SIGNAL",
  "WECHAT",
  "IM",
  "OTHER",
] as const;
export type ContactType = (typeof ContactTypeLiterals)[number];

/* ──────────────────────────────────────────────────────────────────────────
 * Helpers (trim, empty→undefined, normalize)
 * ────────────────────────────────────────────────────────────────────────── */

function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length ? s : undefined;
}

function uniq<T>(arr: T[] | undefined | null): T[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Leaf schemas
 * ────────────────────────────────────────────────────────────────────────── */

// S3.F3 Languages (needs per-item level)
const LanguageItem = z
  .object({
    isoCode: z
      .string()
      .min(2)
      .max(16)
      .transform((s) => s.trim().toLowerCase()),
    level: z.enum(CEFRLiterals),
  })
  .strict();

// S4 Experience (repeating)
const ExperienceItem = z
  .object({
    orgName: z.string().trim().min(1).max(200),
    roleTitle: z.string().trim().max(200).transform(trimOrUndefined).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    isCurrent: z.boolean().optional(),
  })
  .strict();

// S4 Education (repeating)
const EducationItem = z
  .object({
    institution: z.string().trim().min(1).max(200),
    credential: z
      .string()
      .trim()
      .max(200)
      .transform(trimOrUndefined)
      .optional(),
    fieldOfStudy: z
      .string()
      .trim()
      .max(200)
      .transform(trimOrUndefined)
      .optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

// S5 Publications (repeating)
const PublicationItem = z
  .object({
    title: z.string().trim().min(1).max(300),
    outlet: z.string().trim().max(200).transform(trimOrUndefined).optional(),
    year: z
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 1)
      .optional(),
    url: z.string().url().transform(trimOrUndefined).optional(),
  })
  .strict();

// S5 Media Appearances (repeating)
const MediaItem = z
  .object({
    title: z.string().trim().min(1).max(300),
    outlet: z.string().trim().max(200).transform(trimOrUndefined).optional(),
    date: z.string().datetime().optional(),
    url: z.string().url().transform(trimOrUndefined).optional(),
    type: z.enum(MediaTypeLiterals).optional(),
  })
  .strict();

// S7 Additional Emails (guest-owned; per-item visibility)
const AdditionalEmailItem = z
  .object({
    email: z
      .string()
      .email()
      .transform((s) => s.trim().toLowerCase()),
    visibility: z.enum(ContactVisibilityLiterals).default("INTERNAL"),
    // Convenience for UI; DB uses verifiedAt. We just accept boolean and drop if false/undefined.
    verified: z.boolean().optional(),
  })
  .strict();

// S7 Contact Methods (Phones / IM)
const ContactMethodItem = z
  .object({
    type: z.enum(ContactTypeLiterals),
    value: z.string().trim().min(1).max(200),
    visibility: z.enum(ContactVisibilityLiterals).default("INTERNAL"),
  })
  .strict();

/* ──────────────────────────────────────────────────────────────────────────
 * Main DTO schema
 * ────────────────────────────────────────────────────────────────────────── */

export const guestProfileV2Schema = z
  .object({
    // Identity (S1)
    headshotUrl: z.string().url().optional(), // maps to avatarUrl in DB in some flows
    honorific: z.enum(HonorificLiterals).optional(),
    displayName: z.string().max(200).transform(trimOrUndefined).optional(),
    nativeName: z.string().max(200).transform(trimOrUndefined).optional(),
    pronouns: z.enum(PronounsLiterals).optional(),

    // Headline & Summary (S2)
    headline: z
      .string()
      .max(120, "Headline must be 120 characters or less.")
      .transform(trimOrUndefined)
      .optional(),
    shortBio: z
      .string()
      .max(280, "Short bio must be 280 characters or less.")
      .transform(trimOrUndefined)
      .optional(),
    fullBio: z.string().transform(trimOrUndefined).optional(),

    // Expertise & Coverage (S3)
    topicKeys: z
      .array(
        z
          .string()
          .transform((s) => s.trim())
          .pipe(z.string().min(1))
      )
      .transform((arr) => uniq(arr))
      .optional()
      .default([]),
    regionCodes: z
      .array(
        z
          .string()
          .transform((s) => s.trim().toUpperCase())
          .pipe(z.string().min(1))
      )
      .transform((arr) => uniq(arr))
      .optional()
      .default([]),
    languages: z
      .array(LanguageItem)
      .transform((arr) => uniq(arr))
      .optional()
      .default([]),

    // Affiliations & Experience (S4)
    experience: z
      .array(ExperienceItem)
      .transform((arr) => uniq(arr))
      .optional()
      .default([]),
    education: z
      .array(EducationItem)
      .transform((arr) => uniq(arr))
      .optional()
      .default([]),

    // Publications & Media (S5)
    publications: z
      .array(PublicationItem)
      .transform((arr) => uniq(arr))
      .optional()
      .default([]),
    media: z
      .array(MediaItem)
      .transform((arr) => uniq(arr))
      .optional()
      .default([]),

    // Logistics (S6)
    countryCode: z
      .string()
      .length(2, "Use a 2-letter ISO country code.")
      .transform((s) => s.trim().toUpperCase())
      .optional(),
    city: z.string().max(200).transform(trimOrUndefined).optional(),
    timezone: z.string().max(64).transform(trimOrUndefined).optional(),
    appearanceTypes: z
      .array(z.enum(AppearanceTypeLiterals))
      .transform((arr) => uniq(arr))
      .optional()
      .default([]),
    travelReadiness: z.enum(TravelReadinessLiterals).optional(),

    // Contacts (guest-owned subset of S7)
    additionalEmails: z
      .array(AdditionalEmailItem)
      .transform((arr) => uniq(arr))
      .optional()
      .default([]),
    contacts: z
      .array(ContactMethodItem)
      .transform((arr) => uniq(arr))
      .optional()
      .default([]),

    // Visibility flags carried from V1 (kept for safety; optional)
    listedPublic: z.boolean().optional(),
    inviteable: z.boolean().optional(),
  })
  .strict();

export type GuestProfileV2DTO = z.infer<typeof guestProfileV2Schema>;

/* ──────────────────────────────────────────────────────────────────────────
 * Public helpers
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * safeParseGuestProfileV2
 * - Returns Zod’s SafeParse result (no throw).
 * - Normalizes values (trim, case, dedupe) via .transform pipes.
 */
export function safeParseGuestProfileV2(
  input: unknown
): z.SafeParseReturnType<unknown, GuestProfileV2DTO> {
  return guestProfileV2Schema.safeParse(input);
}

/**
 * validateGuestProfileV2
 * - Throws ZodError on invalid input (for API routes).
 * - Returns a fully normalized DTO otherwise.
 */
export function validateGuestProfileV2(input: unknown): GuestProfileV2DTO {
  return guestProfileV2Schema.parse(input);
}
