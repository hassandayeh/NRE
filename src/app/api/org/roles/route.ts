// src/app/api/org/roles/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../lib/viewer";
import {
  invalidateAccessCache,
  PERMISSIONS,
} from "../../../../lib/access/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

// ---------- types ----------
type SlotOverride = { key: string; allowed: boolean };
type SlotUpdate = {
  label?: string;
  isActive?: boolean;
  /** Header toggle alias for booking:inviteable (kept for future, but we also send as overrides) */
  bookable?: boolean;
  /** Array<{key, allowed}> or Record<permissionKey, boolean|number|string> */
  overrides?: unknown;
};

// ---------- helpers ----------
function isValidSlot(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 10;
}
const VALID_KEYS = new Set(PERMISSIONS as readonly string[]);

function normBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(s)) return true;
    if (["false", "0", "no", "off"].includes(s)) return false;
  }
  return undefined;
}

async function ensurePermissionKeyMap() {
  // Ensure all keys exist so writes never drop
  await prisma.permissionKey.createMany({
    data: (PERMISSIONS as readonly string[]).map((key) => ({ key })),
    skipDuplicates: true,
  });
  const rows = await prisma.permissionKey.findMany({
    select: { id: true, key: true },
  });
  const map = new Map<string, string>();
  rows.forEach((r) => map.set(r.key, r.id));
  return map;
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

async function readOrgRoleShell(orgId: string, slot: number) {
  const r = await prisma.orgRole.findUnique({
    where: { orgId_slot: { orgId, slot } },
    select: { label: true, isActive: true },
  });
  return { label: r?.label ?? `Role ${slot}`, isActive: r?.isActive ?? false };
}

async function readOrgOverrides(
  orgId: string,
  slot: number
): Promise<SlotOverride[]> {
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

/** Deny-aware local compute: effective = template ⊕ overrides; inactive => empty set */
function computeEffective(
  templateKeys: string[],
  overrides: SlotOverride[],
  isActive: boolean
) {
  const eff = new Set<string>(templateKeys.filter((k) => VALID_KEYS.has(k)));
  for (const o of overrides) {
    if (!VALID_KEYS.has(o.key)) continue;
    if (o.allowed) eff.add(o.key);
    else eff.delete(o.key); // **deny actually removes**
  }
  return isActive ? eff : new Set<string>();
}

async function shapeSlot(orgId: string, slot: number) {
  const [shell, tmpl, over] = await Promise.all([
    readOrgRoleShell(orgId, slot),
    readTemplate(slot),
    readOrgOverrides(orgId, slot),
  ]);
  const eff = computeEffective(tmpl, over, shell.isActive);
  return {
    slot,
    label: shell.label,
    isActive: shell.isActive,
    bookable: eff.has("booking:inviteable"),
    effective: Array.from(eff).sort(),
    template: [...tmpl].filter((k) => VALID_KEYS.has(k)).sort(),
    overrides: over.map((o) => ({ key: o.key, allowed: !!o.allowed })),
  };
}

/** Unified manage check:
 *  allow if role has `settings:manage` (or legacy `settingsmanage`)
 *  OR `roles:manage` (or legacy `rolesmanage`)
 */
async function canManageSettingsForOrg(userId: string, orgId: string) {
  const ur = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { slot: true },
  });
  if (!ur) return false;

  // local, deny-aware compute for the viewer
  const [shell, tmpl, over] = await Promise.all([
    readOrgRoleShell(orgId, ur.slot),
    readTemplate(ur.slot),
    readOrgOverrides(orgId, ur.slot),
  ]);

  const eff = computeEffective(tmpl, over, shell.isActive);

  // accept both colon and non-colon keys so DB/UI aliases work
  const has = (key: string) => eff.has(key) || eff.has(key.replace(":", ""));

  return has("settings:manage") || has("roles:manage");
}

// ---------- GET ----------
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
    const probe = (searchParams.get("probe") || "").trim();
    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: "orgId is required" },
        { status: 400 }
      );
    }

    const canManage = await canManageSettingsForOrg(viewer.userId, orgId);
    // Also allow read-only access for listing roles if the user has directory:view
    let canDirectory = false;
    if (!canManage) {
      const ur = await prisma.userRole.findUnique({
        where: { userId_orgId: { userId: viewer.userId, orgId } },
        select: { slot: true },
      });
      if (ur) {
        const [shell2, tmpl2, over2] = await Promise.all([
          readOrgRoleShell(orgId, ur.slot),
          readTemplate(ur.slot),
          readOrgOverrides(orgId, ur.slot),
        ]);
        const eff2 = computeEffective(tmpl2, over2, shell2.isActive);
        const has = (k: string) => eff2.has(k) || eff2.has(k.replace(":", ""));
        canDirectory = has("directory:view");
      }
    }

    if (probe === "1" || probe.toLowerCase() === "true") {
      if (!canManage)
        return NextResponse.json(
          { ok: false, error: "Forbidden" },
          { status: 403 }
        );
      const res = NextResponse.json(
        {
          ok: true,
          orgId,
          canManageSettings: true,
          apiVersion: "roles-route-r9",
        },
        { status: 200 }
      );
      res.headers.set("X-EB-Roles-Route", "r9");
      return res;
    }

    if (!canManage && !canDirectory)
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );

    const slots = await Promise.all(
      Array.from({ length: 10 }, (_, i) => i + 1).map((s) =>
        shapeSlot(orgId, s)
      )
    );

    const res = NextResponse.json(
      {
        ok: true,
        orgId,
        permissionKeys: PERMISSIONS,
        slots,
        apiVersion: "roles-route-r9",
      },
      { status: 200 }
    );
    res.headers.set("X-EB-Roles-Route", "r9");
    return res;
  } catch (err) {
    console.error("GET /api/org/roles error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to load org roles" },
      { status: 500 }
    );
  }
}

// ---------- PATCH ----------
/**
 * Body:
 * {
 *   orgId: string,
 *   updates: {
 *     "6": {
 *       label?: string, isActive?: boolean, bookable?: boolean,
 *       overrides?: Array<{ key, allowed|allow|value|enabled|checked }>
 *                | Record<permissionKey, boolean|number|string>
 *     }
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

    const canManage = await canManageSettingsForOrg(viewer.userId, orgId);
    if (!canManage) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const keyMap = await ensurePermissionKeyMap();

    console.log("[ROLES API r9] PATCH", { orgId, slots: Object.keys(updates) });

    for (const rawSlot of Object.keys(updates)) {
      const slotNum = Number(rawSlot);
      if (!isValidSlot(slotNum)) continue;
      const u = updates[rawSlot] as SlotUpdate;

      // 1) Upsert role shell
      const patchShell: { label?: string; isActive?: boolean } = {};
      if (typeof u.label === "string")
        patchShell.label = u.label.trim().slice(0, 80);
      if (typeof u.isActive === "boolean") patchShell.isActive = u.isActive;

      const role = await prisma.orgRole.upsert({
        where: { orgId_slot: { orgId, slot: slotNum } },
        update: patchShell,
        create: {
          orgId,
          slot: slotNum,
          label: patchShell.label ?? `Role ${slotNum}`,
          isActive: patchShell.isActive ?? false,
        },
        select: { id: true },
      });

      // 2) Read current overrides, normalize incoming, merge
      const current = await readOrgOverrides(orgId, slotNum);
      const merged = new Map<string, boolean>(
        current.map((o) => [o.key, !!o.allowed])
      );

      const incoming: SlotOverride[] = [];
      if (Array.isArray(u.overrides)) {
        for (const raw of u.overrides as any[]) {
          if (!raw || typeof raw.key !== "string") continue;
          const rawAllowed =
            raw.allowed ??
            (raw as any).allow ??
            (raw as any).value ??
            (raw as any).enabled ??
            (raw as any).checked;
          const allowed = normBool(rawAllowed);
          if (allowed === undefined || !VALID_KEYS.has(raw.key)) continue;
          incoming.push({ key: raw.key, allowed });
        }
      } else if (u.overrides && typeof u.overrides === "object") {
        for (const [k, v] of Object.entries(
          u.overrides as Record<string, unknown>
        )) {
          const allowed = normBool(v);
          if (allowed === undefined || !VALID_KEYS.has(k)) continue;
          incoming.push({ key: k, allowed });
        }
      }

      // Alias “bookable” to explicit overrides for clarity
      if (typeof u.bookable === "boolean") {
        incoming.push({ key: "booking:inviteable", allowed: u.bookable });
      }

      // Merge deltas
      for (const o of incoming) merged.set(o.key, o.allowed);

      // Build desired final set
      const desired: SlotOverride[] = Array.from(merged.entries())
        .filter(([k]) => VALID_KEYS.has(k))
        .map(([k, allowed]) => ({ key: k, allowed: !!allowed }));

      console.log("[ROLES API r9] write slot", slotNum, {
        desiredCount: desired.length,
        desiredKeys: desired.map((d) => `${d.key}:${d.allowed ? "1" : "0"}`),
      });

      // 3) Replace-all write (idempotent)
      await prisma.$transaction([
        prisma.orgRolePermission.deleteMany({ where: { orgRoleId: role.id } }),
        desired.length
          ? prisma.orgRolePermission.createMany({
              data: desired.map((o) => ({
                orgRoleId: role.id,
                permissionKeyId: keyMap.get(o.key)!,
                allowed: !!o.allowed,
              })),
              skipDuplicates: true,
            })
          : prisma.orgRolePermission.deleteMany({
              where: { orgRoleId: role.id },
            }),
      ]);
    }

    // Invalidate any app-level caches
    invalidateAccessCache(orgId);

    // Return FRESH, deny-aware state computed locally (no getEffectiveRole)
    const slots = await Promise.all(
      Array.from({ length: 10 }, (_, i) => i + 1).map((s) =>
        shapeSlot(orgId, s)
      )
    );

    const res = NextResponse.json(
      {
        ok: true,
        orgId,
        permissionKeys: PERMISSIONS,
        slots,
        apiVersion: "roles-route-r9",
      },
      { status: 200 }
    );
    res.headers.set("X-EB-Roles-Route", "r9");
    return res;
  } catch (err) {
    console.error("PATCH /api/org/roles error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to update org roles" },
      { status: 500 }
    );
  }
}
