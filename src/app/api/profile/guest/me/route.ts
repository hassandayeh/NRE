// src/app/api/profile/guest/me/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import prisma from "../../../../../lib/prisma";
import {
  validateGuestProfileV2,
  type GuestProfileV2DTO,
  AppearanceTypeLiterals,
} from "../../../../../lib/profile/guestSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ok = { ok: true; profile: GuestProfileV2DTO };
type Err = { ok: false; message: string; code?: string };

function json(status: number, body: Ok | Err) {
  return NextResponse.json(body, { status });
}

function getUser(session: unknown): any {
  return (session as any)?.user || null;
}
function getUserId(session: unknown): string | null {
  const u = getUser(session);
  return u?.id || u?.userId || u?.uid || null;
}
function getGuestProfileId(session: unknown): string | null {
  const u = getUser(session);
  return u?.guestProfileId || null;
}
function fallbackDisplay(session: any): string {
  return (
    session?.user?.name ||
    (session?.user?.email ? String(session.user.email).split("@")[0] : "") ||
    "Guest"
  );
}

function toIso(d: unknown): string | undefined {
  try {
    if (!d) return undefined;
    if (typeof d === "string") return new Date(d).toISOString();
    if (d instanceof Date) return d.toISOString();
  } catch {}
  return undefined;
}

function mapRowToDTO(row: any, session: any): GuestProfileV2DTO {
  const langs =
    Array.isArray(row?.languages) && row.languages.length
      ? row.languages.map((l: any) => ({
          isoCode: String(l?.isoCode || "").toLowerCase(),
          level: (l?.level as any) || "B2",
        }))
      : [];

  const experience =
    Array.isArray(row?.experience) && row.experience.length
      ? row.experience.map((r: any) => ({
          orgName: String(r?.orgName || "").trim(),
          roleTitle: r?.roleTitle ? String(r.roleTitle).trim() : undefined,
          from: toIso(r?.from),
          to: toIso(r?.to),
          isCurrent: !!r?.isCurrent,
        }))
      : [];

  const education =
    Array.isArray(row?.education) && row.education.length
      ? row.education.map((r: any) => ({
          institution: String(r?.institution || "").trim(),
          credential: r?.credential ? String(r.credential).trim() : undefined,
          fieldOfStudy: r?.fieldOfStudy
            ? String(r.fieldOfStudy).trim()
            : undefined,
          from: toIso(r?.from),
          to: toIso(r?.to),
        }))
      : [];

  const publications =
    Array.isArray(row?.publications) && row.publications.length
      ? row.publications.map((p: any) => ({
          title: String(p?.title || "").trim(),
          outlet: p?.outlet ? String(p.outlet).trim() : undefined,
          year: typeof p?.year === "number" ? p.year : undefined,
          url: p?.url ? String(p.url) : undefined,
        }))
      : [];

  const media =
    Array.isArray(row?.media) && row.media.length
      ? row.media.map((m: any) => ({
          title: String(m?.title || "").trim(),
          outlet: m?.outlet ? String(m.outlet).trim() : undefined,
          date: toIso(m?.date),
          url: m?.url ? String(m.url) : undefined,
          type: m?.type,
        }))
      : [];

  const additionalEmails =
    Array.isArray(row?.additionalEmails) && row.additionalEmails.length
      ? row.additionalEmails.map((e: any) => ({
          email: String(e?.email || "")
            .toLowerCase()
            .trim(),
          visibility: e?.visibility || "INTERNAL",
          verified: !!e?.verifiedAt,
        }))
      : [];

  const contacts =
    Array.isArray(row?.contacts) && row.contacts.length
      ? row.contacts.map((c: any) => ({
          type: c?.type || "PHONE",
          value: String(c?.value || "").trim(),
          visibility: c?.visibility || "INTERNAL",
        }))
      : [];

  // Prefer new column avatarUrl; fallback to older headshotUrl if present.
  const headshotUrl: string | undefined =
    row?.avatarUrl || row?.headshotUrl || undefined;

  // Default to [] but ensure literals are valid if DB had old booleans.
  const appearanceTypes: GuestProfileV2DTO["appearanceTypes"] = Array.isArray(
    row?.appearanceTypes
  )
    ? row.appearanceTypes.filter((v: any) =>
        (AppearanceTypeLiterals as readonly string[]).includes(v)
      )
    : [];

  return {
    // Identity
    displayName: row?.displayName || fallbackDisplay(session),
    nativeName: row?.nativeName || undefined,
    pronouns: row?.pronouns || undefined,

    // Headline & Summary
    headline: row?.headline || undefined,
    shortBio: row?.shortBio || undefined,
    fullBio: row?.fullBio || undefined,

    // Expertise & Coverage
    topicKeys: Array.isArray(row?.topicKeys) ? row.topicKeys : [],
    regionCodes: Array.isArray(row?.regionCodes) ? row.regionCodes : [],
    languages: langs,

    // Experience & Credentials
    experience,
    education,

    // Publications & Media
    publications,
    media,

    // Logistics
    countryCode: row?.countryCode || undefined,
    city: row?.city || undefined,
    timezone: row?.timezone || undefined,
    appearanceTypes,
    travelReadiness: row?.travelReadiness || undefined,

    // Contacts (guest-owned)
    additionalEmails,
    contacts,

    // Flags / visuals
    listedPublic:
      typeof row?.listedPublic === "boolean" ? row.listedPublic : undefined,
    inviteable:
      typeof row?.inviteable === "boolean" ? row.inviteable : undefined,
    headshotUrl,
  };
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !(session as any)?.user) {
    return json(401, { ok: false, message: "Unauthorized", code: "AUTH" });
  }

  const user = getUser(session);
  const userId = getUserId(session);
  const gpId = getGuestProfileId(session);

  const repo =
    (prisma as any).guestProfile ||
    (prisma as any).guestProfileV2 ||
    (prisma as any).GuestProfile ||
    null;
  if (!repo) {
    return json(500, {
      ok: false,
      message: "Prisma client missing guest profile model",
      code: "PRISMA_CLIENT_OUTDATED",
    });
  }

  // Try a few safe lookups. Any can fail if the column doesn't exist in a given env.
  let row: any = null;
  try {
    if (gpId) {
      try {
        row = await repo.findUnique({
          where: { id: gpId },
          include: {
            languages: true,
            experience: true,
            education: true,
            publications: true,
            media: true,
            additionalEmails: true,
            contacts: true,
          },
        });
      } catch {
        row = await repo.findUnique({ where: { id: gpId } });
      }
    }
    if (!row && user?.email) {
      try {
        row = await repo.findFirst({
          where: { personalEmail: user.email },
          include: {
            languages: true,
            experience: true,
            education: true,
            publications: true,
            media: true,
            additionalEmails: true,
            contacts: true,
          },
        });
      } catch {}
    }
    if (!row && userId) {
      // Legacy schemas sometimes had userId on the profile
      try {
        row = await repo.findUnique({
          where: { userId },
          include: {
            languages: true,
            experience: true,
            education: true,
            publications: true,
            media: true,
            additionalEmails: true,
            contacts: true,
          },
        });
      } catch {
        try {
          row = await repo.findFirst({ where: { userId } });
        } catch {}
      }
    }
  } catch {
    // ignore; we'll fall back
  }

  const candidate: GuestProfileV2DTO = row
    ? mapRowToDTO(row, session)
    : {
        // Reasonable defaults; all optional in DTO but prefilled for UX
        displayName: fallbackDisplay(session),
        nativeName: "",
        pronouns: undefined,
        headline: "",
        shortBio: "",
        fullBio: "",
        topicKeys: [],
        regionCodes: [],
        languages: [{ isoCode: "en", level: "B2" }],
        experience: [],
        education: [],
        publications: [],
        media: [],
        countryCode: "EG",
        city: "",
        timezone: "Africa/Cairo",
        appearanceTypes: [],
        travelReadiness: undefined,
        additionalEmails: [],
        contacts: [],
        listedPublic: false,
        inviteable: false,
        headshotUrl: "",
      };

  try {
    const dto = validateGuestProfileV2(candidate);
    return json(200, { ok: true, profile: dto });
  } catch (err) {
    // If validation fails for some unexpected legacy combo, return a minimal safe baseline
    const fallback: GuestProfileV2DTO = {
      displayName: fallbackDisplay(session),
      topicKeys: [],
      regionCodes: [],
      languages: [{ isoCode: "en", level: "B2" }],
      experience: [],
      education: [],
      publications: [],
      media: [],
      appearanceTypes: [],
      additionalEmails: [],
      contacts: [],
      countryCode: "EG",
      city: "",
      timezone: "Africa/Cairo",
      listedPublic: false,
      inviteable: false,
      headshotUrl: "",
    };
    return json(200, { ok: true, profile: fallback });
  }
}
