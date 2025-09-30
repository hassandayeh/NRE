// src/app/api/bookings/[id]/participants/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma";
import {
  resolveViewerFromRequest,
  canEditBooking,
} from "../../../../../lib/viewer";
import { Prisma, BookingParticipantRole, InviteStatus } from "@prisma/client";

const MULTI_PARTICIPANTS_ENABLED =
  (process.env.MULTI_PARTICIPANTS_ENABLED ?? "true") !== "false";

/* ----------------------------- helpers ------------------------------ */
function upcaseString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.toUpperCase();
}
function coerceRoleEnum(v: unknown): BookingParticipantRole | null {
  const s = upcaseString(v);
  if (!s) return null;
  const vals = Object.values(BookingParticipantRole) as string[];
  return vals.includes(s) ? (s as BookingParticipantRole) : null;
}
// STRICT string version (no union) to satisfy includes()
function coerceStatusEnum(v: unknown): InviteStatus | null {
  const raw = upcaseString(v);
  if (!raw) return null;
  const s = raw === "CANCELED" ? "CANCELLED" : raw; // prisma uses CANCELLED
  const vals = Object.values(InviteStatus) as string[];
  return vals.includes(s) ? (s as InviteStatus) : null;
}
function asTrimmedOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}
function ensureEnabled() {
  if (!MULTI_PARTICIPANTS_ENABLED) {
    throw Object.assign(new Error("Participants API is disabled"), {
      status: 404,
    });
  }
}
async function canViewerRead(viewer: any, bookingId: string, orgId: string) {
  if (canEditBooking(viewer, orgId)) return true;
  if (viewer?.userId) {
    const exists = await prisma.bookingParticipant.findFirst({
      where: { bookingId, userId: viewer.userId },
      select: { id: true },
    });
    if (exists) return true;
  }
  return false;
}
function mapParticipant(p: any) {
  return {
    id: p.id,
    role: p.role as string,
    inviteStatus: (p.inviteStatus as InviteStatus | null) ?? null,
    isPrimaryHost: !!p.isPrimaryHost,
    notes: p.notes ?? null,
    invitedAt: p.invitedAt ?? null,
    respondedAt: p.respondedAt ?? null,
    createdAt: p.createdAt ?? null,
    updatedAt: p.updatedAt ?? null,
    userId: p.userId ?? null,
    user: p.user
      ? {
          id: p.user.id,
          displayName: p.user.displayName,
          name: p.user.name,
          email: p.user.email,
          avatarUrl: p.user.avatarUrl,
        }
      : null,
  };
}
function groupDynamically(rows: Array<{ role: string } & any>) {
  const grouped: Record<string, any[]> = {};
  for (const r of rows) {
    const key = r.role || "UNKNOWN";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }
  return grouped;
}

/* ------------------------------- GET -------------------------------- */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    ensureEnabled();

    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn) {
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

    // orgId is non-null in schema; assert to satisfy TS
    const canRead = await canViewerRead(
      viewer,
      booking.id,
      booking.orgId as string
    );
    if (!canRead) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    const rows = await prisma.bookingParticipant.findMany({
      where: { bookingId: booking.id },
      orderBy: [
        { role: "asc" },
        { isPrimaryHost: "desc" },
        { createdAt: "asc" },
      ],
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    const participants = rows.map(mapParticipant);
    const grouped = groupDynamically(participants);
    const roles = Object.keys(grouped);

    return NextResponse.json({ ok: true, participants, grouped, roles });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    console.error("GET /participants failed:", e);
    return NextResponse.json(
      { ok: false, error: status === 404 ? "Not found" : "Server error" },
      { status }
    );
  }
}

/* ------------------------------- POST ------------------------------- */
type AddInput = {
  userId?: string | null;
  name?: string | null;
  role: BookingParticipantRole;
  inviteStatus?: InviteStatus | null;
  isPrimaryHost?: boolean;
  notes?: string | null;
};
type UpdateInput = {
  id: string;
  inviteStatus?: InviteStatus | null;
  isPrimaryHost?: boolean;
  notes?: string | null;
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    ensureEnabled();

    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn) {
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

    if (!canEditBooking(viewer, booking.orgId as string)) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      add?: any[];
      update?: any[];
      removeIds?: string[];
    };

    const adds: AddInput[] = Array.isArray(body.add)
      ? body.add
          .map((r) => ({
            role: coerceRoleEnum(r?.role) as BookingParticipantRole,
            userId: asTrimmedOrNull(r?.userId),
            name: asTrimmedOrNull(r?.name),
            inviteStatus: coerceStatusEnum(r?.inviteStatus),
            isPrimaryHost: !!r?.isPrimaryHost,
            notes: asTrimmedOrNull(r?.notes),
          }))
          .filter((r) => !!r.role)
      : [];

    const updates: UpdateInput[] = Array.isArray(body.update)
      ? body.update
          .map((r) => ({
            id: String(r?.id || ""),
            inviteStatus: coerceStatusEnum(r?.inviteStatus) ?? undefined,
            isPrimaryHost:
              typeof r?.isPrimaryHost === "boolean"
                ? r.isPrimaryHost
                : undefined,
            notes: asTrimmedOrNull(r?.notes),
          }))
          .filter((r) => r.id)
      : [];

    const removeIds: string[] = Array.isArray(body.removeIds)
      ? body.removeIds.map((x) => String(x)).filter(Boolean)
      : [];

    const now = new Date();

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (removeIds.length > 0) {
        await tx.bookingParticipant.deleteMany({
          where: { bookingId: booking.id, id: { in: removeIds } },
        });
      }

      if (adds.length > 0) {
        await tx.bookingParticipant.createMany({
          data: adds.map((a) => ({
            bookingId: booking.id,
            role: a.role,
            userId: a.userId ?? null,
            name: a.name ?? "",
            inviteStatus: a.inviteStatus ?? InviteStatus.PENDING,
            isPrimaryHost: !!a.isPrimaryHost,
            notes: a.notes ?? undefined,
            invitedAt: now,
          })),
        });
      }

      for (const u of updates) {
        const before = await tx.bookingParticipant.findFirst({
          where: { id: u.id, bookingId: booking.id },
          select: { inviteStatus: true },
        });
        if (!before) continue;

        await tx.bookingParticipant.update({
          where: { id: u.id },
          data: {
            ...(u.inviteStatus
              ? { inviteStatus: { set: u.inviteStatus } }
              : {}),
            isPrimaryHost:
              typeof u.isPrimaryHost === "boolean"
                ? u.isPrimaryHost
                : undefined,
            notes: u.notes ?? undefined,
            ...(u.inviteStatus &&
            (u.inviteStatus === InviteStatus.ACCEPTED ||
              u.inviteStatus === InviteStatus.DECLINED ||
              u.inviteStatus === InviteStatus.CANCELLED)
              ? { respondedAt: now }
              : {}),
          },
        });
      }
    });

    const rows = await prisma.bookingParticipant.findMany({
      where: { bookingId: booking.id },
      orderBy: [
        { role: "asc" },
        { isPrimaryHost: "desc" },
        { createdAt: "asc" },
      ],
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    const participants = rows.map(mapParticipant);
    const grouped = groupDynamically(participants);
    const roles = Object.keys(grouped);

    return NextResponse.json({ ok: true, participants, grouped, roles });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const code = e?.code || "";

    if (e?.status === 404) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }
    if (code === "P2003") {
      return NextResponse.json(
        { ok: false, error: "Invalid user reference." },
        { status: 400 }
      );
    }
    if (code === "P2002") {
      return NextResponse.json(
        { ok: false, error: "Duplicate participant for this role." },
        { status: 400 }
      );
    }

    console.error("POST /participants failed:", e);
    return NextResponse.json(
      { ok: false, error: msg || "Server error" },
      { status: 500 }
    );
  }
}
