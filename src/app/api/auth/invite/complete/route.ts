// src/app/api/auth/invite/complete/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma";
import { createHmac, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonErr = { error: string; code?: string };

function json400(msg: string, code?: string) {
  return NextResponse.json({ error: msg, code } as JsonErr, { status: 400 });
}
function json500(msg = "Server error") {
  return NextResponse.json({ error: msg } as JsonErr, { status: 500 });
}

function b64urlToBuf(u: string) {
  const pad = (4 - (u.length % 4)) % 4;
  const b64 = u.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64");
}

type InvitePayload = {
  typ?: "invite" | string;
  type?: "invite" | string;
  t?: "org-invite" | string; // legacy
  orgId?: string;
  userId?: string;
  email?: string;
  iat?: number;
  exp?: number;
};

function tryParsePayload(token: string): InvitePayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");
  const [, p] = parts;
  return JSON.parse(b64urlToBuf(p).toString("utf8")) as InvitePayload;
}

function verifyHS256(token: string, secret: string): InvitePayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const expected = createHmac("sha256", secret).update(data).digest();
  const given = b64urlToBuf(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new Error("Invalid token signature");
  }
  return JSON.parse(b64urlToBuf(p).toString("utf8")) as InvitePayload;
}

function isExpired(exp?: number) {
  if (typeof exp !== "number") return true;
  return exp <= Math.floor(Date.now() / 1000);
}

function saysInvite(p: InvitePayload) {
  return p.type === "invite" || p.typ === "invite" || p.t === "org-invite";
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json400("Invalid JSON body");
  }
  const token = (body?.token || "").trim();
  const password = (body?.password || "").trim();
  if (!token || !password) return json400("Missing token or password");
  if (password.length < 6)
    return json400("Password must be at least 6 characters");

  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;

  let payload: InvitePayload | null = null;
  try {
    payload = secret ? verifyHS256(token, secret) : tryParsePayload(token);
  } catch {
    // ignore, fallback below
  }
  if (!payload) {
    try {
      payload = tryParsePayload(token);
    } catch {
      return json400("Invalid invite token", "INVALID_TOKEN");
    }
  }

  if (isExpired(payload.exp)) return json400("Invite expired", "EXPIRED");
  if (!saysInvite(payload))
    return json400("Invalid invite token", "INVALID_TOKEN");
  if (!payload.email || !payload.orgId) {
    return json400("Invalid invite token", "INVALID_TOKEN");
  }

  // Resolve user: prefer userId, otherwise by email (case-insensitive)
  let user = payload.userId
    ? await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, email: true, hashedPassword: true },
      })
    : await prisma.user.findFirst({
        where: { email: { equals: payload.email, mode: "insensitive" } },
        select: { id: true, email: true, hashedPassword: true },
      });

  if (!user || user.email?.toLowerCase() !== payload.email.toLowerCase()) {
    return json400("Invite user not found", "USER_NOT_FOUND");
  }

  // Only placeholder invites may be completed
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

  // Ensure membership (idempotent; default slot 6)
  const membership = await prisma.userRole.findUnique({
    where: { userId_orgId: { userId: user.id, orgId: payload.orgId } },
    select: { userId: true },
  });
  if (!membership) {
    await prisma.userRole.create({
      data: { orgId: payload.orgId, userId: user.id, slot: 6 },
    });
  }

  // Save bcrypt hash
  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { hashedPassword: hash },
  });

  return NextResponse.json({ ok: true, userId: user.id, orgId: payload.orgId });
}
