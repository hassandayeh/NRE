// src/app/api/profile/guest/update/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ZodError } from "zod";
import { authOptions } from "../../../../../lib/auth";
import prisma from "../../../../../lib/prisma";
import { del as blobDel } from "@vercel/blob";
import {
  validateGuestProfileV2,
  type GuestProfileV2DTO,
} from "../../../../../lib/profile/guestSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ok = { ok: true; profile: GuestProfileV2DTO };
type Err = { ok: false; message: string; code?: string; issues?: string[] };

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
function getUserEmail(session: unknown): string | null {
  const u = getUser(session);
  return (u?.email as string | undefined) || null;
}
function getGuestProfileId(session: unknown): string | null {
  const u = getUser(session);
  return u?.guestProfileId || null;
}

function keyFromBlobUrl(u?: string | null): string | null {
  if (!u) return null;
  try {
    const key = decodeURIComponent(new URL(u).pathname).replace(/^\/+/, "");
    // Safety: only allow deleting keys we own
    return key.startsWith("avatars/") ? key : null;
  } catch {
    return null;
  }
}

function toIso(d: unknown): string | undefined {
  try {
    if (!d) return undefined;
    if (typeof d === "string") return new Date(d).toISOString();
    if (d instanceof Date) return d.toISOString();
  } catch {}
  return undefined;
}

function parseYear(input: unknown): number | null {
  // Accepts 2024 or 2024-06 (UI can send YYYY or YYYY-MM)
  if (typeof input === "number" && Number.isFinite(input)) {
    const y = Math.trunc(input);
    return y >= 1900 && y <= 3000 ? y : null;
  }
  if (typeof input === "string") {
    const m = input.trim().match(/^(\d{4})(?:-(\d{2}))?$/);
    if (m) {
      const y = parseInt(m[1], 10);
      return y >= 1900 && y <= 3000 ? y : null;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !(session as any)?.user) {
    return json(401, { ok: false, message: "Unauthorized", code: "AUTH" });
  }

  // Resolve identity for upsert (no autoprovision of users here)
  const gpId = getGuestProfileId(session);
  const email = getUserEmail(session);
  if (!gpId && !email) {
    return json(401, {
      ok: false,
      message: "No profile id or email in session",
      code: "AUTH_NO_ID",
    });
  }

  // Parse body
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json(400, {
      ok: false,
      message: "Invalid JSON body",
      code: "BAD_JSON",
    });
  }

  // Validate/normalize
  let dto: GuestProfileV2DTO;
  try {
    dto = validateGuestProfileV2(payload);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => i.message);
      return json(400, {
        ok: false,
        message: "Invalid profile payload",
        code: "VALIDATION",
        issues,
      });
    }
    return json(500, { ok: false, message: "Unexpected error", code: "ERROR" });
  }

  // Guard: ensure model exists on generated client
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

  // Fetch existing profile (by id preferred, otherwise by personalEmail)
  let existing: any = null;
  try {
    if (gpId) {
      existing = await repo.findUnique({
        where: { id: gpId },
        select: { id: true, avatarUrl: true, personalEmail: true },
      });
    }
    if (!existing && email) {
      existing = await repo.findFirst({
        where: { personalEmail: email },
        select: { id: true, avatarUrl: true, personalEmail: true },
      });
    }
  } catch {
    // ignore; we treat as not found
  }

  // Prepare scalar/array columns (guest-owned, all exist in schema)
  const scalars = {
    displayName: dto.displayName ?? null,
    honorific: dto.honorific ?? null,
    nativeName: dto.nativeName ?? null,
    pronouns: dto.pronouns ?? null,

    headline: dto.headline ?? null,
    shortBio: dto.shortBio ?? null,
    fullBio: dto.fullBio ?? null,

    topicKeys: dto.topicKeys ?? [],
    regionCodes: dto.regionCodes ?? [],

    countryCode: dto.countryCode ?? null,
    city: dto.city ?? null,
    timezone: dto.timezone ?? null,
    appearanceTypes: dto.appearanceTypes ?? [],
    travelReadiness: dto.travelReadiness ?? null,

    avatarUrl: dto.headshotUrl ?? null, // store under avatarUrl
    listedPublic:
      typeof dto.listedPublic === "boolean" ? dto.listedPublic : undefined,
    inviteable:
      typeof dto.inviteable === "boolean" ? dto.inviteable : undefined,
  } as const;

  // Child rows prepared from DTO
  const langRows =
    dto.languages?.map((l) => ({
      isoCode: l.isoCode,
      level: l.level,
    })) ?? [];

  const expRows =
    dto.experience?.map((r) => ({
      orgName: r.orgName,
      roleTitle: r.roleTitle ?? null,
      from: r.from ? new Date(r.from) : null,
      to: r.to ? new Date(r.to) : null,
      isCurrent: !!r.isCurrent,
    })) ?? [];

  const eduRows =
    dto.education?.map((r) => ({
      institution: r.institution,
      credential: r.credential ?? null,
      fieldOfStudy: r.fieldOfStudy ?? null,
      from: r.from ? new Date(r.from) : null,
      to: r.to ? new Date(r.to) : null,
    })) ?? [];

  const pubRows =
    dto.publications?.map((p: any) => ({
      title: p?.title,
      // UI uses "outlet" already — keep; if future UI sends "publisher", ignore for now.
      outlet: (p?.outlet ?? null) || null,
      // Accept either DTO.year (number) or UI.date (YYYY / YYYY-MM string)
      year: parseYear((p?.year as any) ?? (p?.date as any)),
      url: p?.url ?? null,
    })) ?? [];

  const mediaRows =
    dto.media?.map((m: any) => ({
      title: m?.title,
      // UI sends "network"; DB/model uses "outlet" — accept either
      outlet: (m?.outlet ?? m?.network ?? null) || null,
      date: m?.date ? new Date(m.date) : null,
      url: m?.url ?? null,
      type: typeof m?.type === "string" ? m.type : undefined,
    })) ?? [];

  const addEmailRows =
    dto.additionalEmails?.map((e) => ({
      email: e.email,
      visibility: e.visibility as any,
      verifiedAt: e.verified ? new Date() : null, // simple rule: incoming true stamps now
    })) ?? [];

  const contactRows =
    dto.contacts?.map((c) => ({
      type: c.type as any,
      value: c.value,
      visibility: c.visibility as any,
    })) ?? [];

  // Best-effort cleanup after update
  const prevAvatarUrl = existing?.avatarUrl || null;
  const nextAvatarUrl = dto.headshotUrl ?? null;

  // Helper to build a non-interactive batch for atomic replace
  const buildOps = (profileId: string) => {
    const p = prisma as any; // use 'any' to avoid TS mismatches if client isn't regenerated yet
    const ops: any[] = [
      p.guestProfile.update({
        where: { id: profileId },
        data: { ...scalars },
      }),
      p.guestLanguage.deleteMany({ where: { profileId } }),
      p.guestExperience.deleteMany({ where: { profileId } }),
      p.guestEducation.deleteMany({ where: { profileId } }),
      p.guestPublication.deleteMany({ where: { profileId } }),
      p.guestMediaAppearance.deleteMany({ where: { profileId } }),
      p.guestAdditionalEmail.deleteMany({ where: { profileId } }),
      p.guestContactMethod.deleteMany({ where: { profileId } }),
    ];

    if (langRows.length) {
      ops.push(
        p.guestLanguage.createMany({
          data: langRows.map((r: any) => ({ ...r, profileId })),
        })
      );
    }
    if (expRows.length) {
      ops.push(
        p.guestExperience.createMany({
          data: expRows.map((r: any) => ({ ...r, profileId })),
        })
      );
    }
    if (eduRows.length) {
      ops.push(
        p.guestEducation.createMany({
          data: eduRows.map((r: any) => ({ ...r, profileId })),
        })
      );
    }
    if (pubRows.length) {
      ops.push(
        p.guestPublication.createMany({
          data: pubRows.map((r: any) => ({ ...r, profileId })),
        })
      );
    }
    if (mediaRows.length) {
      ops.push(
        p.guestMediaAppearance.createMany({
          data: mediaRows.map((r: any) => ({ ...r, profileId })),
        })
      );
    }
    if (addEmailRows.length) {
      ops.push(
        p.guestAdditionalEmail.createMany({
          data: addEmailRows.map((r: any) => ({ ...r, profileId })),
        })
      );
    }
    if (contactRows.length) {
      ops.push(
        p.guestContactMethod.createMany({
          data: contactRows.map((r: any) => ({ ...r, profileId })),
        })
      );
    }

    return ops;
  };

  try {
    // 1) Resolve or create the profile record
    let profileId = existing?.id as string | undefined;

    if (!profileId && email) {
      const byEmail = await (prisma as any).guestProfile.findFirst({
        where: { personalEmail: email },
        select: { id: true },
      });
      if (byEmail?.id) profileId = byEmail.id as string;
    }

    if (!profileId) {
      if (!email)
        throw new Error("Cannot create profile without a personal email");
      const created = await (prisma as any).guestProfile.create({
        data: { personalEmail: email, ...scalars },
        select: { id: true },
      });
      profileId = created.id as string;
    }

    // 2) Atomic replace of parent + children (no interactive tx)
    await prisma.$transaction(buildOps(profileId));

    // 3) Best-effort blob cleanup if the avatar changed or was removed
    try {
      if (prevAvatarUrl && prevAvatarUrl !== nextAvatarUrl) {
        const key = keyFromBlobUrl(prevAvatarUrl);
        const token = process.env.BLOB_READ_WRITE_TOKEN;
        if (key && token) {
          await blobDel(key, { token });
        }
      }
    } catch (delErr) {
      console.warn("[blob] old avatar cleanup failed:", delErr);
    }

    // Return the normalized DTO we saved
    return json(200, { ok: true, profile: dto });
  } catch (e: any) {
    // If create hit a unique constraint (likely personalEmail), retry once as update-by-email
    if (e?.code === "P2002" && email) {
      try {
        const found = await (prisma as any).guestProfile.findFirst({
          where: { personalEmail: email },
          select: { id: true },
        });
        if (found?.id) {
          const profileId = found.id as string;
          await prisma.$transaction(buildOps(profileId));
          return json(200, { ok: true, profile: dto });
        }
      } catch (retryErr) {
        console.error("guest/update retry failed:", retryErr);
      }
    }

    console.error("guest/update upsert failed:", e);
    const code = e?.code || e?.name || "DB";
    const message =
      code === "P2003"
        ? "Database error (foreign key). Is the profile missing?"
        : code === "P2002"
        ? "Unique constraint failed"
        : e?.message || "Failed to save profile";
    return json(500, {
      ok: false,
      message,
      code,
      issues: e?.meta ? [JSON.stringify(e.meta)] : undefined,
    });
  }
}
