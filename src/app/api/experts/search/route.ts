// src/app/api/experts/search/route.ts
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

/** Local literal types */
type ExpertStatus = "PUBLIC" | "EXCLUSIVE";
type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

function parseBool(v: string | null): boolean | undefined {
  if (v === null) return undefined;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

/** Accept ISO, "YYYY-MM-DD HH:mm", datetime-local, or epoch ms */
function parseStartAt(raw: string | null | undefined): Date | null {
  if (!raw) return null;

  // epoch ms?
  if (/^\d{10,13}$/.test(raw)) {
    const ms = raw.length === 10 ? Number(raw) * 1000 : Number(raw);
    if (Number.isFinite(ms)) {
      const d = new Date(ms);
      if (!Number.isNaN(d.valueOf())) return d;
    }
  }

  // normalize a space into 'T' for "YYYY-MM-DD HH:mm[:ss]"
  let normalized = raw.trim().replace(" ", "T");

  // plain "YYYY-MM-DDTHH:mm" (datetime-local) → treat as local time (valid in Node/Edge/Chromium)
  let d = new Date(normalized);
  if (!Number.isNaN(d.valueOf())) return d;

  // if no timezone was provided, try forcing UTC with trailing Z
  if (!/[zZ]|[+\-]\d\d:?\d\d$/.test(normalized)) {
    d = new Date(normalized + "Z");
    if (!Number.isNaN(d.valueOf())) return d;
  }

  return null;
}

type ExpertBase = {
  id: string;
  name: string | null;
  slug?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  languages?: string[];
  tags?: string[];
  timezone?: string;
  countryCode?: string | null;
  city?: string | null;
  supportsOnline?: boolean;
  supportsInPerson?: boolean;
  expertStatus?: ExpertStatus | null;
  exclusiveOrgId?: string | null;
  rankBoost?: number;
  kind?: "EXPERT" | "REPORTER";
};
type Availability = {
  status: "AVAILABLE" | "BUSY" | "UNKNOWN";
  reasons?: string[];
};
type ExpertItem = ExpertBase & { availability?: Availability };

/** Get current user's org IDs without importing your auth route */
async function resolveUserOrgIdsFromSession(): Promise<string[]> {
  try {
    const { getServerSession } = await import("next-auth");
    const session: any = await getServerSession();
    let userId: string | undefined = session?.user?.id as string | undefined;

    // Fallback via email → userId
    if (!userId && session?.user?.email) {
      const u = await prisma.user.findUnique({
        where: { email: String(session.user.email) },
        select: { id: true },
      });
      userId = u?.id;
    }
    if (!userId) return [];

    const mems = await prisma.organizationMembership.findMany({
      where: { userId },
      select: { orgId: true },
    });
    return mems.map((m) => m.orgId);
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // ---- Visibility (new) ----
    const visibilityParam = (
      searchParams.get("visibility") || ""
    ).toLowerCase();
    let visibility: "public" | "org" | "both" | undefined;
    if (
      visibilityParam === "public" ||
      visibilityParam === "org" ||
      visibilityParam === "both"
    ) {
      visibility = visibilityParam;
    } else {
      const m = (searchParams.get("mode") || "public").toLowerCase();
      visibility = m === "org" ? ("org" as const) : ("public" as const);
    }

    const q = searchParams.get("q")?.trim() || "";

    const langs = (searchParams.get("languages") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const tags = (searchParams.get("tags") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const supportsOnline = parseBool(searchParams.get("supportsOnline"));
    const supportsInPerson = parseBool(searchParams.get("supportsInPerson"));
    const countryCode =
      searchParams.get("countryCode")?.toUpperCase() || undefined;
    const city = searchParams.get("city") || undefined;

    // slot-aware + onlyAvailable (now accepts startAt OR startAtLocal OR startAtMs)
    const startAtRaw =
      searchParams.get("startAt") ??
      searchParams.get("startAtLocal") ??
      searchParams.get("startAtMs");
    const durationMinsStr = searchParams.get("durationMins");
    const onlyAvailable = searchParams.get("onlyAvailable") === "true";
    const wantAvailability = !!startAtRaw || !!durationMinsStr || onlyAvailable;

    // pagination
    const take = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get("take") || "20", 10) || 20)
    );
    const skip = Math.max(
      0,
      parseInt(searchParams.get("skip") || "0", 10) || 0
    );
    const cursor = searchParams.get("cursor") || undefined;

    let startAt: Date | undefined;
    let endAt: Date | undefined;

    if (wantAvailability) {
      const d = parseStartAt(startAtRaw);
      const mins = parseInt(durationMinsStr || "", 10);
      if (!d || !Number.isFinite(mins) || mins <= 0) {
        return NextResponse.json(
          {
            error:
              "Invalid startAt or durationMins. Use ISO (e.g. 2025-09-24T02:00:00Z), 'YYYY-MM-DD HH:mm', datetime-local (YYYY-MM-DDTHH:mm), or epoch ms; durationMins must be a positive integer.",
          },
          { status: 400 }
        );
      }
      startAt = d;
      endAt = new Date(d.getTime() + mins * 60_000);
    }

    // ===== Visibility WHERE blocks =====
    const publicWhereBlock = {
      AND: [
        {
          OR: [
            { expertStatus: "PUBLIC" as ExpertStatus },
            { expertStatus: null },
          ],
        },
        { memberships: { none: {} } }, // exclude all staff in Public
      ],
    };

    // resolve orgIds for org/both
    let orgIds: string[] = [];
    if (visibility === "org" || visibility === "both") {
      const orgIdParam = searchParams.get("orgId");
      if (orgIdParam) {
        orgIds = orgIdParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        orgIds = await resolveUserOrgIdsFromSession();
      }
      if (orgIds.length === 0) {
        return NextResponse.json(
          {
            error:
              "Could not determine orgId for org visibility. Please sign in or pass orgId.",
          },
          { status: 400 }
        );
      }
    }

    const orgWhereBlock =
      visibility === "org" || visibility === "both"
        ? {
            OR: [
              // EXCLUSIVE experts for my org(s)
              {
                AND: [
                  { expertStatus: "EXCLUSIVE" as ExpertStatus },
                  { exclusiveOrgId: { in: orgIds } },
                ],
              },
              // REPORTERS (members who are not owners/producers)
              {
                memberships: {
                  some: {
                    orgId: { in: orgIds },
                    NOT: { role: { in: ["OWNER", "PRODUCER"] } },
                  },
                },
              },
            ],
          }
        : undefined;

    let visibilityWhere: Record<string, unknown>;
    if (visibility === "public") {
      visibilityWhere = publicWhereBlock;
    } else if (visibility === "org") {
      visibilityWhere = orgWhereBlock!;
    } else {
      // both: union of public + org
      visibilityWhere = { OR: [publicWhereBlock, orgWhereBlock!] };
    }

    // ===== Common filters =====
    const where: Record<string, any> = {
      AND: [
        visibilityWhere,
        q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { bio: { contains: q, mode: "insensitive" } },
              ],
            }
          : {},
        langs.length ? { languages: { hasSome: langs } } : {},
        tags.length ? { tags: { hasSome: tags } } : {},
        typeof supportsOnline === "boolean" ? { supportsOnline } : {},
        typeof supportsInPerson === "boolean" ? { supportsInPerson } : {},
        countryCode ? { countryCode } : {},
        city ? { city: { contains: city, mode: "insensitive" } } : {},
      ],
    };

    // ===== Fetch page =====
    const paginationOpts: any = {
      take,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : { skip }),
    };

    const usersRaw = (await prisma.user.findMany({
      where,
      ...paginationOpts,
      ...(visibility === "org" || visibility === "both"
        ? { include: { memberships: { select: { orgId: true, role: true } } } }
        : {}),
    })) as any[];

    const experts: ExpertBase[] = usersRaw.map((u: any): ExpertBase => {
      const isExclusive = u.expertStatus === "EXCLUSIVE";
      const hasAnyMembership = Array.isArray(u.memberships)
        ? u.memberships.length > 0
        : false;
      const kind: "EXPERT" | "REPORTER" =
        isExclusive ||
        (!hasAnyMembership &&
          (u.expertStatus === "PUBLIC" || u.expertStatus === null))
          ? "EXPERT"
          : "REPORTER";

      return {
        id: u.id,
        name: u.name ?? null,
        slug: "slug" in u ? (u.slug as string | null) : null,
        avatarUrl: "avatarUrl" in u ? (u.avatarUrl as string | null) : null,
        bio: "bio" in u ? (u.bio as string | null) : null,
        languages: Array.isArray(u.languages) ? (u.languages as string[]) : [],
        tags: Array.isArray(u.tags) ? (u.tags as string[]) : [],
        timezone: (u.timezone as string) ?? "UTC",
        countryCode:
          "countryCode" in u ? (u.countryCode as string | null) : null,
        city: "city" in u ? (u.city as string | null) : null,
        supportsOnline:
          "supportsOnline" in u ? Boolean(u.supportsOnline) : true,
        supportsInPerson:
          "supportsInPerson" in u ? Boolean(u.supportsInPerson) : true,
        expertStatus:
          (u.expertStatus as ExpertStatus | null | undefined) ?? null,
        exclusiveOrgId:
          "exclusiveOrgId" in u ? (u.exclusiveOrgId as string | null) : null,
        rankBoost: Number.isFinite(u?.rankBoost) ? (u.rankBoost as number) : 0,
        kind,
      };
    });

    // If availability is not requested → sort & return
    if (!wantAvailability) {
      const sorted = [...experts].sort(
        (a: ExpertItem, b: ExpertItem): number => {
          if ((b.rankBoost || 0) !== (a.rankBoost || 0))
            return (b.rankBoost || 0) - (a.rankBoost || 0);
          return (a.name || "").localeCompare(b.name || "");
        }
      );
      const nextCursor =
        usersRaw.length === take ? usersRaw[usersRaw.length - 1].id : null;
      return NextResponse.json({
        items: sorted,
        count: sorted.length,
        nextCursor,
      });
    }

    // ===== Slot-aware availability (blocks + bookings) =====
    const expertIdsForAvail: string[] = experts
      .filter(
        (e) => e.expertStatus === "EXCLUSIVE" || e.expertStatus === "PUBLIC"
      )
      .map((e) => e.id);

    // 1) ExpertTimeBlock overlaps
    let blocks: Array<{ expertUserId: string }> = [];
    try {
      blocks = await (prisma as any).expertTimeBlock.findMany({
        where: {
          expertUserId: { in: expertIdsForAvail },
          AND: [{ startAt: { lt: endAt } }, { endAt: { gt: startAt } }],
        },
        select: { expertUserId: true },
      });
    } catch {
      blocks = [];
    }

    // 2) Booking overlaps (exclude CANCELLED)
    const paddingMs = 24 * 60 * 60 * 1000;
    const lowerBound = new Date(startAt!.getTime() - paddingMs);
    const candidateBookings = await prisma.booking.findMany({
      where: {
        expertUserId: { in: expertIdsForAvail },
        status: { not: "CANCELLED" as BookingStatus },
        startAt: { lt: endAt, gt: lowerBound },
      },
      select: { expertUserId: true, startAt: true, durationMins: true },
    });

    const busyFromBlocks = new Set(blocks.map((b) => b.expertUserId));
    const busyFromBookings = new Set<string>();
    for (const bk of candidateBookings) {
      const bkEnd = new Date(
        bk.startAt.getTime() + (bk.durationMins || 0) * 60_000
      );
      if (bk.startAt < endAt! && bkEnd > startAt!) {
        if (bk.expertUserId) busyFromBookings.add(bk.expertUserId);
      }
    }

    let items: ExpertItem[] = experts.map((e): ExpertItem => {
      if (e.expertStatus !== "EXCLUSIVE" && e.expertStatus !== "PUBLIC") {
        // Reporter
        return { ...e, availability: { status: "UNKNOWN" } };
      }
      const reasons: string[] = [];
      if (busyFromBlocks.has(e.id)) reasons.push("block");
      if (busyFromBookings.has(e.id)) reasons.push("booking");
      const busy = reasons.length > 0;
      return {
        ...e,
        availability: {
          status: busy ? "BUSY" : "AVAILABLE",
          ...(busy ? { reasons } : {}),
        },
      };
    });

    // If onlyAvailable requested → keep only AVAILABLE experts (drop reporters & busy)
    if (onlyAvailable) {
      items = items.filter((i) => i.availability?.status === "AVAILABLE");
    }

    // AVAILABLE first → rankBoost → name
    items.sort((a: ExpertItem, b: ExpertItem): number => {
      const aBusy = a.availability?.status === "BUSY" ? 1 : 0;
      const bBusy = b.availability?.status === "BUSY" ? 1 : 0;
      if (aBusy !== bBusy) return aBusy - bBusy;
      if ((b.rankBoost || 0) !== (a.rankBoost || 0))
        return (b.rankBoost || 0) - (a.rankBoost || 0);
      return (a.name || "").localeCompare(b.name || "");
    });

    const nextCursor =
      usersRaw.length === take ? usersRaw[usersRaw.length - 1].id : null;
    return NextResponse.json({ items, count: items.length, nextCursor });
  } catch (err: unknown) {
    console.error("experts/search error:", err);
    return NextResponse.json(
      { error: "Failed to search experts." },
      { status: 500 }
    );
  }
}
