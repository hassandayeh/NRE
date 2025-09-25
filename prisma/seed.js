/* prisma/seed.js
 * Seed dataset for NRE (matches current schema)
 * - Password for all users = "123"
 * - Creates:
 *    - Orgs: Newsroom A, Global Experts
 *    - Users: Owner A, Producer A, Host A, Public Expert 1/2, Exclusive Expert A
 *    - Memberships: OWNER/PRODUCER/HOST for Newsroom A; EXPERTs belong to Global Experts
 *    - Visibility: PUBLIC for 2 experts, EXCLUSIVE to Newsroom A for 1 expert
 * - Includes one sample booking so the list isn’t empty
 */

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

/** Helper: create a user with PUBLIC/EXCLUSIVE visibility that works with both
 *  client shapes (expertVisStatus new name, expertStatus legacy name).
 */
async function createUserWithVisibility(
  data,
  visStatus,
  exclusiveOrgId = null
) {
  // Try with the new field name first
  try {
    return await prisma.user.create({
      data: { ...data, expertVisStatus: visStatus, exclusiveOrgId },
    });
  } catch {
    // Fallback to legacy client shape
    return await prisma.user.create({
      data: { ...data, expertStatus: visStatus, exclusiveOrgId },
    });
  }
}

async function main() {
  console.log("🔄 Resetting data (safe order) …");
  // Children first
  await prisma.bookingGuest?.deleteMany?.({});
  await prisma.bookingNote?.deleteMany?.({});
  await prisma.booking.deleteMany({});
  await prisma.favoriteListItem?.deleteMany?.({});
  await prisma.favoriteList?.deleteMany?.({});
  await prisma.organizationMembership.deleteMany({});
  await prisma.orgSettings.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.organization.deleteMany({});

  console.log("🔐 Hashing password '123' …");
  const hashed = await bcrypt.hash("123", 10);

  console.log("🏢 Creating organizations …");
  const orgA = await prisma.organization.create({
    data: { name: "Newsroom A" },
  });
  const orgGlobal = await prisma.organization.create({
    data: { name: "Global Experts" },
  });

  console.log("⚙️ Org settings …");
  await prisma.orgSettings.create({
    data: {
      orgId: orgA.id,
      showProgramName: true,
      showHostName: true,
      showTalkingPoints: true,
      allowInPerson: true,
      allowOnline: true,
    },
  });

  console.log("👤 Creating staff users (Newsroom A) …");
  const ownerA = await prisma.user.create({
    data: {
      email: "owner@nre.test",
      name: "Owner A",
      hashedPassword: hashed,
      activeOrgId: orgA.id,
    },
  });
  const producerA = await prisma.user.create({
    data: {
      email: "producer.a@nre.test",
      name: "Producer A",
      hashedPassword: hashed,
      activeOrgId: orgA.id,
    },
  });
  const hostA = await prisma.user.create({
    data: {
      email: "host.a@nre.test",
      name: "Host A",
      hashedPassword: hashed,
      activeOrgId: orgA.id,
    },
  });

  console.log("🔗 Adding staff memberships …");
  await prisma.organizationMembership.createMany({
    data: [
      { userId: ownerA.id, orgId: orgA.id, role: "OWNER" },
      { userId: producerA.id, orgId: orgA.id, role: "PRODUCER" },
      { userId: hostA.id, orgId: orgA.id, role: "HOST" },
    ],
    skipDuplicates: true,
  });

  console.log("⭐ Creating experts …");
  // PUBLIC experts (org-agnostic → belong to Global Experts org for the EXPERT label)
  const expertPublic1 = await createUserWithVisibility(
    {
      email: "expert.1@nre.test",
      name: "Expert Public One",
      hashedPassword: hashed,
    },
    "PUBLIC",
    null
  );
  const expertPublic2 = await createUserWithVisibility(
    {
      email: "expert.2@nre.test",
      name: "Expert Public Two",
      hashedPassword: hashed,
    },
    "PUBLIC",
    null
  );
  // EXCLUSIVE expert to Newsroom A
  const expertExclusiveA = await createUserWithVisibility(
    {
      email: "expert.a.exclusive@nre.test",
      name: "Expert A Exclusive",
      hashedPassword: hashed,
    },
    "EXCLUSIVE",
    orgA.id
  );

  console.log(
    "🔗 Adding EXPERT memberships (label only; keeps experts org-agnostic) …"
  );
  await prisma.organizationMembership.createMany({
    data: [
      { userId: expertPublic1.id, orgId: orgGlobal.id, role: "EXPERT" },
      { userId: expertPublic2.id, orgId: orgGlobal.id, role: "EXPERT" },
      // Exclusive expert also labeled EXPERT so search recognizes them
      { userId: expertExclusiveA.id, orgId: orgGlobal.id, role: "EXPERT" },
    ],
    skipDuplicates: true,
  });

  console.log("📅 Creating a sample booking in Newsroom A …");
  const startPlus90 = new Date(Date.now() + 90 * 60 * 1000);
  await prisma.booking.create({
    data: {
      subject: "TV Interview — Seeded",
      expertName: expertPublic1.name, // legacy display in list cards
      newsroomName: "Newsroom A",
      appearanceType: "ONLINE",
      status: "PENDING",
      startAt: startPlus90,
      durationMins: 45,
      programName: "Morning Brief",
      hostName: "Host A", // legacy text
      talkingPoints: "Seeded booking using PUBLIC expert.",
      organization: { connect: { id: orgA.id } },
      // FKs (optional)
      expert: { connect: { id: expertPublic1.id } },
      host: { connect: { id: hostA.id } },
    },
  });

  console.log("\n✅ Seed complete.\n");
  console.table(
    [
      { role: "OWNER (A)", email: "owner@nre.test", password: "123" },
      { role: "PRODUCER (A)", email: "producer.a@nre.test", password: "123" },
      { role: "HOST (A)", email: "host.a@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.1@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.2@nre.test", password: "123" },
      {
        role: "EXPERT (EXCLUSIVE→A)",
        email: "expert.a.exclusive@nre.test",
        password: "123",
      },
    ],
    ["role", "email", "password"]
  );
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
