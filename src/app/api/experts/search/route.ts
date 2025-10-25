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
 *
 * Query params:
 * - q: optional free-text (name/email)
 * - take: optional limit (default 30, max 50)
 * - orgId: required (derived by the v2 proxy if not provided by caller)
 *
 * Privacy:
 * - Only returns listedPublic guests.
 *
 * NOTE:
 * - This slice expands the SELECT to include richer card fields so that the
 *   Directory V2 proxy can render badges without extra round-trips:
 *   city, countryCode, avatarUrl, topicKeys (→ topics), regionCodes (→ regions),
 *   languages { isoCode, level }.
 *
 * Shape is additive. We keep legacy fields (name, tags, availability) intact.
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

  const allowed = await hasCan({ userId, orgId, permission: "directory:view" });
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

    // ⬇️ Expanded selection to feed Directory V2 badges without extra fetches
    const rows = await prisma.guestProfile.findMany({
      where,
      select: {
        id: true,
        displayName: true,
        // richer card fields
        city: true,
        countryCode: true,
        avatarUrl: true,
        topicKeys: true, // -> topics
        regionCodes: true, // -> regions
        languages: {
          select: {
            isoCode: true,
            level: true,
          },
        },
        // keep a couple of legacy-safe fields if someone depends on them
        // headline: true, // optional (not required by this slice)
      },
      take,
    });

    // Normalize to legacy + enriched shape (non-breaking)
    const items = rows.map((r) => ({
      id: r.id,
      // legacy field kept (used by older consumers)
      name: r.displayName ?? null,

      // enriched fields (Directory V2 proxy will map to UI SearchItem)
      displayName: r.displayName ?? null,
      city: r.city ?? null,
      countryCode: r.countryCode ?? null,
      avatarUrl: r.avatarUrl ?? null,
      topics: r.topicKeys ?? [],
      regions: r.regionCodes ?? [],
      languages: (r.languages || []).map((l) => ({
        isoCode: l.isoCode,
        level: l.level,
      })),

      // legacy placeholders preserved
      tags: [] as string[],
      availability: null as null,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to load experts." },
      { status: 500 }
    );
  }
}
