// src/app/api/whoami/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import prisma from "../../../lib/prisma";

// GET /api/whoami
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email ?? null;

    const me = email
      ? await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            activeOrgId: true,
          },
        })
      : null;

    const memberships = me
      ? await prisma.organizationMembership.findMany({
          where: { userId: me.id },
          select: { role: true, orgId: true },
          orderBy: { orgId: "asc" },
        })
      : [];

    const roles = memberships.map((m) => m.role);
    const staffMembership =
      memberships.find((m) => m.role === "OWNER" || m.role === "PRODUCER") ??
      null;
    const expertMemberships = memberships.filter((m) => m.role === "EXPERT");

    // Optional: if ?bookingId= is provided, we’ll also return that booking’s orgId
    const url = new URL(request.url);
    const bookingId = url.searchParams.get("bookingId");
    let bookingOrg: string | null = null;
    if (bookingId) {
      const b = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, orgId: true },
      });
      bookingOrg = b?.orgId ?? null;
    }

    return NextResponse.json(
      {
        sessionEmail: email,
        user: me,
        memberships,
        roles,
        staffMembership,
        expertCount: expertMemberships.length,
        activeOrgId: me?.activeOrgId ?? null,
        bookingId: bookingId ?? null,
        bookingOrgId: bookingOrg,
        canEditIfStaffSameOrg:
          !!staffMembership && bookingOrg
            ? staffMembership.orgId === bookingOrg
            : null,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: true, message: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
