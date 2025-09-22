/* prisma/seed.js
   Seeds aligned with final product rules:
   - No user has multi-org membership.
   - Owners/Producers are single-org members.
   - Experts are global (no membership). Exclusivity is modeled via User.expertStatus + exclusiveOrgId.
   - A few sample bookings use expertUserId FK (legacy expertName kept for now).
*/

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("🔄 Resetting data…");
  // Truncate in a safe order (child → parent) due to relations
  await prisma.booking.deleteMany({});
  await prisma.organizationMembership.deleteMany({});
  await prisma.orgSettings.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.organization.deleteMany({});

  console.log("🔐 Hashing password '123' for all users…");
  const hashed = await bcrypt.hash("123", 10);

  console.log("🏢 Creating organizations…");
  const orgA = await prisma.organization.create({
    data: { name: "Newsroom A" },
  });
  const orgB = await prisma.organization.create({
    data: { name: "Newsroom B" },
  });

  // Minimal org settings for both orgs
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
  await prisma.orgSettings.create({
    data: {
      orgId: orgB.id,
      showProgramName: true,
      showHostName: true,
      showTalkingPoints: true,
      allowInPerson: true,
      allowOnline: true,
    },
  });

  console.log("👤 Creating users… (password = 123)");
  // Owners (single-org)
  const ownerA = await prisma.user.create({
    data: {
      email: "owner@nre.test",
      name: "Owner A",
      hashedPassword: hashed,
    },
  });
  const ownerB = await prisma.user.create({
    data: {
      email: "owner.b@nre.test",
      name: "Owner B",
      hashedPassword: hashed,
    },
  });

  // Producers (single-org)
  const producerA = await prisma.user.create({
    data: {
      email: "producer.a@nre.test",
      name: "Producer A",
      hashedPassword: hashed,
    },
  });

  // Experts (GLOBAL) — PUBLIC by default
  const expert1 = await prisma.user.create({
    data: {
      email: "expert.1@nre.test",
      name: "Expert One",
      hashedPassword: hashed,
      expertStatus: "PUBLIC",
    },
  });
  const expert2 = await prisma.user.create({
    data: {
      email: "expert.2@nre.test",
      name: "Expert Two",
      hashedPassword: hashed,
      expertStatus: "PUBLIC",
    },
  });
  // Create additional PUBLIC experts without keeping variables (no-unused-vars)
  await prisma.user.create({
    data: {
      email: "expert.3@nre.test",
      name: "Expert Three",
      hashedPassword: hashed,
      expertStatus: "PUBLIC",
    },
  });
  await prisma.user.create({
    data: {
      email: "expert.4@nre.test",
      name: "Expert Four",
      hashedPassword: hashed,
      expertStatus: "PUBLIC",
    },
  });
  await prisma.user.create({
    data: {
      email: "expert.5@nre.test",
      name: "Expert Five",
      hashedPassword: hashed,
      expertStatus: "PUBLIC",
    },
  });

  // EXCLUSIVE experts (hidden from public; discoverable only within that org)
  const expertAExclusive = await prisma.user.create({
    data: {
      email: "expert.a.exclusive@nre.test",
      name: "Expert A Exclusive",
      hashedPassword: hashed,
      expertStatus: "EXCLUSIVE",
      exclusiveOrgId: orgA.id,
    },
  });
  // Create Org B exclusive without keeping the variable (no-unused-vars)
  await prisma.user.create({
    data: {
      email: "expert.b.exclusive@nre.test",
      name: "Expert B Exclusive",
      hashedPassword: hashed,
      expertStatus: "EXCLUSIVE",
      exclusiveOrgId: orgB.id,
    },
  });

  console.log("👥 Creating memberships (single-org only)…");
  // Owners
  await prisma.organizationMembership.create({
    data: { userId: ownerA.id, orgId: orgA.id, role: "OWNER" },
  });
  await prisma.organizationMembership.create({
    data: { userId: ownerB.id, orgId: orgB.id, role: "OWNER" },
  });

  // Producer in Org A
  await prisma.organizationMembership.create({
    data: { userId: producerA.id, orgId: orgA.id, role: "PRODUCER" },
  });

  // NOTE: Experts have NO memberships, by design.

  // --- Sample bookings ---
  console.log("🗓️  Creating sample bookings…");

  const now = new Date();
  const plus = (mins) => new Date(now.getTime() + mins * 60000);

  // Org A → PUBLIC expert (allowed)
  await prisma.booking.create({
    data: {
      subject: "TV Interview — Public Expert",
      expertName: expert1.name, // legacy display
      expertUserId: expert1.id, // new FK
      newsroomName: "Newsroom A",
      appearanceType: "ONLINE",
      status: "PENDING",
      startAt: plus(60), // +1h
      durationMins: 45,
      programName: "Morning Brief",
      hostName: "Host A",
      talkingPoints: "Public expert scenario.",
      orgId: orgA.id,
    },
  });

  // Org A → EXCLUSIVE-to-A expert (allowed)
  await prisma.booking.create({
    data: {
      subject: "Panel — Exclusive Expert A",
      expertName: expertAExclusive.name,
      expertUserId: expertAExclusive.id,
      newsroomName: "Newsroom A",
      appearanceType: "IN_PERSON",
      status: "CONFIRMED",
      startAt: plus(180), // +3h
      durationMins: 60,
      locationName: "Studio A",
      orgId: orgA.id,
    },
  });

  // Org B → PUBLIC expert (allowed)
  await prisma.booking.create({
    data: {
      subject: "Radio Slot — Public Expert",
      expertName: expert2.name,
      expertUserId: expert2.id,
      newsroomName: "Newsroom B",
      appearanceType: "ONLINE",
      status: "PENDING",
      startAt: plus(240), // +4h
      durationMins: 30,
      orgId: orgB.id,
    },
  });

  console.log("\n✅ Seed complete.\n");
  console.table(
    [
      { role: "OWNER (A)", email: "owner@nre.test", password: "123" },
      { role: "OWNER (B)", email: "owner.b@nre.test", password: "123" },
      { role: "PRODUCER (A)", email: "producer.a@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.1@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.2@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.3@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.4@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.5@nre.test", password: "123" },
      {
        role: "EXPERT (EXCL A)",
        email: "expert.a.exclusive@nre.test",
        password: "123",
      },
      {
        role: "EXPERT (EXCL B)",
        email: "expert.b.exclusive@nre.test",
        password: "123",
      },
    ],
    ["role", "email", "password"]
  );
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
