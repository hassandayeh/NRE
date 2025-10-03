// src/app/api/org/users/invite/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth"; // note: one level deeper than .../org/users/route.ts
import prisma from "../../../../../lib/prisma";
import { createHmac, randomBytes } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonErr = { error: string; code?: string };

function badRequest(msg: string, code?: string) {
  return NextResponse.json({ error: msg, code } as JsonErr, { status: 400 });
}
function unauthorized(msg = "Unauthorized") {
  return NextResponse.json({ error: msg } as JsonErr, { status: 401 });
}
function forbidden(msg = "Forbidden") {
  return NextResponse.json({ error: msg } as JsonErr, { status: 403 });
}
function serverError(msg = "Server error") {
  return NextResponse.json({ error: msg } as JsonErr, { status: 500 });
}

/** ---- RBAC helper (same logic we used in /api/org/users/route.ts) ---- */
async function hasPermission(
  orgId: string,
  userId: string,
  key: string
): Promise<boolean> {
  const membership = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { slot: true },
  });
  if (!membership) return false;

  const slot = membership.slot;

  const orgRole = await prisma.orgRole.findUnique({
    where: { orgId_slot: { orgId, slot } },
    select: {
      isActive: true,
      permissions: {
        where: { permissionKey: { key } },
        select: { allowed: true },
        take: 1,
      },
    },
  });
  if (!orgRole || !orgRole.isActive) return false;
  const override = orgRole.permissions[0];
  if (override) return !!override.allowed;

  const template = await prisma.roleTemplate.findUnique({
    where: { slot },
    select: {
      permissions: {
        where: { permissionKey: { key } },
        select: { permissionKeyId: true },
        take: 1,
      },
    },
  });
  return !!template?.permissions?.length;
}

/** ---- tiny JWT (HS256) without extra deps ---- */
function b64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signInviteToken(payload: Record<string, unknown>, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = createHmac("sha256", secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

/** ---------- POST ----------
 * Generate an invite link for a STAFF user in an org.
 * - Ensures the user exists (create minimal staff if needed).
 * - Ensures membership in the org (idempotent).
 * - Returns /auth/invite/accept?token=...
 * Body:
 *  { "email": "person@org.com" } OR { "userId": "usr_123" }
 *  Optional: { "slot": 1..10 } or { "orgRoleKey": "role3" } when creating/ensuring membership
 *  Optional: { "expiresInHours": number } default 72
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = (searchParams.get("orgId") || "").trim();
  if (!orgId) return badRequest("Missing orgId");

  const session = await getServerSession(authOptions);
  const actingUserId = (session?.user as any)?.id as string | undefined;
  if (!actingUserId) return unauthorized();

  const ok = await hasPermission(orgId, actingUserId, "settings:manage");
  if (!ok) return forbidden();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const rawEmail = (body?.email ?? "").trim();
  const rawUserId = (body?.userId ?? "").trim();
  if ((!rawEmail && !rawUserId) || (rawEmail && rawUserId)) {
    return badRequest("Provide exactly one of 'email' or 'userId'");
  }

  // Resolve slot for ensuring membership
  let slot: number | undefined = Number.isFinite(body?.slot)
    ? Number(body.slot)
    : undefined;
  if (!slot && typeof body?.orgRoleKey === "string") {
    const m = /^role(10|[1-9])$/i.exec(body.orgRoleKey);
    if (m) slot = Number(m[1]);
  }
  if (!slot) slot = 6;
  if (!Number.isFinite(slot) || slot < 1 || slot > 10) {
    return badRequest("Invalid 'slot' (must be 1..10)");
  }

  // Find or create target staff user (org-owned)
  let target = rawUserId
    ? await prisma.user.findUnique({
        where: { id: rawUserId },
        select: { id: true, email: true, displayName: true },
      })
    : await prisma.user.findFirst({
        where: { email: { equals: rawEmail, mode: "insensitive" } },
        select: { id: true, email: true, displayName: true },
      });

  if (!target) {
    // minimal staff record with placeholder hashedPassword
    const placeholderHash = `invited:${randomBytes(48).toString("hex")}`;
    target = await prisma.user.create({
      data: {
        email: rawEmail,
        displayName: null,
        hashedPassword: placeholderHash,
      },
      select: { id: true, email: true, displayName: true },
    });
  }

  // Ensure org membership (idempotent)
  const existing = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId: target.id, orgId } },
    select: { slot: true },
  });
  if (!existing) {
    await prisma.userRole.create({
      data: { orgId, userId: target.id, slot },
    });
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return serverError("Missing NEXTAUTH_SECRET");

  const now = Math.floor(Date.now() / 1000);
  const ttlHours = Number.isFinite(body?.expiresInHours)
    ? Number(body.expiresInHours)
    : 72;
  const exp = now + Math.max(1, Math.min(24 * 14, Math.trunc(ttlHours))) * 3600; // clamp 1h..14d

  const payload = {
    typ: "invite",
    orgId,
    userId: target.id,
    email: target.email,
    iat: now,
    exp,
  };

  const token = signInviteToken(payload, secret);
  const inviteUrl = `/auth/invite/accept?token=${encodeURIComponent(token)}`;

  return NextResponse.json({
    inviteUrl,
    token, // included for MVP copy-paste; remove later if you prefer
    expiresAt: new Date(exp * 1000).toISOString(),
    orgId,
    user: { id: target.id, email: target.email },
  });
}
