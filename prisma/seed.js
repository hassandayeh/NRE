// prisma/seed.js
// Idempotent seed for Org & Tenancy foundation.
// Creates/updates:
// - Organization: "Dev Org"
// - OrgFeatureToggle for that org
// - User: dev@example.com (pre-hashed password)
// - OrganizationMembership: role DEV, and sets user's activeOrgId

const { PrismaClient, Role } = require("@prisma/client");
const prisma = new PrismaClient();

// bcrypt hash for the plaintext "devpassword123" using cost 12
// We keep a fixed hash here to avoid adding bcrypt as a dependency for the seed step.
const DEV_PASSWORD_HASH =
  "$2b$12$ZZM0/HwssgNi7rR4HGck1uXg9Tr/EOv4bpit3d0UJt3RmUnukBIE2";

async function main() {
  console.log("⏳ Seeding database (Org & Tenancy)…");

  // 1) Upsert Dev Org
  const orgName = "Dev Org";
  let org = await prisma.organization.findFirst({ where: { name: orgName } });
  if (!org) {
    org = await prisma.organization.create({ data: { name: orgName } });
    console.log(`✅ Created Organization: ${org.name} (${org.id})`);
  } else {
    console.log(`ℹ️ Organization already exists: ${org.name} (${org.id})`);
  }

  // 2) Upsert OrgFeatureToggle for Dev Org (one row per org)
  const toggles = await prisma.orgFeatureToggle.upsert({
    where: { orgId: org.id },
    update: {
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

  // 3) Upsert Developer user
  const devEmail = "dev@example.com";
  const displayName = "Developer";
  let user = await prisma.user.findUnique({ where: { email: devEmail } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: devEmail,
        name: displayName,
        hashedPassword: DEV_PASSWORD_HASH,
        activeOrgId: org.id, // set active org immediately
      },
    });
    console.log(`✅ Created User: ${devEmail} (${user.id})`);
  } else {
    // Ensure active org is set
    if (user.activeOrgId !== org.id) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { activeOrgId: org.id },
      });
      console.log(`🔄 Updated User activeOrgId → ${org.id}`);
    } else {
      console.log(`ℹ️ User already exists: ${devEmail} (${user.id})`);
    }
  }

  // 4) Upsert membership (user ↔ org) with role DEV
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: user.id, orgId: org.id },
  });
  if (!membership) {
    await prisma.organizationMembership.create({
      data: {
        userId: user.id,
        orgId: org.id,
        role: Role.DEV,
      },
    });
    console.log(`✅ Created membership DEV for ${devEmail} → ${org.name}`);
  } else {
    console.log("ℹ️ Membership already exists for user/org");
  }

  console.log("✅ Seed complete.");
  console.log("————————————————————————————————————————");
  console.log("Local sign-in (once auth is wired in next step):");
  console.log("  Email:    dev@example.com");
  console.log("  Password: devpassword123");
  console.log("————————————————————————————————————————");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
