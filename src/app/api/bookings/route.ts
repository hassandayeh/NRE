// src/app/api/bookings/route.ts
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import prisma from "../../../lib/prisma";
import type { Booking, Role } from "@prisma/client";

type Appearance = "ONLINE" | "IN_PERSON";
const TENANCY_ON = process.env.TENANCY_ENFORCED !== "false";

async function getAuthContext() {
  const session = await getServerSession(authOptions);
  const user = session?.user as any | undefined;

  const email = user?.email as string | undefined;
  const dbUser = email
    ? await prisma.user.findUnique({
        where: { email },
        select: { id: true, activeOrgId: true },
      })
    : null;

  const userId = dbUser?.id ?? null;
  const activeOrgId = (dbUser?.activeOrgId as string | null) ?? null;

  const memberships = userId
    ? await prisma.organizationMembership.findMany({
        where: { userId },
        select: { orgId: true, role: true },
      })
    : [];

  const rolesByOrg = new Map<string, Role>();
  for (const m of memberships) rolesByOrg.set(m.orgId, m.role as Role);

  return {
    session,
    user,
    userId,
    activeOrgId,
    memberships,
    rolesByOrg,
    isSignedIn: !!userId,
  };
}

function isNewsroomStaff(rolesByOrg: Map<string, Role>, orgId: string | null) {
  if (!orgId) return false;
  const role = rolesByOrg.get(orgId);
  return role === "OWNER" || role === "PRODUCER";
}

function firstProducerOrg(rolesByOrg: Map<string, Role>): string | null {
  for (const [orgId, role] of rolesByOrg) {
    if (role === "OWNER" || role === "PRODUCER") return orgId;
  }
  return null;
}

function isExpert(rolesByOrg: Map<string, Role>) {
  for (const [, role] of rolesByOrg) if (role === "EXPERT") return true;
  return false;
}

function coerceAppearance(val: unknown): Appearance | null {
  if (typeof val !== "string") return null;
  const up = val.toUpperCase().replace("-", "_");
  return up === "ONLINE" || up === "IN_PERSON" ? (up as Appearance) : null;
}

function asTrimmed(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const t = val.trim();
  return t.length ? t : "";
}

function coerceISODate(val: unknown): Date | null {
  if (typeof val !== "string") return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function coerceInt(val: unknown): number | null {
  const n =
    typeof val === "number" ? val : typeof val === "string" ? Number(val) : NaN;
  return Number.isFinite(n) ? n : null;
}

// ---------- GET /api/bookings ----------
export async function GET() {
  try {
    const { isSignedIn, user, activeOrgId, rolesByOrg, memberships } =
      await getAuthContext();
    if (!isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    let bookings: Booking[] = [];

    if (!TENANCY_ON) {
      bookings = await prisma.booking.findMany({
        orderBy: [{ startAt: "asc" }],
      });
      return NextResponse.json({ ok: true, bookings }, { status: 200 });
    }

    const expertName = (user?.name as string | undefined) ?? "__";
    const expertOrgIds = memberships
      .filter((m) => m.role === "EXPERT")
      .map((m) => m.orgId);

    if (isNewsroomStaff(rolesByOrg, activeOrgId)) {
      bookings = await prisma.booking.findMany({
        where: { orgId: activeOrgId ?? undefined },
        orderBy: [{ startAt: "asc" }],
      });
    } else if (isExpert(rolesByOrg)) {
      bookings = await prisma.booking.findMany({
        where: {
          orgId: { in: expertOrgIds.length ? expertOrgIds : ["__none__"] },
          expertName: expertName,
        },
        orderBy: [{ startAt: "asc" }],
      });
    } else {
      bookings = [];
    }

    return NextResponse.json({ ok: true, bookings }, { status: 200 });
  } catch (err) {
    console.error("GET /api/bookings error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load bookings" },
      { status: 500 }
    );
  }
}

// ---------- POST /api/bookings ----------
export async function POST(req: Request) {
  try {
    const { isSignedIn, activeOrgId, rolesByOrg } = await getAuthContext();
    if (!isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Resolve the org we will create the booking under
    let resolvedOrgId: string | null = activeOrgId ?? null;

    if (TENANCY_ON) {
      // Only newsroom staff can create
      if (!isNewsroomStaff(rolesByOrg, activeOrgId)) {
        const fallbackOrg = firstProducerOrg(rolesByOrg);
        if (!fallbackOrg) {
          return NextResponse.json(
            { ok: false, error: "Forbidden" },
            { status: 403 }
          );
        }
        resolvedOrgId = fallbackOrg;
      }
      if (!resolvedOrgId) {
        return NextResponse.json(
          { ok: false, error: "No active organization selected." },
          { status: 400 }
        );
      }
    } else {
      resolvedOrgId = activeOrgId ?? resolvedOrgId;
    }

    const body = await req.json().catch(() => ({} as any));

    // Accept aliases from UI and map them
    const subject = asTrimmed(body.subject);
    const newsroomName = asTrimmed(body.newsroomName);
    const expertName = asTrimmed(body.expertName ?? body.guestName); // alias
    const appearanceType = coerceAppearance(body.appearanceType);
    const startAt = coerceISODate(body.startAt);
    const durationMins = coerceInt(body.durationMins);
    const locationName = asTrimmed(body.locationName);
    const locationUrl = asTrimmed(body.locationUrl ?? body.meetingLink); // alias
    const programName = asTrimmed(body.programName);
    const hostName = asTrimmed(body.hostName);
    const talkingPoints = asTrimmed(body.talkingPoints);

    // Field-level validations
    if (!subject)
      return NextResponse.json(
        { ok: false, error: "Subject is required." },
        { status: 400 }
      );
    if (!newsroomName)
      return NextResponse.json(
        { ok: false, error: "Newsroom name is required." },
        { status: 400 }
      );
    if (!expertName)
      return NextResponse.json(
        { ok: false, error: "Guest name (expert) is required." },
        { status: 400 }
      );
    if (!appearanceType)
      return NextResponse.json(
        { ok: false, error: "Appearance type must be ONLINE or IN_PERSON." },
        { status: 400 }
      );
    if (!startAt)
      return NextResponse.json(
        { ok: false, error: "Start date/time is invalid." },
        { status: 400 }
      );
    if (durationMins == null || durationMins <= 0)
      return NextResponse.json(
        { ok: false, error: "Duration must be a positive number." },
        { status: 400 }
      );

    const created = await prisma.booking.create({
      data: {
        subject,
        newsroomName,
        expertName,
        appearanceType,
        startAt,
        durationMins,
        locationName: locationName ?? "",
        locationUrl: locationUrl ?? "",
        programName: programName ?? "",
        hostName: hostName ?? "",
        talkingPoints: talkingPoints ?? "",
        // relation connect instead of orgId scalar
        organization: resolvedOrgId
          ? { connect: { id: resolvedOrgId } }
          : undefined,
      },
    });

    revalidateTag("bookings");
    return NextResponse.json({ ok: true, booking: created }, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/bookings error:", err?.message || err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to create booking" },
      { status: 500 }
    );
  }
}
