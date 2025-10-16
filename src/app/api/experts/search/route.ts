// src/app/api/experts/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { hasCan } from "../../../../lib/access/permissions";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/experts/search
 * Used by Directory → Global tab.
 * Query params:
 *   - q: optional free-text (name/email)
 *   - take: optional limit (default 30, max 50)
 *   - visibility: "public" (ignored if column doesn't exist)
 *
 * NOTE: We keep selection minimal and map to the GlobalExpert shape
 * the page expects (id, name, city, countryCode, tags, availability).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();

  // ── Permission guard: require orgId + signed-in staff with directory:view ──
  const orgId = (searchParams.get("orgId") || "").trim();
  if (!orgId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const email = (session?.user as any)?.email as string | undefined;
  let userId = (session?.user as any)?.id as string | undefined;

  if (!userId && email) {
    const u = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    userId = u?.id;
  }
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const allowed = await hasCan({
    userId,
    orgId,
    permission: "directory:view",
  });

  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "DIRECTORY_FORBIDDEN" },
      { status: 403 }
    );
  }
  // ───────────────────────────────────────────────────────────────────────────

  const take = Math.min(
    50,
    Math.max(1, parseInt(searchParams.get("take") || "30", 10) || 30)
  );

  try {
    // Basic where: search by displayName or personalEmail if provided
    // Enforce privacy: only list public guests, with optional search
    const where: any = {
      listedPublic: true,
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { personalEmail: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    // Pull minimal fields (safe across schema changes)
    const rows = await prisma.guestProfile.findMany({
      where,
      select: {
        id: true,
        displayName: true,
        // If your model has these, we can expand later:
        // city: true,
        // countryCode: true,
        // tags: true,
      },
      take,
    });

    // Normalize to GlobalExpert[]
    const items = rows.map((r: any) => ({
      id: r.id,
      name: r.displayName ?? null,
      city: null,
      countryCode: null,
      tags: [],
      availability: null,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load experts." },
      { status: 500 }
    );
  }
}
