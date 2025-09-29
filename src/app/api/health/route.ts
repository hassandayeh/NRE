// src/app/api/health/route.ts
import { NextRequest, NextResponse } from "next/server";
// from src/app/api/health/route.ts -> src/lib/auth.ts
import { prisma } from "../../../lib/auth";

export const runtime = "nodejs";

/**
 * GET /api/health
 * - Returns booleans for required env vars (no secrets).
 * - Optionally checks DB connectivity (default: on).
 * - Optional protection with x-health-key header when HEALTHCHECK_KEY is set.
 *
 * Examples:
 *   /api/health                   -> env + DB check
 *   /api/health?db=false          -> env only (skip DB)
 *   curl -H "x-health-key: <key>" https://.../api/health
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const checkDb = url.searchParams.get("db") !== "false"; // default = true

  // Optional header guard (set HEALTHCHECK_KEY in Vercel to enable)
  const headerKey = req.headers.get("x-health-key");
  if (
    process.env.HEALTHCHECK_KEY &&
    headerKey !== process.env.HEALTHCHECK_KEY
  ) {
    return NextResponse.json(
      { ok: false, reason: "unauthorized" },
      { status: 401 }
    );
  }

  const env = {
    NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: !!process.env.NEXTAUTH_URL,
    DATABASE_URL: !!process.env.DATABASE_URL,
    DIRECT_URL: !!process.env.DIRECT_URL,
    HEALTHCHECK_KEY: !!process.env.HEALTHCHECK_KEY,
  };

  let db: "skipped" | "ok" | "error" = "skipped";
  let now: string | null = null;
  let message: string | null = null;

  if (checkDb) {
    try {
      const rows = await prisma.$queryRawUnsafe<{ now: string }[]>(
        "SELECT NOW()"
      );
      db = "ok";
      now = rows?.[0]?.now ?? null;
    } catch (e: any) {
      db = "error";
      message = e?.message ?? String(e);
    }
  }

  const ok =
    env.NEXTAUTH_SECRET &&
    env.NEXTAUTH_URL &&
    env.DATABASE_URL &&
    (!checkDb || db === "ok");

  return NextResponse.json(
    { ok, env, db, now, message },
    { status: ok ? 200 : 500 }
  );
}
