// src/app/api/org/modes/presets/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = {
  modeSlot: number;
  modeLabel: string | null;
  label: string;
  details: string;
};

function ok(rows: Row[]) {
  return NextResponse.json(rows, { status: 200 });
}
function err(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orgId =
      searchParams.get("orgId") || req.headers.get("x-org-id") || "";
    if (!orgId) return err(400, "orgId is required");

    // Read access presets by joining to OrganizationMode + OrganizationAccessField via Prisma relations
    const presets = await prisma.organizationAccessPreset.findMany({
      where: { organizationMode: { orgId } },
      select: {
        value: true, // details
        organizationMode: { select: { slot: true, label: true } },
        accessField: { select: { label: true } },
      },
    });

    const rows: Row[] = (presets ?? []).map((p) => ({
      modeSlot: p.organizationMode.slot,
      modeLabel: p.organizationMode.label ?? null,
      label: p.accessField.label,
      details: p.value ?? "",
    }));

    // Stable sort: by slot, then label, then details
    rows.sort(
      (a, b) =>
        a.modeSlot - b.modeSlot ||
        a.label.localeCompare(b.label) ||
        a.details.localeCompare(b.details)
    );

    return ok(rows);
  } catch (e) {
    console.error("[api/org/modes/presets] error", e);
    return err(500, "Failed to load mode access presets");
  }
}
