import { NextResponse } from "next/server";
import { PrismaClient, Role, ExpertStatus } from "@prisma/client";
import { resolveViewerFromRequest } from "../../../../lib/viewer";

const prisma = new PrismaClient();

/** Parse ISO datetime safely; return Date or null */
function parseISO(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Check time overlap between [aStart, aEnd) and [bStart, bEnd) */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Compute end = start + minutes */
function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
}

/** Resolve caller orgId using your viewer helper (session + JWT) */
async function getCallerOrgId(req: Request): Promise<string> {
  const v = await resolveViewerFromRequest(req);
  if (!v?.isSignedIn) throw new Response("Unauthorized", { status: 401 });

  const orgId =
    v.activeOrgId ??
    (Array.isArray(v.staffOrgIds) && v.staffOrgIds[0]) ??
    (Array.isArray(v.memberships) && v.memberships[0]?.orgId) ??
    null;

  if (!orgId) throw new Response("Unauthorized", { status: 401 });
  return orgId;
}

type DirectoryItem = {
  id: string;
  kind: "HOST" | "REPORTER" | "EXPERT";
  displayName: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  languages: string[];
  tags: string[];
  availability: "AVAILABLE" | "BUSY" | null;
};

export async function GET(req: Request) {
  try {
    const orgId = await getCallerOrgId(req); // ✅ correct org scope

    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const start = parseISO(url.searchParams.get("start"));
    const end = parseISO(url.searchParams.get("end"));
    const wantAvailability = !!(start && end && start < end);

    // Shared text filter
    const nameWhere =
      q.length > 1
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } },
              { languages: { has: q.toLowerCase() } },
              { tags: { has: q.toLowerCase() } },
              { city: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {};

    // Hosts in org
    const hosts = await prisma.user.findMany({
      where: {
        memberships: { some: { orgId, role: Role.HOST } },
        ...nameWhere,
      },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        city: true,
        countryCode: true,
        languages: true,
        tags: true,
      },
      orderBy: [{ displayName: "asc" }],
    });

    // Reporters in org — robust to local enum drift
    const ReporterRole = (Role as any)?.REPORTER ?? ("REPORTER" as any);
    const reporters = await prisma.user.findMany({
      where: {
        memberships: { some: { orgId, role: ReporterRole } },
        ...nameWhere,
      },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        city: true,
        countryCode: true,
        languages: true,
        tags: true,
      },
      orderBy: [{ displayName: "asc" }],
    });

    // Exclusive experts of org
    const exclusiveExperts = await prisma.user.findMany({
      where: {
        expertVisStatus: ExpertStatus.EXCLUSIVE,
        exclusiveOrgId: orgId,
        ...nameWhere,
      },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        city: true,
        countryCode: true,
        languages: true,
        tags: true,
      },
      orderBy: [{ displayName: "asc" }],
    });

    // Merge with kind tag
    const baseItems: DirectoryItem[] = [
      ...hosts.map((u) => ({
        ...u,
        kind: "HOST" as const,
        availability: null,
      })),
      ...reporters.map((u) => ({
        ...u,
        kind: "REPORTER" as const,
        availability: null,
      })),
      ...exclusiveExperts.map((u) => ({
        ...u,
        kind: "EXPERT" as const,
        availability: null,
      })),
    ];

    // Availability: only when both start & end are provided; otherwise null (hide badge)
    if (wantAvailability) {
      const ids = baseItems.map((i) => i.id);
      if (ids.length) {
        const from = new Date(start!.getTime() - 8 * 60 * 60 * 1000);
        const to = end!;
        const bookings = await prisma.booking.findMany({
          where: {
            startAt: { gte: from, lt: to },
            OR: [
              { hostUserId: { in: ids } },
              { expertUserId: { in: ids } },
              { guests: { some: { userId: { in: ids } } } },
            ],
          },
          select: {
            startAt: true,
            durationMins: true,
            hostUserId: true,
            expertUserId: true,
            guests: { select: { userId: true } },
          },
        });

        const busy = new Set<string>();
        for (const b of bookings) {
          const bStart = b.startAt;
          const bEnd = addMinutes(b.startAt, b.durationMins);
          if (!overlaps(start!, end!, bStart, bEnd)) continue;
          const parts = new Set<string>();
          if (b.hostUserId) parts.add(b.hostUserId);
          if (b.expertUserId) parts.add(b.expertUserId);
          for (const g of b.guests) if (g.userId) parts.add(g.userId);
          for (const id of parts) busy.add(id);
        }
        for (const item of baseItems) {
          item.availability = busy.has(item.id) ? "BUSY" : "AVAILABLE";
        }
      }
    } else {
      for (const item of baseItems) item.availability = null;
    }

    return NextResponse.json({
      ok: true,
      window: wantAvailability ? { start, end } : null,
      count: baseItems.length,
      items: baseItems,
    });
  } catch (err: any) {
    if (err instanceof Response) return err;
    console.error("[/api/directory/org] error", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}
