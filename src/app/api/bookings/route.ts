// src/app/api/bookings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import prisma from "../../../lib/prisma";

const TENANCY_ENFORCED = process.env.TENANCY_ENFORCED !== "false";

async function getAuthedUser(req: NextRequest) {
  // 1) Try JWT from NextAuth
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  const token = await getToken({ req, secret }).catch(() => null);
  let email = (token?.email as string | undefined) ?? undefined;

  // 2) Fallback to getServerSession if JWT failed
  if (!email) {
    const session = await getServerSession(authOptions).catch(() => null);
    email = (session?.user?.email as string | undefined) ?? undefined;
  }

  if (!email) return null;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: true },
  });
  return user;
}

function roleForActiveOrg(user: any) {
  if (!user?.activeOrgId) return null;
  const m = user.memberships?.find((mm: any) => mm.orgId === user.activeOrgId);
  return m?.role ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!TENANCY_ENFORCED) {
      const all = await prisma.booking.findMany({
        orderBy: { startAt: "desc" },
      });
      return NextResponse.json(all);
    }

    const activeRole = roleForActiveOrg(user);

    // If user has no active org and is not an EXPERT with single org → empty list
    if (
      !activeRole &&
      !user.memberships?.some((m: any) => m.role === "EXPERT")
    ) {
      return NextResponse.json([], { status: 200 });
    }

    // EXPERT view (temporary name match)
    if (
      activeRole === "EXPERT" ||
      (!activeRole && user.memberships?.every((m: any) => m.role === "EXPERT"))
    ) {
      const name = user.name ?? "";
      const expertBookings = await prisma.booking.findMany({
        where: {
          expertName: name,
          orgId: { in: user.memberships.map((m: any) => m.orgId) },
        },
        orderBy: { startAt: "desc" },
      });
      return NextResponse.json(expertBookings);
    }

    // PRODUCER/ADMIN/OWNER: scope by active org
    if (!user.activeOrgId) {
      return NextResponse.json(
        { error: "No active organization selected." },
        { status: 400 }
      );
    }

    const rows = await prisma.booking.findMany({
      where: { orgId: user.activeOrgId },
      orderBy: { startAt: "desc" },
    });
    return NextResponse.json(rows);
  } catch (e) {
    console.error("GET /api/bookings failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const {
      subject,
      expertName,
      newsroomName,
      appearanceType, // "ONLINE" | "IN_PERSON"
      startAt,
      durationMins,
      locationName,
      locationUrl,
      programName,
      hostName,
      talkingPoints,
    } = body ?? {};

    if (
      !subject ||
      !expertName ||
      !newsroomName ||
      !appearanceType ||
      !startAt ||
      !durationMins
    ) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 }
      );
    }

    let orgIdToUse = body.orgId ?? null;

    if (TENANCY_ENFORCED) {
      const activeRole = roleForActiveOrg(user);
      const expertOnly = user.memberships?.every(
        (m: any) => m.role === "EXPERT"
      );
      const fallbackOrgId =
        user.activeOrgId ?? (expertOnly ? user.memberships?.[0]?.orgId : null);

      if (!fallbackOrgId) {
        return NextResponse.json(
          { error: "No active organization selected." },
          { status: 400 }
        );
      }

      orgIdToUse = fallbackOrgId;

      if (activeRole === "EXPERT" || expertOnly) {
        if ((user.name ?? "") !== expertName) {
          return NextResponse.json(
            { error: "Experts can only create bookings for themselves." },
            { status: 403 }
          );
        }
      }
    }

    const created = await prisma.booking.create({
      data: {
        subject,
        expertName,
        newsroomName,
        appearanceType,
        startAt: new Date(startAt),
        durationMins: Number(durationMins),
        locationName: locationName ?? null,
        locationUrl: locationUrl ?? null,
        programName: programName ?? null,
        hostName: hostName ?? null,
        talkingPoints: talkingPoints ?? null,
        orgId: orgIdToUse,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    console.error("POST /api/bookings failed:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
