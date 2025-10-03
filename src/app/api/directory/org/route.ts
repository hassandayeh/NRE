// src/app/api/directory/org/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Err = { error: string; code?: string };

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
function badRequest(msg: string, code?: string) {
  return json({ error: msg, code } as Err, { status: 400 });
}
function unauthorized() {
  return json({ error: "Unauthorized" } as Err, { status: 401 });
}
function forbidden() {
  return json({ error: "Forbidden" } as Err, { status: 403 });
}
function notFound() {
  return json({ error: "Not found" } as Err, { status: 404 });
}
function conflict(msg = "Multiple organizations") {
  return json({ error: msg, code: "MULTI_ORG" } as Err, { status: 409 });
}

/**
 * GET /api/directory/org
 *
 * Returns the acting user's organization in a simple, client-friendly shape.
 * - If orgId is provided, validates membership and echoes it back.
 * - If orgId is not provided and the user belongs to exactly one org, auto-selects it.
 * - If user belongs to multiple orgs, returns 409 so the caller can choose.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return unauthorized();

  const { searchParams } = new URL(req.url);
  const orgIdParam = (searchParams.get("orgId") || "").trim() || null;

  // If explicit orgId was given, ensure the caller is a member of it.
  if (orgIdParam) {
    const member = await prisma.userRole.findUnique({
      where: { userId_orgId: { userId, orgId: orgIdParam } },
      select: { orgId: true },
    });
    if (!member) return forbidden();
    // Redundant keys so clients can read orgId via several shapes
    return json({ orgId: member.orgId, id: member.orgId });
  }

  // No explicit orgId → infer from memberships.
  const memberships = await prisma.userRole.findMany({
    where: { userId },
    select: { orgId: true },
    take: 2, // we only need to know if there’s more than one
  });

  if (memberships.length === 0) return notFound();
  if (memberships.length > 1) return conflict();

  const only = memberships[0]!;
  return json({ orgId: only.orgId, id: only.orgId });
}
