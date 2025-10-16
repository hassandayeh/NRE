// src/app/api/profile/guest/me/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import prisma from "../../../../../lib/prisma";
import {
  validateGuestProfileV2,
  type GuestProfileV2DTO,
} from "../../../../../lib/profile/guestSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ok = { ok: true; profile: GuestProfileV2DTO };
type Err = { ok: false; message: string; code?: string };

function json(status: number, body: Ok | Err) {
  return NextResponse.json(body, { status });
}

function getUserId(session: unknown): string | null {
  const s = session as any;
  return s?.user?.id || s?.user?.userId || s?.user?.uid || null;
}

function fallbackDisplay(session: any): string {
  return (
    session?.user?.name ||
    (session?.user?.email ? String(session.user.email).split("@")[0] : "") ||
    "Guest"
  );
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !(session as any)?.user) {
    return json(401, { ok: false, message: "Unauthorized", code: "AUTH" });
  }
  const userId = getUserId(session);
  if (!userId) {
    return json(401, {
      ok: false,
      message: "No user id in session",
      code: "AUTH_NO_ID",
    });
  }

  // Try fetch existing record (guard for stale Prisma client types)
  const repo =
    (prisma as any).guestProfileV2 || (prisma as any).guestProfile || null;
  if (!repo) {
    return json(500, {
      ok: false,
      message: "Prisma client missing guest profile model",
      code: "PRISMA_CLIENT_OUTDATED",
    });
  }
  const row: any = await repo.findUnique({
    where: { userId },
  });

  // Build a candidate DTO from DB (if present) or sensible defaults
  const candidate: GuestProfileV2DTO = row
    ? {
        displayName: row?.displayName || fallbackDisplay(session),
        localName: row?.localName || "",
        pronouns: row?.pronouns || "",
        languages:
          row?.languages && row.languages.length
            ? (row.languages as GuestProfileV2DTO["languages"])
            : (["English"] as GuestProfileV2DTO["languages"]),
        timezone: row?.timezone || "Africa/Cairo",
        city: row?.city || "",
        countryCode: row?.countryCode || "EG",
        regions: (row?.regions || []) as GuestProfileV2DTO["regions"],
        bio: row?.bio || "",
        topics: row?.topics || [],
        formats: {
          tv: row?.formatsTv ?? true,
          radio: row?.formatsRadio ?? true,
          online: row?.formatsOnline ?? true,
          phone: row?.formatsPhone ?? true,
        },
        links: row?.links || [],
        additionalEmails: row?.additionalEmails || [],
        phone: row?.phone || "",
        feeNote: row?.feeNote || "",
        visibility: (row?.visibility as any) || "PRIVATE",
        inviteable: row?.inviteable ?? false,
      }
    : {
        // Defaults when no record exists yet (valid per schema)
        displayName: fallbackDisplay(session),
        localName: "",
        pronouns: "",
        languages: ["English"],
        timezone: "Africa/Cairo",
        city: "",
        countryCode: "EG",
        regions: [],
        bio: "",
        topics: [],
        formats: { tv: true, radio: true, online: true, phone: true },
        links: [],
        additionalEmails: [],
        phone: "",
        feeNote: "",
        visibility: "PRIVATE",
        inviteable: false,
      };

  // Normalize/validate to ensure consistent DTO back to the client
  try {
    const dto = validateGuestProfileV2(candidate);
    return json(200, { ok: true, profile: dto });
  } catch (e) {
    // If normalization unexpectedly fails, fall back to minimal safe payload
    const fallback: GuestProfileV2DTO = {
      displayName: fallbackDisplay(session),
      localName: "",
      pronouns: "",
      languages: ["English"],
      timezone: "Africa/Cairo",
      city: "",
      countryCode: "EG",
      regions: [],
      bio: "",
      topics: [],
      formats: { tv: true, radio: true, online: true, phone: true },
      links: [],
      additionalEmails: [],
      phone: "",
      feeNote: "",
      visibility: "PRIVATE",
      inviteable: false,
    };
    return json(200, { ok: true, profile: fallback });
  }
}
