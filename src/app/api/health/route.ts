// src/app/api/health/route.ts
import { NextResponse } from "next/server";
// from src/app/api/health/route.ts -> src/lib/auth.ts
import { prisma } from "../../../lib/auth";

export const runtime = "nodejs";

export async function GET() {
  // booleans only—no secrets are exposed
  const env = {
    NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: !!process.env.NEXTAUTH_URL,
    DATABASE_URL: !!process.env.DATABASE_URL,
    DIRECT_URL: !!process.env.DIRECT_URL,
  };

  try {
    // quick DB check
    const now = await prisma.$queryRawUnsafe<{ now: string }[]>("SELECT NOW()");
    return NextResponse.json({
      ok: true,
      env,
      db: "ok",
      now: now?.[0]?.now ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, env, db: "error", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
