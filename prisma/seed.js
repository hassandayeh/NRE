/* prisma/seed.js
 * Seed dataset for NRE — Org/tenancy + Experts Directory + Availability blocks
 * Password for all users = "123"
 *
 * Notes:
 * - This script hard-resets tables (deleteMany) then repopulates a clean dataset.
 * - Experts are GLOBAL (no memberships). Exclusivity via User.expertStatus + exclusiveOrgId.
 * - Slugs are unique to satisfy the unique index on User.slug.
 */

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

async function main() {
  console.log("🔄 Resetting data in safe order…");
  await prisma.expertTimeBlock.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.organizationMembership.deleteMany({});
  await prisma.orgSettings.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.organization.deleteMany({});

  console.log("🔐 Hashing password '123'…");
  const hashed = await bcrypt.hash("123", 10);

  console.log("🏢 Creating organizations…");
  const orgA = await prisma.organization.create({
    data: { name: "Newsroom A" },
  });
  const orgB = await prisma.organization.create({
    data: { name: "Newsroom B" },
  });

  console.log("⚙️  Creating org settings…");
  await prisma.orgSettings.create({
    data: {
      orgId: orgA.id,
      showProgramName: true,
      showHostName: true,
      showTalkingPoints: true,
      allowInPerson: true,
      allowOnline: true,
      defaultDurationMins: 45,
      minLeadTimeMins: 60,
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
      defaultDurationMins: 30,
      minLeadTimeMins: 30,
    },
  });

  console.log("👤 Creating owners/producers (single-org only) …");
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
  const producerA = await prisma.user.create({
    data: {
      email: "producer.a@nre.test",
      name: "Producer A",
      hashedPassword: hashed,
    },
  });
  const producerB = await prisma.user.create({
    data: {
      email: "producer.b@nre.test",
      name: "Producer B",
      hashedPassword: hashed,
    },
  });

  await prisma.organizationMembership.createMany({
    data: [
      { userId: ownerA.id, orgId: orgA.id, role: "OWNER" },
      { userId: ownerB.id, orgId: orgB.id, role: "OWNER" },
      { userId: producerA.id, orgId: orgA.id, role: "PRODUCER" },
      { userId: producerB.id, orgId: orgB.id, role: "PRODUCER" },
    ],
    skipDuplicates: true,
  });

  console.log("⭐ Creating experts (GLOBAL users) …");
  const experts = await prisma.$transaction([
    // PUBLIC experts
    prisma.user.create({
      data: {
        email: "expert.1@nre.test",
        name: "Expert One",
        hashedPassword: hashed,
        expertStatus: "PUBLIC",
        slug: "expert-one",
        bio: "Technology analyst and TV commentator.",
        languages: ["en", "ar"],
        tags: ["technology", "ai", "policy"],
        timezone: "Asia/Beirut",
        countryCode: "LB",
        city: "Beirut",
        supportsInPerson: true,
        supportsOnline: true,
        inPersonRadiusKm: 100,
        avatarUrl: "https://i.pravatar.cc/150?img=11",
        rankBoost: 2,
      },
    }),
    prisma.user.create({
      data: {
        email: "expert.2@nre.test",
        name: "Expert Two",
        hashedPassword: hashed,
        expertStatus: "PUBLIC",
        slug: "expert-two",
        bio: "Macroeconomist focused on MENA markets.",
        languages: ["en"],
        tags: ["economy", "finance"],
        timezone: "Europe/London",
        countryCode: "GB",
        city: "London",
        supportsInPerson: true,
        supportsOnline: true,
        inPersonRadiusKm: 50,
        avatarUrl: "https://i.pravatar.cc/150?img=12",
      },
    }),
    prisma.user.create({
      data: {
        email: "expert.3@nre.test",
        name: "Expert Three",
        hashedPassword: hashed,
        expertStatus: "PUBLIC",
        slug: "expert-three",
        bio: "Public health researcher and radio guest.",
        languages: ["en", "fr"],
        tags: ["health", "policy"],
        timezone: "Europe/Paris",
        countryCode: "FR",
        city: "Paris",
        supportsInPerson: true,
        supportsOnline: true,
        inPersonRadiusKm: 30,
        avatarUrl: "https://i.pravatar.cc/150?img=13",
      },
    }),
    prisma.user.create({
      data: {
        email: "expert.4@nre.test",
        name: "Expert Four",
        hashedPassword: hashed,
        expertStatus: "PUBLIC",
        slug: "expert-four",
        bio: "Climate scientist and panel speaker.",
        languages: ["en"],
        tags: ["climate", "science"],
        timezone: "America/New_York",
        countryCode: "US",
        city: "New York",
        supportsInPerson: true,
        supportsOnline: true,
        inPersonRadiusKm: 80,
        avatarUrl: "https://i.pravatar.cc/150?img=14",
      },
    }),
    prisma.user.create({
      data: {
        email: "expert.5@nre.test",
        name: "Expert Five",
        hashedPassword: hashed,
        expertStatus: "PUBLIC",
        slug: "expert-five",
        bio: "Sports analyst covering football & basketball.",
        languages: ["en"],
        tags: ["sports"],
        timezone: "Europe/Berlin",
        countryCode: "DE",
        city: "Berlin",
        supportsInPerson: true,
        supportsOnline: true,
        avatarUrl: "https://i.pravatar.cc/150?img=15",
      },
    }),
    prisma.user.create({
      data: {
        email: "expert.6@nre.test",
        name: "Expert Six",
        hashedPassword: hashed,
        expertStatus: "PUBLIC",
        slug: "expert-six",
        bio: "Middle East politics commentator.",
        languages: ["ar", "en"],
        tags: ["politics", "middle-east"],
        timezone: "Asia/Amman",
        countryCode: "JO",
        city: "Amman",
        supportsInPerson: true,
        supportsOnline: true,
        avatarUrl: "https://i.pravatar.cc/150?img=16",
      },
    }),
    prisma.user.create({
      data: {
        email: "expert.7@nre.test",
        name: "Expert Seven",
        hashedPassword: hashed,
        expertStatus: "PUBLIC",
        slug: "expert-seven",
        bio: "Media law expert and lecturer.",
        languages: ["en"],
        tags: ["law", "media"],
        timezone: "Europe/Dublin",
        countryCode: "IE",
        city: "Dublin",
        supportsInPerson: false,
        supportsOnline: true,
        avatarUrl: "https://i.pravatar.cc/150?img=17",
      },
    }),
    prisma.user.create({
      data: {
        email: "expert.8@nre.test",
        name: "Expert Eight",
        hashedPassword: hashed,
        expertStatus: "PUBLIC",
        slug: "expert-eight",
        bio: "Cybersecurity researcher.",
        languages: ["en"],
        tags: ["security", "technology"],
        timezone: "America/Los_Angeles",
        countryCode: "US",
        city: "San Francisco",
        supportsInPerson: false,
        supportsOnline: true,
        avatarUrl: "https://i.pravatar.cc/150?img=18",
      },
    }),

    // EXCLUSIVE experts (discoverable only inside their org)
    prisma.user.create({
      data: {
        email: "expert.a.exclusive@nre.test",
        name: "Expert A Exclusive",
        hashedPassword: hashed,
        expertStatus: "EXCLUSIVE",
        exclusiveOrgId: orgA.id,
        slug: "expert-a-exclusive",
        bio: "Exclusive media coach for Org A.",
        languages: ["en", "ar"],
        tags: ["media-training"],
        timezone: "Asia/Beirut",
        countryCode: "LB",
        city: "Beirut",
        supportsInPerson: true,
        supportsOnline: true,
        avatarUrl: "https://i.pravatar.cc/150?img=19",
        rankBoost: 3,
      },
    }),
    prisma.user.create({
      data: {
        email: "expert.b.exclusive@nre.test",
        name: "Expert B Exclusive",
        hashedPassword: hashed,
        expertStatus: "EXCLUSIVE",
        exclusiveOrgId: orgB.id,
        slug: "expert-b-exclusive",
        bio: "Exclusive economics advisor for Org B.",
        languages: ["en"],
        tags: ["economy"],
        timezone: "Europe/Rome",
        countryCode: "IT",
        city: "Rome",
        supportsInPerson: true,
        supportsOnline: true,
        avatarUrl: "https://i.pravatar.cc/150?img=20",
      },
    }),
  ]);

  // ✅ Only assign the expert refs we actually use to avoid eslint(no-unused-vars).
  const [expert1, expert2, , , , , , expert8, expertAExclusive] = experts;

  console.log("🗓️  Creating availability blocks (ExpertTimeBlock) …");
  const now = new Date();
  const addMins = (d, m) => new Date(d.getTime() + m * 60000);

  await prisma.expertTimeBlock.createMany({
    data: [
      // Expert One busy in +90..+150 mins
      {
        id: "tb-expert1-1",
        expertUserId: expert1.id,
        startAt: addMins(now, 90),
        endAt: addMins(now, 150),
        reason: "On air",
      },
      // Expert Two busy in +240..+270 mins
      {
        id: "tb-expert2-1",
        expertUserId: expert2.id,
        startAt: addMins(now, 240),
        endAt: addMins(now, 270),
        reason: "Client call",
      },
      // Exclusive A busy in +160..+220 mins
      {
        id: "tb-expertA-1",
        expertUserId: expertAExclusive.id,
        startAt: addMins(now, 160),
        endAt: addMins(now, 220),
        reason: "Workshop",
      },
      // Expert Eight has a long blocked focus window
      {
        id: "tb-expert8-1",
        expertUserId: expert8.id,
        startAt: addMins(now, 60),
        endAt: addMins(now, 240),
        reason: "Deep work",
      },
    ],
    skipDuplicates: true,
  });

  console.log("📚 Creating sample bookings…");
  await prisma.booking.createMany({
    data: [
      {
        id: "seed-booking-1",
        subject: "TV Interview — Public Expert",
        expertName: expert1.name, // legacy display
        expertUserId: expert1.id, // FK
        newsroomName: "Newsroom A",
        appearanceType: "ONLINE",
        status: "PENDING",
        startAt: addMins(now, 60), // +1h
        durationMins: 45,
        programName: "Morning Brief",
        hostName: "Host A",
        talkingPoints: "Public expert scenario.",
        orgId: orgA.id,
        createdByUserId: producerA.id,
      },
      {
        id: "seed-booking-2",
        subject: "Panel — Exclusive Expert A",
        expertName: expertAExclusive.name,
        expertUserId: expertAExclusive.id,
        newsroomName: "Newsroom A",
        appearanceType: "IN_PERSON",
        status: "CONFIRMED",
        startAt: addMins(now, 180), // +3h
        durationMins: 60,
        locationName: "Studio A",
        orgId: orgA.id,
        createdByUserId: ownerA.id,
      },
      {
        id: "seed-booking-3",
        subject: "Radio Slot — Public Expert",
        expertName: "Expert Two",
        expertUserId: expert2.id,
        newsroomName: "Newsroom B",
        appearanceType: "ONLINE",
        status: "PENDING",
        startAt: addMins(now, 240), // +4h
        durationMins: 30,
        orgId: orgB.id,
        createdByUserId: producerB.id,
      },
    ],
    skipDuplicates: true,
  });

  console.log("\n✅ Seed complete.\n");
  console.table(
    [
      { role: "OWNER (A)", email: "owner@nre.test", password: "123" },
      { role: "OWNER (B)", email: "owner.b@nre.test", password: "123" },
      { role: "PRODUCER (A)", email: "producer.a@nre.test", password: "123" },
      { role: "PRODUCER (B)", email: "producer.b@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.1@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.2@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.3@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.4@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.5@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.6@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.7@nre.test", password: "123" },
      { role: "EXPERT (PUBLIC)", email: "expert.8@nre.test", password: "123" },
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
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
