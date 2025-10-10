// src/app/api/org/modes/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { resolveViewerFromRequest } from "../../../../lib/viewer";
import { hasCan } from "../../../../lib/access/permissions";

/* ================================== DTOs ================================== */
type ModeDto = {
  slot: number;
  active: boolean;
  label?: string;
  accessFieldLabel?: string;
  presets?: string[];
};

type AccessFieldDto = {
  key: string;
  label: string;
  presets?: string[];
};

/* =============================== Stub Data ================================ */
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

/* =========================== Raw SQL row shapes =========================== */
interface ModeRow {
  slot: number;
  active: boolean;
  label: string | null;
  accessFieldLabel: string | null;
  presets: string[];
}

interface AccessRow {
  key: string;
  label: string;
  presets: string[];
}

/* ================================ Helpers ================================= */
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
  const candidateKeys = [
    "org.modes.manage",
    "settings:manage",
    "org.settings.manage",
  ];
  for (const permission of candidateKeys) {
    try {
      // @ts-ignore: repo helper signature
      const ok = await hasCan({ userId: viewer.userId, orgId, permission });
      if (ok) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/* ================================== GET =================================== */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = (searchParams.get("orgId") || "").trim();

  if (!orgId) {
    return NextResponse.json({ modes: stubModes, access: stubAccess });
  }

  try {
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
      LEFT JOIN "OrganizationModePreset" mp
        ON mp."orgModeId" = m."id"
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

    const accessRaw = (await prisma.$queryRawUnsafe(
      `
      SELECT
        a."key",
        a."label",
        COALESCE(
          JSON_AGG(ap."value" ORDER BY ap."id") FILTER (WHERE m."orgId" = $1),
          '[]'
        ) AS "presets"
      FROM "OrganizationAccessField" a
      LEFT JOIN "OrganizationAccessPreset" ap
        ON ap."accessFieldId" = a."id"
      LEFT JOIN "OrganizationMode" m
        ON m."id" = ap."orgModeId"
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
    return NextResponse.json({ modes: stubModes, access: stubAccess });
  }
}

/* ================================== POST ================================== */
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

    const canManage = await ensureCanManage(req, orgId);
    if (!canManage) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const action = String(body?.action || "").trim();

    switch (action) {
      /* --------------------------- mode:update --------------------------- */
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
        const labelInput =
          typeof body?.label === "string" && body.label.trim()
            ? body.label.trim()
            : undefined;
        const accessFieldLabel =
          typeof body?.accessFieldLabel === "string" &&
          body.accessFieldLabel.trim()
            ? body.accessFieldLabel.trim()
            : undefined;
        const presets = toStringArray(body?.presets);

        // IMPORTANT: label is required by schema → provide a default when creating
        const defaultLabel = `Mode ${slot}`;

        const mode = await prisma.organizationMode.upsert({
          where: { orgId_slot: { orgId, slot } },
          create: {
            orgId,
            slot,
            active: active ?? true,
            label: labelInput ?? defaultLabel,
            ...(accessFieldLabel ? { accessFieldLabel } : {}),
          },
          update: {
            ...(active === undefined ? {} : { active }),
            ...(labelInput === undefined ? {} : { label: labelInput }),
            ...(accessFieldLabel === undefined ? {} : { accessFieldLabel }),
          },
          select: { id: true },
        });

        if (presets.length) {
          await prisma.organizationModePreset.deleteMany({
            where: { orgModeId: mode.id },
          });
          await prisma.organizationModePreset.createMany({
            data: presets.map((value) => ({ orgModeId: mode.id, value })),
          });
        } else if (Array.isArray(body?.presets)) {
          await prisma.organizationModePreset.deleteMany({
            where: { orgModeId: mode.id },
          });
        }

        return NextResponse.json({ ok: true, status: "mode_updated" });
      }

      /* --------------------- access:create / access:update -------------------- */
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
        const modeSlotRaw = body?.modeSlot;
        const modeSlot =
          Number.isInteger(modeSlotRaw) || typeof modeSlotRaw === "string"
            ? Number(modeSlotRaw)
            : 0;

        if (!key || !label) {
          return NextResponse.json(
            { ok: false, error: "key and label are required" },
            { status: 400 }
          );
        }

        // Access fields are GLOBAL: upsert by `key`
        const field = await prisma.organizationAccessField.upsert({
          where: { key },
          create: { key, label },
          update: { label },
          select: { id: true },
        });

        // If presets array is present, we must have a valid modeSlot to attach them.
        if (Array.isArray(body?.presets)) {
          if (!Number.isInteger(modeSlot) || modeSlot < 1 || modeSlot > 10) {
            if (presets.length) {
              return NextResponse.json(
                {
                  ok: false,
                  error: "modeSlot (1..10) is required when providing presets",
                },
                { status: 400 }
              );
            }
            // else: silently ignore (no presets to write)
          } else {
            // IMPORTANT: label is required by schema → provide a default when creating
            const defaultModeLabel = `Mode ${modeSlot}`;

            const mode = await prisma.organizationMode.upsert({
              where: { orgId_slot: { orgId, slot: modeSlot } },
              create: {
                orgId,
                slot: modeSlot,
                active: true,
                label: defaultModeLabel,
              },
              update: {},
              select: { id: true },
            });

            await prisma.organizationAccessPreset.deleteMany({
              where: { orgModeId: mode.id, accessFieldId: field.id },
            });

            if (presets.length) {
              await prisma.organizationAccessPreset.createMany({
                data: presets.map((value) => ({
                  orgModeId: mode.id,
                  accessFieldId: field.id,
                  value,
                })),
              });
            }
          }
        }

        return NextResponse.json({ ok: true, status: "access_saved" });
      }

      /* ------------------------------ access:delete --------------------------- */
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

        const field = await prisma.organizationAccessField.findUnique({
          where: { key },
          select: { id: true },
        });

        if (field) {
          const modes = await prisma.organizationMode.findMany({
            where: { orgId },
            select: { id: true },
          });
          const modeIds = modes.map((m) => m.id);
          if (modeIds.length) {
            await prisma.organizationAccessPreset.deleteMany({
              where: { accessFieldId: field.id, orgModeId: { in: modeIds } },
            });
          }
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
