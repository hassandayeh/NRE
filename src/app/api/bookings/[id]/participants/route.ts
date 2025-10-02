// src/app/api/bookings/[id]/participants/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../../lib/viewer";
import { hasCan } from "../../../../../lib/access/permissions";
import { InviteStatus } from "@prisma/client";

// GET: list participants on a booking (requires participant:view)
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn || !viewer.userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      select: { id: true, orgId: true },
    });
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    const canView = await hasCan({
      userId: viewer.userId,
      orgId: booking.orgId,
      permission: "participant:view",
    });
    if (!canView) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const rows = await prisma.bookingParticipant.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        bookingId: true,
        userId: true,
        roleSlot: true,
        roleLabelSnapshot: true,
        inviteStatus: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, displayName: true } },
      },
    });

    const participants = rows.map((r) => ({
      id: r.id,
      bookingId: r.bookingId,
      userId: r.userId,
      displayName: r.user?.displayName ?? "Unknown",
      roleSlot: r.roleSlot,
      roleLabel: r.roleLabelSnapshot ?? `Role ${r.roleSlot}`,
      inviteStatus: r.inviteStatus,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return NextResponse.json({ ok: true, participants }, { status: 200 });
  } catch (err) {
    console.error("GET /api/bookings/[id]/participants error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load participants" },
      { status: 500 }
    );
  }
}

// POST: add a participant by userId and roleSlot (requires participant:add)
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn || !viewer.userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      select: { id: true, orgId: true },
    });
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    const canAdd = await hasCan({
      userId: viewer.userId,
      orgId: booking.orgId,
      permission: "participant:add",
    });
    if (!canAdd) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      userId?: string;
      roleSlot?: number;
    };
    const userId = typeof body.userId === "string" ? body.userId : "";
    const roleSlot = Number(body.roleSlot);

    if (
      !userId ||
      !Number.isInteger(roleSlot) ||
      roleSlot < 1 ||
      roleSlot > 10
    ) {
      return NextResponse.json(
        { ok: false, error: "userId and roleSlot (1..10) are required" },
        { status: 400 }
      );
    }

    // Snapshot current org role label for stable UI
    const orgRole = await prisma.orgRole.findUnique({
      where: { orgId_slot: { orgId: booking.orgId, slot: roleSlot } },
      select: { label: true },
    });

    const created = await prisma.bookingParticipant.create({
      data: {
        bookingId: booking.id,
        userId,
        roleSlot,
        roleLabelSnapshot: orgRole?.label ?? `Role ${roleSlot}`,
        inviteStatus: InviteStatus.PENDING,
        invitedByUserId: viewer.userId,
        invitedAt: new Date(),
      },
      select: {
        id: true,
        bookingId: true,
        userId: true,
        roleSlot: true,
        roleLabelSnapshot: true,
        inviteStatus: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, displayName: true } },
      },
    });

    return NextResponse.json(
      {
        ok: true,
        participant: {
          id: created.id,
          bookingId: created.bookingId,
          userId: created.userId,
          displayName: created.user?.displayName ?? "Unknown",
          roleSlot: created.roleSlot,
          roleLabel: created.roleLabelSnapshot ?? `Role ${created.roleSlot}`,
          inviteStatus: created.inviteStatus,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/bookings/[id]/participants error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to add participant" },
      { status: 500 }
    );
  }
}
