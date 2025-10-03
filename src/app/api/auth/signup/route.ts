// src/app/api/auth/signup/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "../../../../lib/prisma";
import { encode } from "next-auth/jwt";
import { getEffectiveRole } from "../../../../lib/access/permissions";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function POST(req: Request) {
  try {
    const { displayName, orgName, email, password } = (await req.json()) ?? {};

    // Basic validation
    if (
      !displayName ||
      !orgName ||
      !email ||
      !password ||
      typeof displayName !== "string" ||
      typeof orgName !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
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

    // Reject if a user with this email already exists
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

    // Create everything in a single transaction
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1) Organization
        const org = await tx.organization.create({
          data: { name: orgName.trim() },
          select: { id: true, name: true },
        });

        // 2) Seed OrgRole rows for slots 1..10
        //    - Slot #1: label "Admin", isActive:true
        //    - Others: label "Role N", isActive:false
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

    // Resolve label via access layer (non-fatal)
    let roleLabel = "Admin";
    try {
      const eff = await getEffectiveRole(result.org.id, 1);
      if (eff?.label) roleLabel = eff.label;
    } catch {
      /* ignore */
    }

    // Issue NextAuth JWT cookie so the user is signed in
    const maxAgeSec = 60 * 60 * 24 * 30; // 30 days
    const token = await encode({
      token: {
        sub: result.user.id,
        email: result.user.email,
        name: result.user.displayName || result.user.email,
        orgId: result.org.id,
        roleSlot: 1,
        roleLabel,
      } as any,
      secret: process.env.NEXTAUTH_SECRET as string,
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

    return res;
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json(
      {
        ok: false,
        message:
          "Unexpected error while creating your account. Please try again.",
      },
      { status: 500 }
    );
  }
}
