// src/app/api/experts/search/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import prisma from "../../../../lib/prisma";
import type { Prisma, Role } from "@prisma/client";

/**
 * GET /api/experts/search
 * Query:
 *  - q?: string
 *  - visibility?: "org" | "public" | "both" (default: "org")
 *  - take?: number (1..50, default 20)
 *  - cursor?: string (id cursor)
 *
 * Behaviour:
 *  - Excludes HOST-only users by requiring EXPERT membership somewhere.
 *  - "org": EXPERTS in your org OR EXCLUSIVE to your org.
 *  - "public": EXPERTS with PUBLIC visibility (still require EXPERT membership somewhere).
 *  - "both": union of the above.
 *  - Returns minimal fields the UI needs.
 *
 * Compatibility:
 *  - Works with either Prisma shape:
 *      - new:  user.expertVisStatus
 *      - old:  user.expertStatus
 *    We *try* expertVisStatus first; if Prisma rejects the filter, we retry with expertStatus.
 */

type Visibility = "org" | "public" | "both";

function firstStaffOrg(rolesByOrg: Map<string, Role>): string | null {
  for (const [orgId, role] of rolesByOrg) {
    if (
      role === "OWNER" ||
      role === "ADMIN" ||
      role === "PRODUCER" ||
      role === "HOST"
    )
      return orgId;
  }
  return null;
}

function buildBaseAND(q: string): Prisma.UserWhereInput[] {
  const AND: Prisma.UserWhereInput[] = [];
  // Must be EXPERT somewhere (excludes HOST-only users)
  AND.push({ memberships: { some: { role: "EXPERT" as Role } } });
  // Name filter (keep to `name` to avoid client drift)
  if (q) AND.push({ name: { contains: q, mode: "insensitive" } });
  return AND;
}

/** Build visibility branch using a specific status key name. */
function buildVisibilityAND(
  visibility: Visibility,
  staffOrgId: string | undefined,
  statusKey: "expertVisStatus" | "expertStatus"
): Prisma.UserWhereInput[] {
  const AND: Prisma.UserWhereInput[] = [];
  if (visibility === "org") {
    if (staffOrgId) {
      AND.push({
        OR: [
          // Expert in my org
          {
            memberships: {
              some: { role: "EXPERT" as Role, orgId: staffOrgId },
            },
          },
          // Exclusive to my org
          { [statusKey]: "EXCLUSIVE", exclusiveOrgId: staffOrgId } as any,
        ],
      });
    } else {
      AND.push({ id: "__no_org__" as any });
    }
  } else if (visibility === "public") {
    AND.push({ [statusKey]: "PUBLIC" } as any);
  } else {
    // both
    if (staffOrgId) {
      AND.push({
        OR: [
          {
            memberships: {
              some: { role: "EXPERT" as Role, orgId: staffOrgId },
            },
          },
          { [statusKey]: "EXCLUSIVE", exclusiveOrgId: staffOrgId } as any,
          { [statusKey]: "PUBLIC" } as any,
        ],
      });
    } else {
      AND.push({ [statusKey]: "PUBLIC" } as any);
    }
  }
  return AND;
}

/** Try a query with a given status key; if Prisma rejects it, throw to caller to retry. */
async function queryWithStatusKey(args: {
  q: string;
  visibility: Visibility;
  take: number;
  cursor?: string;
  staffOrgId?: string;
  statusKey: "expertVisStatus" | "expertStatus";
}) {
  const { q, visibility, take, cursor, staffOrgId, statusKey } = args;

  const AND = [
    ...buildBaseAND(q),
    ...buildVisibilityAND(visibility, staffOrgId, statusKey),
  ];
  const where: Prisma.UserWhereInput = { AND };

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    // keep select minimal (works across client shapes)
    select: { id: true, name: true },
  });

  return users;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const visibility = (
      url.searchParams.get("visibility") || "org"
    ).toLowerCase() as Visibility;
    const take = Math.max(
      1,
      Math.min(50, Number(url.searchParams.get("take") || "20"))
    );
    const cursor = url.searchParams.get("cursor") || undefined;

    // ---- Auth & org context ----
    const session = await getServerSession(authOptions);
    const email = session?.user?.email as string | undefined;
    if (!email) {
      return NextResponse.json(
        { items: [], count: 0, nextCursor: null },
        { status: 200 }
      );
    }

    const me = await prisma.user.findUnique({
      where: { email },
      select: { id: true, activeOrgId: true },
    });

    const memberships = me?.id
      ? await prisma.organizationMembership.findMany({
          where: { userId: me.id },
          select: { orgId: true, role: true },
        })
      : [];

    const rolesByOrg = new Map<string, Role>();
    for (const m of memberships) rolesByOrg.set(m.orgId, m.role as Role);

    const staffOrgId =
      me?.activeOrgId ?? firstStaffOrg(rolesByOrg) ?? undefined;

    // ---- Attempt with new key; fall back to legacy key if Prisma rejects it ----
    let users;
    try {
      users = await queryWithStatusKey({
        q,
        visibility,
        take,
        cursor,
        staffOrgId,
        statusKey: "expertVisStatus",
      });
    } catch {
      users = await queryWithStatusKey({
        q,
        visibility,
        take,
        cursor,
        staffOrgId,
        statusKey: "expertStatus",
      });
    }

    const items = users.map((u) => ({
      id: u.id,
      name: u.name || "Unnamed",
      kind: "EXPERT" as const,
      availability: { status: "UNKNOWN" as const },
    }));

    const nextCursor =
      users.length === take ? users[users.length - 1]?.id ?? null : null;

    return NextResponse.json(
      { items, count: items.length, nextCursor },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/experts/search error:", err);
    // Return 200 + empty so the UI shows a friendly state
    return NextResponse.json(
      {
        items: [],
        count: 0,
        nextCursor: null,
        error: "Failed to search experts.",
      },
      { status: 200 }
    );
  }
}
