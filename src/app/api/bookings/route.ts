import { NextResponse } from "next/server";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ----- Validation -----
const AppearanceType = z.enum(["ONLINE", "IN_PERSON"]);

const baseSchema = z.object({
  subject: z.string().trim().min(2).max(300),
  newsroomName: z.string().trim().min(2).max(200),
  // Accept either expertName OR guestName (legacy); we'll normalize below.
  expertName: z.string().trim().min(2).max(200).optional(),
  guestName: z.string().trim().min(2).max(200).optional(),
  startAt: z.preprocess((v) => {
    if (typeof v === "string") return new Date(v);
    if (v instanceof Date) return v;
    return v;
  }, z.date()),
  durationMins: z.number().int().min(5).max(600),
  // Optional (may not exist in schema yet; accepted but not persisted)
  programName: z.string().trim().max(120).optional(),
  hostName: z.string().trim().max(120).optional(),
  talkingPoints: z.string().trim().max(2000).optional(),
});

const onlineSchema = baseSchema.extend({
  appearanceType: z.literal(AppearanceType.Enum.ONLINE),
  meetingLink: z.string().url(), // accepted, not persisted (schema missing)
});

const inPersonSchema = baseSchema.extend({
  appearanceType: z.literal(AppearanceType.Enum.IN_PERSON),
  venueAddress: z.string().min(5), // accepted, not persisted (schema missing)
});

const createSchema = z.discriminatedUnion("appearanceType", [
  onlineSchema,
  inPersonSchema,
]);

// ----- GET /api/bookings -----
export async function GET() {
  try {
    const bookings = await prisma.booking.findMany({
      orderBy: { startAt: "desc" },
      select: {
        id: true,
        subject: true,
        newsroomName: true,
        expertName: true,
        appearanceType: true,
        startAt: true,
        durationMins: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ bookings });
  } catch (err) {
    console.error("GET /api/bookings error:", err);
    return NextResponse.json(
      { error: "Failed to load bookings" },
      { status: 500 }
    );
  }
}

// ----- POST /api/bookings -----
export async function POST(req: Request) {
  try {
    const json = await req.json();

    // Normalize legacy -> new before validation (so errors are cleaner)
    if (!json.expertName && json.guestName) {
      json.expertName = json.guestName;
    }

    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue.path.join(".");
      return NextResponse.json(
        { error: `${path || "payload"}: ${issue.message}` },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Persist only fields known to exist in your current schema
    const created = await prisma.booking.create({
      data: {
        subject: data.subject,
        newsroomName: data.newsroomName,
        expertName: data.expertName!, // guaranteed after normalization
        appearanceType: data.appearanceType,
        startAt: data.startAt,
        durationMins: data.durationMins,
        // NOTE: meetingLink / venueAddress / programName / hostName / talkingPoints
        // are accepted by the API but intentionally NOT persisted until the
        // schema migration adds these columns.
      },
      select: {
        id: true,
        subject: true,
        newsroomName: true,
        expertName: true,
        appearanceType: true,
        startAt: true,
        durationMins: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, booking: created }, { status: 201 });
  } catch (err) {
    console.error("POST /api/bookings error:", err);
    return NextResponse.json(
      { error: "Failed to create booking" },
      { status: 500 }
    );
  }
}
