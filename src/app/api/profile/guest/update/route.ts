// src/app/api/profile/guest/update/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { ZodError } from "zod";
import { authOptions } from "../../../../../lib/auth";
import prisma from "../../../../../lib/prisma";
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

function getUserId(session: unknown): string | null {
  const s = session as any;
  return s?.user?.id || s?.user?.userId || s?.user?.uid || null;
}
function getUserEmail(session: unknown): string | null {
  const s = session as any;
  return (s?.user?.email as string | undefined) || null;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !(session as any)?.user) {
    return json(401, { ok: false, message: "Unauthorized", code: "AUTH" });
  }

  // Resolve a stable key for this profile (no DB lookups, no autoprovision)
  const sessionId = getUserId(session);
  const sessionEmail = getUserEmail(session);
  if (!sessionId && !sessionEmail) {
    return json(401, {
      ok: false,
      message: "No user identity in session",
      code: "AUTH_NO_ID",
    });
  }
  const uid = (sessionId || sessionEmail!) as string;

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

  // Persist (upsert by userId = resolved uid)
  const data = {
    userId: uid,
    displayName: dto.displayName,
    localName: dto.localName || null,
    pronouns: dto.pronouns || null,
    timezone: dto.timezone,
    city: dto.city || null,
    countryCode: dto.countryCode,
    languages: dto.languages,
    regions: dto.regions,
    topics: dto.topics,
    formatsTv: dto.formats.tv,
    formatsRadio: dto.formats.radio,
    formatsOnline: dto.formats.online,
    formatsPhone: dto.formats.phone,
    bio: dto.bio || null,
    links: dto.links,
    additionalEmails: dto.additionalEmails,
    phone: dto.phone || null,
    feeNote: dto.feeNote || null,
    visibility: dto.visibility as any, // enum: PUBLIC | PRIVATE
    inviteable: dto.inviteable,
  };

  try {
    // Guard: some environments cache an older Prisma Client and don't expose guestProfileV2 yet.
    const repo = (prisma as any).guestProfileV2;
    if (!repo) {
      console.error(
        "PrismaClient is missing guestProfileV2. Run `npx prisma generate` and restart the TS server."
      );
      return json(500, {
        ok: false,
        message: "Prisma client outdated on server",
        code: "PRISMA_CLIENT_OUTDATED",
      });
    }

    await repo.upsert({
      where: { userId: uid },
      create: data,
      update: { ...data },
    });

    return json(200, { ok: true, profile: dto });
  } catch (e: any) {
    console.error("guest/update upsert failed:", e);
    const code = e?.code || e?.name || "DB";
    const message =
      code === "P2003"
        ? "Database error (foreign key). Is the user missing?"
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
