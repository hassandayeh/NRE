// src/lib/viewer.ts
// Server-only viewer resolution & simple auth helpers shared by pages and route handlers.

import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import prisma from "./prisma";
import { authOptions } from "./auth";

export type ViewerRole = "OWNER" | "ADMIN" | "PRODUCER" | "EXPERT";
export type Membership = { orgId: string; role: ViewerRole };

export type Viewer = {
  isSignedIn: boolean;
  userId: string | null;
  email: string | null;
  name: string | null;
  activeOrgId: string | null;
  memberships: Membership[];
  staffOrgIds: string[];
};

/** Feature flag: tenancy enforced unless set to the string "false". */
export const TENANCY_ON = process.env.TENANCY_ENFORCED !== "false";

// ---------- internals ----------
async function fetchMemberships(userId: string): Promise<Membership[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: { userId },
    select: { orgId: true, role: true },
  });
  return rows.map((r) => ({ orgId: r.orgId, role: r.role as ViewerRole }));
}

function computeStaffOrgIds(memberships: Membership[]): string[] {
  return memberships
    .filter(
      (m) => m.role === "OWNER" || m.role === "ADMIN" || m.role === "PRODUCER"
    )
    .map((m) => m.orgId);
}

function guest(): Viewer {
  return {
    isSignedIn: false,
    userId: null,
    email: null,
    name: null,
    activeOrgId: null,
    memberships: [],
    staffOrgIds: [],
  };
}

// ---------- main: for Server Components (no Request available) ----------
export async function resolveViewer(): Promise<Viewer> {
  const session = await getServerSession(authOptions);
  const su = session?.user as any | undefined;

  if (!su?.id) return guest();

  const memberships = await fetchMemberships(su.id);
  return {
    isSignedIn: true,
    userId: su.id as string,
    email: (su.email as string | null) ?? null,
    name: (su.name as string | null) ?? null,
    activeOrgId: (su.activeOrgId as string | null) ?? null,
    memberships,
    staffOrgIds: computeStaffOrgIds(memberships),
  };
}

// ---------- main: for Route Handlers (Request available; includes JWT fallback) ----------
export async function resolveViewerFromRequest(req: Request): Promise<Viewer> {
  // Try session first (covers most cases)
  const viaSession = await resolveViewer();
  if (viaSession.isSignedIn) return viaSession;

  // Fallback to JWT when getServerSession is null but a token is present
  const token = await getToken({ req: req as any });
  if (!token?.email && !token?.sub) return guest();

  const me =
    (token.email &&
      (await prisma.user.findUnique({
        where: { email: token.email },
        select: { id: true, email: true, name: true, activeOrgId: true },
      }))) ||
    (token.sub &&
      (await prisma.user.findUnique({
        where: { id: token.sub },
        select: { id: true, email: true, name: true, activeOrgId: true },
      })));

  if (!me) return guest();

  const memberships = await fetchMemberships(me.id);
  return {
    isSignedIn: true,
    userId: me.id,
    email: me.email,
    name: me.name,
    activeOrgId: me.activeOrgId ?? null,
    memberships,
    staffOrgIds: computeStaffOrgIds(memberships),
  };
}

// ---------- helpers used by pages & APIs ----------
export function isNewsroomStaff(viewer: Viewer, orgId?: string | null) {
  if (!orgId) return viewer.staffOrgIds.length > 0;
  return viewer.staffOrgIds.includes(orgId);
}

export function canEditBooking(viewer: Viewer, bookingOrgId?: string | null) {
  if (!TENANCY_ON) return viewer.isSignedIn; // dev escape hatch
  if (!bookingOrgId) return false;
  return isNewsroomStaff(viewer, bookingOrgId);
}

/**
 * Build a safe Prisma where clause for reading a single booking by id.
 * - Staff: allowed within any of their staff orgs.
 * - Expert: allowed only if assigned (temporary expertName match until FK migration).
 */
export function buildBookingReadWhere(
  id: string,
  viewer: Viewer,
  enforce = TENANCY_ON
) {
  if (!enforce) return { id };

  if (viewer.staffOrgIds.length > 0) {
    return { id, orgId: { in: viewer.staffOrgIds } };
  }

  // Expert path (temporary until we migrate to expert FK)
  const name = viewer.name ?? "__invalid__";
  return { id, expertName: name };
}
