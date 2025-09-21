// prisma/seed.js
// Seeds multi-tenant orgs, users, memberships, org settings, and sample bookings.
// All users' password = "123" (hashed).

const {
  PrismaClient,
  AppearanceType,
  BookingStatus,
  Role,
} = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

function futureDate({ days = 0, hours = 10, minutes = 0 } = {}) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

async function main() {
  console.log("🔄 Resetting data…");

  // Order matters due to FK constraints
  await prisma.organizationMembership.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.orgSettings.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.organization.deleteMany({});

  console.log("🔐 Hashing password '123' for all users…");
  const passwordHash = await bcrypt.hash("123", 10);

  console.log("🏢 Creating organizations…");
  const orgA = await prisma.organization.create({
    data: {
      name: "Newsroom A",
      settings: {
        create: {
          showProgramName: true,
          showHostName: true,
          showTalkingPoints: true,
          allowInPerson: true,
          allowOnline: true,
        },
      },
    },
  });

  const orgB = await prisma.organization.create({
    data: {
      name: "Newsroom B",
      settings: {
        create: {
          showProgramName: true,
          showHostName: true,
          showTalkingPoints: true,
          allowInPerson: true,
          allowOnline: true,
        },
      },
    },
  });

  console.log("👤 Creating users… (password = 123)");
  const owner = await prisma.user.create({
    data: {
      email: "owner@nre.test",
      name: "Owner Omar",
      hashedPassword: passwordHash,
      activeOrgId: orgA.id, // start in A for header/switcher testing
    },
  });

  const producerA = await prisma.user.create({
    data: {
      email: "producer.a@nre.test",
      name: "Producer A",
      hashedPassword: passwordHash,
      activeOrgId: orgA.id,
    },
  });

  const producerB = await prisma.user.create({
    data: {
      email: "producer.b@nre.test",
      name: "Producer B",
      hashedPassword: passwordHash,
      activeOrgId: orgB.id,
    },
  });

  const expert1 = await prisma.user.create({
    data: {
      email: "expert.1@nre.test",
      name: "Expert One",
      hashedPassword: passwordHash,
    },
  });

  const expert2 = await prisma.user.create({
    data: {
      email: "expert.2@nre.test",
      name: "Expert Two",
      hashedPassword: passwordHash,
    },
  });

  const expert3 = await prisma.user.create({
    data: {
      email: "expert.3@nre.test",
      name: "Expert Three",
      hashedPassword: passwordHash,
    },
  });

  console.log("🔗 Creating memberships…");
  await prisma.organizationMembership.createMany({
    data: [
      // Owner belongs to both A and B → eligible for switcher
      { userId: owner.id, orgId: orgA.id, role: Role.OWNER },
      { userId: owner.id, orgId: orgB.id, role: Role.OWNER },

      // Producers — single org each (no switcher)
      { userId: producerA.id, orgId: orgA.id, role: Role.PRODUCER },
      { userId: producerB.id, orgId: orgB.id, role: Role.PRODUCER },

      // Experts — exclusive to one org each (no switcher)
      { userId: expert1.id, orgId: orgA.id, role: Role.EXPERT },
      { userId: expert2.id, orgId: orgB.id, role: Role.EXPERT },
      { userId: expert3.id, orgId: orgA.id, role: Role.EXPERT },
    ],
    skipDuplicates: true,
  });

  console.log("🗓️ Creating sample bookings…");
  // Bookings for Newsroom A
  await prisma.booking.createMany({
    data: [
      {
        subject: "TV Interview: Energy Outlook",
        expertName: "Expert One",
        newsroomName: "Newsroom A",
        appearanceType: AppearanceType.ONLINE,
        status: BookingStatus.PENDING,
        startAt: futureDate({ days: 3, hours: 11 }),
        durationMins: 45,
        locationName: "Zoom",
        locationUrl: "https://zoom.example/a",
        programName: "Morning Brief",
        hostName: "Layla",
        talkingPoints: "Oil supply; OPEC+ policy; price bands",
        orgId: orgA.id,
      },
      {
        subject: "Studio Panel: Inflation Watch",
        expertName: "Expert Three",
        newsroomName: "Newsroom A",
        appearanceType: AppearanceType.IN_PERSON,
        status: BookingStatus.CONFIRMED,
        startAt: futureDate({ days: 7, hours: 18 }),
        durationMins: 30,
        locationName: "Studio 1",
        locationUrl: "https://maps.example/studio-1",
        programName: "Market Close",
        hostName: "Karim",
        talkingPoints: "CPI vs core; FX pass-through",
        orgId: orgA.id,
      },
    ],
  });

  // Bookings for Newsroom B
  await prisma.booking.createMany({
    data: [
      {
        subject: "Remote Hit: Tech IPOs",
        expertName: "Expert Two",
        newsroomName: "Newsroom B",
        appearanceType: AppearanceType.ONLINE,
        status: BookingStatus.PENDING,
        startAt: futureDate({ days: 2, hours: 14 }),
        durationMins: 20,
        locationName: "Teams",
        locationUrl: "https://teams.example/b",
        programName: "Lunch Live",
        hostName: "Maya",
        talkingPoints: "Pipeline; pricing windows; lockups",
        orgId: orgB.id,
      },
      {
        subject: "Studio Chat: Energy Transition",
        expertName: "Expert Two",
        newsroomName: "Newsroom B",
        appearanceType: AppearanceType.IN_PERSON,
        status: BookingStatus.CONFIRMED,
        startAt: futureDate({ days: 10, hours: 16 }),
        durationMins: 25,
        locationName: "Studio B",
        locationUrl: "https://maps.example/studio-b",
        programName: "Evening Desk",
        hostName: "Hadi",
        talkingPoints: "Grid upgrades; subsidies; EV adoption",
        orgId: orgB.id,
      },
    ],
  });

  console.log("✅ Seed complete.\n");
  console.table([
    { role: "OWNER (multi-org)", email: "owner@nre.test", password: "123" },
    { role: "PRODUCER (A)", email: "producer.a@nre.test", password: "123" },
    { role: "PRODUCER (B)", email: "producer.b@nre.test", password: "123" },
    { role: "EXPERT (A)", email: "expert.1@nre.test", password: "123" },
    { role: "EXPERT (B)", email: "expert.2@nre.test", password: "123" },
    { role: "EXPERT (A)", email: "expert.3@nre.test", password: "123" },
  ]);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
