/**
 * Slot-based access helpers (Roles 1–10).
 * No named roles — everything flows through slots and permissions.
 */

import prisma from "../prisma"; // uses default export from src/lib/prisma

/** Canonical permission keys (keep in sync with prisma/seed.js). */
export const PERMISSIONS = [
  // Bookings & participants
  "booking:view",
  "booking:create",
  "booking:update",
  "booking:delete",

  "participant:view",
  "participant:add",
  "participant:invite",
  "participant:remove",

  // Directory / “Bookable Talent” bundle
  "directory:listed_internal",
  "booking:inviteable",

  // Notes
  "notes:read",
  "notes:write",

  // Admin & settings
  "roles:manage",
  "settings:manage",
  "staff:create",
  "staff:delete",
  "billing:manage",

  // Lists
  "favorites:manage",
] as const;

export type PermissionKeyName = (typeof PERMISSIONS)[number] | (string & {});

/** Simple in-memory caches (server-only). */
const SLOT_TTL_MS = 10_000;
const PERMS_TTL_MS = 10_000;

type SlotCacheVal = { slot: number | null; expires: number };
type PermsCacheVal = {
  perms: Set<string>;
  label: string;
  isActive: boolean;
  expires: number;
};

const userSlotCache = new Map<string, SlotCacheVal>(); // key: `${userId}:${orgId}`
const rolePermsCache = new Map<string, PermsCacheVal>(); // key: `${orgId}:${slot}`

/** Get a user's slot in an org (cached). */
export async function getUserSlot(
  userId: string,
  orgId: string
): Promise<number | null> {
  const key = `${userId}:${orgId}`;
  const now = Date.now();
  const cached = userSlotCache.get(key);
  if (cached && cached.expires > now) return cached.slot;

  const rec = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { slot: true },
  });

  const slot = rec?.slot ?? null;
  userSlotCache.set(key, { slot, expires: now + SLOT_TTL_MS });
  return slot;
}

/** Compute effective permissions for an org + slot (template ± org overrides). */
export async function getEffectiveRole(orgId: string, slot: number) {
  const key = `${orgId}:${slot}`;
  const now = Date.now();
  const cached = rolePermsCache.get(key);
  if (cached && cached.expires > now) return cached;

  // Fetch org role (label/active + overrides) and the slot's template permissions.
  const [orgRole, tmpl] = await Promise.all([
    prisma.orgRole.findUnique({
      where: { orgId_slot: { orgId, slot } },
      select: {
        isActive: true,
        label: true,
        permissions: {
          select: { allowed: true, permissionKey: { select: { key: true } } },
        },
      },
    }),
    prisma.roleTemplate.findUnique({
      where: { slot },
      select: {
        permissions: { select: { permissionKey: { select: { key: true } } } },
      },
    }),
  ]);

  // Start with template permissions.
  const set = new Set<string>();
  tmpl?.permissions.forEach((p: { permissionKey: { key: string } }) => {
    set.add(p.permissionKey.key);
  });

  // Apply org overrides: allowed=true adds; allowed=false removes.
  orgRole?.permissions.forEach(
    (op: { allowed: boolean; permissionKey: { key: string } }) => {
      const k = op.permissionKey.key;
      if (op.allowed) set.add(k);
      else set.delete(k);
    }
  );

  const label = orgRole?.label ?? `Role ${slot}`;
  const isActive = orgRole?.isActive ?? false;

  const val: PermsCacheVal = {
    perms: set,
    label,
    isActive,
    expires: now + PERMS_TTL_MS,
  };
  rolePermsCache.set(key, val);
  return val;
}

/** Check a permission for a user in an org. */
export async function hasCan(args: {
  userId: string;
  orgId: string;
  permission: PermissionKeyName;
}): Promise<boolean> {
  const { userId, orgId, permission } = args;
  const slot = await getUserSlot(userId, orgId);
  if (slot == null) return false;

  const eff = await getEffectiveRole(orgId, slot);
  if (!eff.isActive) return false;

  return eff.perms.has(permission as string);
}

/** “Bookable Talent” means: listed internally AND inviteable. */
export async function isBookableTalent(args: {
  userId: string;
  orgId: string;
}): Promise<boolean> {
  const { userId, orgId } = args;
  const slot = await getUserSlot(userId, orgId);
  if (slot == null) return false;

  const eff = await getEffectiveRole(orgId, slot);
  if (!eff.isActive) return false;

  return (
    eff.perms.has("directory:listed_internal") &&
    eff.perms.has("booking:inviteable")
  );
}

/** Convenience: get role display for a user (slot + label + active). */
export async function getUserRoleInfo(userId: string, orgId: string) {
  const slot = await getUserSlot(userId, orgId);
  if (slot == null)
    return {
      slot: null as number | null,
      label: null as string | null,
      isActive: false,
    };

  const eff = await getEffectiveRole(orgId, slot);
  return { slot, label: eff.label, isActive: eff.isActive };
}

/** List active slots for an org (for UI dropdowns). */
export async function listActiveOrgRoles(orgId: string) {
  return prisma.orgRole.findMany({
    where: { orgId, isActive: true },
    orderBy: { slot: "asc" },
    select: { slot: true, label: true },
  });
}

/** Manual cache invalidation (call after changing roles/permissions). */
export function invalidateAccessCache(orgId?: string) {
  const now = Date.now() - 1;
  if (!orgId) {
    for (const [k, v] of userSlotCache)
      userSlotCache.set(k, { ...v, expires: now });
    for (const [k, v] of rolePermsCache)
      rolePermsCache.set(k, { ...v, expires: now });
    return;
  }
  for (const [k, v] of rolePermsCache) {
    if (k.startsWith(`${orgId}:`))
      rolePermsCache.set(k, { ...v, expires: now });
  }
}
