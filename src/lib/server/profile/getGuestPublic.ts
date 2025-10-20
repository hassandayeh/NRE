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
  if (!gp.listedPublic) {
    return { ok: false, status: 404, message: "Profile is not public" };
  }

  // ---- Image: be generous in what we accept from the DB schema ----
  // Try common/legacy keys and nested shapes, then mirror to all keys the renderer recognizes.
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

    // Privacy: NEVER expose these on public
    additionalEmails: [],
    contacts: [],
    listedPublic: true,
  };

  return { ok: true, profile: profile as GuestProfileV2DTO };
}
