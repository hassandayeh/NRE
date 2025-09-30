// src/app/api/directory/org/route.ts

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../lib/viewer";

/* ---------- Local types (avoid relying on missing Prisma enums) ---------- */
type Kind = "HOST" | "REPORTER" | "EXPERT";
type Availability = "AVAILABLE" | "BUSY" | null;

type DirectoryItem = {
  id: string;
  kind: Kind;
  displayName: string | null;
  avatarUrl: string | null;
  city: string | null;
  countryCode: string | null;
  languages: string[];
  tags: string[];
  availability: Availability;
};

/* ---------- Helpers ---------- */

function parseISO(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60_000);
}

async function getCallerOrgId(req: Request): Promise<string> {
  const v = await resolveViewerFromRequest(req);
  if (!v?.isSignedIn) throw new Response("Unauthorized", { status: 401 });

  // ✅ Avoid boolean (`false`) leaking from && expressions
  const fromStaff = Array.isArray(v.staffOrgIds) ? v.staffOrgIds[0] : undefined;
  const fromMemberships = Array.isArray(v.memberships)
    ? v.memberships[0]?.orgId
    : undefined;

  const orgId = v.activeOrgId ?? fromStaff ?? fromMemberships ?? null;

  if (!orgId) throw new Response("Unauthorized", { status: 401 });
  return orgId;
}

/* ---------- Route ---------- */

export async function GET(req: Request) {
  try {
    const orgId = await getCallerOrgId(req); // ✅ scoped to caller org

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
        memberships: { some: { orgId, role: "HOST" } },
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

    // Reporters in org
    const reporters = await prisma.user.findMany({
      where: {
        memberships: { some: { orgId, role: "REPORTER" } },
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
        expertVisStatus: "EXCLUSIVE", // was ExpertStatus.EXCLUSIVE
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
      ...hosts.map(
        (u: any): DirectoryItem => ({
          ...u,
          kind: "HOST",
          availability: null,
        })
      ),
      ...reporters.map(
        (u: any): DirectoryItem => ({
          ...u,
          kind: "REPORTER",
          availability: null,
        })
      ),
      ...exclusiveExperts.map(
        (u: any): DirectoryItem => ({
          ...u,
          kind: "EXPERT",
          availability: null,
        })
      ),
    ];

    // Availability only when both start & end are provided
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

    return NextResponse.json(
      {
        ok: true,
        window: wantAvailability ? { start, end } : null,
        count: baseItems.length,
        items: baseItems,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err instanceof Response) return err;
    console.error("[/api/directory/org] error", err);
    return NextResponse.json(
      { ok: false, error: "Server error" },
      { status: 500 }
    );
  }
}
