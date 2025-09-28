// src/app/api/org/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";
import { z } from "zod";

/** Helpers */
function json(data: unknown, init?: number | ResponseInit) {
  const normalized: ResponseInit | undefined =
    typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, normalized);
}

async function requireUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  const id = (session.user as any)?.id as string | undefined;
  const email = (session.user as any)?.email as string | undefined;

  if (id) {
    const u = await prisma.user.findUnique({ where: { id } });
    if (u) return u;
  }
  if (email) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (u) return u;
  }
  return null;
}

/**
 * Resolve the organization the requester OWNS.
 * If `?orgId=` is provided, we verify ownership of that org.
 * Otherwise we pick the first org where the user has role OWNER.
 */
async function resolveOwnerOrgId(userId: string, req: NextRequest) {
  const url = new URL(req.url);
  const qOrgId = url.searchParams.get("orgId")?.trim();

  if (qOrgId) {
    const own = await prisma.organizationMembership.findFirst({
      where: { userId, orgId: qOrgId, role: "OWNER" as any },
      select: { orgId: true },
    });
    if (!own) return null;
    return own.orgId;
  }

  const anyOwned = await prisma.organizationMembership.findFirst({
    where: { userId, role: "OWNER" as any },
    select: { orgId: true },
  });
  return anyOwned?.orgId ?? null;
}

/** Validation */
const putSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200, "Too long"),
  })
  .strict();

/** GET /api/org/profile[?orgId=...] — owner only */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const orgId = await resolveOwnerOrgId((user as any).id, req);
  if (!orgId) return json({ error: "Forbidden (owner only)" }, 403);

  // Avoid typed select (older Prisma clients): fetch broad and pick fields
  const org = (await prisma.organization.findUnique({
    where: { id: orgId },
  })) as any;

  if (!org) return json({ error: "Organization not found" }, 404);

  return json({
    org: {
      id: org.id,
      name: org.name,
      // Future: logoUrl, description (after schema adds)
    },
  });
}

/** PUT /api/org/profile[?orgId=...] — owner only */
export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const orgId = await resolveOwnerOrgId((user as any).id, req);
  if (!orgId) return json({ error: "Forbidden (owner only)" }, 403);

  let payload: unknown = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = putSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }

  const updated = (await prisma.organization.update({
    where: { id: orgId },
    data: { name: parsed.data.name } as any,
  })) as any;

  return json({
    org: {
      id: updated.id,
      name: updated.name,
    },
  });
}

// PATCH behaves like PUT for convenience
export const PATCH = PUT;
