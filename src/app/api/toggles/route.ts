// src/app/api/toggles/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { z } from "zod";

/**
 * This route serves org-scoped feature toggles.
 * It no longer requires `?orgId=...` — if omitted, we resolve an org automatically:
 *  1) Use the first OrgSettings row's orgId, or
 *  2) Use the first Organization row's id, or
 *  3) Create a minimal Organization ("Default Org") and use its id.
 *
 * This keeps the Settings page working in dev/staging without extra wiring.
 */

// ---- Validation ----
const patchSchema = z
  .object({
    showProgramName: z.boolean().optional(),
    showHostName: z.boolean().optional(),
    showTalkingPoints: z.boolean().optional(),
    // New (client already shows them; safe to persist)
    allowInPerson: z.boolean().optional(),
    allowOnline: z.boolean().optional(),
  })
  .strict();

type PatchShape = z.infer<typeof patchSchema>;

// ---- Helpers ----
function json(data: unknown, init?: number | ResponseInit) {
  const normalized: ResponseInit | undefined =
    typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, normalized);
}

async function resolveOrgId(req: NextRequest): Promise<string> {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("orgId");
  if (fromQuery && fromQuery.trim()) return fromQuery;

  // 1) If any OrgSettings row exists, reuse its orgId
  const anySettings = await prisma.orgSettings.findFirst({
    select: { orgId: true },
  });
  if (anySettings?.orgId) return anySettings.orgId;

  // 2) If any Organization exists, use it
  const anyOrg = await prisma.organization.findFirst({
    select: { id: true },
  });
  if (anyOrg?.id) return anyOrg.id;

  // 3) Dev fallback: create a minimal org
  const createdOrg = await prisma.organization.create({
    data: { name: "Default Org" },
    select: { id: true },
  });
  return createdOrg.id;
}

function pickSettings(row: {
  orgId: string;
  showProgramName: boolean;
  showHostName: boolean;
  showTalkingPoints: boolean;
  allowInPerson: boolean;
  allowOnline: boolean;
}) {
  // Flat shape so the client accepts it without special casing
  return {
    orgId: row.orgId,
    showProgramName: row.showProgramName,
    showHostName: row.showHostName,
    showTalkingPoints: row.showTalkingPoints,
    allowInPerson: row.allowInPerson,
    allowOnline: row.allowOnline,
  };
}

async function getOrCreateSettings(orgId: string) {
  const found = await prisma.orgSettings.findUnique({
    where: { orgId },
  });
  if (found) return found;

  // Create with defaults (as per Prisma schema defaults)
  return prisma.orgSettings.create({
    data: { orgId },
  });
}

// ---- Handlers ----

// GET /api/toggles[?orgId=...]
export async function GET(req: NextRequest) {
  try {
    const orgId = await resolveOrgId(req);
    const settings = await getOrCreateSettings(orgId);
    return json(pickSettings(settings));
  } catch (e: any) {
    return json({ error: e?.message ?? "Failed to load toggles" }, 500);
  }
}

// PUT /api/toggles[?orgId=...]
// Accepts a flat JSON body of any subset of the known boolean keys.
export async function PUT(req: NextRequest) {
  try {
    const orgId = await resolveOrgId(req);
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      /* empty body handled below */
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, 400);
    }

    // Ensure row exists, then update
    await getOrCreateSettings(orgId);
    const updated = await prisma.orgSettings.update({
      where: { orgId },
      data: parsed.data,
    });

    return json(pickSettings(updated));
  } catch (e: any) {
    return json({ error: e?.message ?? "Failed to save toggles" }, 500);
  }
}

// PATCH supported for convenience (same behavior as PUT)
export const PATCH = PUT;

// Optional: POST can act as idempotent "initialize/upsert" (kept compatible)
export async function POST(req: NextRequest) {
  try {
    const orgId = await resolveOrgId(req);
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      /* allow empty */
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: parsed.error.flatten() }, 400);
    }
    const upserted = await prisma.orgSettings.upsert({
      where: { orgId },
      create: { orgId, ...parsed.data },
      update: { ...parsed.data },
    });
    return json(pickSettings(upserted), 201);
  } catch (e: any) {
    return json({ error: e?.message ?? "Failed to initialize toggles" }, 500);
  }
}
