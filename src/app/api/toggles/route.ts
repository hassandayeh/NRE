import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();

// Small helper: get or create the single org and its toggle row
async function ensureOrgAndToggles() {
  // 1) Find first org
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: { name: "Default Organization" },
    });
  }

  // 2) Ensure toggles row (unique per org)
  let toggles = await prisma.orgFeatureToggle.findUnique({
    where: { orgId: org.id },
  });
  if (!toggles) {
    toggles = await prisma.orgFeatureToggle.create({
      data: { orgId: org.id }, // defaults are true per schema
    });
  }

  return { org, toggles };
}

export async function GET() {
  try {
    const { toggles } = await ensureOrgAndToggles();

    return NextResponse.json({
      toggles: {
        showProgramName: toggles.showProgramName,
        showHostName: toggles.showHostName,
        showTalkingPoints: toggles.showTalkingPoints,
        orgId: toggles.orgId,
        id: toggles.id,
      },
    });
  } catch (err) {
    console.error("GET /api/toggles error:", err);
    return NextResponse.json(
      { error: "Failed to load toggles" },
      { status: 500 }
    );
  }
}

const updateSchema = z.object({
  showProgramName: z.boolean().optional(),
  showHostName: z.boolean().optional(),
  showTalkingPoints: z.boolean().optional(),
});

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue.path.join(".");
      return NextResponse.json(
        { error: `${path || "payload"}: ${issue.message}` },
        { status: 400 }
      );
    }

    const { org, toggles } = await ensureOrgAndToggles();

    const updated = await prisma.orgFeatureToggle.update({
      where: { orgId: org.id },
      data: {
        // Only update keys provided
        ...(parsed.data.showProgramName !== undefined && {
          showProgramName: parsed.data.showProgramName,
        }),
        ...(parsed.data.showHostName !== undefined && {
          showHostName: parsed.data.showHostName,
        }),
        ...(parsed.data.showTalkingPoints !== undefined && {
          showTalkingPoints: parsed.data.showTalkingPoints,
        }),
      },
    });

    // Optional: reflect changes to <body data-*> by reading these at render time.
    return NextResponse.json({
      ok: true,
      toggles: {
        showProgramName: updated.showProgramName,
        showHostName: updated.showHostName,
        showTalkingPoints: updated.showTalkingPoints,
        orgId: updated.orgId,
        id: updated.id,
      },
    });
  } catch (err) {
    console.error("PUT /api/toggles error:", err);
    return NextResponse.json(
      { error: "Failed to update toggles" },
      { status: 500 }
    );
  }
}
