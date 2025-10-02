// src/app/api/org/roles/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../lib/viewer";
import {
  getEffectiveRole,
  invalidateAccessCache,
  PERMISSIONS,
} from "../../../../lib/access/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

type SlotUpdate = {
  label?: string;
  isActive?: boolean;
  overrides?: Array<{ key: string; allowed: boolean }>;
};

// ---------- helpers ----------
function isValidSlot(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 10;
}

function shapeSlot(
  slot: number,
  label: string,
  isActive: boolean,
  effective: Set<string>,
  tmpl: string[],
  overrides: Array<{ key: string; allowed: boolean }>
) {
  return {
    slot,
    label,
    isActive,
    effective: Array.from(effective).sort(),
    template: [...tmpl].sort(),
    overrides: overrides.map((o) => ({ key: o.key, allowed: !!o.allowed })),
  };
}

async function readTemplate(slot: number): Promise<string[]> {
  const t = await prisma.roleTemplate.findUnique({
    where: { slot },
    select: {
      permissions: { select: { permissionKey: { select: { key: true } } } },
    },
  });
  return (t?.permissions ?? []).map((p) => p.permissionKey.key);
}

async function readOrgOverrides(
  orgId: string,
  slot: number
): Promise<Array<{ key: string; allowed: boolean }>> {
  const or = await prisma.orgRole.findUnique({
    where: { orgId_slot: { orgId, slot } },
    select: {
      permissions: {
        select: { allowed: true, permissionKey: { select: { key: true } } },
      },
    },
  });
  return (or?.permissions ?? []).map((p) => ({
    key: p.permissionKey.key,
    allowed: p.allowed,
  }));
}

async function ensurePermissionKeyMap() {
  const rows = await prisma.permissionKey.findMany({
    select: { id: true, key: true },
  });
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.key, r.id);
  return map;
}

// ---------- GET /api/org/roles?orgId=... ----------
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
    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: "orgId is required" },
        { status: 400 }
      );
    }

    // Only admins can view/manage roles config
    const canManage = await prisma.userRole
      .findUnique({
        where: { userId_orgId: { userId: viewer.userId, orgId } },
        select: { slot: true },
      })
      .then(async (ur) => {
        if (!ur) return false;
        const eff = await getEffectiveRole(orgId, ur.slot);
        return eff.isActive && eff.perms.has("roles:manage");
      });

    if (!canManage) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const slots: Array<{
      slot: number;
      label: string;
      isActive: boolean;
      effective: string[];
      template: string[];
      overrides: Array<{ key: string; allowed: boolean }>;
    }> = [];

    for (let s = 1; s <= 10; s++) {
      const [eff, tmpl, over] = await Promise.all([
        getEffectiveRole(orgId, s),
        readTemplate(s),
        readOrgOverrides(orgId, s),
      ]);
      slots.push(shapeSlot(s, eff.label, eff.isActive, eff.perms, tmpl, over));
    }

    return NextResponse.json(
      { ok: true, orgId, permissionKeys: PERMISSIONS, slots },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/org/roles error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load org roles" },
      { status: 500 }
    );
  }
}

// ---------- PATCH /api/org/roles ----------
/**
 * Body:
 * {
 *   orgId: string,
 *   updates: {
 *     "1": { label?: string, isActive?: boolean, overrides?: [{ key: string, allowed: boolean }] },
 *     "4": { ... },
 *     ...
 *   }
 * }
 */
export async function PATCH(req: NextRequest) {
  try {
    const viewer = await resolveViewerFromRequest(req);
    if (!viewer?.isSignedIn || !viewer.userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      orgId?: string;
      updates?: Record<string, SlotUpdate>;
    };

    const orgId = (body.orgId || "").trim();
    const updates = body.updates || {};

    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: "orgId is required" },
        { status: 400 }
      );
    }

    // Must be allowed to manage roles
    const canManage = await prisma.userRole
      .findUnique({
        where: { userId_orgId: { userId: viewer.userId, orgId } },
        select: { slot: true },
      })
      .then(async (ur) => {
        if (!ur) return false;
        const eff = await getEffectiveRole(orgId, ur.slot);
        return eff.isActive && eff.perms.has("roles:manage");
      });

    if (!canManage) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    // Build permission key id map once
    const keyMap = await ensurePermissionKeyMap();
    const validKeys = new Set(PERMISSIONS as readonly string[]);

    // Apply updates slot by slot
    for (const rawSlot of Object.keys(updates)) {
      const slotNum = Number(rawSlot);
      if (!isValidSlot(slotNum)) continue;

      const u = updates[rawSlot] as SlotUpdate;
      const updateData: { label?: string; isActive?: boolean } = {};
      if (typeof u.label === "string")
        updateData.label = u.label.trim().slice(0, 80);
      if (typeof u.isActive === "boolean") updateData.isActive = u.isActive;

      // Upsert OrgRole shell
      const role = await prisma.orgRole.upsert({
        where: { orgId_slot: { orgId, slot: slotNum } },
        update: updateData,
        create: {
          orgId,
          slot: slotNum,
          label: updateData.label ?? `Role ${slotNum}`,
          isActive: updateData.isActive ?? false,
        },
        select: { id: true },
      });

      // Overrides: replace-all strategy for simplicity & correctness
      if (Array.isArray(u.overrides)) {
        // Filter to known keys and present in PermissionKey
        const cleaned = u.overrides
          .filter((o) => o && typeof o.key === "string" && validKeys.has(o.key))
          .map((o) => ({ key: o.key, allowed: !!o.allowed }));

        await prisma.orgRolePermission.deleteMany({
          where: { orgRoleId: role.id },
        });

        if (cleaned.length) {
          const data = cleaned
            .map((o) => {
              const permissionKeyId = keyMap.get(o.key);
              if (!permissionKeyId) return null;
              return {
                orgRoleId: role.id,
                permissionKeyId,
                allowed: o.allowed,
              };
            })
            .filter(Boolean) as Array<{
            orgRoleId: string;
            permissionKeyId: string;
            allowed: boolean;
          }>;

          if (data.length) {
            await prisma.orgRolePermission.createMany({
              data,
              skipDuplicates: true,
            });
          }
        }
      }
    }

    // Invalidate caches
    invalidateAccessCache(orgId);

    // Respond with the fresh state (reuse GET logic)
    const slots: any[] = [];
    for (let s = 1; s <= 10; s++) {
      const [eff, tmpl, over] = await Promise.all([
        getEffectiveRole(orgId, s),
        readTemplate(s),
        readOrgOverrides(orgId, s),
      ]);
      slots.push(shapeSlot(s, eff.label, eff.isActive, eff.perms, tmpl, over));
    }

    return NextResponse.json(
      { ok: true, orgId, permissionKeys: PERMISSIONS, slots },
      { status: 200 }
    );
  } catch (err) {
    console.error("PATCH /api/org/roles error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to update org roles" },
      { status: 500 }
    );
  }
}
