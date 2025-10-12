// src/app/api/directory/org/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

/**
 * GET /api/directory/org?orgId=...&q=...&debug=1
 *
 * Source of truth:
 * - "UserRole" (userId, orgId, slot, assignedAt)
 * - "User" (id, displayName, email, city, countryCode, hashedPassword, ...)
 * - "OrgRole" (orgId, slot, label, isActive, ...)
 *
 * Behavior:
 * - orgId defaults to session.orgId; admin may override with ?orgId=.
 * - Returns normalized items for the Internal Directory (members of orgId).
 * - Non-admins only see users whose role has directory:listed_internal=allow.
 * - ?q= filters on name/email/id/city/country/roleLabel.
 * - ?debug=1 adds { source, countPre, countPost, roles, admin, filtered }.
 *
 * 2025-10-12:
 * - Exclude pending/invited staff:
 *   (A) Intersect with ACTIVE members from /api/org/users.
 *   (B) Fallback: exclude users whose User.hashedPassword starts with "invited:".
 */

// ---------- prisma singleton ----------
const g = globalThis as unknown as { __nre_prisma?: PrismaClient };
const prisma =
  g.__nre_prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error"] : ["error"],
  });
if (process.env.NODE_ENV !== "production") g.__nre_prisma = prisma;

// ---------- helpers ----------
function normRole(r: unknown): string | null {
  if (!r) return null;
  const s = String(r).trim();
  if (!s) return null;
  return s.toUpperCase().replace(/\s+/g, "_").replace(/#\d+$/, "");
}
function extractRoles(session: any): Set<string> {
  const roles = new Set<string>();
  const add = (v: unknown) => {
    const n = normRole(v);
    if (n) roles.add(n);
  };
  add(session?.user?.role);
  (session?.user?.roles ?? []).forEach(add);
  add(session?.role);
  (session?.roles ?? []).forEach(add);
  const mems =
    session?.user?.orgMemberships ??
    session?.user?.memberships ??
    session?.orgMemberships ??
    session?.memberships ??
    [];
  if (Array.isArray(mems)) mems.forEach((m: any) => add(m?.role));
  return roles;
}

function toBool(v: unknown) {
  return v === true || v === "true" || v === 1 || v === "1";
}
function asNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function sanitizeId(id: string) {
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

type OrgDirectoryItem = {
  id: string;
  displayName?: string | null;
  name?: string | null;
  email?: string | null;
  city?: string | null;
  countryCode?: string | null;
  roleSlot?: number | null;
  roleLabel?: string | null;
  inviteable?: boolean; // derived
  listed_internal?: boolean; // derived
};

function isAdminFromSession(session: any, roles: Set<string>) {
  // Prefer explicit roleSlot === 1 if present
  const slotCandidates = [
    session?.roleSlot,
    session?.user?.roleSlot,
    session?.user?.orgRoleSlot,
    session?.orgRoleSlot,
  ];
  if (slotCandidates.some((v) => asNum(v) === 1)) return true;

  // Fallback to common labels present in legacy session shapes
  const roleNames = Array.from(roles);
  if (
    roleNames.includes("ADMIN") ||
    roleNames.includes("OWNER") ||
    roleNames.includes("PRODUCER")
  ) {
    return true;
  }

  // Ultimate fallback: if session has an "isAdmin" boolean
  if (toBool(session?.isAdmin) || toBool(session?.user?.isAdmin)) return true;

  return false;
}

/** Shape-agnostic detector for "active" staff rows returned by /api/org/users. */
function isActiveStaff(u: any): boolean {
  const toLower = (v: any) => (v ?? "").toString().toLowerCase();

  // Obvious negatives first
  if (u?.removed === true || u?.removedAt) return false;
  if (u?.disabled === true) return false;
  if (u?.suspended === true) return false;

  // Status-like fields
  const status = toLower(
    u?.status ??
      u?.state ??
      u?.roleStatus ??
      u?.membershipStatus ??
      u?.inviteStatus
  );
  if (status.includes("pending") || status.includes("invite")) return false;

  // Pending flags
  if (u?.isPending === true || u?.pending === true || u?.invited === true)
    return false;
  if (u?.flags && (u.flags.pending === true || u.flags.invited === true))
    return false;

  // Invite lifecycle
  const invitedAt = u?.invitedAt ?? u?.createdByInviteAt;
  const acceptedAt = u?.acceptedAt ?? u?.accepted_at ?? u?.activatedAt;
  if (invitedAt && !acceptedAt) return false;

  // Placeholder password marker used in some flows
  const hp = u?.hashedPassword;
  if (typeof hp === "string" && hp.startsWith("invited:")) return false;

  return true;
}

// ---------- handler ----------
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const overrideOrgId = url.searchParams.get("orgId");
  const debugOn = url.searchParams.get("debug") === "1";

  // Pull session (forward auth cookie)
  const cookie = req.headers.get("cookie") || "";
  const sessionRes = await fetch(new URL("/api/auth/session", url).toString(), {
    headers: { cookie },
    cache: "no-store",
  });
  const session = sessionRes.ok
    ? await sessionRes.json().catch(() => null)
    : null;
  const roles = extractRoles(session);
  const sessionOrgId =
    session?.orgId ?? session?.user?.orgId ?? session?.user?.org?.id ?? null;

  // org from session by default; allow admin override via ?orgId=
  const orgId = sanitizeId(String(overrideOrgId || sessionOrgId || ""));
  if (!orgId) {
    return NextResponse.json({
      ok: true,
      items: [],
      ...(debugOn
        ? {
            debug: {
              reason: "no-org",
              roles: Array.from(roles),
              admin: false,
            },
          }
        : {}),
    });
  }

  // Parameterized raw SQL (uses actual column names in DB):
  // - "UserRole": userId, orgId, slot, assignedAt
  // - "User": displayName, email, city, countryCode, hashedPassword
  // - "OrgRole": label, isActive (join on (orgId, slot))
  const sql = Prisma.sql`
    SELECT
      ur."userId"         AS "userId",
      ur."orgId"          AS "orgId",
      ur."slot"           AS "slot",
      ur."assignedAt"     AS "assignedAt",
      u."id"              AS "u_id",
      u."displayName"     AS "u_displayName",
      u."email"           AS "u_email",
      u."city"            AS "u_city",
      u."countryCode"     AS "u_countryCode",
      u."hashedPassword"  AS "u_hashedPassword",
      r."label"           AS "role_label",
      r."isActive"        AS "role_active"
    FROM "public"."UserRole" ur
    JOIN "public"."User" u
      ON u."id" = ur."userId"
    LEFT JOIN "public"."OrgRole" r
      ON r."orgId" = ur."orgId" AND r."slot" = ur."slot"
    WHERE ur."orgId" = ${orgId}
    ORDER BY u."displayName" NULLS LAST, u."id"
  `;

  let rows: any[] = [];
  let errMsg: string | undefined;
  try {
    rows = await prisma.$queryRaw(sql);
  } catch (e: any) {
    errMsg = e?.message || String(e);
    rows = [];
  }

  // Build a set of users who look "invited but not yet activated" (DB fallback)
  const invitedIdSet = new Set<string>();
  for (const r of rows) {
    const hp = r?.u_hashedPassword;
    if (typeof hp === "string" && hp.startsWith("invited:")) {
      invitedIdSet.add(String(r.u_id ?? r.userId));
    }
  }

  // Normalize rows → items
  let items: OrgDirectoryItem[] = rows.map((r) => {
    const displayName = r.u_displayName ?? null;
    return {
      id: String(r.u_id ?? r.userId),
      displayName,
      name: displayName,
      email: r.u_email ?? null,
      city: r.u_city ?? null,
      countryCode: r.u_countryCode ?? null,
      roleSlot:
        typeof r.slot === "number" ? r.slot : Number(r.slot ?? 0) || null,
      roleLabel: r.role_label ?? null,
      inviteable: undefined, // set below after role lookup
      listed_internal: undefined, // set below after role lookup
    };
  });

  // Client-side search (pre-flagging, fine)
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((x) =>
      [x.displayName, x.name, x.email, x.id, x.city, x.countryCode, x.roleLabel]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle))
    );
  }

  // Derive Bookable flags by consulting /api/org/roles (single org roundtrip)
  // - listed_internal: allow  => listed
  // - inviteable:      allow  => inviteable
  let listedSlots = new Set<number>();
  let inviteSlots = new Set<number>();
  let rolesFetchError: string | null = null;
  try {
    const rolesRes = await fetch(
      new URL(
        `/api/org/roles?orgId=${encodeURIComponent(orgId)}`,
        url
      ).toString(),
      { headers: { cookie }, cache: "no-store" }
    );
    if (rolesRes.ok) {
      const rolesJson: any = await rolesRes.json();
      const slots: Array<{
        slot: number;
        overrides: Array<{ key: string; allowed: boolean }>;
      }> = Array.isArray(rolesJson?.slots) ? rolesJson.slots : [];

      for (const s of slots) {
        const ov = new Map(s.overrides.map((o) => [o.key, o.allowed === true]));
        if (ov.get("directory:listed_internal") === true)
          listedSlots.add(s.slot);
        if (ov.get("booking:inviteable") === true) inviteSlots.add(s.slot);
      }
    } else {
      rolesFetchError = `${rolesRes.status} ${rolesRes.statusText}`;
    }
  } catch (e: any) {
    rolesFetchError = e?.message || "fetch-failed";
  }

  // Mark flags on each item
  for (const it of items) {
    const slot = it.roleSlot ?? 0;
    it.listed_internal = listedSlots.has(slot);
    it.inviteable = inviteSlots.has(slot);
  }

  // === (A) Intersect with ACTIVE users from /api/org/users (excludes pending/invited) ===
  let activeIdSet: Set<string> | null = null;
  let activeEmailSet: Set<string> | null = null;
  let usersFetchError: string | null = null;
  try {
    const usersRes = await fetch(
      new URL(
        `/api/org/users?orgId=${encodeURIComponent(orgId)}&take=500`,
        url
      ).toString(),
      { headers: { cookie }, cache: "no-store" }
    );
    if (usersRes.ok) {
      const uj: any = await usersRes.json();
      const rowsU: any[] = (uj.items ?? uj.users ?? []) as any[];

      const activeRows = rowsU.filter(isActiveStaff);

      activeIdSet = new Set(
        activeRows
          .map((u) =>
            String(u?.userId ?? u?.id ?? u?.user?.id ?? u?.member?.id ?? "")
          )
          .filter(Boolean)
      );
      activeEmailSet = new Set(
        activeRows
          .map((u) =>
            (u?.email ?? u?.user?.email ?? u?.member?.email ?? "")
              .toString()
              .toLowerCase()
          )
          .filter(Boolean)
      );
    } else {
      usersFetchError = `${usersRes.status} ${usersRes.statusText}`;
    }
  } catch (e: any) {
    usersFetchError = e?.message || "fetch-failed";
  }

  // Apply active-set filter when we have data
  if (
    (activeIdSet && activeIdSet.size > 0) ||
    (activeEmailSet && activeEmailSet.size > 0)
  ) {
    items = items.filter((x) => {
      const idOk = activeIdSet?.has(String(x.id)) ?? false;
      const emailOk = x.email
        ? activeEmailSet?.has(String(x.email).toLowerCase()) ?? false
        : false;
      return idOk || emailOk;
    });
  }

  // === (B) Fallback: exclude users clearly marked as invited in DB
  if (invitedIdSet.size > 0) {
    items = items.filter((x) => !invitedIdSet.has(String(x.id)));
  }

  // Non-admin viewers: hide non-listed members
  const isAdmin = isAdminFromSession(session, roles);
  const countPre = items.length;
  let filtered = false;
  if (!isAdmin) {
    items = items.filter((x) => x.listed_internal === true);
    filtered = true;
  }
  const countPost = items.length;

  return NextResponse.json({
    ok: true,
    items,
    ...(debugOn
      ? {
          debug: {
            orgId,
            roles: Array.from(roles),
            admin: isAdmin,
            filtered,
            countPre,
            countPost,
            rolesFetchError,
            usersFetchError,
            source:
              'sql:public."UserRole" → public."User"(+hashedPassword) + public."OrgRole" + roles(/api/org/roles) + active(/api/org/users) + invited(hp)',
            error: errMsg ?? null,
            invitedCount: invitedIdSet.size,
          },
        }
      : {}),
  });
}
