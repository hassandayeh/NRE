// src/app/api/auth/invite/complete/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma";
import { createHmac, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonErr = { error: string; code?: string };

function badRequest(msg: string, code?: string) {
  return NextResponse.json({ error: msg, code } as JsonErr, { status: 400 });
}
function serverError(msg = "Server error") {
  return NextResponse.json({ error: msg } as JsonErr, { status: 500 });
}

/** ---- base64url helpers ---- */
function b64urlToBuf(u: string) {
  const b64 =
    u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((u.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

type InvitePayload = {
  typ: "invite";
  orgId: string;
  userId: string;
  email: string;
  iat: number;
  exp: number;
};

/** Verify HS256 invite token and return payload */
function verifyInviteToken(token: string, secret: string): InvitePayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const expected = createHmac("sha256", secret).update(data).digest();
  const given = b64urlToBuf(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new Error("Invalid token signature");
  }
  const payloadJson = b64urlToBuf(p).toString("utf8");
  const payload = JSON.parse(payloadJson) as InvitePayload;
  if (payload.typ !== "invite") throw new Error("Invalid token type");
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) throw new Error("Invite expired");
  return payload;
}

/** ---------- POST ----------
 * Body: { token: string, password: string }
 * Effect:
 *  - Verify token (HS256, exp)
 *  - Ensure user exists & membership to org (idempotent)
 *  - If already completed (non-placeholder hash), return 409
 *  - Save bcrypt hash so logins use secure compare (auth.ts already supports bcrypt)
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const token = (body?.token || "").trim();
  const password = (body?.password || "").trim();

  if (!token || !password) return badRequest("Missing token or password");
  if (password.length < 6)
    return badRequest("Password must be at least 6 characters");

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return serverError("Missing NEXTAUTH_SECRET");

  let payload: InvitePayload;
  try {
    payload = verifyInviteToken(token, secret);
  } catch (e: any) {
    return badRequest(e?.message || "Invalid invite token", "INVALID_TOKEN");
  }

  // Ensure user exists and matches email
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, hashedPassword: true },
  });
  if (!user || user.email?.toLowerCase() !== payload.email.toLowerCase()) {
    return badRequest("Invite user not found", "USER_NOT_FOUND");
  }

  // Ensure membership (idempotent; default slot 6 if missing)
  const membership = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId: user.id, orgId: payload.orgId } },
    select: { userId: true },
  });
  if (!membership) {
    await prisma.userRole.create({
      data: { orgId: payload.orgId, userId: user.id, slot: 6 },
    });
  }

  // Prevent re-use: invited accounts were created with "invited:..." placeholder
  const isPlaceholder =
    typeof user.hashedPassword === "string" &&
    user.hashedPassword.startsWith("invited:");
  if (!isPlaceholder) {
    return NextResponse.json(
      {
        error: "Invitation already completed",
        code: "INVITE_ALREADY_COMPLETED",
      } as JsonErr,
      { status: 409 }
    );
  }

  // Hash the password securely
  const hash = await bcrypt.hash(password, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      hashedPassword: hash,
    },
  });

  return NextResponse.json({ ok: true, userId: user.id, orgId: payload.orgId });
}
