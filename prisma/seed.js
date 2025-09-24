/* prisma/seed.js
   Seeds aligned with the new Guests/Notes/Favorites + HOST model.

   Accounts (password=123):
   - owner@nre.test        (OWNER, Org A)
   - owner.b@nre.test      (OWNER, Org B)
   - producer.a@nre.test   (PRODUCER, Org A)
   - host.a@nre.test       (HOST, Org A)
   - expert.1@nre.test     (EXPERT, PUBLIC)
   - expert.2@nre.test     (EXPERT, PUBLIC)
   - expert.3@nre.test     (EXPERT, PUBLIC)
   - expert.4@nre.test     (EXPERT, PUBLIC)
   - expert.5@nre.test     (EXPERT, PUBLIC)
   - expert.a.exclusive@nre.test (EXPERT, EXCLUSIVE to Org A)
   - expert.b.exclusive@nre.test (EXPERT, EXCLUSIVE to Org B)
*/

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

async function main() {
  console.log("🔄 Resetting data (child → parent) …");
  // New tables first
  await prisma.bookingNote.deleteMany({});
  await prisma.bookingGuest.deleteMany({});
  await prisma.favoriteListItem.deleteMany({});
  await prisma.favoriteList.deleteMany({});
  // Legacy/main tables
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

  console.log("⚙️  Creating org settings…");
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
  // Owners
  const ownerA = await prisma.user.create({
    data: { email: "owner@nre.test", name: "Owner A", hashedPassword: hashed },
  });
  const ownerB = await prisma.user.create({
    data: {
      email: "owner.b@nre.test",
      name: "Owner B",
      hashedPassword: hashed,
    },
  });
  // Producer (Org A)
  const producerA = await prisma.user.create({
    data: {
      email: "producer.a@nre.test",
      name: "Producer A",
      hashedPassword: hashed,
    },
  });
  // Host (Org A)
  const hostA = await prisma.user.create({
    data: { email: "host.a@nre.test", name: "Host A", hashedPassword: hashed },
  });

  // Experts (GLOBAL)
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
  // Additional PUBLIC experts (no variables kept)
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

  // EXCLUSIVE experts
  const expertAExclusive = await prisma.user.create({
    data: {
      email: "expert.a.exclusive@nre.test",
      name: "Expert A Exclusive",
      hashedPassword: hashed,
      expertStatus: "EXCLUSIVE",
      exclusiveOrgId: orgA.id,
    },
  });
  await prisma.user.create({
    data: {
      email: "expert.b.exclusive@nre.test",
      name: "Expert B Exclusive",
      hashedPassword: hashed,
      expertStatus: "EXCLUSIVE",
      exclusiveOrgId: orgB.id,
    },
  });

  console.log("🔗 Creating memberships (single-org) …");
  await prisma.organizationMembership.create({
    data: { userId: ownerA.id, orgId: orgA.id, role: "OWNER" },
  });
  await prisma.organizationMembership.create({
    data: { userId: ownerB.id, orgId: orgB.id, role: "OWNER" },
  });
  await prisma.organizationMembership.create({
    data: { userId: producerA.id, orgId: orgA.id, role: "PRODUCER" },
  });
  await prisma.organizationMembership.create({
    data: { userId: hostA.id, orgId: orgA.id, role: "HOST" },
  });
  // NOTE: Experts do NOT have org memberships by design.

  console.log("⭐ Creating Favorites (org-wide) …");
  const shortlist = await prisma.favoriteList.create({
    data: {
      orgId: orgA.id,
      name: "Morning Show Shortlist",
      createdById: producerA.id,
      items: {
        create: [
          { targetUserId: expert1.id },
          { targetUserId: expertAExclusive.id }, // allowed in org A
        ],
      },
    },
  });

  console.log("📅 Creating sample bookings …");
  const now = new Date();
  const plus = (mins) => new Date(now.getTime() + mins * 60000);

  // === Legacy-style samples (kept) ===
  await prisma.booking.create({
    data: {
      subject: "TV Interview — Public Expert",
      expertName: expert1.name, // legacy display
      expertUserId: expert1.id, // legacy FK (mirrored)
      newsroomName: "Newsroom A",
      appearanceScope: "UNIFIED",
      appearanceType: "ONLINE",
      accessProvisioning: "SHARED",
      status: "PENDING",
      startAt: plus(60), // +1h
      durationMins: 45,
      programName: "Morning Brief",
      hostName: "Host A",
      talkingPoints: "Public expert scenario.",
      orgId: orgA.id,
      // booking default for ONLINE (still fine)
      locationUrl: "https://meet.example.com/abc-123",
    },
  });

  await prisma.booking.create({
    data: {
      subject: "Panel — Exclusive Expert A",
      expertName: expertAExclusive.name,
      expertUserId: expertAExclusive.id,
      newsroomName: "Newsroom A",
      appearanceScope: "UNIFIED",
      appearanceType: "IN_PERSON",
      accessProvisioning: "SHARED",
      status: "CONFIRMED",
      startAt: plus(180), // +3h
      durationMins: 60,
      locationName: "Studio A",
      locationAddress: "123 Main St, City",
      orgId: orgA.id,
    },
  });

  await prisma.booking.create({
    data: {
      subject: "Radio Slot — Public Expert",
      expertName: expert2.name,
      expertUserId: expert2.id,
      newsroomName: "Newsroom B",
      appearanceScope: "UNIFIED",
      appearanceType: "ONLINE",
      accessProvisioning: "SHARED",
      status: "PENDING",
      startAt: plus(240), // +4h
      durationMins: 30,
      orgId: orgB.id,
      locationUrl: "https://meet.example.com/radio-456",
    },
  });

  // === New PER_GUEST + PER_GUEST sample ===
  const mixed = await prisma.booking.create({
    data: {
      subject: "Mixed Appearance Demo",
      newsroomName: "Newsroom A",
      // Legacy mirror (temporary): first guest is the "primary" for legacy views
      expertName: expert1.name,
      expertUserId: expert1.id,

      appearanceScope: "PER_GUEST",
      accessProvisioning: "PER_GUEST",
      status: "CONFIRMED",
      startAt: plus(90), // +1.5h
      durationMins: 50,
      programName: "Saba7oo",
      hostName: "Host A",
      talkingPoints: "Demo booking with mixed guest appearances.",
      orgId: orgA.id,

      // Optional booking defaults as placeholders (fallbacks if we flip to SHARED later)
      locationUrl: "https://meet.example.com/mixed-zoom",
      locationName: "Studio A",
      locationAddress: "123 Main St, City",
      dialInfo: "Producer will call if needed",

      // Guests (order matters for display)
      guests: {
        create: [
          // Online expert with explicit joinUrl
          {
            userId: expert1.id,
            name: expert1.name,
            kind: "EXPERT",
            order: 0,
            appearanceType: "ONLINE",
            joinUrl: "https://meet.example.com/guest-expert1",
          },
          // In-person expert with venue
          {
            userId: expert2.id,
            name: expert2.name,
            kind: "EXPERT",
            order: 1,
            appearanceType: "IN_PERSON",
            venueName: "Studio A — Desk 2",
            venueAddress: "123 Main St, City",
          },
          // Phone reporter (external; no userId)
          {
            name: "Reporter Caller",
            kind: "REPORTER",
            order: 2,
            appearanceType: "PHONE",
            dialInfo: "Producer will call +1 (555) 000-0000, PIN 1234",
          },
        ],
      },

      // A couple of notes by the HOST
      notes: {
        create: [
          {
            authorId: hostA.id,
            body: "Pre-interview call completed. All good.",
          },
          {
            authorId: hostA.id,
            body: "IFB and mic check scheduled 30 min before.",
          },
        ],
      },
    },
  });

  console.log("\n✅ Seed complete.\n");
  console.table(
    [
      { role: "OWNER (A)", email: "owner@nre.test", password: "123" },
      { role: "OWNER (B)", email: "owner.b@nre.test", password: "123" },
      { role: "PRODUCER (A)", email: "producer.a@nre.test", password: "123" },
      { role: "HOST (A)", email: "host.a@nre.test", password: "123" },
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

  console.log("\n⭐ Favorites\n", {
    listId: shortlist.id,
    name: shortlist.name,
    org: "Org A",
  });
  console.log("\n🧪 Mixed Appearance booking id:", mixed.id);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
