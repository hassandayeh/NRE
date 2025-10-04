// src/app/api/org/modes/route.ts
import { NextResponse } from "next/server";
// Relative path to your prisma singleton
import { prisma } from "../../../../lib/prisma";

// ---- DTOs returned to the UI ----
type ModeDto = {
  slot: number; // 1..10
  active: boolean;
  label?: string;
  accessFieldLabel?: string;
  presets?: string[];
};

type AccessFieldDto = {
  key: string; // e.g., "link" | "address" | "dial"
  label: string; // e.g., "Link" | "Address" | "Dial-in number"
  presets?: string[];
};

// ---- Stub data (fallback) ----
const stubModes: ModeDto[] = [
  {
    slot: 1,
    active: true,
    label: "Online",
    accessFieldLabel: "Link",
    presets: ["Zoom (Default)", "Teams"],
  },
  {
    slot: 2,
    active: true,
    label: "In-Person",
    accessFieldLabel: "Address",
    presets: ["Studio A — HQ", "Studio B — Downtown"],
  },
  {
    slot: 3,
    active: true,
    label: "Phone",
    accessFieldLabel: "Dial-in number",
    presets: [],
  },
  { slot: 4, active: false },
  { slot: 5, active: false },
  { slot: 6, active: false },
  { slot: 7, active: false },
  { slot: 8, active: false },
  { slot: 9, active: false },
  { slot: 10, active: false },
];

const stubAccess: AccessFieldDto[] = [
  { key: "link", label: "Link", presets: ["Zoom (Default)", "Teams"] },
  {
    key: "address",
    label: "Address",
    presets: ["Studio A — HQ", "Studio B — Downtown"],
  },
  { key: "dial", label: "Dial-in number", presets: [] },
];

// ---- DB row shapes for raw SQL (explicit typing; no "implicit any") ----
interface ModeRow {
  slot: number;
  active: boolean;
  label: string | null;
  accessFieldLabel: string | null;
  presets: string[]; // aggregated JSON array
}

interface AccessRow {
  key: string;
  label: string;
  presets: string[]; // aggregated JSON array
}

// ---- GET (raw SQL when orgId provided; otherwise stub) ----
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId") ?? undefined;

  if (!orgId) {
    // Keep page working without org context
    return NextResponse.json({ modes: stubModes, access: stubAccess });
  }

  try {
    // Modes with preset aggregation
    const modesRaw = (await prisma.$queryRawUnsafe<ModeRow[]>(
      `
      SELECT
        m."slot",
        m."active",
        m."label",
        m."accessFieldLabel",
        COALESCE(
          JSON_AGG(mp."value" ORDER BY mp."id")
            FILTER (WHERE mp."id" IS NOT NULL),
          '[]'
        ) AS "presets"
      FROM "OrganizationMode" m
      LEFT JOIN "OrganizationModePreset" mp
        ON mp."orgModeId" = m."id"
      WHERE m."orgId" = $1
      GROUP BY m."slot", m."active", m."label", m."accessFieldLabel"
      ORDER BY m."slot" ASC
      `,
      orgId
    )) as unknown as ModeRow[];

    const modes: ModeDto[] = modesRaw.map((r: ModeRow) => ({
      slot: Number(r.slot),
      active: Boolean(r.active),
      label: r.label ?? undefined,
      accessFieldLabel: r.accessFieldLabel ?? undefined,
      presets: Array.isArray(r.presets) ? r.presets : [],
    }));

    // Access fields with preset aggregation
    const accessRaw = (await prisma.$queryRawUnsafe<AccessRow[]>(
      `
      SELECT
        a."key",
        a."label",
        COALESCE(
          JSON_AGG(ap."value" ORDER BY ap."id")
            FILTER (WHERE ap."id" IS NOT NULL),
          '[]'
        ) AS "presets"
      FROM "OrganizationAccessField" a
      LEFT JOIN "OrganizationAccessPreset" ap
        ON ap."accessFieldId" = a."id"
      WHERE a."orgId" = $1
      GROUP BY a."key", a."label"
      ORDER BY a."label" ASC
      `,
      orgId
    )) as unknown as AccessRow[];

    const access: AccessFieldDto[] = accessRaw.map((r: AccessRow) => ({
      key: r.key,
      label: r.label,
      presets: Array.isArray(r.presets) ? r.presets : [],
    }));

    return NextResponse.json({ modes, access });
  } catch {
    // Any DB error → safe stub
    return NextResponse.json({ modes: stubModes, access: stubAccess });
  }
}
