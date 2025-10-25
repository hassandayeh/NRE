// prisma/seed.js
// Pilot/dev seed for YOUR exact org id (no org creation).
// - Org: cmgxp9jcf0000knvgyy5k09ak (hard-coded)
// - Grants booking:view to Role 1 and 4 (org-wide list access)
// - Seeds 4 users (producer, host, two guests) + memberships
// - Seeds 3 bookings under that org + participants

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
  },
});

async function main() {
  // bcrypt
  let bcrypt;
  try {
    bcrypt = require("bcryptjs");
  } catch (e) {
    console.error("\nMissing dependency: bcryptjs\nRun: npm i bcryptjs\n");
    throw e;
  }

  const ORG_ID = "cmgxp9jcf0000knvgyy5k09ak"; // <-- your pilot org id

  // --- Ensure org exists (do NOT create a new one) ---
  const org = await prisma.organization.findUnique({ where: { id: ORG_ID } });
  if (!org) {
    throw new Error(
      `Organization not found: ${ORG_ID}. This seed intentionally does not create orgs.`
    );
  }

  // --- Roles 1..10 (create if missing; do not modify existing labels) ---
  const slots = Array.from({ length: 10 }, (_, i) => i + 1);
  for (const slot of slots) {
    await prisma.orgRole.upsert({
      where: { orgId_slot: { orgId: org.id, slot } },
      update: {}, // keep existing as-is
      create: {
        orgId: org.id,
        slot,
        label: slot === 4 ? "Admin" : `Role ${slot}`,
        isActive: slot === 4,
      },
    });
  }

  async function roleLabel(orgId, slot) {
    const r = await prisma.orgRole.findUnique({
      where: { orgId_slot: { orgId, slot } },
      select: { label: true },
    });
    return r?.label ?? `Role ${slot}`;
  }

  // --- Minimal permission keys (idempotent) ---
  const ensureKey = (key, description) =>
    prisma.permissionKey.upsert({
      where: { key },
      update: {},
      create: { key, description },
    });

  const [dirViewKey, bookViewKey, bookCreateKey] = await Promise.all([
    ensureKey("directory:view", "See Directory module"),
    ensureKey("booking:view", "View bookings in org"),
    ensureKey("booking:create", "Create bookings in org"),
  ]);

  const role1 = await prisma.orgRole.findUnique({
    where: { orgId_slot: { orgId: org.id, slot: 1 } },
  });
  const role4 = await prisma.orgRole.findUnique({
    where: { orgId_slot: { orgId: org.id, slot: 4 } },
  });

  async function grant(role, key) {
    if (!role) return;
    await prisma.orgRolePermission.upsert({
      where: {
        orgRoleId_permissionKeyId: {
          orgRoleId: role.id,
          permissionKeyId: key.id,
        },
      },
      update: { allowed: true },
      create: { orgRoleId: role.id, permissionKeyId: key.id, allowed: true },
    });
  }

  // Org-wide list gate, per your requirement
  await grant(role1, bookViewKey);
  await grant(role4, bookViewKey);
  // Optional convenience: creators
  await grant(role4, bookCreateKey);
  // Directory access is handy while testing
  await grant(role1, dirViewKey);
  await grant(role4, dirViewKey);

  // --- Users (producer, host, two guests) — all in THIS org ---
  async function upsertUser({ id, email, name, slot }) {
    const hashed = await bcrypt.hash("123456", 10);
    const user = await prisma.user.upsert({
      where: { email },
      update: { displayName: name },
      create: {
        id,
        email,
        displayName: name,
        hashedPassword: hashed,
        supportsOnline: true,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_orgId: { userId: user.id, orgId: org.id } },
      update: { slot, orgManaged: true },
      create: { userId: user.id, orgId: org.id, slot, orgManaged: true },
    });
    return user;
  }

  const userProducer = await upsertUser({
    id: "user-producer-dev",
    email: "producer@dev.local",
    name: "Producer Pat",
    slot: 2,
  });
  const userHost = await upsertUser({
    id: "user-host-dev",
    email: "host@dev.local",
    name: "Host Alex",
    slot: 4,
  });
  const userGuest1 = await upsertUser({
    id: "user-guest1-dev",
    email: "guest1@dev.local",
    name: "Guest Casey",
    slot: 5,
  });
  const userGuest2 = await upsertUser({
    id: "user-guest2-dev",
    email: "guest2@dev.local",
    name: "Guest Bailey",
    slot: 5,
  });

  // --- Bookings under THIS org ---
  const now = new Date();
  const addMins = (d, m) => new Date(d.getTime() + m * 60000);

  const bookings = [
    {
      id: "bk-morning-1",
      subject: "Morning Live: Economy Update",
      status: "PENDING",
      startAt: addMins(now, 120),
      durationMins: 30,
      appearanceType: "ONLINE",
      locationUrl: "https://studio.example.com/room/economy",
    },
    {
      id: "bk-morning-2",
      subject: "Midday Live: Weather",
      status: "PENDING",
      startAt: addMins(now, 130),
      durationMins: 30,
      appearanceType: "ONLINE",
      locationUrl: "https://studio.example.com/room/weather",
    },
    {
      id: "bk-evening",
      subject: "Evening Bulletin",
      status: "CONFIRMED",
      startAt: addMins(now, 480),
      durationMins: 45,
      appearanceType: "IN_PERSON",
      locationName: "Studio A",
    },
  ];

  for (const b of bookings) {
    await prisma.booking.upsert({
      where: { id: b.id },
      update: {
        subject: b.subject,
        status: b.status,
        startAt: b.startAt,
        durationMins: b.durationMins,
        appearanceType: b.appearanceType,
        locationUrl: b.locationUrl ?? null,
        locationName: b.locationName ?? null,
      },
      create: {
        id: b.id,
        orgId: org.id,
        subject: b.subject,
        status: b.status,
        startAt: b.startAt,
        durationMins: b.durationMins,
        appearanceType: b.appearanceType,
        locationUrl: b.locationUrl ?? null,
        locationName: b.locationName ?? null,
      },
    });
  }

  // --- Participants with varied statuses ---
  async function addParticipant({
    bookingId,
    userId,
    slot,
    status,
    invitedBy,
  }) {
    await prisma.bookingParticipant.upsert({
      where: { bookingId_userId: { bookingId, userId } }, // @@unique([bookingId, userId])
      update: {
        roleSlot: slot,
        roleLabelSnapshot: await roleLabel(org.id, slot),
        inviteStatus: status,
        invitedByUserId: invitedBy,
      },
      create: {
        bookingId,
        userId,
        roleSlot: slot,
        roleLabelSnapshot: await roleLabel(org.id, slot),
        inviteStatus: status,
        invitedByUserId: invitedBy,
        invitedAt: new Date(),
      },
    });
  }

  // Booking 1
  await addParticipant({
    bookingId: "bk-morning-1",
    userId: userHost.id,
    slot: 4,
    status: "ACCEPTED",
    invitedBy: userProducer.id,
  });
  await addParticipant({
    bookingId: "bk-morning-1",
    userId: userGuest1.id,
    slot: 5,
    status: "PENDING",
    invitedBy: userProducer.id,
  });

  // Booking 2
  await addParticipant({
    bookingId: "bk-morning-2",
    userId: userHost.id,
    slot: 4,
    status: "ACCEPTED",
    invitedBy: userProducer.id,
  });
  await addParticipant({
    bookingId: "bk-morning-2",
    userId: userGuest2.id,
    slot: 5,
    status: "DECLINED",
    invitedBy: userProducer.id,
  });

  // Booking 3
  await addParticipant({
    bookingId: "bk-evening",
    userId: userHost.id,
    slot: 4,
    status: "PENDING",
    invitedBy: userProducer.id,
  });

  console.log("\n✅ Seed complete.");
  console.log("Target org:", org.id);
  console.log("Seeded bookings:", bookings.map((b) => b.id).join(", "));
  console.log(
    "\nUsers (pwd 123456): producer@dev.local, host@dev.local, guest1@dev.local, guest2@dev.local\n"
  );
}

main()
  .catch((e) => {
    console.error("\n❌ Seed failed:\n", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
