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
  const email = session?.user?.email as string | undefined;

  const dbUser = email
    ? await prisma.user.findUnique({
        where: { email },
        select: { id: true, activeOrgId: true, name: true },
      })
    : null;

  const userId = dbUser?.id ?? null;
  const userName = (dbUser?.name as string | undefined) ?? undefined;
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
    userId,
    userName,
    activeOrgId,
    rolesByOrg,
    isSignedIn: !!userId,
  };
}

function firstProducerOrg(rolesByOrg: Map<string, Role>): string | null {
  for (const [orgId, role] of rolesByOrg) {
    if (role === "OWNER" || role === "PRODUCER") return orgId;
  }
  return null;
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

// ---------- GET ----------
export async function GET() {
  try {
    const { isSignedIn, userName, userId, activeOrgId, rolesByOrg } =
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

    // No org switcher anymore → derive staff org from membership when activeOrgId is null
    const staffOrgId = activeOrgId ?? firstProducerOrg(rolesByOrg);

    if (staffOrgId) {
      // Staff view → list by their org
      bookings = await prisma.booking.findMany({
        where: { orgId: staffOrgId },
        orderBy: [{ startAt: "asc" }],
      });
    } else {
      // Expert view → return bookings by FK or (legacy) by name using a small SQL
      const rows = await prisma.$queryRaw<Booking[]>`
        SELECT * FROM "Booking"
        WHERE ("expertUserId" = ${userId}::text)
           OR ("expertName" = ${userName ?? ""})
        ORDER BY "startAt" ASC
      `;
      bookings = rows as Booking[];
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

// ---------- POST ----------
export async function POST(req: Request) {
  try {
    const { isSignedIn, activeOrgId, rolesByOrg } = await getAuthContext();

    if (!isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Resolve org (staff-only create; no org switching)
    let resolvedOrgId: string | null =
      activeOrgId ?? firstProducerOrg(rolesByOrg);
    if (!resolvedOrgId) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({} as any));

    const subject = asTrimmed(body.subject);
    const newsroomName = asTrimmed(body.newsroomName);
    const expertUserIdInput = asTrimmed(body.expertUserId);
    const expertNameInput = asTrimmed(body.expertName ?? body.guestName);
    const appearanceType = coerceAppearance(body.appearanceType);
    const startAt = coerceISODate(body.startAt);
    const durationMins = coerceInt(body.durationMins);
    const locationName = asTrimmed(body.locationName);
    const locationUrl = asTrimmed(body.locationUrl ?? body.meetingLink);
    const programName = asTrimmed(body.programName);
    const hostName = asTrimmed(body.hostName);
    const talkingPoints = asTrimmed(body.talkingPoints);

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
    if (!expertUserIdInput && !expertNameInput)
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

    // Resolve expert (FK preferred, fallback by name)
    const expert =
      (expertUserIdInput
        ? await prisma.user.findUnique({ where: { id: expertUserIdInput } })
        : null) ??
      (expertNameInput
        ? await prisma.user.findFirst({ where: { name: expertNameInput } })
        : null);

    if (!expert) {
      return NextResponse.json(
        { ok: false, error: "Expert not found." },
        { status: 404 }
      );
    }

    // Exclusivity: PUBLIC allowed; EXCLUSIVE only if same org
    const expStatus = (expert.expertStatus ?? "PUBLIC") as
      | "PUBLIC"
      | "EXCLUSIVE";
    if (expStatus === "EXCLUSIVE" && expert.exclusiveOrgId !== resolvedOrgId) {
      return NextResponse.json(
        { ok: false, error: "Expert is exclusive to another organization." },
        { status: 403 }
      );
    }

    const expertNameFinal = expert.name ?? expertNameInput ?? "Expert";

    const created = await prisma.booking.create({
      data: {
        subject,
        newsroomName,
        expertName: expertNameFinal, // keep legacy label for now
        appearanceType,
        startAt,
        durationMins,
        locationName: locationName ?? "",
        locationUrl: locationUrl ?? "",
        programName: programName ?? "",
        hostName: hostName ?? "",
        talkingPoints: talkingPoints ?? "",
        organization: { connect: { id: resolvedOrgId } },
      },
    });

    // Update FK via raw to avoid Prisma type churn
    await prisma.$executeRawUnsafe(
      `UPDATE "Booking" SET "expertUserId" = $1 WHERE "id" = $2`,
      expert.id,
      created.id
    );

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
