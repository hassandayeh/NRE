// src/app/api/hosts/search/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import prisma from "../../../../lib/prisma";
import type { Prisma, Role } from "@prisma/client";

/**
 * GET /api/hosts/search
 * Query:
 *  - q?: string
 *  - take?: number (1..50, default 20)
 *  - cursor?: string (id cursor)
 *
 * Returns: { items: Array<{ id, name }>, count, nextCursor }
 * Only lists users who are HOSTs in the caller's org.
 */

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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const take = Math.max(
      1,
      Math.min(50, Number(url.searchParams.get("take") || "20"))
    );
    const cursor = url.searchParams.get("cursor") || undefined;

    const session = await getServerSession(authOptions);
    const email = session?.user?.email as string | undefined;
    if (!email)
      return NextResponse.json(
        { items: [], count: 0, nextCursor: null },
        { status: 200 }
      );

    const me = await prisma.user.findUnique({
      where: { email },
      select: { id: true, activeOrgId: true },
    });
    const userId = me?.id ?? null;

    const memberships = userId
      ? await prisma.organizationMembership.findMany({
          where: { userId },
          select: { orgId: true, role: true },
        })
      : [];

    const rolesByOrg = new Map<string, Role>();
    for (const m of memberships) rolesByOrg.set(m.orgId, m.role as Role);

    const staffOrgId =
      me?.activeOrgId ?? firstStaffOrg(rolesByOrg) ?? undefined;
    if (!staffOrgId) {
      // No org context → nothing to list
      return NextResponse.json(
        { items: [], count: 0, nextCursor: null },
        { status: 200 }
      );
    }

    // Build WHERE
    const AND: Prisma.UserWhereInput[] = [
      { memberships: { some: { role: "HOST" as Role, orgId: staffOrgId } } },
    ];
    if (q) AND.push({ name: { contains: q, mode: "insensitive" } });

    const where: Prisma.UserWhereInput = { AND };

    const users = await prisma.user.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, name: true },
    });

    const items = users.map((u) => ({ id: u.id, name: u.name || "Unnamed" }));
    const nextCursor =
      users.length === take ? users[users.length - 1]?.id ?? null : null;

    return NextResponse.json(
      { items, count: items.length, nextCursor },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/hosts/search error:", err);
    return NextResponse.json(
      { items: [], count: 0, nextCursor: null },
      { status: 200 }
    );
  }
}
