// src/app/api/org/modes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

type ModeDTO = {
  slot: number;
  active: boolean; // computed: row exists for (orgId, slot)
  label: string | null;
};

type AccessDTO = {
  key: string;
  label: string;
};

// --------------------------- GET ---------------------------
// Returns all 10 mode slots with computed "active" and label.
// Also returns the list of global access fields that are used
// by presets in this org (optional for the current UI).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId") || "";

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }

  try {
    const modes = (await prisma.$queryRawUnsafe<ModeDTO[]>(
      `
      WITH slots AS (SELECT generate_series(1,10) AS slot)
      SELECT 
        s.slot::int                       AS slot,
        (m."id" IS NOT NULL)              AS active,
        m."label"                         AS label
      FROM slots s
      LEFT JOIN "OrganizationMode" m
        ON m."orgId" = $1 AND m."slot" = s.slot
      ORDER BY s.slot;
      `,
      orgId
    )) as ModeDTO[];

    const access = (await prisma.$queryRawUnsafe<AccessDTO[]>(
      `
      SELECT DISTINCT a."key" AS key, a."label" AS label
      FROM "OrganizationAccessField" a
      JOIN "OrganizationAccessPreset" p ON p."accessFieldId" = a."id"
      JOIN "OrganizationMode" m ON m."id" = p."orgModeId"
      WHERE m."orgId" = $1
      ORDER BY a."key";
      `,
      orgId
    )) as AccessDTO[];

    return NextResponse.json({ modes, access });
  } catch (err) {
    console.error("GET /api/org/modes failed:", err);
    return NextResponse.json(
      { modes: [], access: [], error: "Server error" },
      { status: 500 }
    );
  }
}

// --------------------------- POST (minimal) ---------------------------
// Optional: basic upsert for a mode label if you choose to call this endpoint.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const action = body?.action;
  const orgId = String(body?.orgId || "");
  if (action !== "mode:update") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const slot = Number(body?.slot || 0);
  const label = String(body?.label || (slot ? `Mode ${slot}` : "Mode")).trim();

  if (!orgId || !slot) {
    return NextResponse.json(
      { error: "orgId and slot are required" },
      { status: 400 }
    );
  }

  try {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "OrganizationMode" ("id","orgId","slot","label","createdAt","updatedAt")
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT ("orgId","slot")
      DO UPDATE SET "label" = EXCLUDED."label", "updatedAt" = NOW();
      `,
      `om_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      orgId,
      slot,
      label
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/org/modes mode:update failed:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
