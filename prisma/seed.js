// prisma/seed.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// bcrypt is optional; fall back to a known hash for "password" if not installed.
let bcrypt;
try {
  bcrypt = require("bcryptjs");
} catch {
  bcrypt = null;
}
async function hashPassword(pw = "password") {
  const fallback =
    "$2b$10$WqBq0XxkC3N1g7vQx6XbMeHh1a5mF1CPn8m8eZJvC6f1y6Q5nB5Nq"; // "password"
  try {
    if (!bcrypt) return fallback;
    return await bcrypt.hash(pw, 10);
  } catch {
    return fallback;
  }
}

async function createOrg(name) {
  const org = await prisma.organization.create({ data: { name } });
  await prisma.orgSettings.create({
    data: {
      orgId: org.id,
      showProgramName: true,
      showHostName: true,
      showTalkingPoints: true,
      allowInPerson: true,
      allowOnline: true,
    },
  });
  return org;
}

async function main() {
  console.log("🌱 Resetting DB…");

  // Clear tables in dependency order
  await prisma.favoriteListItem.deleteMany();
  await prisma.favoriteList.deleteMany();
  await prisma.bookingNote.deleteMany();
  await prisma.bookingGuest.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.organizationMembership.deleteMany();
  await prisma.orgSettings.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // Orgs
  const orgA = await createOrg("Org: Newsroom A");
  const orgB = await createOrg("Org: Newsroom B");

  const pw = await hashPassword("password");

  // Staff (Org A)
  const producerA = await prisma.user.create({
    data: {
      email: "producer.a@nre.test",
      hashedPassword: pw,
      name: "Producer A",
      displayName: "Producer A",
      activeOrgId: orgA.id,
      expertVisStatus: null,
      languages: ["en"],
      timeZone: "Europe/Berlin",
      memberships: { create: [{ orgId: orgA.id, role: "PRODUCER" }] },
    },
  });

  const hostA = await prisma.user.create({
    data: {
      email: "host.a@nre.test",
      hashedPassword: pw,
      name: "Host A",
      displayName: "Host A",
      activeOrgId: orgA.id,
      expertVisStatus: null, // host is not a public expert
      languages: ["en"],
      timeZone: "Europe/London",
      memberships: { create: [{ orgId: orgA.id, role: "HOST" }] },
    },
  });

  // Staff (Org B) — to avoid "unused variable" and to exercise cross-org data
  const producerB = await prisma.user.create({
    data: {
      email: "producer.b@nre.test",
      hashedPassword: pw,
      name: "Producer B",
      displayName: "Producer B",
      activeOrgId: orgB.id,
      expertVisStatus: null,
      languages: ["en"],
      timeZone: "Europe/Paris",
      memberships: { create: [{ orgId: orgB.id, role: "PRODUCER" }] },
    },
  });

  // Exclusive experts per org
  const expertExclusiveA = await prisma.user.create({
    data: {
      email: "expert.exclusive.a@nre.test",
      hashedPassword: pw,
      name: "Expert A (Exclusive)",
      displayName: "Expert A (Exclusive)",
      bio: "Exclusive to Org A; climate policy researcher.",
      languages: ["en"],
      tags: ["climate", "policy"],
      supportsOnline: true,
      supportsInPerson: true,
      city: "New York",
      countryCode: "US",
      timeZone: "America/New_York",
      expertVisStatus: "EXCLUSIVE",
      exclusiveOrgId: orgA.id,
      memberships: { create: [{ orgId: orgA.id, role: "EXPERT" }] },
    },
  });

  const expertExclusiveB = await prisma.user.create({
    data: {
      email: "expert.exclusive.b@nre.test",
      hashedPassword: pw,
      name: "Expert B (Exclusive)",
      displayName: "Expert B (Exclusive)",
      bio: "Exclusive to Org B; EU tech regulation analyst.",
      languages: ["en", "de"],
      tags: ["technology", "policy", "eu"],
      supportsOnline: true,
      supportsInPerson: false,
      city: "Berlin",
      countryCode: "DE",
      timeZone: "Europe/Berlin",
      expertVisStatus: "EXCLUSIVE",
      exclusiveOrgId: orgB.id,
      memberships: { create: [{ orgId: orgB.id, role: "EXPERT" }] },
    },
  });

  // Public experts (diverse)
  const publicExperts = [
    {
      name: "Expert Public One",
      email: "expert.public.one@nre.test",
      bio: "Technology analyst and TV commentator.",
      languages: ["en", "ar"],
      tags: ["technology", "ai", "policy"],
      supportsOnline: true,
      supportsInPerson: true,
      city: "Beirut",
      countryCode: "LB",
      timeZone: "Asia/Beirut",
    },
    {
      name: "Expert Public Two",
      email: "expert.public.two@nre.test",
      bio: "Cybersecurity researcher.",
      languages: ["en"],
      tags: ["security", "technology"],
      supportsOnline: true,
      supportsInPerson: false,
      city: "San Francisco",
      countryCode: "US",
      timeZone: "America/Los_Angeles",
    },
    {
      name: "Expert Three",
      email: "expert.public.three@nre.test",
      bio: "Sports analyst covering football & basketball.",
      languages: ["en"],
      tags: ["sports"],
      supportsOnline: true,
      supportsInPerson: true,
      city: "Berlin",
      countryCode: "DE",
      timeZone: "Europe/Berlin",
    },
    {
      name: "Expert Four",
      email: "expert.public.four@nre.test",
      bio: "Climate scientist and panel speaker.",
      languages: ["en"],
      tags: ["climate", "science"],
      supportsOnline: true,
      supportsInPerson: true,
      city: "New York",
      countryCode: "US",
      timeZone: "America/New_York",
    },
    {
      name: "Expert Five",
      email: "expert.public.five@nre.test",
      bio: "Media law expert and lecturer.",
      languages: ["en"],
      tags: ["law", "media"],
      supportsOnline: true,
      supportsInPerson: false,
      city: "Dublin",
      countryCode: "IE",
      timeZone: "Europe/Dublin",
    },
    {
      name: "Expert Six",
      email: "expert.public.six@nre.test",
      bio: "Middle East politics commentator.",
      languages: ["ar", "en"],
      tags: ["politics", "middle-east"],
      supportsOnline: true,
      supportsInPerson: true,
      city: "Amman",
      countryCode: "JO",
      timeZone: "Asia/Amman",
    },
    {
      name: "Expert Seven",
      email: "expert.public.seven@nre.test",
      bio: "Financial markets reporter.",
      languages: ["en"],
      tags: ["finance", "markets"],
      supportsOnline: false,
      supportsInPerson: true,
      city: "London",
      countryCode: "GB",
      timeZone: "Europe/London",
    },
    {
      name: "Expert Eight",
      email: "expert.public.eight@nre.test",
      bio: "AI ethics researcher.",
      languages: ["en", "fr"],
      tags: ["ai", "ethics"],
      supportsOnline: true,
      supportsInPerson: false,
      city: "Paris",
      countryCode: "FR",
      timeZone: "Europe/Paris",
    },
    {
      name: "Expert Nine",
      email: "expert.public.nine@nre.test",
      bio: "Public health specialist.",
      languages: ["en", "pt"],
      tags: ["health", "policy"],
      supportsOnline: false,
      supportsInPerson: true,
      city: "São Paulo",
      countryCode: "BR",
      timeZone: "America/Sao_Paulo",
    },
    {
      name: "Expert Ten",
      email: "expert.public.ten@nre.test",
      bio: "Data journalist.",
      languages: ["en"],
      tags: ["data", "journalism"],
      supportsOnline: true,
      supportsInPerson: true,
      city: "Bengaluru",
      countryCode: "IN",
      timeZone: "Asia/Kolkata",
    },
    {
      name: "Expert Eleven",
      email: "expert.public.eleven@nre.test",
      bio: "Energy policy analyst.",
      languages: ["en"],
      tags: ["energy", "policy"],
      supportsOnline: true,
      supportsInPerson: true,
      city: "Houston",
      countryCode: "US",
      timeZone: "America/Chicago",
    },
    {
      name: "Expert Twelve",
      email: "expert.public.twelve@nre.test",
      bio: "Technology evangelist.",
      languages: ["en", "ja"],
      tags: ["technology", "innovation"],
      supportsOnline: true,
      supportsInPerson: false,
      city: "Tokyo",
      countryCode: "JP",
      timeZone: "Asia/Tokyo",
    },
  ];

  console.log("👤 Creating public experts…");
  const publicCreated = [];
  for (const e of publicExperts) {
    const row = await prisma.user.create({
      data: {
        email: e.email,
        hashedPassword: pw,
        name: e.name,
        displayName: e.name,
        bio: e.bio,
        languages: e.languages,
        tags: e.tags,
        supportsOnline: e.supportsOnline,
        supportsInPerson: e.supportsInPerson,
        city: e.city,
        countryCode: e.countryCode,
        timeZone: e.timeZone,
        expertVisStatus: "PUBLIC",
      },
    });
    publicCreated.push(row);
  }

  // Favorites (Org A)
  await prisma.favoriteList.create({
    data: {
      orgId: orgA.id,
      name: "Tech Bench",
      createdById: producerA.id,
      items: {
        create: [
          { targetUserId: publicCreated[0].id },
          { targetUserId: publicCreated[1].id },
          { targetUserId: publicCreated[7].id },
        ],
      },
    },
  });
  await prisma.favoriteList.create({
    data: {
      orgId: orgA.id,
      name: "Climate Voices",
      createdById: producerA.id,
      items: {
        create: [
          { targetUserId: publicCreated[3].id },
          { targetUserId: expertExclusiveA.id },
        ],
      },
    },
  });

  // Favorites (Org B) — uses expertExclusiveB so it’s not unused
  await prisma.favoriteList.create({
    data: {
      orgId: orgB.id,
      name: "EU Tech Panel",
      createdById: producerB.id,
      items: {
        create: [
          { targetUserId: expertExclusiveB.id },
          { targetUserId: publicCreated[7].id }, // Expert Eight (Paris)
        ],
      },
    },
  });

  // Bookings to create availability overlaps
  const now = Date.now();
  const toMs = (mins) => mins * 60 * 1000;

  await prisma.booking.create({
    data: {
      subject: "Tech panel: AI in 2025",
      newsroomName: "Org: Newsroom A",
      expertName: "Expert Public Two",
      appearanceScope: "UNIFIED",
      appearanceType: "ONLINE",
      accessProvisioning: "SHARED",
      status: "CONFIRMED",
      startAt: new Date(now + toMs(60)), // +1h
      durationMins: 60,
      locationUrl: "https://meet.example.com/ai2025",
      orgId: orgA.id,
      expertUserId: publicCreated[1].id,
      hostUserId: hostA.id,
    },
  });

  await prisma.booking.create({
    data: {
      subject: "Energy policy briefing",
      newsroomName: "Org: Newsroom A",
      expertName: "Expert Eleven",
      appearanceScope: "UNIFIED",
      appearanceType: "IN_PERSON",
      accessProvisioning: "SHARED",
      status: "PENDING",
      startAt: new Date(now + toMs(180)), // +3h
      durationMins: 45,
      locationName: "NRE HQ",
      locationAddress: "123 Main St",
      orgId: orgA.id,
      expertUserId: publicCreated[10].id,
      hostUserId: hostA.id,
    },
  });

  console.log("✅ Seed complete.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
