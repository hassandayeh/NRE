// src/app/api/bookings/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, AppearanceType } from "@prisma/client";

// Prisma singleton for Next.js dev HMR
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const errors: string[] = [];

    // ---- coerce + validate required fields ----
    const subjectRaw = coerceString(body.subject);
    const newsroomNameRaw = coerceString(body.newsroomName);

    // Support either expertName or guestName (your current UI uses guestName)
    const expertNameRaw =
      coerceString(body.expertName) ?? coerceString(body.guestName);

    const appearanceTypeRaw = coerceString(body.appearanceType);
    const startAtRaw = body.startAt;
    const durationMinsRaw = coerceNumber(body.durationMins);

    if (!subjectRaw) errors.push("subject is required");
    if (!newsroomNameRaw) errors.push("newsroomName is required");
    if (!expertNameRaw) errors.push("expertName (or guestName) is required");

    let appearanceType: AppearanceType | null = null;
    if (appearanceTypeRaw) {
      const upper = appearanceTypeRaw.toUpperCase();
      if (upper === "IN_PERSON" || upper === "ONLINE") {
        appearanceType = upper as AppearanceType;
      } else {
        errors.push('appearanceType must be "IN_PERSON" or "ONLINE"');
      }
    } else {
      errors.push("appearanceType is required");
    }

    const startAt = new Date(startAtRaw);
    if (!isFinite(startAt.getTime())) {
      errors.push("startAt must be a valid ISO date string");
    }

    const duration = Number(durationMinsRaw);
    if (!Number.isFinite(duration) || duration <= 0) {
      errors.push("durationMins must be a positive number");
    }

    if (errors.length) {
      return NextResponse.json({ ok: false, errors }, { status: 400 });
    }

    // At this point types are safe; assign to narrowed (non-null) vars
    const subject = subjectRaw as string;
    const newsroomName = newsroomNameRaw as string;
    const expertName = expertNameRaw as string;
    const apType = appearanceType as AppearanceType;
    const durationMins = Math.trunc(duration);

    // ---- optional fields ----
    const orgId = coerceString(body.orgId) || null;

    // Accept either the new names or your current UI names
    // - ONLINE: meetingLink -> locationUrl
    // - IN_PERSON: venueAddress -> locationName
    const locationNameExplicit = coerceString(body.locationName);
    const locationUrlExplicit = coerceString(body.locationUrl);
    const meetingLink = coerceString(body.meetingLink);
    const venueAddress = coerceString(body.venueAddress);

    const locationName =
      locationNameExplicit ??
      (apType === "IN_PERSON" ? venueAddress ?? null : null);

    const locationUrl =
      locationUrlExplicit ?? (apType === "ONLINE" ? meetingLink ?? null : null);

    // NEW optional extras (nullable in schema)
    const programName = coerceString(body.programName) || null;
    const hostName = coerceString(body.hostName) || null;
    const talkingPoints = coerceString(body.talkingPoints) || null;

    const booking = await prisma.booking.create({
      data: {
        subject,
        expertName,
        newsroomName,
        appearanceType: apType,
        startAt,
        durationMins,
        locationName,
        locationUrl,
        orgId,
        programName,
        hostName,
        talkingPoints,
        // status left for model default (PENDING)
      },
    });

    return NextResponse.json({ ok: true, booking }, { status: 201 });
  } catch (err: any) {
    const message =
      typeof err?.message === "string" ? err.message : "Unknown server error";
    return NextResponse.json(
      { ok: false, errors: ["Failed to create booking", message] },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const bookings = await prisma.booking.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ ok: true, bookings });
  } catch (err: any) {
    const message =
      typeof err?.message === "string" ? err.message : "Unknown server error";
    return NextResponse.json(
      { ok: false, errors: ["Failed to fetch bookings", message] },
      { status: 500 }
    );
  }
}

/* ----------------- helpers ----------------- */
function coerceString(v: unknown): string | null {
  if (typeof v === "string") return v.trim();
  if (v == null) return null;
  return String(v).trim();
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}
