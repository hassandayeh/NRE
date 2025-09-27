// prisma/seed.js
// Rich seed: 2 orgs; staff (Owner/Producers/Hosts/Reporters), Exclusive & Public Experts, sample bookings.
// Passwords: ALWAYS "123".
// Safe to run after `prisma migrate reset` (fresh DB).
// Uses CommonJS per package.json ("type": not module).

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const PASSWORD = "123";

// Simple helper to stagger future times
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

  // ---------- Create Orgs + Settings ----------
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

  // Utility to create a user (optionally with membership role in an org)
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
          create: [
            {
              role,
              organization: { connect: { id: org.id } },
            },
          ],
        },
      },
    });
    return user;
  }

  // Utility to create an expert (PUBLIC or EXCLUSIVE)
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
        expertVisStatus: visibility, // PUBLIC | EXCLUSIVE
        exclusiveOrgId,
      },
    });
  }

  // Image source (stable dev avatars)
  const img = (n) => `https://i.pravatar.cc/300?img=${n}`;

  // ---------- STAFF PER ORG ----------
  const staffIndex = { A: 1, B: 1 }; // just to vary avatar ids

  async function seedOrgStaff(label, org) {
    const idx = staffIndex[label];

    // 1 Owner
    const owner = await createStaff({
      displayName: `Owner ${label}`,
      email: `owner.${label.toLowerCase()}@nre.test`,
      avatarUrl: img(10 + idx),
      org,
      role: "OWNER",
    });

    // 2 Producers
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

    // 3 Hosts
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

    // 5 Reporters (requires Role.REPORTER in schema)
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

  // ---------- EXCLUSIVE EXPERTS PER ORG ----------
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

  // ---------- PUBLIC EXPERTS (10 total, no org) ----------
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

  // ---------- SAMPLE BOOKINGS to power availability badges ----------
  // We’ll create a few bookings in the next 7 days for Hosts + Experts + a Reporter.
  async function makeBooking({
    org,
    subject,
    startAt,
    durationMins = 45,
    appearanceType = "ONLINE",
    hostUserId,
    expertUserId,
    expertName,
    newsroomName,
    guests = [], // array of { userId, name, kind, appearanceType, joinUrl|venueName|dialInfo }
  }) {
    return prisma.booking.create({
      data: {
        orgId: org.id,
        subject,
        startAt,
        durationMins,
        appearanceScope: "UNIFIED",
        appearanceType,
        locationUrl:
          appearanceType === "ONLINE" ? "https://meet.example/test" : null,
        expertUserId: expertUserId || null,
        hostUserId: hostUserId || null,
        expertName,
        newsroomName,
        guests: {
          create: guests.map((g, order) => ({
            userId: g.userId ?? null,
            name: g.name,
            kind: g.kind,
            order,
            appearanceType: g.appearanceType,
            joinUrl: g.joinUrl ?? null,
            venueName: g.venueName ?? null,
            venueAddress: g.venueAddress ?? null,
            dialInfo: g.dialInfo ?? null,
          })),
        },
      },
    });
  }

  const t1 = atNext(11, 0); // next 11:00 local
  const t2 = addMinutes(t1, 120); // +2h
  const t3 = addMinutes(t1, 240); // +4h

  // Org A: create 3 bookings
  await makeBooking({
    org: orgA,
    subject: "A: Morning Live Hit",
    startAt: t1,
    durationMins: 40,
    appearanceType: "ONLINE",
    hostUserId: staffA.hosts[0].id,
    expertUserId: exclusiveA[0].id,
    expertName: exclusiveA[0].displayName ?? "Exclusive Expert A-1",
    newsroomName: "Org A Newsroom",
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
    hostUserId: staffA.hosts[1].id,
    expertUserId: exclusiveA[1].id,
    expertName: exclusiveA[1].displayName ?? "Exclusive Expert A-2",
    newsroomName: "Org A Newsroom",
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

  await makeBooking({
    org: orgA,
    subject: "A: In-Person Panel",
    startAt: t3,
    durationMins: 60,
    appearanceType: "IN_PERSON",
    hostUserId: staffA.hosts[2].id,
    expertUserId: exclusiveA[2].id,
    expertName: exclusiveA[2].displayName ?? "Exclusive Expert A-3",
    newsroomName: "Org A Newsroom",
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

  // Org B: create 2 bookings
  await makeBooking({
    org: orgB,
    subject: "B: Midday Update",
    startAt: addMinutes(t1, 60),
    durationMins: 30,
    appearanceType: "ONLINE",
    hostUserId: staffB.hosts[0].id,
    expertUserId: exclusiveB[0].id,
    expertName: exclusiveB[0].displayName ?? "Exclusive Expert B-1",
    newsroomName: "Org B Newsroom",
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

  await makeBooking({
    org: orgB,
    subject: "B: Reporter De-Brief",
    startAt: addMinutes(t2, 90),
    durationMins: 30,
    appearanceType: "ONLINE",
    hostUserId: staffB.hosts[1].id,
    expertUserId: exclusiveB[1].id,
    expertName: exclusiveB[1].displayName ?? "Exclusive Expert B-2",
    newsroomName: "Org B Newsroom",
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

  // ---------- Output handy table ----------
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
