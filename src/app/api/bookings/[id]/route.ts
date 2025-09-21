// src/app/api/bookings/[id]/route.ts
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import prisma from "../../../../lib/prisma";

type Params = { params: { id: string } };

const UPDATABLE_FIELDS = [
  "subject",
  "newsroomName",
  "expertName",
  "appearanceType",
  "startAt",
  "durationMins",
  "programName",
  "hostName",
  "talkingPoints",
] as const;

export async function PUT(req: Request, { params }: Params) {
  try {
    const id = params.id;
    const body = await req.json();

    // Build a safe update payload (whitelist keys & coerce types)
    const data: Record<string, any> = {};
    for (const key of UPDATABLE_FIELDS) {
      if (body[key] !== undefined) {
        if (key === "startAt") {
          const d = new Date(body.startAt);
          if (!isNaN(d.getTime())) data.startAt = d;
          continue;
        }
        data[key] = body[key];
      }
    }

    const updated = await prisma.booking.update({
      where: { id },
      data,
    });

    // 🔄 Make the bookings list fresh on next render
    revalidateTag("bookings");

    return NextResponse.json({ ok: true, booking: updated }, { status: 200 });
  } catch (err) {
    console.error("PUT /api/bookings/[id] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to update booking" },
      { status: 500 }
    );
  }
}
