// src/app/api/org/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../lib/viewer";
import { hasCan } from "../../../../lib/access/permissions";

// ---------------- GET /api/org/profile ----------------
// Query: orgId (required), includeRoles=true|false (default true)
export async function GET(req: NextRequest) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn || !viewer.userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("orgId") ?? "";
    const includeRoles =
      (searchParams.get("includeRoles") ?? "true").toLowerCase() === "true";
    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: "orgId is required" },
        { status: 400 }
      );
    }

    // Basic read gate — anyone who can view bookings can read org profile
    const canRead = await hasCan({
      userId: viewer.userId,
      orgId,
      permission: "booking:view",
    });
    if (!canRead) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });
    if (!org) {
      return NextResponse.json(
        { ok: false, error: "Not found" },
        { status: 404 }
      );
    }

    let roles: Array<{ slot: number; label: string; isActive: boolean }> = [];
    if (includeRoles) {
      roles = await prisma.orgRole.findMany({
        where: { orgId },
        orderBy: { slot: "asc" },
        select: { slot: true, label: true, isActive: true },
      });
    }

    return NextResponse.json(
      {
        ok: true,
        org: {
          id: org.id,
          name: org.name,
          createdAt: org.createdAt.toISOString(),
          updatedAt: org.updatedAt.toISOString(),
          roles,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/org/profile error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load org profile" },
      { status: 500 }
    );
  }
}

// ---------------- PATCH /api/org/profile ----------------
// Body: { orgId: string, name?: string }
// Requires: settings:manage
export async function PATCH(req: NextRequest) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn || !viewer.userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Partial<{
      orgId: string;
      name: string;
    }>;
    const orgId = typeof body.orgId === "string" ? body.orgId : "";
    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: "orgId is required" },
        { status: 400 }
      );
    }

    const canUpdate = await hasCan({
      userId: viewer.userId,
      orgId,
      permission: "settings:manage",
    });
    if (!canUpdate) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const data: { name?: string } = {};
    if (typeof body.name === "string" && body.name.trim()) {
      data.name = body.name.trim().slice(0, 200);
    }

    if (!Object.keys(data).length) {
      return NextResponse.json(
        { ok: false, error: "No changes supplied" },
        { status: 400 }
      );
    }

    const updated = await prisma.organization.update({
      where: { id: orgId },
      data,
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });

    return NextResponse.json(
      {
        ok: true,
        org: {
          id: updated.id,
          name: updated.name,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("PATCH /api/org/profile error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to update org profile" },
      { status: 500 }
    );
  }
}
