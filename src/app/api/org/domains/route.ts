// src/app/api/org/domains/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";

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

/**
 * Minimal email-domain normalization:
 * - lowercases
 * - strips surrounding spaces
 * - removes leading "@"
 */
function normalizeDomain(input: string) {
  let d = (input || "").trim().toLowerCase();
  if (d.startsWith("@")) d = d.slice(1);
  return d;
}

/**
 * Admin check:
 * - Session required
 * - User must have a UserRole in the org with slot === 1 (admin)
 *   (Matches our Role 1 = Org Admin convention; narrow enough for MVP.)
 */
async function requireOrgAdmin(orgId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email)
    return { ok: false as const, status: "unauthorized" as const };

  const email = session.user.email!;
  const me = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!me?.id) return { ok: false as const, status: "unauthorized" as const };
  const userId = me.id;

  const membership = await prisma.userRole.findFirst({
    where: { userId, orgId, slot: 1 }, // Admin slot
    select: { userId: true },
  });

  if (!membership) return { ok: false as const, status: "forbidden" as const };
  return { ok: true as const, userId };
}

/**
 * GET /api/org/domains?orgId=...
 * Returns claimed domains for the org.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId") || "";

  if (!orgId) return badRequest("Missing orgId", "ORG_ID_REQUIRED");

  const adminCheck = await requireOrgAdmin(orgId);
  if (!adminCheck.ok) {
    return adminCheck.status === "unauthorized" ? unauthorized() : forbidden();
  }

  const rows = await prisma.organizationDomain.findMany({
    where: { orgId },
    orderBy: [{ isPrimary: "desc" }, { domain: "asc" }],
    select: {
      domain: true,
      status: true,
      isPrimary: true,
      verifiedAt: true,
    },
  });

  return NextResponse.json({ orgId, domains: rows });
}

/**
 * POST /api/org/domains
 * Body: { orgId: string, domain: string, makePrimary?: boolean }
 * Creates (VERIFIED for now) and optionally marks as primary.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body", "INVALID_JSON");
  }

  const orgId = (body?.orgId || "").trim();
  let domain = normalizeDomain(body?.domain || "");
  const makePrimary = !!body?.makePrimary;

  if (!orgId) return badRequest("Missing orgId", "ORG_ID_REQUIRED");
  if (!domain) return badRequest("Missing domain", "DOMAIN_REQUIRED");
  if (domain.includes("/") || domain.includes(" ")) {
    return badRequest("Invalid domain", "DOMAIN_INVALID");
  }

  const adminCheck = await requireOrgAdmin(orgId);
  if (!adminCheck.ok) {
    return adminCheck.status === "unauthorized" ? unauthorized() : forbidden();
  }

  // Upsert to be idempotent for the same org/domain
  const inserted = await prisma.organizationDomain.upsert({
    where: { orgId_domain: { orgId, domain } },
    update: {}, // nothing to update here; use PATCH later if needed
    create: {
      orgId,
      domain,
      status: "VERIFIED", // Manual verify for MVP (no SMTP/DNS yet)
      isPrimary: false,
      verifiedAt: new Date(),
      verifiedByUserId: adminCheck.userId,
    },
    select: { domain: true, status: true, isPrimary: true, verifiedAt: true },
  });

  if (makePrimary) {
    // Make this domain primary and unset others
    await prisma.$transaction([
      prisma.organizationDomain.update({
        where: { orgId_domain: { orgId, domain } },
        data: { isPrimary: true },
      }),
      prisma.organizationDomain.updateMany({
        where: { orgId, domain: { not: domain }, isPrimary: true },
        data: { isPrimary: false },
      }),
    ]);
  }

  return NextResponse.json({ ok: true, domain: inserted });
}

/**
 * DELETE /api/org/domains?orgId=...&domain=...
 * Removes a claimed domain for the org.
 */
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = (searchParams.get("orgId") || "").trim();
  const domain = normalizeDomain(searchParams.get("domain") || "");

  if (!orgId) return badRequest("Missing orgId", "ORG_ID_REQUIRED");
  if (!domain) return badRequest("Missing domain", "DOMAIN_REQUIRED");

  const adminCheck = await requireOrgAdmin(orgId);
  if (!adminCheck.ok) {
    return adminCheck.status === "unauthorized" ? unauthorized() : forbidden();
  }

  // Guard: do not allow deleting the only primary if it is the only domain
  const existing = await prisma.organizationDomain.findMany({
    where: { orgId },
    select: { domain: true, isPrimary: true },
  });

  const target = existing.find((d) => d.domain === domain);
  if (!target) return badRequest("Domain not found", "DOMAIN_NOT_FOUND");

  if (target.isPrimary && existing.length > 1) {
    // If deleting a primary and others exist, automatically promote the first non-target domain
    const promote = existing.find((d) => d.domain !== domain);
    if (promote) {
      await prisma.organizationDomain.update({
        where: { orgId_domain: { orgId, domain: promote.domain } },
        data: { isPrimary: true },
      });
    }
  }

  await prisma.organizationDomain.delete({
    where: { orgId_domain: { orgId, domain } },
  });

  return NextResponse.json({ ok: true });
}
