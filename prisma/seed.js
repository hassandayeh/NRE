// prisma/seed.js
// Minimal, robust seed for local/dev environments.
// - Uses DIRECT_URL to avoid PgBouncer pool limits during seeding.
// - Performs writes sequentially to prevent pool timeouts.
// - Seeds: Dev Org, 10 role slots, Admin user, UserRole, and grants `settings:manage` to slot 4.

const { PrismaClient } = require("@prisma/client");

// Force the seed to use DIRECT_URL (non-pooler). Fallback to DATABASE_URL if needed.
const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
  },
});

async function main() {
  // ---- bcrypt for password hashing ----
  let bcrypt;
  try {
    bcrypt = require("bcryptjs");
  } catch (e) {
    console.error("\nMissing dependency: bcryptjs\nRun: npm i bcryptjs\n");
    throw e;
  }

  const adminEmail = "admin@dev.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "123456";
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // ---- 1) Organization ----
  const org = await prisma.organization.upsert({
    where: { id: "org-dev" }, // deterministic to keep seed idempotent
    update: { name: "Dev Org" },
    create: { id: "org-dev", name: "Dev Org" },
  });

  // ---- 2) Org roles (slots 1..10). Slot 4 is Admin and active. ----
  const slots = Array.from({ length: 10 }, (_, i) => i + 1);
  for (const slot of slots) {
    await prisma.orgRole.upsert({
      where: { orgId_slot: { orgId: org.id, slot } }, // @@unique([orgId, slot])
      update: {},
      create: {
        orgId: org.id,
        slot,
        label: slot === 4 ? "Admin" : `Role ${slot}`,
        isActive: slot === 4,
      },
    });
  }

  // ---- 3) Admin user ----
  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { displayName: "Dev Admin", hashedPassword: passwordHash },
    create: {
      id: "user-admin-dev",
      email: adminEmail,
      displayName: "Dev Admin",
      hashedPassword: passwordHash,
      supportsOnline: true,
    },
  });

  // ---- 4) Membership (UserRole) ----
  await prisma.userRole.upsert({
    where: { userId_orgId: { userId: user.id, orgId: org.id } }, // @@id([userId, orgId])
    update: { slot: 4, orgManaged: true },
    create: { userId: user.id, orgId: org.id, slot: 4, orgManaged: true },
  });

  // ---- 5) Permissions: grant `settings:manage` to the Admin slot (4) ----
  const settingsKey = await prisma.permissionKey.upsert({
    where: { key: "settings:manage" },
    update: {},
    create: {
      key: "settings:manage",
      description: "Manage organization settings",
    },
  });

  const adminRole = await prisma.orgRole.findUnique({
    where: { orgId_slot: { orgId: org.id, slot: 4 } },
  });

  // Composite PK: (orgRoleId, permissionKeyId)
  await prisma.orgRolePermission.upsert({
    where: {
      orgRoleId_permissionKeyId: {
        orgRoleId: adminRole.id,
        permissionKeyId: settingsKey.id,
      },
    },
    update: { allowed: true },
    create: {
      orgRoleId: adminRole.id,
      permissionKeyId: settingsKey.id,
      allowed: true,
    },
  });

  console.log("\n✅ Seed complete.");
  console.log("Login with:");
  console.log("  Email   : admin@dev.local");
  console.log(`  Password: ${adminPassword}\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ Seed failed:\n", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
