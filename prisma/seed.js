/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  // -----------------------------
  // 1) Permission catalog
  // -----------------------------
  const PERMS = [
    // Bookings & participants
    { key: "booking:view", desc: "Can view bookings" },
    { key: "booking:create", desc: "Can create bookings" },
    { key: "booking:update", desc: "Can update bookings" },
    { key: "booking:delete", desc: "Can delete bookings" },

    { key: "participant:view", desc: "Can view participants" },
    { key: "participant:add", desc: "Can add participants" },
    { key: "participant:invite", desc: "Can invite participants" },
    { key: "participant:remove", desc: "Can remove participants" },

    // Directory / “Bookable Talent” bundle
    {
      key: "directory:listed_internal",
      desc: "Appears in internal directory & pickers",
    },
    {
      key: "booking:inviteable",
      desc: "Can be invited to bookings (bookable talent)",
    },

    // Notes
    { key: "notes:read", desc: "Can read notes" },
    { key: "notes:write", desc: "Can write notes" },

    // Admin & settings
    { key: "roles:manage", desc: "Can manage roles & permissions" },
    { key: "settings:manage", desc: "Can manage org settings" },
    { key: "staff:create", desc: "Can create staff accounts" },
    { key: "staff:delete", desc: "Can archive/delete staff accounts" },
    { key: "billing:manage", desc: "Can manage billing & subscription" },

    // Lists
    { key: "favorites:manage", desc: "Can manage favorites lists" },
  ];

  const permByKey = {};
  for (const p of PERMS) {
    const rec = await prisma.permissionKey.upsert({
      where: { key: p.key },
      update: { description: p.desc },
      create: { key: p.key, description: p.desc },
    });
    permByKey[p.key] = rec;
  }

  // Bundles
  const CORE_BOOKING = [
    "booking:view",
    "booking:create",
    "booking:update",
    "booking:delete",
    "participant:view",
    "participant:add",
    "participant:invite",
    "participant:remove",
    "notes:read",
    "notes:write",
  ];
  const TALENT_BUNDLE = ["directory:listed_internal", "booking:inviteable"];

  // -----------------------------
  // 2) Role templates (slots 1..10)
  // -----------------------------
  const templates = [
    {
      slot: 1,
      label: "Admin",
      active: true,
      perms: [...Object.keys(permByKey)],
    },
    {
      slot: 2,
      label: "Lead Producer",
      active: true,
      perms: [
        ...CORE_BOOKING,
        ...TALENT_BUNDLE,
        "staff:create",
        "staff:delete",
        "favorites:manage",
      ],
    },
    {
      slot: 3,
      label: "Producer/Booker",
      active: true,
      perms: [...CORE_BOOKING, ...TALENT_BUNDLE, "favorites:manage"],
    },
    {
      slot: 4,
      label: "Host/Presenter",
      active: true,
      perms: ["booking:view", "notes:read", "notes:write", ...TALENT_BUNDLE],
    },
    {
      slot: 5,
      label: "Reporter",
      active: true,
      perms: ["booking:view", "notes:read", "notes:write", ...TALENT_BUNDLE],
    },
    {
      slot: 6,
      label: "Viewer",
      active: true,
      perms: ["booking:view", "notes:read"],
    },
    { slot: 7, label: "Role 7", active: false, perms: [] },
    { slot: 8, label: "Role 8", active: false, perms: [] },
    { slot: 9, label: "Role 9", active: false, perms: [] },
    { slot: 10, label: "Role 10", active: false, perms: [] },
  ];

  for (const t of templates) {
    const tmpl = await prisma.roleTemplate.upsert({
      where: { slot: t.slot },
      update: { defaultLabel: t.label, isActiveByDefault: t.active },
      create: {
        slot: t.slot,
        defaultLabel: t.label,
        isActiveByDefault: t.active,
      },
    });

    // Reset and set default permissions for the template
    await prisma.roleTemplatePermission.deleteMany({
      where: { roleTemplateId: tmpl.id },
    });
    if (t.perms.length) {
      await prisma.roleTemplatePermission.createMany({
        data: t.perms.map((k) => ({
          roleTemplateId: tmpl.id,
          permissionKeyId: permByKey[k].id,
        })),
        skipDuplicates: true,
      });
    }
  }

  // -----------------------------
  // 3) One org + org roles
  // -----------------------------
  let org = await prisma.organization.findFirst({
    where: { name: "Demo Org" },
  });
  if (!org)
    org = await prisma.organization.create({ data: { name: "Demo Org" } });

  // Materialize OrgRole records from templates
  for (const t of templates) {
    await prisma.orgRole.upsert({
      where: { orgId_slot: { orgId: org.id, slot: t.slot } },
      update: { label: t.label, isActive: t.active },
      create: {
        orgId: org.id,
        slot: t.slot,
        label: t.label,
        isActive: t.active,
      },
    });
  }

  // -----------------------------
  // 4) Users
  // -----------------------------
  const user = async (email, displayName) =>
    prisma.user.upsert({
      where: { email },
      update: { displayName },
      create: {
        email,
        displayName,
        hashedPassword: "seeded", // dev-only placeholder
        supportsOnline: true,
      },
    });

  const admin = await user("admin@demo.test", "Admin One");
  const producer = await user("producer@demo.test", "Producer Pat");
  const host = await user("host@demo.test", "Host Harper");
  const reporter = await user("reporter@demo.test", "Reporter Ray");

  // -----------------------------
  // 5) Role assignments (one per user per org)
  // -----------------------------
  const assign = (u, slot) =>
    prisma.userRole.upsert({
      where: { userId_orgId: { userId: u.id, orgId: org.id } },
      update: { slot },
      create: { userId: u.id, orgId: org.id, slot },
    });

  await assign(admin, 1);
  await assign(producer, 3);
  await assign(host, 4);
  await assign(reporter, 5);

  // Helper to fetch org role label
  const roleLabel = async (slot) => {
    const or = await prisma.orgRole.findUnique({
      where: { orgId_slot: { orgId: org.id, slot } },
      select: { label: true },
    });
    return or?.label ?? `Role ${slot}`;
    // (We snapshot labels on participants so UI remains stable if labels change later.)
  };

  // -----------------------------
  // 6) Sample booking + participants + note
  // -----------------------------
  const booking = await prisma.booking.create({
    data: {
      orgId: org.id,
      subject: "Demo Interview",
      status: "PENDING",
      startAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // +1 day
      durationMins: 60,
      appearanceType: "ONLINE",
      locationUrl: "https://example.test/room",
    },
  });

  await prisma.bookingParticipant.createMany({
    data: [
      {
        bookingId: booking.id,
        userId: host.id,
        roleSlot: 4,
        roleLabelSnapshot: await roleLabel(4),
        inviteStatus: "PENDING",
      },
      {
        bookingId: booking.id,
        userId: reporter.id,
        roleSlot: 5,
        roleLabelSnapshot: await roleLabel(5),
        inviteStatus: "PENDING",
      },
    ],
    skipDuplicates: true,
  });

  await prisma.bookingNote.create({
    data: {
      bookingId: booking.id,
      authorId: admin.id,
      body: "Seeded note: hello from the new Roles 1–10 base.",
    },
  });

  console.log("✅ Seed complete.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
