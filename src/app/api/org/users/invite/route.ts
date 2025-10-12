// src/app/api/org/users/invite/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import prisma from "../../../../../lib/prisma";
import { randomBytes, createHmac } from "crypto";

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

// Lightweight dev telemetry (no-op in production)
function devInfo(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
    console.info("[telemetry]", ...args);
  }
}

function b64url(buf: Buffer | string) {
  const b = Buffer.isBuffer(buf)
    ? buf.toString("base64")
    : Buffer.from(buf).toString("base64");
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signHS256(header: any, payload: any, secret: string): string {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const sig = createHmac("sha256", secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

type InvitePayload = {
  type: "invite";
  typ: "invite";
  orgId: string;
  orgName?: string; // ✅ added so accept screen can show the human-readable name
  userId: string;
  email: string;
  iat: number;
  exp: number;
};

function signInviteToken(payload: InvitePayload) {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing NEXTAUTH_SECRET/AUTH_SECRET");
  return signHS256({ alg: "HS256", typ: "JWT" }, payload, secret);
}

// (simple permission check; keep it permissive for now)
async function canManage(orgId: string, userId: string) {
  const m = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { userId: true },
  });
  return !!m;
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = (searchParams.get("orgId") || "").trim();
  if (!orgId) return badRequest("Missing orgId");

  const session = await getServerSession(authOptions);
  const actingUserId = (session?.user as any)?.id as string | undefined;
  if (!actingUserId) return unauthorized();

  const ok = await canManage(orgId, actingUserId);
  if (!ok) return forbidden();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const email = (body?.email || "").trim();
  const name = typeof body?.name === "string" ? body.name.trim() : undefined;
  let slot = Number.isFinite(body?.slot) ? Number(body.slot) : 6;

  if (!email) return badRequest("Email required");
  if (!Number.isFinite(slot) || slot < 1 || slot > 10)
    return badRequest("Invalid slot");

  // Telemetry: request parsed
  devInfo("invite:request", { orgId, actingUserId, email, slot });

  // POLICY: slot must be active in this org
  const destRole = await prisma.orgRole.findUnique({
    where: { orgId_slot: { orgId, slot } },
    select: { isActive: true },
  });
  if (!destRole || !destRole.isActive) {
    return badRequest("Destination role is inactive.", "ROLE_INACTIVE");
  }

  // Find existing by email (case-insensitive)
  let user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, displayName: true, hashedPassword: true },
  });

  // Rule: do NOT invite existing (active) users anywhere
  if (user) {
    const isInvited =
      typeof user.hashedPassword === "string" &&
      user.hashedPassword.startsWith("invited:");
    if (!isInvited) {
      devInfo("invite:block", {
        reason: "user_exists",
        orgId,
        actingUserId,
        email,
        userId: user.id,
      });
      return NextResponse.json(
        { error: "User already exists", code: "user_exists" } as JsonErr,
        { status: 409 }
      );
    }
  }

  // Create placeholder user if truly new
  if (!user) {
    const placeholder = `invited:${randomBytes(48).toString("hex")}`;
    user = await prisma.user.create({
      data: {
        email,
        displayName: name || null,
        hashedPassword: placeholder,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        hashedPassword: true,
      },
    });
    devInfo("invite:new_user", { orgId, actingUserId, email, userId: user.id });
  }

  // Ensure membership (idempotent)
  const existing = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId: user.id, orgId } },
    select: { userId: true, slot: true },
  });
  if (!existing) {
    await prisma.userRole.create({
      data: { orgId, userId: user.id, slot },
    });
    devInfo(
      existing ? "invite:membership:existing" : "invite:membership:created",
      { orgId, actingUserId, userId: user.id, slot }
    );
  }

  // ✅ Fetch org name (best-effort; no behavior change if missing)
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });

  // Sign token with both keys + userId (+ orgName for UI)
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60 * 24 * 7; // 7 days
  const token = signInviteToken({
    type: "invite",
    typ: "invite",
    orgId,
    orgName: org?.name || undefined, // 👈 this powers the name on the accept page
    userId: user.id,
    email: user.email!,
    iat: now,
    exp,
  });

  const inviteUrl = `${
    req.nextUrl.origin
  }/auth/invite/accept?token=${encodeURIComponent(token)}`;

  devInfo("invite:issued", {
    orgId,
    actingUserId,
    userId: user.id,
    email,
    expiresAt: exp * 1000,
    inviteUrl,
  });

  // Keep the response shape the same for callers
  return NextResponse.json(
    {
      inviteUrl,
      expiresAt: exp * 1000,
      userId: user.id,
      email: user.email,
      orgId,
      // NOTE: We intentionally do not add orgName here to avoid surprising existing callers.
    },
    { status: 201 }
  );
}
