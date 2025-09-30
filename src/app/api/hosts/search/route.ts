// src/app/api/hosts/search/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";

/** Minimal where-input type (avoid Prisma namespace types that vary by version) */
type UserWhereInput = Record<string, unknown>;

/**
 * GET /api/hosts/search
 * Query:
 * - q?: string
 * - take?: number (1..50, default 20)
 * - cursor?: string (id cursor)
 * - start?: ISO string \
 * - end?: ISO string     |=> either this pair
 *   OR
 * - startAt?: ISO string \
 * - durationMins?: number |=> or this pair
 *
 * Returns: { items: Array<{ id, name, availability? }>, count, nextCursor }
 * Only lists users who are HOSTs in the caller's org.
 */

function firstStaffOrg(rolesByOrg: Map<string, string>): string | null {
  for (const [orgId, role] of rolesByOrg) {
    if (
      role === "OWNER" ||
      role === "ADMIN" ||
      role === "PRODUCER" ||
      role === "HOST"
    ) {
      return orgId;
    }
  }
  return null;
}

function parseWindow(url: URL) {
  const startQS =
    url.searchParams.get("start") ?? url.searchParams.get("startAt");
  const endQS = url.searchParams.get("end");
  const durQS = url.searchParams.get("durationMins");

  const start = startQS ? new Date(startQS) : null;
  let end: Date | null = null;

  if (endQS) {
    end = new Date(endQS);
  } else if (start && durQS && Number(durQS) > 0) {
    end = new Date(start.getTime() + Number(durQS) * 60_000);
  }

  if (start && end && !Number.isNaN(+start) && !Number.isNaN(+end)) {
    return { start, end };
  }
  return { start: null, end: null };
}

function overlaps(a0: Date, a1: Date, b0: Date, b1: Date) {
  return b0 < a1 && b1 > a0;
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

    // Anonymous → empty list (same behavior as before)
    if (!email)
      return NextResponse.json(
        { items: [], count: 0, nextCursor: null },
        { status: 200 }
      );

    // Me + org context
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

    const rolesByOrg = new Map<string, string>();
    for (const m of memberships) rolesByOrg.set(m.orgId, m.role as string);

    const staffOrgId =
      me?.activeOrgId ?? firstStaffOrg(rolesByOrg) ?? undefined;
    if (!staffOrgId) {
      // No org context → nothing to list
      return NextResponse.json(
        { items: [], count: 0, nextCursor: null },
        { status: 200 }
      );
    }

    // Build WHERE for host users (typed locally)
    const AND: UserWhereInput[] = [
      { memberships: { some: { role: "HOST", orgId: staffOrgId } } },
    ];
    if (q) AND.push({ name: { contains: q, mode: "insensitive" } });

    const where: UserWhereInput = { AND };

    const users = await prisma.user.findMany({
      where: where as any, // safe: structure matches Prisma where input
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, name: true },
    });

    const items: Array<{
      id: string;
      name: string;
      availability?: { status: "AVAILABLE" | "BUSY" };
    }> = users.map((u: { id: string; name: string | null }) => ({
      id: u.id,
      name: u.name || "Unnamed",
    }));

    const { start, end } = parseWindow(url);

    // If a window is provided, compute availability
    if (start && end && items.length > 0) {
      const hostIds = items.map((i) => i.id);

      // Generous lookback to make sure we fetch any booking that could overlap the window
      const lookbackMs = 12 * 60 * 60 * 1000; // 12h
      const since = new Date(start.getTime() - lookbackMs);

      // 1) New model: BookingHost join rows
      const hostJoins = await prisma.bookingHost.findMany({
        where: {
          userId: { in: hostIds },
          booking: {
            orgId: staffOrgId,
            startAt: { gt: since, lt: end }, // narrow server-side; exact overlap checked below
          },
        },
        select: {
          userId: true,
          booking: { select: { startAt: true, durationMins: true } },
        },
      });

      // 2) Legacy mirror: Booking.hostUserId
      const legacyHosts = await prisma.booking.findMany({
        where: {
          orgId: staffOrgId,
          hostUserId: { in: hostIds },
          startAt: { gt: since, lt: end },
        },
        select: { hostUserId: true, startAt: true, durationMins: true },
      });

      // Bucket by host
      const buckets = new Map<string, Array<{ s: Date; e: Date }>>();

      function add(
        uid: string | null | undefined,
        s: Date,
        mins: number | null | undefined
      ) {
        if (!uid) return;
        const endTime = new Date(s.getTime() + (Number(mins) || 0) * 60_000);
        const arr = buckets.get(uid) || [];
        arr.push({ s, e: endTime });
        buckets.set(uid, arr);
      }

      for (const r of hostJoins) {
        add(r.userId, new Date(r.booking.startAt), r.booking.durationMins);
      }
      for (const r of legacyHosts) {
        add(r.hostUserId, new Date(r.startAt), r.durationMins);
      }

      // Compute status per item
      for (const it of items) {
        const windows = buckets.get(it.id) || [];
        const busy = windows.some((w) => overlaps(start, end, w.s, w.e));
        it.availability = { status: busy ? "BUSY" : "AVAILABLE" };
      }
    }

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
