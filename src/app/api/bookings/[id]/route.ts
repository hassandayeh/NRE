// src/app/api/bookings/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { PrismaClient, AppearanceType } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";

// Prisma singleton (like elsewhere)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ---- Validation schema (all fields optional; we only update provided ones)
const EditSchema = z
  .object({
    subject: z
      .string()
      .trim()
      .min(2, "Subject too short")
      .max(300, "Subject too long")
      .optional(),
    // time
    startAt: z
      .preprocess((v) => {
        if (typeof v === "string") return new Date(v);
        if (v instanceof Date) return v;
        return v;
      }, z.date({ invalid_type_error: "Invalid date" }))
      .optional(),
    durationMins: z
      .number()
      .int("Duration must be whole minutes")
      .min(5)
      .max(600)
      .optional(),

    // appearance & location
    appearanceType: z.nativeEnum(AppearanceType).optional(), // "ONLINE" | "IN_PERSON"
    locationName: z.string().trim().max(300).optional().nullable(),
    locationUrl: z
      .string()
      .trim()
      .url("locationUrl must be a valid URL")
      .max(2048)
      .optional()
      .nullable(),

    // extras (optional)
    programName: z.string().trim().max(200).optional().nullable(),
    hostName: z.string().trim().max(200).optional().nullable(),
    talkingPoints: z.string().trim().max(10000).optional().nullable(),
  })
  .refine(
    (data) =>
      Object.keys(data).length > 0 &&
      Object.values(data).some((v) => v !== undefined),
    { message: "No changes provided" }
  );

// ---- PATCH /api/bookings/:id
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  // Auth required
  const session = await getServerSession(authOptions);
  if (!session || !session.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bookingId = params.id;
  if (!bookingId || typeof bookingId !== "string") {
    return NextResponse.json({ error: "Invalid booking id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = EditSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "Validation error" },
      { status: 400 }
    );
  }

  // Build data object with only provided keys
  const data: any = {};
  const v = parsed.data;

  if (v.subject !== undefined) data.subject = v.subject;
  if (v.startAt !== undefined) data.startAt = v.startAt;
  if (v.durationMins !== undefined) data.durationMins = v.durationMins;

  if (v.appearanceType !== undefined) data.appearanceType = v.appearanceType;
  if (v.locationName !== undefined) data.locationName = v.locationName;
  if (v.locationUrl !== undefined) data.locationUrl = v.locationUrl;

  if (v.programName !== undefined) data.programName = v.programName;
  if (v.hostName !== undefined) data.hostName = v.hostName;
  if (v.talkingPoints !== undefined) data.talkingPoints = v.talkingPoints;

  try {
    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data,
    });

    return NextResponse.json({ booking: updated }, { status: 200 });
  } catch (e: any) {
    // Not found or other DB error
    const message =
      e?.code === "P2025" ? "Booking not found" : "Failed to update booking";
    const status = e?.code === "P2025" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
