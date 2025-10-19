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

export async function getGuestPublic(guestId: string): Promise<PublicRes> {
  if (!guestId || typeof guestId !== "string") {
    return { ok: false, status: 400, message: "Missing guestId" };
  }

  // NOTE: Model name is assumed to be `guestProfile` (common in this codebase).
  // If your Prisma model differs, adjust the call below.
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

  // Shape into the DTO used by the renderer. Be forgiving with optional fields.
  const profile: any = {
    id: gp.id,

    // Identity
    displayName: gp.displayName ?? gp.name ?? "",
    honorific: gp.honorific ?? null,
    pronouns: gp.pronouns ?? null,
    nativeName: gp.nativeName ?? null,

    // Headshot (renderer can handle undefined/null)
    headshotUrl: gp.headshotUrl ?? gp.photoUrl ?? gp?.photo?.url ?? null,

    // Headline & bios
    headline: gp.headline ?? "",
    shortBio: gp.shortBio ?? "",
    fullBio: gp.fullBio ?? "",

    // Coverage
    languages: gp.languages ?? [],
    regionCodes: gp.regionCodes ?? [],
    topicKeys: gp.topicKeys ?? [],
    appearanceTypes: gp.appearanceTypes ?? [],

    // Experience / Education
    experience: gp.experience ?? [],
    education: gp.education ?? [],

    // Publications / Media
    publications: gp.publications ?? [],
    media: gp.media ?? [],

    // Logistics & flags
    timezone: gp.timezone ?? "",
    city: gp.city ?? "",
    countryCode: gp.countryCode ?? "",
    travelReadiness: gp.travelReadiness ?? null,
    inviteable: gp.inviteable ?? null,

    // Privacy: NEVER expose these on public
    additionalEmails: [],
    contacts: [],
    listedPublic: true,
  };

  return { ok: true, profile: profile as GuestProfileV2DTO };
}
