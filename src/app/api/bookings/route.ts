import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import prisma from "../../../lib/prisma";
import type { Booking } from "@prisma/client";

/**
 * Features (unchanged)
 * - Legacy create path kept as-is (UNIFIED, ONLINE/IN_PERSON, single expert).
 * - New path (behind BOOKING_GUESTS_V2=true):
 *   • Supports PHONE appearance and full per-guest payload (UNIFIED | PER_GUEST).
 *   • Persists guests into BookingGuest with sane fallbacks.
 *   • Mirrors first EXPERT guest to booking.expertUserId/expertName (back-compat).
 *   • Enforces expert exclusivity for any internal EXPERT guests.
 *
 * New in this patch:
 * - FEATURE_MULTI_HOSTS_WRITE=true → optionally persists BookingHost rows from body.hosts[].
 *   When false (default), hosts[] is ignored (legacy mirror still supported via host/hostUserId).
 */

type Appearance = "ONLINE" | "IN_PERSON" | "PHONE";
type AppearanceScope = "UNIFIED" | "PER_GUEST";
type AccessProvisioning = "SHARED" | "PER_GUEST";
type ParticipantKind = "EXPERT" | "REPORTER";

const TENANCY_ON = process.env.TENANCY_ENFORCED !== "false";
const GUESTS_V2_ON = process.env.BOOKING_GUESTS_V2 === "true";
const MULTI_HOSTS_WRITE_ON = process.env.FEATURE_MULTI_HOSTS_WRITE === "true";

/** ---------- Auth/tenancy helpers ---------- */
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

  const rolesByOrg = new Map<string, string>();
  for (const m of memberships) rolesByOrg.set(m.orgId, m.role as string);

  return { userId, userName, activeOrgId, rolesByOrg, isSignedIn: !!userId };
}

// Treat OWNER | ADMIN | PRODUCER | HOST as staff (HOST read-only but sees org list)
function firstStaffOrg(rolesByOrg: Map<string, string>): string | null {
  for (const [orgId, role] of rolesByOrg) {
    if (
      role === "OWNER" ||
      role === "ADMIN" ||
      role === "PRODUCER" ||
      role === "HOST"
    ) {
      return orgId;
    }
  }
  return null;
}

/** ---------- coercers ---------- */
function coerceAppearance(val: unknown): Appearance | null {
  if (typeof val !== "string") return null;
  const up = val.toUpperCase().replace("-", "_");
  return up === "ONLINE" || up === "IN_PERSON" || up === "PHONE"
    ? (up as Appearance)
    : null;
}
function coerceScope(val: unknown): AppearanceScope | null {
  if (typeof val !== "string") return null;
  const up = val.toUpperCase();
  return up === "UNIFIED" || up === "PER_GUEST"
    ? (up as AppearanceScope)
    : null;
}
function coerceProvisioning(val: unknown): AccessProvisioning | null {
  if (typeof val !== "string") return null;
  const up = val.toUpperCase();
  return up === "SHARED" || up === "PER_GUEST"
    ? (up as AccessProvisioning)
    : null;
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

/** ---------- GET (list) ---------- */
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

    // Staff view → list by their org (HOST included)
    const staffOrgId = activeOrgId ?? firstStaffOrg(rolesByOrg);
    if (staffOrgId) {
      bookings = await prisma.booking.findMany({
        where: { orgId: staffOrgId },
        orderBy: [{ startAt: "asc" }],
      });
    } else {
      // Expert view → bookings where user is expert or added as guest, or matches legacy name
      bookings = await prisma.booking.findMany({
        where: {
          OR: [
            { expertUserId: userId ?? undefined },
            { guests: { some: { userId: userId ?? undefined } } },
            { expertName: userName ?? "" }, // legacy fallback
          ],
        },
        orderBy: [{ startAt: "asc" }],
      });
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

/** ---------- POST (create) ---------- */
export async function POST(req: Request) {
  try {
    const { isSignedIn, activeOrgId, rolesByOrg } = await getAuthContext();
    if (!isSignedIn) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Staff-only create (OWNER/PRODUCER; HOST is view-only)
    const producerOrgId =
      activeOrgId ??
      (() => {
        for (const [orgId, role] of rolesByOrg) {
          if (role === "OWNER" || role === "PRODUCER") return orgId;
        }
        return null;
      })();

    if (!producerOrgId) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({} as any));

    // Core fields
    const subject = asTrimmed(body.subject);
    const newsroomName = asTrimmed(body.newsroomName);
    const startAt = coerceISODate(body.startAt);
    const durationMins = coerceInt(body.durationMins);
    const programName = asTrimmed(body.programName);
    const hostName = asTrimmed(body.hostName); // legacy text (kept)
    const hostUserIdInput = asTrimmed(body.hostUserId); // legacy FK/mirror
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

    // ---------- Path A: New payload (BOOKING_GUESTS_V2=true) ----------
    if (GUESTS_V2_ON) {
      const appearanceScope: AppearanceScope =
        coerceScope(body.appearanceScope) ?? "UNIFIED";
      const accessProvisioning: AccessProvisioning =
        coerceProvisioning(body.accessProvisioning) ?? "SHARED";

      // Booking-level defaults (used when UNIFIED and/or as fallbacks)
      const unifiedAppearanceType: Appearance | null =
        appearanceScope === "UNIFIED"
          ? coerceAppearance(body.appearanceType)
          : null;
      const locationUrl = asTrimmed(body.locationUrl);
      const locationName = asTrimmed(body.locationName);
      const locationAddress = asTrimmed(body.locationAddress);
      const dialInfo = asTrimmed(body.dialInfo);

      // Validate booking-level requirements
      if (appearanceScope === "UNIFIED") {
        if (!unifiedAppearanceType) {
          return NextResponse.json(
            { ok: false, error: "Choose an appearance type for UNIFIED." },
            { status: 400 }
          );
        }
        if (unifiedAppearanceType === "ONLINE" && !locationUrl) {
          return NextResponse.json(
            {
              ok: false,
              error: "UNIFIED+ONLINE requires a link (locationUrl).",
            },
            { status: 400 }
          );
        }
        if (
          unifiedAppearanceType === "IN_PERSON" &&
          !(locationName || locationAddress)
        ) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "UNIFIED+IN_PERSON requires locationName or locationAddress.",
            },
            { status: 400 }
          );
        }
        if (unifiedAppearanceType === "PHONE" && !dialInfo) {
          return NextResponse.json(
            { ok: false, error: "UNIFIED+PHONE requires dialInfo." },
            { status: 400 }
          );
        }
      } else {
        // PER_GUEST must have at least one guest
        if (!Array.isArray(body.guests) || body.guests.length === 0) {
          return NextResponse.json(
            {
              ok: false,
              error: "PER_GUEST requires a non-empty guests[] array.",
            },
            { status: 400 }
          );
        }
      }

      // Parse guests with coercion + defaults
      type GuestInput = {
        userId?: string;
        name?: string;
        kind?: ParticipantKind;
        appearanceType?: Appearance;
        joinUrl?: string;
        venueName?: string;
        venueAddress?: string;
        dialInfo?: string;
        order?: number;
      };

      const rawGuests: GuestInput[] = Array.isArray(body.guests)
        ? body.guests
        : [];
      const guests = rawGuests.map((g, idx) => {
        const gi = {
          userId: asTrimmed(g.userId),
          name: asTrimmed(g.name) || "Guest",
          kind:
            typeof g.kind === "string" &&
            (g.kind.toUpperCase() === "EXPERT" ||
              g.kind.toUpperCase() === "REPORTER")
              ? (g.kind.toUpperCase() as ParticipantKind)
              : "EXPERT",
          appearanceType:
            coerceAppearance(g.appearanceType) ?? unifiedAppearanceType ?? null,
          joinUrl: asTrimmed(g.joinUrl),
          venueName: asTrimmed(g.venueName),
          venueAddress: asTrimmed(g.venueAddress),
          dialInfo: asTrimmed(g.dialInfo),
          order: Number.isFinite(g.order as any) ? Number(g.order) : idx,
        };
        return gi;
      });

      // Determine primary EXPERT (for back-compat mirror to booking.expert*)
      const primaryExpert =
        guests.find((g) => g.kind === "EXPERT") ?? guests[0];
      if (!primaryExpert) {
        return NextResponse.json(
          { ok: false, error: "At least one guest is required." },
          { status: 400 }
        );
      }

      // Enforce exclusivity for any internal EXPERT users
      const expertUserIds = guests
        .filter((g) => g.kind === "EXPERT" && g.userId)
        .map((g) => g.userId!) as string[];
      if (expertUserIds.length > 0) {
        const expertUsers = await prisma.user.findMany({
          where: { id: { in: expertUserIds } },
          select: {
            id: true,
            name: true,
            expertVisStatus: true,
            exclusiveOrgId: true,
          },
        });
        for (const ex of expertUsers) {
          const vis = (ex as any).expertVisStatus ?? "PUBLIC";
          if (
            vis === "EXCLUSIVE" &&
            (ex as any).exclusiveOrgId !== producerOrgId
          ) {
            return NextResponse.json(
              {
                ok: false,
                error: `Expert "${
                  ex.name ?? ex.id
                }" is exclusive to another organization.`,
              },
              { status: 403 }
            );
          }
        }
      }

      // Build booking create data (unchanged fields)
      const bookingData = {
        subject,
        newsroomName,
        programName: programName ?? "",
        hostName: hostName ?? "",
        talkingPoints: talkingPoints ?? "",
        appearanceScope,
        accessProvisioning,
        appearanceType:
          appearanceScope === "UNIFIED" ? unifiedAppearanceType : null,
        locationUrl: locationUrl ?? "",
        locationName: locationName ?? "",
        locationAddress: locationAddress ?? "",
        dialInfo: dialInfo ?? "",
        startAt: startAt!,
        durationMins: durationMins!,
        organization: { connect: { id: producerOrgId } },
        expertName: (primaryExpert.name as string) ?? "Expert",
        ...(primaryExpert.userId
          ? { expert: { connect: { id: primaryExpert.userId } } }
          : {}),
        ...(hostUserIdInput
          ? { host: { connect: { id: hostUserIdInput } } }
          : {}),
      };

      // Transaction: create booking, then guests (and hosts[] if flag ON)
      const created = await prisma.$transaction(async (tx) => {
        const b = await tx.booking.create({ data: bookingData });

        if (guests.length > 0) {
          // Compute per-guest fallbacks from booking-level defaults
          const defaults = {
            type: bookingData.appearanceType ?? null,
            onlineUrl: bookingData.locationUrl || null,
            venueName: bookingData.locationName || null,
            venueAddress: bookingData.locationAddress || null,
            dialInfo: bookingData.dialInfo || null,
          };
          await tx.bookingGuest.createMany({
            data: guests.map((g, idx) => {
              const type = g.appearanceType ?? defaults.type ?? "ONLINE";
              return {
                bookingId: b.id,
                userId: g.userId ?? null,
                name: g.name!,
                kind: g.kind!,
                order: Number.isFinite(g.order as any)
                  ? (g.order as number)
                  : idx,
                appearanceType: type as any,
                joinUrl:
                  type === "ONLINE" ? g.joinUrl || defaults.onlineUrl : null,
                venueName:
                  type === "IN_PERSON"
                    ? g.venueName || defaults.venueName
                    : null,
                venueAddress:
                  type === "IN_PERSON"
                    ? g.venueAddress || defaults.venueAddress
                    : null,
                dialInfo:
                  type === "PHONE" ? g.dialInfo || defaults.dialInfo : null,
              };
            }),
          });
        }

        // ✅ NEW: persist hosts[] only when the feature flag is ON
        if (
          MULTI_HOSTS_WRITE_ON &&
          Array.isArray(body.hosts) &&
          body.hosts.length > 0
        ) {
          await tx.bookingHost.createMany({
            data: body.hosts.map((h: any, i: number) => ({
              bookingId: b.id,
              userId: h?.userId ? String(h.userId) : null,
              name: h?.name ? String(h.name) : "Host",
              order: Number.isFinite(h?.order) ? Number(h.order) : i,
              appearanceType: coerceAppearance(h?.appearanceType) ?? "ONLINE",
              joinUrl: asTrimmed(h?.joinUrl) ?? null,
              venueName: asTrimmed(h?.venueName) ?? null,
              venueAddress: asTrimmed(h?.venueAddress) ?? null,
              dialInfo: asTrimmed(h?.dialInfo) ?? null,
            })),
          });
        }

        return b;
      });

      revalidateTag("bookings");
      return NextResponse.json({ ok: true, booking: created }, { status: 201 });
    }

    // ---------- Path B: Legacy payload (unchanged) ----------
    const expertUserIdInput = asTrimmed(body.expertUserId);
    const expertNameInput = asTrimmed(body.expertName ?? body.guestName);
    const appearanceType = coerceAppearance(body.appearanceType);
    const locationName = asTrimmed(body.locationName);
    const locationUrl = asTrimmed(body.locationUrl ?? body.meetingLink);

    if (!expertUserIdInput && !expertNameInput)
      return NextResponse.json(
        { ok: false, error: "Guest name (expert) is required." },
        { status: 400 }
      );
    if (!appearanceType || appearanceType === "PHONE")
      return NextResponse.json(
        { ok: false, error: "Appearance must be ONLINE or IN_PERSON." },
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

    // Exclusivity guard
    const expStatusRaw =
      (expert as any).expertVisStatus ??
      (expert as any).expertStatus ??
      "PUBLIC";
    const expStatus = expStatusRaw as "PUBLIC" | "EXCLUSIVE";
    if (
      expStatus === "EXCLUSIVE" &&
      (expert as any).exclusiveOrgId !== producerOrgId
    ) {
      return NextResponse.json(
        { ok: false, error: "Expert is exclusive to another organization." },
        { status: 403 }
      );
    }

    const created = await prisma.booking.create({
      data: {
        subject,
        newsroomName,
        expertName: (expert as any).name ?? expertNameInput ?? "Expert",
        appearanceScope: "UNIFIED",
        appearanceType,
        startAt,
        durationMins,
        locationName: locationName ?? "",
        locationUrl: locationUrl ?? "",
        programName: programName ?? "",
        hostName: hostName ?? "",
        talkingPoints: talkingPoints ?? "",
        organization: { connect: { id: producerOrgId } },
        expert: { connect: { id: (expert as any).id } },
        ...(hostUserIdInput
          ? { host: { connect: { id: hostUserIdInput } } }
          : {}),
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
