// prisma/seed.js
// Rich seed: 2 orgs; staff (Owner/Producers/Hosts/Reporters), Exclusive & Public Experts,
// sample bookings including multi-host demos. Passwords: ALWAYS "123".
// Safe to run after `prisma migrate reset` (fresh DB). CommonJS per package.json.

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

const PASSWORD = "123";

/** Simple helpers for time windows */
function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60 * 1000);
}
function atNext(hourLocal, minuteLocal = 0) {
  const d = new Date();
  d.setHours(hourLocal, minuteLocal, 0, 0);
  if (d < new Date()) d.setDate(d.getDate() + 1);
  return d;
}

async function main() {
  console.log("Seeding database…");

  const hashed = await bcrypt.hash(PASSWORD, 10);

  /* ---------- Create Orgs + Settings ---------- */
  const orgA = await prisma.organization.create({
    data: {
      name: "Org A",
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
      name: "Org B",
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

  /* ---------- User factories ---------- */
  async function createStaff({
    displayName,
    email,
    avatarUrl,
    org,
    role,
    city = "Cairo",
    countryCode = "EG",
    timeZone = "Africa/Cairo",
  }) {
    const user = await prisma.user.create({
      data: {
        email,
        name: displayName,
        displayName,
        avatarUrl,
        hashedPassword: hashed,
        city,
        countryCode,
        timeZone,
        memberships: {
          create: [{ role, organization: { connect: { id: org.id } } }],
        },
      },
    });
    return user;
  }

  // PUBLIC / EXCLUSIVE experts (standalone users, optionally tied to an org)
  async function createExpert({
    displayName,
    email,
    avatarUrl,
    visibility, // "PUBLIC" | "EXCLUSIVE"
    exclusiveOrgId = null,
    languages = ["en", "ar"],
    tags = ["news", "policy"],
    supportsOnline = true,
    supportsInPerson = false,
    city = "Cairo",
    countryCode = "EG",
    timeZone = "Africa/Cairo",
  }) {
    return prisma.user.create({
      data: {
        email,
        name: displayName,
        displayName,
        avatarUrl,
        hashedPassword: hashed, // allows signing in as an expert for POV tests
        languages,
        tags,
        supportsOnline,
        supportsInPerson,
        city,
        countryCode,
        timeZone,
        expertVisStatus: visibility, // Prisma field (column mapped to expertStatus)
        exclusiveOrgId,
      },
    });
  }

  // Dev avatars
  const img = (n) => `https://i.pravatar.cc/300?img=${n}`;

  /* ---------- STAFF PER ORG ---------- */
  const staffIndex = { A: 1, B: 1 }; // vary avatar ids a bit

  async function seedOrgStaff(label, org) {
    const idx = staffIndex[label];

    const owner = await createStaff({
      displayName: `Owner ${label}`,
      email: `owner.${label.toLowerCase()}@nre.test`,
      avatarUrl: img(10 + idx),
      org,
      role: "OWNER",
    });

    const producers = await Promise.all(
      [1, 2].map((i) =>
        createStaff({
          displayName: `Producer ${label}-${i}`,
          email: `producer.${label.toLowerCase()}${i}@nre.test`,
          avatarUrl: img(20 + idx + i),
          org,
          role: "PRODUCER",
        })
      )
    );

    const hosts = await Promise.all(
      [1, 2, 3].map((i) =>
        createStaff({
          displayName: `Host ${label}-${i}`,
          email: `host.${label.toLowerCase()}${i}@nre.test`,
          avatarUrl: img(30 + idx + i),
          org,
          role: "HOST",
        })
      )
    );

    const reporters = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        createStaff({
          displayName: `Reporter ${label}-${i}`,
          email: `reporter.${label.toLowerCase()}${i}@nre.test`,
          avatarUrl: img(40 + idx + i),
          org,
          role: "REPORTER",
        })
      )
    );

    staffIndex[label] += 1;
    return { owner, producers, hosts, reporters };
  }

  const staffA = await seedOrgStaff("A", orgA);
  const staffB = await seedOrgStaff("B", orgB);

  /* ---------- EXCLUSIVE EXPERTS PER ORG ---------- */
  async function seedExclusiveExperts(label, org) {
    return Promise.all(
      [1, 2, 3, 4].map((i) =>
        createExpert({
          displayName: `Exclusive Expert ${label}-${i}`,
          email: `expert.exclusive.${label.toLowerCase()}${i}@nre.test`,
          avatarUrl: img(60 + i),
          visibility: "EXCLUSIVE",
          exclusiveOrgId: org.id,
          languages: i % 2 === 0 ? ["en"] : ["en", "ar"],
          tags: i % 2 === 0 ? ["economy", "markets"] : ["technology", "ai"],
          supportsOnline: true,
          supportsInPerson: i % 2 === 0,
          city: i % 2 === 0 ? "Riyadh" : "Cairo",
          countryCode: i % 2 === 0 ? "SA" : "EG",
        })
      )
    );
  }

  const exclusiveA = await seedExclusiveExperts("A", orgA);
  const exclusiveB = await seedExclusiveExperts("B", orgB);

  /* ---------- PUBLIC EXPERTS (10 total, no org) ---------- */
  await Promise.all(
    Array.from({ length: 10 }).map((_, i) =>
      createExpert({
        displayName: `Public Expert ${i + 1}`,
        email: `expert.public${i + 1}@nre.test`,
        avatarUrl: img(80 + i),
        visibility: "PUBLIC",
        exclusiveOrgId: null,
        languages: i % 3 === 0 ? ["en", "fr"] : ["en", "ar"],
        tags: i % 2 === 0 ? ["politics", "governance"] : ["science", "health"],
        supportsOnline: true,
        supportsInPerson: i % 3 === 0,
        city: i % 2 === 0 ? "Dubai" : "Amman",
        countryCode: i % 2 === 0 ? "AE" : "JO",
        timeZone: i % 2 === 0 ? "Asia/Dubai" : "Asia/Amman",
      })
    )
  );

  /* ---------- Booking factory (supports guests[] & hosts[] + host model) ---------- */
  /**
   * @param {Object} params
   * @param {any} params.org
   * @param {string} params.subject
   * @param {Date} params.startAt
   * @param {number} [params.durationMins=45]
   * @param {"ONLINE"|"IN_PERSON"|"PHONE"} [params.appearanceType="ONLINE"]  // guest UNIFIED default
   * @param {string} [params.newsroomName]
   * @param {string} [params.expertUserId]
   * @param {string} [params.expertName]
   * @param {string} [params.hostUserId]  // legacy mirror (optional)
   * @param {Array} [params.guests=[]]    // array of guest rows
   * @param {Array} [params.hosts=[]]     // array of host rows
   * @param {Object} [params.hostModel]   // host model defaults & switches
   */
  async function makeBooking({
    org,
    subject,
    startAt,
    durationMins = 45,
    appearanceType = "ONLINE", // guests UNIFIED default
    newsroomName = "Newsroom",
    expertUserId,
    expertName,
    hostUserId,
    guests = [],
    hosts = [],
    hostModel = {},
  }) {
    // Resolve host model defaults
    const {
      hostAppearanceScope = "UNIFIED",
      hostAccessProvisioning = "SHARED",
      hostAppearanceType = "ONLINE",
      hostLocationUrl = null,
      hostLocationName = null,
      hostLocationAddress = null,
      hostDialInfo = null,
    } = hostModel;

    // Back-compat mirror: if hosts[] exists and hostUserId not set, mirror hosts[0]
    const h0 = hosts[0] || null;
    const mirrorHostUserId = hostUserId || (h0 ? h0.userId : null);
    const mirrorHostName = h0 ? h0.name : null;

    return prisma.booking.create({
      data: {
        orgId: org.id,
        subject,
        newsroomName,
        startAt,
        durationMins,

        // Guests model (UNIFIED defaults)
        appearanceScope: "UNIFIED",
        appearanceType,
        accessProvisioning: "SHARED",
        locationUrl:
          appearanceType === "ONLINE" ? "https://meet.example/default" : null,

        // Legacy mirrors
        expertUserId: expertUserId || null,
        expertName: expertName || null,
        hostUserId: mirrorHostUserId,
        hostName: mirrorHostName,

        // Hosts dual model fields (for View/Edit parity)
        hostAppearanceScope,
        hostAccessProvisioning,
        hostAppearanceType:
          hostAppearanceScope === "UNIFIED" ? hostAppearanceType : null,
        hostLocationUrl:
          hostAppearanceScope === "UNIFIED" &&
          hostAccessProvisioning === "SHARED"
            ? hostLocationUrl
            : null,
        hostLocationName:
          hostAppearanceScope === "UNIFIED" &&
          hostAccessProvisioning === "SHARED"
            ? hostLocationName
            : null,
        hostLocationAddress:
          hostAppearanceScope === "UNIFIED" &&
          hostAccessProvisioning === "SHARED"
            ? hostLocationAddress
            : null,
        hostDialInfo:
          hostAppearanceScope === "UNIFIED" &&
          hostAccessProvisioning === "SHARED"
            ? hostDialInfo
            : null,

        // Guests
        guests: {
          create: guests.map((g, order) => ({
            userId: g.userId ?? null,
            name: g.name,
            kind: g.kind, // "EXPERT" | "REPORTER"
            order,
            appearanceType: g.appearanceType, // ONLINE | IN_PERSON | PHONE
            joinUrl: g.joinUrl ?? null,
            venueName: g.venueName ?? null,
            venueAddress: g.venueAddress ?? null,
            dialInfo: g.dialInfo ?? null,
          })),
        },

        // Hosts (multi-hosts)
        ...(hosts.length
          ? {
              hosts: {
                create: hosts.map((h, order) => ({
                  userId: h.userId ?? null,
                  name: h.name || "Host",
                  order,
                  appearanceType:
                    hostAppearanceScope === "UNIFIED"
                      ? hostAppearanceType
                      : h.appearanceType || "ONLINE",
                  joinUrl:
                    hostAppearanceScope === "UNIFIED" &&
                    hostAccessProvisioning === "SHARED"
                      ? null
                      : h.joinUrl ?? null,
                  venueName:
                    hostAppearanceScope === "UNIFIED" &&
                    hostAccessProvisioning === "SHARED"
                      ? null
                      : h.venueName ?? null,
                  venueAddress:
                    hostAppearanceScope === "UNIFIED" &&
                    hostAccessProvisioning === "SHARED"
                      ? null
                      : h.venueAddress ?? null,
                  dialInfo:
                    hostAppearanceScope === "UNIFIED" &&
                    hostAccessProvisioning === "SHARED"
                      ? null
                      : h.dialInfo ?? null,
                })),
              },
            }
          : {}),
      },
    });
  }

  /* ---------- SAMPLE BOOKINGS ---------- */
  // Windows to power availability badges
  const t1 = atNext(11, 0); // next 11:00 local
  const t2 = addMinutes(t1, 120); // +2h
  const t3 = addMinutes(t1, 240); // +4h
  const t4 = addMinutes(t1, 180); // +3h

  // Org A: a few legacy-style bookings (single host mirror) to feed availability
  await makeBooking({
    org: orgA,
    subject: "A: Morning Live Hit",
    startAt: t1,
    durationMins: 40,
    appearanceType: "ONLINE",
    newsroomName: "Org A Newsroom",
    hostUserId: staffA.hosts[0].id,
    expertUserId: exclusiveA[0].id,
    expertName: exclusiveA[0].displayName ?? "Exclusive Expert A-1",
    guests: [
      {
        userId: exclusiveA[0].id,
        name: exclusiveA[0].displayName ?? "Exclusive Expert A-1",
        kind: "EXPERT",
        appearanceType: "ONLINE",
        joinUrl: "https://meet.example/a1",
      },
    ],
  });

  await makeBooking({
    org: orgA,
    subject: "A: Phone Briefing",
    startAt: t2,
    durationMins: 30,
    appearanceType: "PHONE",
    newsroomName: "Org A Newsroom",
    hostUserId: staffA.hosts[1].id,
    expertUserId: exclusiveA[1].id,
    expertName: exclusiveA[1].displayName ?? "Exclusive Expert A-2",
    guests: [
      {
        userId: exclusiveA[1].id,
        name: exclusiveA[1].displayName ?? "Exclusive Expert A-2",
        kind: "EXPERT",
        appearanceType: "PHONE",
        dialInfo: "+20 2 1234 5678",
      },
      {
        userId: staffA.reporters[0].id,
        name: staffA.reporters[0].displayName ?? "Reporter A-1",
        kind: "REPORTER",
        appearanceType: "ONLINE",
        joinUrl: "https://meet.example/ra1",
      },
    ],
  });

  // Org A: **DEMO** multi-host booking (UNIFIED + SHARED + IN_PERSON) with 2 hosts
  await makeBooking({
    org: orgA,
    subject: "A: In-Person Panel (Two Hosts)",
    startAt: t3,
    durationMins: 60,
    appearanceType: "IN_PERSON", // guest default to show variety
    newsroomName: "Org A Newsroom",
    // host model (unified + shared = defaults used; per-host values empty)
    hostModel: {
      hostAppearanceScope: "UNIFIED",
      hostAccessProvisioning: "SHARED",
      hostAppearanceType: "IN_PERSON",
      hostLocationName: "Studio A",
      hostLocationAddress: "1 Nile St, Cairo",
    },
    hosts: [
      {
        userId: staffA.hosts[0].id,
        name: staffA.hosts[0].displayName,
        // per-host fields empty → View shows "(using booking defaults)"
      },
      {
        userId: staffA.hosts[2].id,
        name: staffA.hosts[2].displayName,
      },
    ],
    expertUserId: exclusiveA[2].id,
    expertName: exclusiveA[2].displayName ?? "Exclusive Expert A-3",
    guests: [
      {
        userId: exclusiveA[2].id,
        name: exclusiveA[2].displayName ?? "Exclusive Expert A-3",
        kind: "EXPERT",
        appearanceType: "IN_PERSON",
        venueName: "Studio A",
        venueAddress: "1 Nile St, Cairo",
      },
    ],
  });

  // Org B: a regular single-host booking
  await makeBooking({
    org: orgB,
    subject: "B: Midday Update",
    startAt: addMinutes(t1, 60),
    durationMins: 30,
    appearanceType: "ONLINE",
    newsroomName: "Org B Newsroom",
    hostUserId: staffB.hosts[0].id,
    expertUserId: exclusiveB[0].id,
    expertName: exclusiveB[0].displayName ?? "Exclusive Expert B-1",
    guests: [
      {
        userId: exclusiveB[0].id,
        name: exclusiveB[0].displayName ?? "Exclusive Expert B-1",
        kind: "EXPERT",
        appearanceType: "ONLINE",
        joinUrl: "https://meet.example/b1",
      },
    ],
  });

  // Org B: **DEMO** mixed-mode multi-host (PER_HOST) to cover link/venue paths
  await makeBooking({
    org: orgB,
    subject: "B: Mixed-Mode Roundtable (Two Hosts)",
    startAt: t4,
    durationMins: 45,
    appearanceType: "ONLINE",
    newsroomName: "Org B Newsroom",
    hostModel: {
      hostAppearanceScope: "PER_HOST",
      hostAccessProvisioning: "PER_HOST",
    },
    hosts: [
      {
        userId: staffB.hosts[0].id,
        name: staffB.hosts[0].displayName,
        appearanceType: "ONLINE",
        joinUrl: "https://meet.example/host.b0",
      },
      {
        userId: staffB.hosts[1].id,
        name: staffB.hosts[1].displayName,
        appearanceType: "IN_PERSON",
        venueName: "Studio B",
        venueAddress: "200 Corniche, Doha",
      },
    ],
    expertUserId: exclusiveB[1].id,
    expertName: exclusiveB[1].displayName ?? "Exclusive Expert B-2",
    guests: [
      {
        userId: staffB.reporters[1].id,
        name: staffB.reporters[1].displayName ?? "Reporter B-2",
        kind: "REPORTER",
        appearanceType: "ONLINE",
        joinUrl: "https://meet.example/rb2",
      },
      {
        userId: exclusiveB[1].id,
        name: exclusiveB[1].displayName ?? "Exclusive Expert B-2",
        kind: "EXPERT",
        appearanceType: "ONLINE",
        joinUrl: "https://meet.example/b2",
      },
    ],
  });

  /* ---------- Output handy table ---------- */
  const allUsers = await prisma.user.findMany({
    include: { memberships: { include: { organization: true } } },
    orderBy: [{ email: "asc" }],
  });

  const rows = allUsers.map((u) => {
    const membership = u.memberships[0];
    const role =
      membership?.role ??
      (u.expertVisStatus ? `EXPERT (${u.expertVisStatus})` : "—");
    const orgName =
      membership?.organization?.name || (u.exclusiveOrgId ? "Exclusive" : "—");
    return {
      Name: u.displayName || u.name || u.email,
      Email: u.email,
      Role: role,
      Org: orgName,
      Password: PASSWORD,
    };
  });

  console.log("\nSeeded users (first 50 shown):");
  console.table(rows.slice(0, 50));
  console.log("\nAll passwords are '123'.");
  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
