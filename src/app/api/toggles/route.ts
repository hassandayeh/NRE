// src/app/api/toggles/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { z } from "zod";

/**
 * Uses the Prisma model from schema.prisma:
 * model OrgSettings {
 *   id                String   @id @default(cuid())
 *   orgId             String   @unique
 *   showProgramName   Boolean  @default(true)
 *   showHostName      Boolean  @default(true)
 *   showTalkingPoints Boolean  @default(true)
 *   allowInPerson     Boolean  @default(true)
 *   allowOnline       Boolean  @default(true)
 *   createdAt         DateTime @default(now())
 *   updatedAt         DateTime @updatedAt
 * }
 */

// --- Validation schemas ---
const orgIdParam = z.object({ orgId: z.string().min(1, "orgId is required") });

const settingsPatchSchema = z
  .object({
    showProgramName: z.boolean().optional(),
    showHostName: z.boolean().optional(),
    showTalkingPoints: z.boolean().optional(),
    allowInPerson: z.boolean().optional(),
    allowOnline: z.boolean().optional(),
  })
  .strict();

/** Helpers */
function getOrgId(req: NextRequest): string | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("orgId");
  return fromQuery ?? null;
}

function json(data: unknown, init?: number | ResponseInit) {
  const normalized: ResponseInit | undefined =
    typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, normalized);
}

// --- GET /api/toggles?orgId=... ---
// Returns settings for an org; auto-creates the row with defaults if it doesn't exist.
export async function GET(req: NextRequest) {
  const orgId = getOrgId(req);
  const parsed = orgIdParam.safeParse({ orgId });
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }

  const existing = await prisma.orgSettings.findUnique({
    where: { orgId: parsed.data.orgId },
  });

  if (existing) return json(existing);

  const created = await prisma.orgSettings.create({
    data: { orgId: parsed.data.orgId },
  });

  return json(created, 201);
}

// --- POST /api/toggles?orgId=... ---
// Idempotent initialization/upsert (useful for first-time setup).
export async function POST(req: NextRequest) {
  const orgId = getOrgId(req);
  const parsed = orgIdParam.safeParse({ orgId });
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const overrides = settingsPatchSchema.safeParse(body);
  if (!overrides.success) {
    return json({ error: overrides.error.flatten() }, 400);
  }

  const settings = await prisma.orgSettings.upsert({
    where: { orgId: parsed.data.orgId },
    create: { orgId: parsed.data.orgId, ...overrides.data },
    update: { ...overrides.data },
  });

  return json(settings, 201);
}

// --- PATCH /api/toggles?orgId=... ---
// Partial update of any subset of settings.
export async function PATCH(req: NextRequest) {
  const orgId = getOrgId(req);
  const parsed = orgIdParam.safeParse({ orgId });
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }

  const payload = (await req.json().catch(() => ({}))) as unknown;
  const check = settingsPatchSchema.safeParse(payload);
  if (!check.success) {
    return json({ error: check.error.flatten() }, 400);
  }

  const existing = await prisma.orgSettings.findUnique({
    where: { orgId: parsed.data.orgId },
  });

  if (!existing) {
    return json(
      {
        error:
          "OrgSettings not found for this orgId. Call POST to initialize first.",
      },
      404
    );
  }

  const updated = await prisma.orgSettings.update({
    where: { orgId: parsed.data.orgId },
    data: check.data,
  });

  return json(updated);
}
