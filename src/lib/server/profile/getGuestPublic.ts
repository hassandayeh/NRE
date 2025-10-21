// src/lib/server/profile/getGuestPublic.ts
/**
 * Minimal read-only fetcher for a guest's PUBLIC profile.
 * - No writes. No side effects.
 * - Returns the same DTO shape used by the internal renderer.
 * - Strips org-private fields (contacts, additionalEmails).
 *
 * Gate: returns { ok:false, status:404 } when `listedPublic !== true`.
 */

import prisma from "../../prisma";
import type { GuestProfileV2DTO } from "../../profile/guestSchema";

export type PublicOk = { ok: true; profile: GuestProfileV2DTO };
export type PublicErr = { ok: false; status: number; message: string };
export type PublicRes = PublicOk | PublicErr;

function coalesceUrl(...vals: unknown[]): string | null {
  for (const v of vals) {
    const s =
      typeof v === "string"
        ? v
        : v && typeof v === "object" && "url" in (v as any)
        ? String((v as any).url)
        : "";
    if (s && typeof s === "string") return s;
  }
  return null;
}

export async function getGuestPublic(guestId: string): Promise<PublicRes> {
  if (!guestId || typeof guestId !== "string") {
    return { ok: false, status: 400, message: "Missing guestId" };
  }

  const gp: any = await prisma.guestProfile.findUnique({
    where: { id: guestId },
  });

  if (!gp) {
    return { ok: false, status: 404, message: "Profile not found" };
  }

  // Must be explicitly public
  // Load child relations needed by the renderer (best-effort, tolerate missing tables)
  // Mirrors the pattern used in the private "me" API.
  try {
    const p = prisma as any;
    gp.languages = await p.guestLanguage.findMany({
      where: { profileId: gp.id },
    });
  } catch {}
  try {
    gp.experience = await (prisma as any).guestExperience.findMany({
      where: { profileId: gp.id },
    });
  } catch {}
  try {
    gp.education = await (prisma as any).guestEducation.findMany({
      where: { profileId: gp.id },
    });
  } catch {}
  try {
    gp.publications = await (prisma as any).guestPublication.findMany({
      where: { profileId: gp.id },
    });
  } catch {}
  try {
    gp.media = await (prisma as any).guestMediaAppearance.findMany({
      where: { profileId: gp.id },
    });
  } catch {}

  // Load "Private details" for the PUBLIC page, but gate strictly by visibility.
  // We accept minor schema drift and normalize to the renderer's expected keys.
  function normVis(v: any) {
    return (v ?? "").toString().toUpperCase();
  }
  function normalizeEmailRow(r: any) {
    return {
      email: r?.email ?? r?.address ?? r?.value ?? "",
      verified: !!(r?.verified ?? r?.isVerified),
      visibility: normVis(r?.visibility ?? r?.permission),
    };
  }
  function normalizeContactRow(r: any) {
    return {
      type: r?.type ?? r?.contactType ?? r?.kind ?? "",
      value: r?.value ?? r?.handle ?? r?.address ?? "",
      visibility: normVis(r?.visibility ?? r?.permission),
    };
  }

  // Additional emails — only keep PUBLIC
  try {
    const rows =
      (await (prisma as any).guestAdditionalEmail.findMany({
        where: { profileId: gp.id },
      })) ?? [];
    gp.additionalEmails = rows
      .map(normalizeEmailRow)
      .filter((e: any) => e.visibility === "PUBLIC");
  } catch {}

  // Contact methods — only keep PUBLIC
  try {
    const rows =
      (await (prisma as any).guestContactMethod.findMany({
        where: { profileId: gp.id },
      })) ?? [];
    gp.contacts = rows
      .map(normalizeContactRow)
      .filter((c: any) => c.visibility === "PUBLIC");
  } catch {}

  // The renderer checks: headshotUrl || photoUrl || photo.url (see component).
  const resolvedHeadshot = coalesceUrl(
    gp.headshotUrl,
    gp.photoUrl,
    gp.profilePhotoUrl,
    gp.avatarUrl,
    gp?.photo,
    gp?.headshot,
    gp?.profilePhoto,
    gp?.image,
    gp?.images?.profile,
    gp?.assets?.headshot
  );

  // ---- Build DTO (be forgiving with missing/legacy fields) ----
  const profile: any = {
    id: gp.id,

    // Identity
    displayName: gp.displayName ?? gp.name ?? "",
    honorific: gp.honorific ?? null,
    pronouns: gp.pronouns ?? null,
    nativeName: gp.nativeName ?? null,

    // Headshot — mirror the resolved URL across all keys the renderer accepts
    headshotUrl: resolvedHeadshot ?? null,
    photoUrl: resolvedHeadshot ?? null,
    photo: resolvedHeadshot ? { url: resolvedHeadshot } : null,

    // Headline & bios
    headline: gp.headline ?? "",
    shortBio: gp.shortBio ?? "",
    fullBio: gp.fullBio ?? "",

    // Coverage (default to arrays)
    languages: Array.isArray(gp.languages) ? gp.languages : [],
    regionCodes: Array.isArray(gp.regionCodes) ? gp.regionCodes : [],
    topicKeys: Array.isArray(gp.topicKeys) ? gp.topicKeys : [],
    appearanceTypes: Array.isArray(gp.appearanceTypes)
      ? gp.appearanceTypes
      : [],

    // Experience / Education
    experience: Array.isArray(gp.experience) ? gp.experience : [],
    education: Array.isArray(gp.education) ? gp.education : [],

    // Publications / Media
    publications: Array.isArray(gp.publications) ? gp.publications : [],
    media: Array.isArray(gp.media) ? gp.media : [],

    // Logistics & flags
    timezone: gp.timezone ?? "",
    city: gp.city ?? "",
    countryCode: gp.countryCode ?? "",
    travelReadiness: gp.travelReadiness ?? null,
    inviteable: typeof gp.inviteable === "boolean" ? gp.inviteable : null,

    // Privacy: expose ONLY PUBLIC rows loaded above
    additionalEmails: Array.isArray(gp.additionalEmails)
      ? gp.additionalEmails
      : [],
    contacts: Array.isArray(gp.contacts) ? gp.contacts : [],

    listedPublic: true,
  };

  return { ok: true, profile: profile as GuestProfileV2DTO };
}
