// src/app/api/directory/org/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";

/**
 * GET /api/directory/org?orgId=...&q=...&debug=1
 *
 * Source of truth:
 *   - "UserRole"  (userId, orgId, slot, assignedAt)
 *   - "User"      (id, displayName, email, city, countryCode, ...)
 *   - "OrgRole"   (orgId, slot, label, isActive, ...)
 *
 * Behavior:
 *   - orgId defaults to session.orgId; admin/dev can override with ?orgId=.
 *   - Returns normalized items for the Internal Directory (members of orgId).
 *   - Admin/Producer/Owner: same payload (we’ll enforce listing later).
 *   - ?q= filters client-side on name/email/id/city/country.
 *   - ?debug=1 adds { source, count, roles } for quick verification.
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

type OrgDirectoryItem = {
  id: string;
  displayName?: string | null;
  name?: string | null;
  email?: string | null;
  city?: string | null;
  countryCode?: string | null;
  roleSlot?: number | null;
  roleLabel?: string | null;
  // future flags (derived from roles or member record)
  inviteable?: boolean;
  listed_internal?: boolean;
};

function sanitizeId(id: string) {
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
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
  const sessionOrgId = session?.orgId ?? session?.user?.orgId ?? null;

  // org from session by default; allow admin/dev override via ?orgId=
  const orgId = sanitizeId(String(overrideOrgId || sessionOrgId || ""));
  if (!orgId) {
    return NextResponse.json({
      ok: true,
      items: [],
      ...(debugOn
        ? { debug: { reason: "no-org", roles: Array.from(roles) } }
        : {}),
    });
  }

  // Parameterized raw SQL (uses actual column names seen in your DB):
  //  - "UserRole": userId, orgId, slot, assignedAt
  //  - "User": displayName, email, city, countryCode (no "name" column)
  //  - "OrgRole": label, isActive (join on (orgId, slot))
  const sql = Prisma.sql`
    SELECT
      ur."userId"               AS "userId",
      ur."orgId"                AS "orgId",
      ur."slot"                 AS "slot",
      ur."assignedAt"           AS "assignedAt",
      u."id"                    AS "u_id",
      u."displayName"           AS "u_displayName",
      u."email"                 AS "u_email",
      u."city"                  AS "u_city",
      u."countryCode"           AS "u_countryCode",
      r."label"                 AS "role_label",
      r."isActive"              AS "role_active"
    FROM "public"."UserRole" ur
    JOIN "public"."User"     u ON u."id" = ur."userId"
    LEFT JOIN "public"."OrgRole" r
      ON r."orgId" = ur."orgId" AND r."slot" = ur."slot"
    WHERE ur."orgId" = ${orgId}
    ORDER BY u."displayName" NULLS LAST, u."id"
  `;

  let rows: any[] = [];
  let errMsg: string | undefined;
  try {
    rows = await prisma.$queryRaw<any[]>(sql);
  } catch (e: any) {
    errMsg = e?.message || String(e);
    rows = [];
  }

  // Normalize to Directory items
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
      // flags not wired yet — we’ll derive from role bundle later
      inviteable: undefined,
      listed_internal: undefined,
    };
  });

  // Client-side search
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((x) =>
      [x.displayName, x.name, x.email, x.id, x.city, x.countryCode, x.roleLabel]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle))
    );
  }

  return NextResponse.json({
    ok: true,
    items,
    ...(debugOn
      ? {
          debug: {
            orgId,
            roles: Array.from(roles),
            count: items.length,
            source: "sql:public.UserRole → public.User (+OrgRole)",
            error: errMsg ?? null,
          },
        }
      : {}),
  });
}
