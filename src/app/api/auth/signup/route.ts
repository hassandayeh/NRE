// src/app/api/auth/signup/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "../../../../lib/prisma";
import { encode } from "next-auth/jwt";
import {
  getEffectiveRole,
  PERMISSIONS,
} from "../../../../lib/access/permissions";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

/** Simple email sanity */
function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Dev-friendly diagnostic responder (never leaks secrets) */
function diagError(
  step: string,
  err: unknown,
  fallbackMsg: string,
  status = 500
) {
  // Prisma errors carry .code (e.g., P2002), jose errors carry .code or .name.
  const anyErr = err as any;
  const code = anyErr?.code || anyErr?.name || "UNKNOWN";
  const meta = anyErr?.meta || undefined;
  // Always log full detail to server console
  // eslint-disable-next-line no-console
  console.error(`[signup][${step}]`, err);
  // Return a structured error to the client in dev; keeps same msg in prod
  const base = {
    ok: false as const,
    step,
    code,
    message: fallbackMsg,
  };
  const body = process.env.NODE_ENV === "production" ? base : { ...base, meta };
  return NextResponse.json(body, { status });
}

/** Grant ALL permissions (from PERMISSIONS) to Slot 1 for an org */
async function grantAllPermsToSlot1(orgId: string) {
  const keys = PERMISSIONS as readonly string[];

  // Ensure permission keys exist (idempotent)
  await prisma.permissionKey.createMany({
    data: keys.map((key) => ({ key })),
    skipDuplicates: true,
  });

  // Map keys -> ids
  const pkRows = await prisma.permissionKey.findMany({
    where: { key: { in: keys as string[] } },
    select: { id: true, key: true },
  });
  const idByKey = new Map(pkRows.map((r) => [r.key, r.id]));

  // Get slot 1 orgRole
  const slot1 = await prisma.orgRole.findUnique({
    where: { orgId_slot: { orgId, slot: 1 } },
    select: { id: true },
  });
  if (!slot1?.id) throw new Error("SLOT1_ROLE_NOT_FOUND");

  // Grant all keys to slot 1 (idempotent)
  await prisma.orgRolePermission.createMany({
    data: keys
      .filter((k) => idByKey.has(k))
      .map((k) => ({
        orgRoleId: slot1.id,
        permissionKeyId: idByKey.get(k)!,
        allowed: true,
      })),
    skipDuplicates: true,
  });
}

export async function POST(req: Request) {
  // Read body
  let displayName = "";
  let orgName = "";
  let email = "";
  let password = "";

  try {
    const body = (await req.json()) ?? {};
    displayName = String(body.displayName || "");
    orgName = String(body.orgName || "");
    email = String(body.email || "");
    password = String(body.password || "");
  } catch (err) {
    return diagError("STEP_PARSE", err, "Invalid request body.", 400);
  }

  // Basic validation (4xx)
  if (!displayName || !orgName || !email || !password) {
    return NextResponse.json(
      { ok: false, message: "Missing or invalid fields." },
      { status: 400 }
    );
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { ok: false, message: "Invalid email address." },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { ok: false, message: "Password must be at least 6 characters." },
      { status: 400 }
    );
  }

  // Early conflict check (409) — do this OUTSIDE the tx to return a friendly error
  try {
    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "An account with this email already exists. Please sign in instead.",
        },
        { status: 409 }
      );
    }
  } catch (err) {
    return diagError("STEP_PRECHECK", err, "Database error during precheck.");
  }

  // ────────────────────────────────────────────────────────────
  // STEP_TX: Create org → org roles (1..10) → user → membership
  // ────────────────────────────────────────────────────────────
  let orgId = "";
  let userId = "";
  let userEmail = "";
  let userDisplay = "";

  try {
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1) Organization
        const org = await tx.organization.create({
          data: { name: orgName.trim() },
          select: { id: true, name: true },
        });

        // 2) Seed OrgRole rows for slots 1..10
        for (let s = 1; s <= 10; s++) {
          const label = s === 1 ? "Admin" : `Role ${s}`;
          const isActive = s === 1;
          await tx.orgRole.upsert({
            where: { orgId_slot: { orgId: org.id, slot: s } },
            update: { label, isActive },
            create: { orgId: org.id, slot: s, label, isActive },
          });
        }

        // 3) User
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await tx.user.create({
          data: {
            email: email.toLowerCase(),
            displayName: displayName.trim(),
            hashedPassword,
          },
          select: { id: true, email: true, displayName: true },
        });

        // 4) Assign membership (slot #1 Admin)
        await tx.userRole.create({
          data: { userId: user.id, orgId: org.id, slot: 1 },
        });

        return { org, user };
      }
    );

    orgId = result.org.id;
    userId = result.user.id;
    userEmail = result.user.email;
    userDisplay = result.user.displayName || result.user.email;
    // eslint-disable-next-line no-console
    console.log("[signup][STEP_TX] ok orgId=%s userId=%s", orgId, userId);
  } catch (err) {
    return diagError(
      "STEP_TX",
      err,
      "Database error while creating your organization/account."
    );
  }

  // ────────────────────────────────────────────────────────────
  // STEP_GRANT: Grant ALL permissions to Slot 1 (policy)
  // moved outside the main tx so we can isolate failures
  // ────────────────────────────────────────────────────────────
  try {
    await grantAllPermsToSlot1(orgId);
    // eslint-disable-next-line no-console
    console.log("[signup][STEP_GRANT] granted all permissions to slot 1");
  } catch (err) {
    return diagError(
      "STEP_GRANT",
      err,
      "Failed to assign admin permissions to your role."
    );
  }

  // Resolve label via access layer (non-fatal)
  let roleLabel = "Admin";
  try {
    const eff = await getEffectiveRole(orgId, 1);
    if (eff?.label) roleLabel = eff.label;
  } catch {
    /* ignore */
  }

  // ────────────────────────────────────────────────────────────
  // STEP_ENCODE: Issue NextAuth-compatible session cookie
  // ────────────────────────────────────────────────────────────
  try {
    const secret = process.env.NEXTAUTH_SECRET || "";
    if (!secret || secret.trim().length < 32) {
      throw new Error("NEXTAUTH_SECRET_MISSING_OR_WEAK");
    }

    const maxAgeSec = 60 * 60 * 24 * 30; // 30 days
    const token = await encode({
      token: {
        sub: userId,
        email: userEmail,
        name: userDisplay,
        orgId,
        roleSlot: 1,
        roleLabel,
      } as any,
      secret,
      maxAge: maxAgeSec,
    });

    const cookieName =
      process.env.NODE_ENV === "production"
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token";

    const res = NextResponse.json(
      { ok: true, redirect: "/modules/booking" },
      { status: 200 }
    );
    res.cookies.set({
      name: cookieName,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: maxAgeSec,
    });

    // eslint-disable-next-line no-console
    console.log("[signup][STEP_ENCODE] cookie set, done");
    return res;
  } catch (err) {
    return diagError(
      "STEP_ENCODE",
      err,
      "Failed to create a sign-in session for you."
    );
  }
}
