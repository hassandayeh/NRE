// src/app/api/experts/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../lib/viewer";
import { hasCan, getEffectiveRole } from "../../../../lib/access/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

/**
 * GET /api/experts/search
 * Query:
 *  - orgId (required)
 *  - q (optional)
 *  - languages, tags, online, inPerson, country, city
 *  - slots=4,5 (optional)
 *  - inviteableOnly=true|false (default true)
 *  - take (default 50), skip (default 0)
 */
export async function GET(req: NextRequest) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn || !viewer.userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("orgId") ?? "";
    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: "orgId is required" },
        { status: 400 }
      );
    }

    const canView = await hasCan({
      userId: viewer.userId,
      orgId,
      permission: "booking:view",
    });
    if (!canView) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const q = (searchParams.get("q") || "").trim();
    const langs = splitCSV(searchParams.get("languages"));
    const tags = splitCSV(searchParams.get("tags"));
    const online = parseBool(searchParams.get("online"));
    const inPerson = parseBool(searchParams.get("inPerson"));
    const country = (searchParams.get("country") || "").trim() || null;
    const city = (searchParams.get("city") || "").trim() || null;
    const slots = toSlotList(searchParams.get("slots"));
    const inviteableOnly =
      (searchParams.get("inviteableOnly") || "true").toLowerCase() === "true";
    const take = clampInt(
      parseInt(searchParams.get("take") || "50", 10),
      1,
      200
    );
    const skip = Math.max(parseInt(searchParams.get("skip") || "0", 10), 0);

    const where: any = { orgId };
    if (slots) where.slot = { in: slots };

    const userWhere: any = {};
    const orSearch: any[] = [];
    if (q) {
      orSearch.push(
        { displayName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } }
      );
    }
    if (orSearch.length) userWhere.OR = orSearch;

    if (langs.length) userWhere.languages = { hasSome: langs };
    if (tags.length) userWhere.tags = { hasSome: tags };
    if (online !== null) userWhere.supportsOnline = online;
    if (inPerson !== null) userWhere.supportsInPerson = inPerson;
    if (country) userWhere.countryCode = country.toUpperCase();
    if (city) userWhere.city = { contains: city, mode: "insensitive" };
    if (Object.keys(userWhere).length) where.user = userWhere;

    const rows = await prisma.userRole.findMany({
      where,
      take,
      skip,
      orderBy: { assignedAt: "desc" },
      select: {
        userId: true,
        slot: true,
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            languages: true,
            tags: true,
            supportsOnline: true,
            supportsInPerson: true,
            city: true,
            countryCode: true,
          },
        },
      },
    });

    const people = await Promise.all(
      rows.map(async (r) => {
        const eff = await getEffectiveRole(orgId, r.slot);
        const listed =
          eff.isActive && eff.perms.has("directory:listed_internal");
        const inviteable = listed && eff.perms.has("booking:inviteable");
        if (!listed) return null;
        if (inviteableOnly && !inviteable) return null;

        return {
          id: r.user.id,
          userId: r.userId,
          displayName: r.user.displayName ?? r.user.email,
          email: r.user.email,
          slot: r.slot,
          roleLabel: eff.label,
          isInviteable: inviteable,
          languages: r.user.languages,
          tags: r.user.tags,
          supportsOnline: r.user.supportsOnline,
          supportsInPerson: r.user.supportsInPerson,
          city: r.user.city,
          countryCode: r.user.countryCode,
        };
      })
    );

    const filtered = people.filter(Boolean) as NonNullable<
      (typeof people)[number]
    >[];

    return NextResponse.json(
      { ok: true, count: filtered.length, people: filtered },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/experts/search error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to search experts" },
      { status: 500 }
    );
  }
}

// utils
function splitCSV(s: string | null): string[] {
  return (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
function parseBool(v: string | null): boolean | null {
  if (v == null) return null;
  const s = v.toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return null;
}
function clampInt(n: number, min: number, max: number) {
  return Math.min(Math.max(Number.isFinite(n) ? n : min, min), max);
}
function toSlotList(csv: string | null): number[] | null {
  if (!csv) return null;
  const nums = csv
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 10);
  return nums.length ? nums : null;
}
