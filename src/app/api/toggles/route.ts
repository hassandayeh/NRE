// src/app/api/toggles/route.ts
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerFromRequest } from "../../../lib/viewer";
import { hasCan } from "../../../lib/access/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

/**
 * GET /api/toggles?orgId=...
 */
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
    const orgId = (searchParams.get("orgId") || "").trim();

    const baseToggles = {
      bookingsEnabled: true,
      directoryEnabled: true,
      accessUIEnabled: true,
    };

    if (!orgId) {
      return NextResponse.json(
        {
          ok: true,
          viewer: { userId: viewer.userId },
          toggles: baseToggles,
          permissions: {},
          capabilities: {},
        },
        { status: 200 }
      );
    }

    const can = async (perm: string) =>
      hasCan({ userId: viewer.userId!, orgId, permission: perm });

    const permissions = {
      "booking:view": await can("booking:view"),
      "booking:create": await can("booking:create"),
      "booking:update": await can("booking:update"),
      "booking:delete": await can("booking:delete"),

      "participant:view": await can("participant:view"),
      "participant:add": await can("participant:add"),
      "participant:invite": await can("participant:invite"),
      "participant:remove": await can("participant:remove"),

      "notes:read": await can("notes:read"),
      "notes:write": await can("notes:write"),

      "roles:manage": await can("roles:manage"),
      "settings:manage": await can("settings:manage"),
      "staff:create": await can("staff:create"),
      "staff:delete": await can("staff:delete"),
      "billing:manage": await can("billing:manage"),

      "favorites:manage": await can("favorites:manage"),
    } as const;

    const capabilities = {
      canViewBookings: permissions["booking:view"],
      canCreateBooking: permissions["booking:create"],
      canEditBooking: permissions["booking:update"],
      canDeleteBooking: permissions["booking:delete"],

      canViewParticipants: permissions["participant:view"],
      canManageParticipants:
        permissions["participant:add"] ||
        permissions["participant:invite"] ||
        permissions["participant:remove"],

      canReadNotes: permissions["notes:read"],
      canWriteNotes: permissions["notes:write"],

      canManageRoles: permissions["roles:manage"],
      canManageSettings: permissions["settings:manage"],
      canManageStaff:
        permissions["staff:create"] || permissions["staff:delete"],
      canManageBilling: permissions["billing:manage"],
      canManageFavorites: permissions["favorites:manage"],

      canUseDirectory: permissions["booking:view"],
    };

    const toggles = {
      ...baseToggles,
      accessUIEnabled:
        capabilities.canManageRoles || capabilities.canManageSettings,
    };

    return NextResponse.json(
      {
        ok: true,
        orgId,
        viewer: { userId: viewer.userId },
        toggles,
        permissions,
        capabilities,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/toggles error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to compute toggles" },
      { status: 500 }
    );
  }
}
