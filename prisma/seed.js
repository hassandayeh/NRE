// prisma/seed.js
// Plain Node.js seed script (no ts-node/tsx required).
// Models referenced: Organization, OrgFeatureToggle
//
// What it does:
// 1) Ensures a default Organization exists.
// 2) Ensures exactly one OrgFeatureToggle row exists for that org
//    (respects the @@unique([orgId]) constraint in schema).
//
// Safe to run multiple times (idempotent).

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("⏳ Seeding database…");

  // 1) Upsert a default organization
  const orgName = "Default Organization";
  let org = await prisma.organization.findFirst({
    where: { name: orgName },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: { name: orgName },
    });
    console.log(`✅ Created Organization: ${org.name} (${org.id})`);
  } else {
    console.log(`ℹ️ Organization already exists: ${org.name} (${org.id})`);
  }

  // 2) Upsert the single toggle row for this org
  //    The schema has @@unique([orgId]) on OrgFeatureToggle,
  //    so "where: { orgId: ... }" is a valid unique selector.
  const toggles = await prisma.orgFeatureToggle.upsert({
    where: { orgId: org.id },
    update: {
      // Default values (can be changed later in-app or via a follow-up seed)
      showProgramName: true,
      showHostName: true,
      showTalkingPoints: true,
    },
    create: {
      orgId: org.id,
      showProgramName: true,
      showHostName: true,
      showTalkingPoints: true,
    },
  });

  console.log("✅ Upserted OrgFeatureToggle:", {
    orgId: toggles.orgId,
    showProgramName: toggles.showProgramName,
    showHostName: toggles.showHostName,
    showTalkingPoints: toggles.showTalkingPoints,
  });

  console.log("🎉 Seed complete.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
