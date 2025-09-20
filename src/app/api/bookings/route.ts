// src/app/api/bookings/route.ts
// GET  /api/bookings  -> list bookings (most recent first)
// POST /api/bookings  -> accept current form payload, map to Booking model, insert

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

/** Prisma singleton (safe for dev hot-reload) */
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;

/** Zod schema that matches the CURRENT client form payload */
const AppearanceType = z.enum(["ONLINE", "IN_PERSON"]);

const Common = z.object({
  guestName: z.string().min(2, "Guest name is required"),
  programName: z.string().trim().max(120).optional(),
  hostName: z.string().trim().max(120).optional(),
  talkingPoints: z.string().trim().max(2000).optional(),
});

const Online = z.object({
  appearanceType: z.literal(AppearanceType.Enum.ONLINE),
  meetingLink: z.string().url("Meeting link must be a valid URL"),
});

const InPerson = z.object({
  appearanceType: z.literal(AppearanceType.Enum.IN_PERSON),
  venueAddress: z.string().min(5, "Venue/address is required"),
});

const FormSchema = z.discriminatedUnion("appearanceType", [
  Common.merge(Online),
  Common.merge(InPerson),
]);
type FormInput = z.infer<typeof FormSchema>;

/** Helper: get the Default Organization's id (seed created it) */
async function getDefaultOrgId(): Promise<string | null> {
  const byName = await prisma.organization.findFirst({
    where: { name: "Default Organization" },
    select: { id: true },
  });
  if (byName) return byName.id;
  const any = await prisma.organization.findFirst({ select: { id: true } });
  return any?.id ?? null;
}

/** GET: list bookings */
export async function GET() {
  try {
    const items = await prisma.booking.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    console.error("GET /api/bookings failed:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch bookings" },
      { status: 500 }
    );
  }
}

/** POST: create booking (form payload -> DB shape) */
export async function POST(req: Request) {
  try {
    const json = (await req.json()) as unknown;

    const parsed = FormSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Validation error",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      );
    }

    const data = parsed.data as FormInput;

    // Map the CURRENT form fields to your Booking model (per schema.prisma)
    // Required by DB: subject, expertName, newsroomName, appearanceType, startAt, durationMins
    const now = new Date();
    const mapped = {
      appearanceType: data.appearanceType, // enum matches
      subject:
        ("programName" in data &&
          data.programName &&
          data.programName.trim()) ||
        `General Booking`,
      expertName: data.guestName,
      newsroomName: "Default Newsroom", // placeholder until newsroom selection exists
      startAt: now, // TODO: replace with real date/time from UI in a later slice
      durationMins: 30, // TODO: replace with user input later
      // Location mapping
      locationName:
        data.appearanceType === "IN_PERSON"
          ? data.venueAddress
          : "Online meeting",
      locationUrl: data.appearanceType === "ONLINE" ? data.meetingLink : null,
      // Optional org scope
      orgId: await getDefaultOrgId(),
      // NOTE: hostName/talkingPoints aren't in the DB model yet. We'll add columns later
      // if we want to persist them; for now they are ignored server-side.
    };

    const created = await prisma.booking.create({ data: mapped });
    return NextResponse.json({ ok: true, item: created }, { status: 201 });
  } catch (err: any) {
    // Surface the actual error in dev to speed up fixes
    if (process.env.NODE_ENV !== "production") {
      console.error("POST /api/bookings error:", err);
      return NextResponse.json(
        { ok: false, error: String(err?.message ?? err) },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { ok: false, error: "Failed to create booking" },
      { status: 500 }
    );
  }
}
