// src/app/api/org/modes/route.ts
import { NextRequest, NextResponse } from "next/server";
// prisma singleton (matches your existing import style here)
import { prisma } from "../../../../lib/prisma";

// Optional helpers used elsewhere in the repo for auth/perm checks
import { resolveViewerFromRequest } from "../../../../lib/viewer";
import { hasCan } from "../../../../lib/access/permissions";

/* ============================================================================
 * DTOs returned to the UI (unchanged)
 * ==========================================================================*/
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

/* ============================================================================
 * Stub fallback (kept exactly as before)
 * ==========================================================================*/
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

/* ============================================================================
 * Raw SQL row shapes (unchanged)
 * ==========================================================================*/
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

/* ============================================================================
 * Helpers
 * ==========================================================================*/
function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((s) => s.length > 0);
}

async function sessionOrgIdFrom(req: NextRequest): Promise<string | null> {
  try {
    const cookie = req.headers.get("cookie") || "";
    const res = await fetch(new URL("/api/auth/session", req.url).toString(), {
      headers: { cookie },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const sess: any = await res.json().catch(() => null);
    const orgId: string =
      (sess?.orgId as string) ||
      (sess?.user?.orgId as string) ||
      (sess?.user?.org?.id as string) ||
      "";
    return orgId?.trim() || null;
  } catch {
    return null;
  }
}

async function ensureCanManage(
  req: NextRequest,
  orgId: string
): Promise<boolean> {
  const viewer = await resolveViewerFromRequest(req);
  if (!viewer?.userId) return false;

  // Try a few common/manage keys; allow if ANY passes.
  const candidateKeys = [
    "org.modes.manage",
    "settings:manage",
    "org.settings.manage",
  ];
  for (const permission of candidateKeys) {
    try {
      // @ts-ignore repo's hasCan signature accepts this object
      const ok = await hasCan({ userId: viewer.userId, orgId, permission });
      if (ok) return true;
    } catch {
      // ignore unknown permission keys and keep trying
    }
  }
  return false;
}

/* ============================================================================
 * GET  — DB-backed when orgId is present; otherwise stub (UNCHANGED)
 * ==========================================================================*/
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // Keep existing behavior: if orgId missing, return stub to keep the page resilient.
  const orgId = (searchParams.get("orgId") || "").trim();
  if (!orgId) {
    return NextResponse.json({ modes: stubModes, access: stubAccess });
  }

  try {
    // Modes with preset aggregation
    const modesRaw = (await prisma.$queryRawUnsafe(
      `
      SELECT
        m."slot",
        m."active",
        m."label",
        m."accessFieldLabel",
        COALESCE(
          JSON_AGG(mp."value" ORDER BY mp."id") FILTER (WHERE mp."id" IS NOT NULL),
          '[]'
        ) AS "presets"
      FROM "OrganizationMode" m
      LEFT JOIN "OrganizationModePreset" mp ON mp."orgModeId" = m."id"
      WHERE m."orgId" = $1
      GROUP BY m."slot", m."active", m."label", m."accessFieldLabel"
      ORDER BY m."slot" ASC
    `,
      orgId
    )) as unknown as ModeRow[];

    const modes: ModeDto[] = modesRaw.map((r) => ({
      slot: Number(r.slot),
      active: Boolean(r.active),
      label: r.label ?? undefined,
      accessFieldLabel: r.accessFieldLabel ?? undefined,
      presets: Array.isArray(r.presets) ? r.presets : [],
    }));

    // Access fields with preset aggregation
    const accessRaw = (await prisma.$queryRawUnsafe(
      `
      SELECT
        a."key",
        a."label",
        COALESCE(
          JSON_AGG(ap."value" ORDER BY ap."id") FILTER (WHERE ap."id" IS NOT NULL),
          '[]'
        ) AS "presets"
      FROM "OrganizationAccessField" a
      LEFT JOIN "OrganizationAccessPreset" ap ON ap."accessFieldId" = a."id"
      WHERE a."orgId" = $1
      GROUP BY a."key", a."label"
      ORDER BY a."label" ASC
    `,
      orgId
    )) as unknown as AccessRow[];

    const access: AccessFieldDto[] = accessRaw.map((r) => ({
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

/* ============================================================================
 * POST — Mutations with PERMISSION GATING
 * ==========================================================================*/
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    let orgId: string = (body?.orgId || "").trim();
    if (!orgId) {
      const fromSession = await sessionOrgIdFrom(req);
      if (fromSession) orgId = fromSession;
    }
    if (!orgId) {
      return NextResponse.json(
        { ok: false, error: "orgId is required" },
        { status: 400 }
      );
    }

    // Permission gate: only managers can write
    const canManage = await ensureCanManage(req, orgId);
    if (!canManage) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const action = String(body?.action || "").trim();

    switch (action) {
      /* ------------------------- Mode: upsert/update ------------------------*/
      case "mode:update": {
        const slot = Number(body?.slot || 0);
        if (!Number.isInteger(slot) || slot < 1 || slot > 10) {
          return NextResponse.json(
            { ok: false, error: "Invalid slot" },
            { status: 400 }
          );
        }
        const active =
          body?.active === true || body?.active === false
            ? Boolean(body.active)
            : undefined;
        const label =
          typeof body?.label === "string" && body.label.trim()
            ? body.label.trim()
            : undefined;
        const accessFieldLabel =
          typeof body?.accessFieldLabel === "string" &&
          body.accessFieldLabel.trim()
            ? body.accessFieldLabel.trim()
            : undefined;
        const presets = toStringArray(body?.presets);

        // Upsert OrganizationMode by (orgId, slot)
        const mode = await prisma.organizationMode.upsert({
          where: { orgId_slot: { orgId, slot } },
          create: {
            orgId,
            slot,
            active: active ?? true,
            label,
            accessFieldLabel,
          },
          update: {
            ...(active === undefined ? {} : { active }),
            ...(label === undefined ? {} : { label }),
            ...(accessFieldLabel === undefined ? {} : { accessFieldLabel }),
          },
          select: { id: true },
        });

        // Replace presets if provided
        if (presets.length) {
          await prisma.organizationModePreset.deleteMany({
            where: { orgModeId: mode.id },
          });
          await prisma.organizationModePreset.createMany({
            data: presets.map((value) => ({ orgModeId: mode.id, value })),
          });
        } else if (Array.isArray(body?.presets)) {
          // Explicitly clear when empty array passed
          await prisma.organizationModePreset.deleteMany({
            where: { orgModeId: mode.id },
          });
        }

        return NextResponse.json({ ok: true, status: "mode_updated" });
      }

      /* ---------------------- Access field: create/upsert --------------------*/
      case "access:create":
      case "access:update": {
        const key =
          typeof body?.key === "string" && body.key.trim()
            ? body.key.trim()
            : null;
        const label =
          typeof body?.label === "string" && body.label.trim()
            ? body.label.trim()
            : null;
        const presets = toStringArray(body?.presets);

        if (!key || !label) {
          return NextResponse.json(
            { ok: false, error: "key and label are required" },
            { status: 400 }
          );
        }

        const field = await prisma.organizationAccessField.upsert({
          where: { orgId_key: { orgId, key } },
          create: { orgId, key, label },
          update: { label },
          select: { id: true },
        });

        // Replace presets if provided
        if (presets.length) {
          await prisma.organizationAccessPreset.deleteMany({
            where: { accessFieldId: field.id },
          });
          await prisma.organizationAccessPreset.createMany({
            data: presets.map((value) => ({ accessFieldId: field.id, value })),
          });
        } else if (Array.isArray(body?.presets)) {
          await prisma.organizationAccessPreset.deleteMany({
            where: { accessFieldId: field.id },
          });
        }

        return NextResponse.json({ ok: true, status: "access_saved" });
      }

      /* -------------------------- Access field: delete -----------------------*/
      case "access:delete": {
        const key =
          typeof body?.key === "string" && body.key.trim()
            ? body.key.trim()
            : null;
        if (!key) {
          return NextResponse.json(
            { ok: false, error: "key is required" },
            { status: 400 }
          );
        }

        // Cascade delete presets first (if no FK cascade)
        const field = await prisma.organizationAccessField.findUnique({
          where: { orgId_key: { orgId, key } },
          select: { id: true },
        });
        if (field) {
          await prisma.organizationAccessPreset.deleteMany({
            where: { accessFieldId: field.id },
          });
          await prisma.organizationAccessField.delete({
            where: { orgId_key: { orgId, key } },
          });
        }

        return NextResponse.json({ ok: true, status: "access_deleted" });
      }

      default:
        return NextResponse.json(
          { ok: false, error: "Unknown or missing action" },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error("POST /api/org/modes error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to update modes/access" },
      { status: 500 }
    );
  }
}
