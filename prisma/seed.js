// prisma/seed.js
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function ensureDefaultOrg() {
  // Ensure a single default org exists (non-destructive if already present)
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: { name: "Default Organization" },
    });
    console.log(`🧱 Created default org: ${org.name}`);
  } else {
    console.log(`🏢 Using existing org: ${org.name}`);
  }
  return org;
}

async function ensureOrgFeatureToggles(orgId) {
  // One toggle row per org — assumed unique on orgId in your schema
  let toggles = await prisma.orgFeatureToggle.findUnique({
    where: { orgId },
  });
  if (!toggles) {
    toggles = await prisma.orgFeatureToggle.create({
      data: { orgId }, // rely on schema defaults (typically true)
    });
    console.log(`🟢 Created feature toggles for org ${orgId}`);
  } else {
    console.log(`⚙️  Feature toggles already exist for org ${orgId}`);
  }
  return toggles;
}

async function upsertDevUser() {
  const email = "dev@example.com";
  const plain = "devpass123";
  const hashedPassword = await bcrypt.hash(plain, 10);

  await prisma.user.upsert({
    where: { email },
    update: {
      name: "Dev User",
      hashedPassword, // ✅ correct field name per schema
    },
    create: {
      email,
      name: "Dev User",
      hashedPassword, // ✅ correct field name per schema
    },
  });

  console.log(`👤 Seeded dev user: ${email} (password: ${plain})`);
}

async function main() {
  const org = await ensureDefaultOrg();
  await ensureOrgFeatureToggles(org.id);
  await upsertDevUser();
  console.log("✅ Seed completed.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
