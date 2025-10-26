// src/app/api/bookings/[id]/participants/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../../lib/viewer";
import { hasCan } from "../../../../../lib/access/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Item = {
  id: string;
  userId: string | null;
  displayName: string | null;
  roleSlot: number | null;
  roleLabel: string | null;
  inviteStatus: string | null;
  invitedAt: string | null;
  respondedAt: string | null;
};

type Ok = { ok: true; items: Item[] } & {
  participants?: Item[];
  roles?: string[];
  grouped?: Record<string, Item[]>;
};
type Err = { ok: false; error: string };

function json(status: number, body: Ok | Err | Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

/* ---------------------------------- utils ---------------------------------- */

// Return type guarantees a string userId so TS stops complaining downstream.
async function requireViewer(req: NextRequest): Promise<{ userId: string }> {
  const viewer = await resolveViewerFromRequest(req);
  if (!viewer?.isSignedIn || !viewer.userId) {
    throw { status: 401, message: "Unauthorized" };
  }
  return { userId: String(viewer.userId) };
}

async function requireBookingAndPerms(
  bookingId: string,
  userId: string,
  perm: "booking:view" | "booking:update"
) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, orgId: true },
  });
  if (!booking) throw { status: 404, message: "Not found" };

  const allowed = await hasCan({
    userId,
    orgId: booking.orgId,
    permission: perm,
  });
  if (!allowed) throw { status: 403, message: "Forbidden" };

  return booking;
}

function mapRoleToSlotAndLabel(input: string | number | null | undefined) {
  if (typeof input === "number" && Number.isFinite(input)) {
    const n = Math.trunc(input);
    return {
      roleSlot: n,
      roleLabelSnapshot:
        n === 1
          ? "Host"
          : n === 2
          ? "Producer"
          : n === 3
          ? "Expert"
          : `Role ${n}`,
    };
  }
  const s = String(input ?? "").toUpperCase();
  if (s === "HOST") return { roleSlot: 1, roleLabelSnapshot: "Host" };
  if (s === "REPORTER") return { roleSlot: 2, roleLabelSnapshot: "Producer" };
  if (s === "EXPERT") return { roleSlot: 3, roleLabelSnapshot: "Expert" };
  return { roleSlot: 3, roleLabelSnapshot: "Expert" };
}

function normStatus(v: unknown): { status: string | null; responded: boolean } {
  if (!v) return { status: null, responded: false };
  const s = String(v).toUpperCase();
  if (s === "CANCELLED") return { status: "CANCELED", responded: true };
  if (s === "CANCELED") return { status: "CANCELED", responded: true };
  if (s === "ACCEPTED") return { status: "ACCEPTED", responded: true };
  if (s === "DECLINED") return { status: "DECLINED", responded: true };
  if (s === "PENDING") return { status: "PENDING", responded: false };
  if (s === "CONFIRMED") return { status: "ACCEPTED", responded: true };
  return { status: null, responded: false };
}

async function fetchParticipantsRows(bookingId: string) {
  try {
    const viaBooking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        participants: {
          select: {
            id: true,
            userId: true,
            roleSlot: true,
            roleLabelSnapshot: true,
            inviteStatus: true,
            invitedAt: true,
            respondedAt: true,
          },
          orderBy: [{ roleSlot: "asc" }, { id: "asc" }],
        },
      },
    });
    return viaBooking?.participants ?? [];
  } catch {
    return await prisma.bookingParticipant.findMany({
      where: { bookingId },
      select: {
        id: true,
        userId: true,
        roleSlot: true,
        roleLabelSnapshot: true,
        inviteStatus: true,
        invitedAt: true,
        respondedAt: true,
      },
      orderBy: [{ roleSlot: "asc" }, { id: "asc" }],
    });
  }
}

async function enrich(
  rows: Awaited<ReturnType<typeof fetchParticipantsRows>>
): Promise<Item[]> {
  const ids = Array.from(
    new Set(rows.map((r) => r.userId).filter(Boolean) as string[])
  );
  let userMap = new Map<
    string,
    { displayName?: string | null; email?: string | null }
  >();
  if (ids.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, email: true },
    });
    userMap = new Map(
      users.map((u) => [u.id, { displayName: u.displayName, email: u.email }])
    );
  }
  return rows.map((r) => {
    const u = r.userId ? userMap.get(r.userId) : undefined;
    const label =
      (u?.displayName && u.displayName.trim()) ||
      (u?.email && u.email.trim()) ||
      null;
    return {
      id: r.id,
      userId: r.userId,
      displayName: label,
      roleSlot: r.roleSlot ?? null,
      roleLabel: r.roleLabelSnapshot ?? null,
      inviteStatus: (r.inviteStatus as any) ?? null,
      invitedAt: r.invitedAt ? r.invitedAt.toISOString() : null,
      respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
    };
  });
}

function deriveRoleLabel(it: Item) {
  return (
    (it.roleLabel && it.roleLabel.trim()) ||
    (typeof it.roleSlot === "number" ? `Role ${it.roleSlot}` : "Role")
  );
}

/* ------------------------------------ GET ----------------------------------- */

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await requireViewer(req);
    await requireBookingAndPerms(params.id, userId, "booking:view");

    const rows = await fetchParticipantsRows(params.id);
    const items = await enrich(rows);

    const grouped = items.reduce<Record<string, Item[]>>((acc, it) => {
      const key = deriveRoleLabel(it);
      (acc[key] ||= []).push(it);
      return acc;
    }, {});
    const roles = Object.keys(grouped);

    return json(200, { ok: true, items, participants: items, roles, grouped });
  } catch (e: any) {
    const status = e?.status ?? 500;
    const message = e?.message ?? "Failed to load participants";
    if (status >= 500) console.error("GET /participants error:", e);
    return json(status, { ok: false, error: message });
  }
}

/* ----------------------------------- POST ----------------------------------- */

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await requireViewer(req);
    await requireBookingAndPerms(params.id, userId, "booking:update");

    const body = (await req.json().catch(() => ({}))) as Partial<{
      participants: Array<{
        userId?: string | null;
        roleInBooking?: string | null;
        roleSlot?: number | null;
      }>;
    }>;
    const input = Array.isArray(body.participants) ? body.participants : [];
    if (!input.length)
      return json(400, { ok: false, error: "No participants provided" });

    const candidateIds = Array.from(
      new Set(
        input
          .map((p) => (typeof p.userId === "string" ? p.userId.trim() : ""))
          .filter(Boolean)
      )
    );
    const existingUsers = candidateIds.length
      ? await prisma.user.findMany({
          where: { id: { in: candidateIds } },
          select: { id: true },
        })
      : [];
    const validUserIds = new Set(existingUsers.map((u) => u.id));

    const now = new Date();
    const rows = input.map((p) => {
      const { roleSlot, roleLabelSnapshot } = mapRoleToSlotAndLabel(
        p.roleSlot ?? p.roleInBooking
      );
      const proposedId = typeof p.userId === "string" ? p.userId.trim() : null;
      return {
        bookingId: params.id,
        userId: proposedId && validUserIds.has(proposedId) ? proposedId : null,
        roleSlot,
        roleLabelSnapshot,
        inviteStatus: "PENDING" as const,
        invitedByUserId: userId,
        invitedAt: now,
      };
    });

    const result = await prisma.bookingParticipant.createMany({
      data: rows,
      skipDuplicates: true,
    });

    return json(200, { ok: true, added: result.count });
  } catch (e: any) {
    const status = e?.status ?? 500;
    const message = e?.message ?? "Failed to add participants";
    if (status >= 500) console.error("POST /participants error:", e);
    return json(status, { ok: false, error: message });
  }
}

/* ---------------------------------- PATCH ----------------------------------- */

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await requireViewer(req);
    await requireBookingAndPerms(params.id, userId, "booking:update");

    const url = new URL(req.url);
    const idFromQuery = url.searchParams.get("id"); // string | null

    const rawBody = (await req.json().catch(() => ({}))) as
      | { id?: unknown; inviteStatus?: unknown }
      | { participant?: { id?: unknown; inviteStatus?: unknown } }
      | { participants?: Array<{ id?: unknown; inviteStatus?: unknown }> }
      | Record<string, unknown>;

    // Safely derive a definite string id
    let id: string | null = null;
    if (typeof idFromQuery === "string" && idFromQuery) id = idFromQuery;
    else if (typeof (rawBody as any).id === "string" && (rawBody as any).id)
      id = (rawBody as any).id;
    else if (
      rawBody &&
      typeof (rawBody as any).participant?.id === "string" &&
      (rawBody as any).participant.id
    )
      id = (rawBody as any).participant.id;
    else if (
      Array.isArray((rawBody as any).participants) &&
      typeof (rawBody as any).participants[0]?.id === "string" &&
      (rawBody as any).participants[0].id
    )
      id = (rawBody as any).participants[0].id;

    const statusInput =
      (rawBody as any).inviteStatus ??
      (rawBody as any).participant?.inviteStatus ??
      (Array.isArray((rawBody as any).participants) &&
        (rawBody as any).participants[0]?.inviteStatus);

    if (!id) return json(400, { ok: false, error: "id is required" });
    const pid: string = id; // now definitely string

    const participant = await prisma.bookingParticipant.findUnique({
      where: { id: pid },
      select: { id: true, bookingId: true },
    });
    if (!participant || participant.bookingId !== params.id) {
      return json(404, { ok: false, error: "Not found" });
    }

    const { status, responded } = normStatus(statusInput);
    if (!status) return json(400, { ok: false, error: "invalid inviteStatus" });

    const updated = await prisma.bookingParticipant.update({
      where: { id: pid },
      data: {
        inviteStatus: status as any,
        respondedAt: responded ? new Date() : null,
      },
      select: {
        id: true,
        userId: true,
        roleSlot: true,
        roleLabelSnapshot: true,
        inviteStatus: true,
        invitedAt: true,
        respondedAt: true,
      },
    });

    return json(200, { ok: true, participant: updated });
  } catch (e: any) {
    const status = e?.status ?? 500;
    const message = e?.message ?? "Failed to update participant";
    if (status >= 500) console.error("PATCH /participants error:", e);
    return json(status, { ok: false, error: message });
  }
}

/* --------------------------------- DELETE ---------------------------------- */

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId } = await requireViewer(req);
    await requireBookingAndPerms(params.id, userId, "booking:update");

    const url = new URL(req.url);
    const idFromQuery = url.searchParams.get("id"); // string | null
    const body = (await req.json().catch(() => ({}))) as Partial<{
      id?: unknown;
    }>;

    // Safely derive a definite string id
    let id: string | null = null;
    if (typeof idFromQuery === "string" && idFromQuery) id = idFromQuery;
    else if (typeof body.id === "string" && body.id) id = body.id;

    if (!id) return json(400, { ok: false, error: "id is required" });
    const pid: string = id;

    const participant = await prisma.bookingParticipant.findUnique({
      where: { id: pid },
      select: { id: true, bookingId: true },
    });
    if (!participant || participant.bookingId !== params.id) {
      return json(404, { ok: false, error: "Not found" });
    }

    await prisma.bookingParticipant.delete({ where: { id: pid } });
    return json(200, { ok: true });
  } catch (e: any) {
    const status = e?.status ?? 500;
    const message = e?.message ?? "Failed to delete participant";
    if (status >= 500) console.error("DELETE /participants error:", e);
    return json(status, { ok: false, error: message });
  }
}
