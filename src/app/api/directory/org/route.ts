// src/app/api/directory/org/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../lib/viewer";
import { hasCan, getEffectiveRole } from "../../../../lib/access/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

type MemberRow = {
  userId: string;
  slot: number;
  user: {
    id: string;
    displayName: string | null;
    email: string;
    languages: string[];
    tags: string[];
    supportsOnline: boolean;
    supportsInPerson: boolean;
    city: string | null;
    countryCode: string | null;
  };
};

function toIntList(csv: string | null): number[] | null {
  if (!csv) return null;
  const nums = csv
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 10);
  return nums.length ? nums : null;
}

// GET /api/directory/org?orgId=...&q=...&slots=4,5&inviteableOnly=true&take=50&skip=0
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
    const q = (searchParams.get("q") || "").trim();
    const inviteableOnly =
      (searchParams.get("inviteableOnly") || "false").toLowerCase() === "true";
    const slots = toIntList(searchParams.get("slots"));
    const take = Math.min(
      Math.max(parseInt(searchParams.get("take") || "50", 10), 1),
      200
    );
    const skip = Math.max(parseInt(searchParams.get("skip") || "0", 10), 0);

    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: "orgId is required" },
        { status: 400 }
      );
    }

    // Gate directory access by booking:view (broad read capability)
    const canViewDirectory = await hasCan({
      userId: viewer.userId,
      orgId,
      permission: "booking:view",
    });
    if (!canViewDirectory) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    // Build query
    const where: any = { orgId };
    if (slots) where.slot = { in: slots };
    if (q) {
      // search by name/email (basic)
      where.user = {
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      };
    }

    // Fetch org members (page)
    const rows: MemberRow[] = await prisma.userRole.findMany({
      where,
      take,
      skip,
      orderBy: { assignedAt: "desc" }, // stable order; we’ll prettify order client-side
      select: {
        userId: true,
        slot: true,
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
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

    // Filter by role activity & directory permissions; attach label/flags
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
          isActiveSlot: eff.isActive,
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
      {
        ok: true,
        count: filtered.length,
        people: filtered,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/directory/org error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load directory" },
      { status: 500 }
    );
  }
}
