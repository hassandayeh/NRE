// src/app/api/guest/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonErr = { ok: false; error: string; code?: string };
function jsonErr(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code } as JsonErr, { status });
}

function asBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
  }
  return undefined;
}

/**
 * GET /api/guest/profile
 * Returns the current guest's editable profile slice.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return jsonErr(401, "Unauthorized");
  const guestProfileId = (session as any).guestProfileId as string | undefined;
  if (!guestProfileId)
    return jsonErr(403, "Forbidden (staff cannot use this endpoint)");

  try {
    const gp = await prisma.guestProfile.findUnique({
      where: { id: guestProfileId },
      select: {
        id: true,
        personalEmail: true,
        displayName: true,
        avatarUrl: true,
        inviteable: true,
        // Added in the previous migration step:
        listedPublic: true,
        updatedAt: true,
      },
    });

    if (!gp) return jsonErr(404, "Guest profile not found");

    return NextResponse.json({
      ok: true,
      profile: {
        id: gp.id,
        email: gp.personalEmail,
        displayName: gp.displayName ?? "",
        avatarUrl: gp.avatarUrl ?? null,
        inviteable: !!gp.inviteable,
        listedPublic: !!gp.listedPublic,
        updatedAt: gp.updatedAt,
      },
    });
  } catch (e: any) {
    return jsonErr(
      500,
      e?.message || "Failed to load guest profile",
      "READ_FAILED"
    );
  }
}

/**
 * POST /api/guest/profile
 * Body: { displayName?: string, listedPublic?: boolean }
 * Updates only provided fields; both are optional.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return jsonErr(401, "Unauthorized");
  const guestProfileId = (session as any).guestProfileId as string | undefined;
  if (!guestProfileId)
    return jsonErr(403, "Forbidden (staff cannot use this endpoint)");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonErr(400, "Invalid JSON body");
  }

  const updates: Record<string, any> = {};

  // displayName: optional string (trimmed, max 200)
  if (body.displayName !== undefined) {
    const raw = String(body.displayName ?? "").trim();
    if (raw.length === 0) {
      // Allow empty to clear the display name, if you prefer keep/require non-empty remove this branch.
      updates.displayName = null;
    } else if (raw.length > 200) {
      return jsonErr(400, "Display name is too long (max 200)");
    } else {
      updates.displayName = raw;
    }
  }

  // listedPublic: optional boolean
  if (body.listedPublic !== undefined) {
    const b = asBool(body.listedPublic);
    if (b === undefined) return jsonErr(400, "listedPublic must be boolean");
    updates.listedPublic = b;
  }

  if (Object.keys(updates).length === 0) {
    return jsonErr(400, "No valid fields to update");
  }

  try {
    const gp = await prisma.guestProfile.update({
      where: { id: guestProfileId },
      data: { ...updates },
      select: {
        id: true,
        personalEmail: true,
        displayName: true,
        avatarUrl: true,
        inviteable: true,
        listedPublic: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      profile: {
        id: gp.id,
        email: gp.personalEmail,
        displayName: gp.displayName ?? "",
        avatarUrl: gp.avatarUrl ?? null,
        inviteable: !!gp.inviteable,
        listedPublic: !!gp.listedPublic,
        updatedAt: gp.updatedAt,
      },
    });
  } catch (e: any) {
    return jsonErr(
      500,
      e?.message || "Failed to update guest profile",
      "WRITE_FAILED"
    );
  }
}
