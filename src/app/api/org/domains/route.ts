// src/app/api/org/domains/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";
import { hasCan } from "../../../../lib/access/permissions";

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

/** Resolve current user id from session (email → user.id) */
async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return null;
  const me = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return me?.id ?? null;
}

/** Require an org-scoped permission; returns userId on success */
async function requireCan(orgId: string, permission: string) {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false as const, status: "unauthorized" as const };
  const ok = await hasCan({ userId, orgId, permission });
  if (!ok) return { ok: false as const, status: "forbidden" as const };
  return { ok: true as const, userId };
}

/**
 * GET /api/org/domains?orgId=...
 * Requires: org:domains:read
 * Returns claimed domains for the org.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId") || "";
  if (!orgId) return badRequest("Missing orgId", "ORG_ID_REQUIRED");

  // Read gate: allow if the viewer has read OR manage (manage ⇒ read).
  const readCheck = await requireCan(orgId, "org:domains:read");

  let userId: string;
  if (readCheck.ok) {
    userId = readCheck.userId;
  } else if (readCheck.status === "unauthorized") {
    return unauthorized();
  } else {
    const manageCheck = await requireCan(orgId, "org:domains:manage");
    if (!manageCheck.ok) return forbidden();
    userId = manageCheck.userId;
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

  // Also report whether the viewer can manage, so the UI can hide/show action buttons.
  const canManage = await hasCan({
    userId,
    orgId,
    permission: "org:domains:manage",
  });

  return NextResponse.json({ orgId, canManage, domains: rows });
}

/**
 * POST /api/org/domains
 * Body: { orgId: string, domain: string, makePrimary?: boolean }
 * Requires: org:domains:manage
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

  // Manage gate (create/update/delete requires manage)
  const manageCheck = await requireCan(orgId, "org:domains:manage");
  if (!manageCheck.ok) {
    return manageCheck.status === "unauthorized" ? unauthorized() : forbidden();
  }
  const userId = manageCheck.userId;

  // Upsert to be idempotent for the same org/domain
  const inserted = await prisma.organizationDomain.upsert({
    where: { orgId_domain: { orgId, domain } },
    update: {}, // nothing to update here; use PATCH later if needed
    create: {
      orgId,
      domain,
      status: "VERIFIED", // MVP: manual verify (no SMTP/DNS yet)
      isPrimary: false,
      verifiedAt: new Date(),
      verifiedByUserId: userId,
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
 * Requires: org:domains:manage
 * Removes a claimed domain for the org.
 */
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = (searchParams.get("orgId") || "").trim();
  const domain = normalizeDomain(searchParams.get("domain") || "");

  if (!orgId) return badRequest("Missing orgId", "ORG_ID_REQUIRED");
  if (!domain) return badRequest("Missing domain", "DOMAIN_REQUIRED");

  const manageCheck = await requireCan(orgId, "org:domains:manage");
  if (!manageCheck.ok) {
    return manageCheck.status === "unauthorized" ? unauthorized() : forbidden();
  }
  const userId = manageCheck.userId;

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
