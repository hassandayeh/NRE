// src/app/layout.tsx
// Server component: reads OrgFeatureToggle from the database on every request
// and exposes the values to the app via <body data-*> attributes.
//
// Why data-*?
// - Keeps this as a single-file change (no extra client/provider file).
// - Works for both server and client components (client code can read from
//   document.body.dataset without wiring a React context yet).
//
// Later, if we want a React Context, we can add a small client Provider file,
// but this keeps us strictly within the one-file workflow for now.

import type { Metadata } from "next";
import "./globals.css";

// --- Prisma singleton (safe in dev hot-reload) ---
import { PrismaClient } from "@prisma/client";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// --- Types for clarity ---
type ToggleFlags = {
  showProgramName: boolean;
  showHostName: boolean;
  showTalkingPoints: boolean;
};

// Fetch the single OrgFeatureToggle row (seed created exactly one).
async function getToggleFlags(): Promise<ToggleFlags> {
  // findFirst is fine here because schema/seed guarantees a single row.
  const row = await prisma.orgFeatureToggle.findFirst({
    select: {
      showProgramName: true,
      showHostName: true,
      showTalkingPoints: true,
    },
  });

  // Sensible defaults if the row doesn't exist yet.
  return {
    showProgramName: row?.showProgramName ?? true,
    showHostName: row?.showHostName ?? true,
    showTalkingPoints: row?.showTalkingPoints ?? true,
  };
}

export const metadata: Metadata = {
  title: "NRE",
  description: "Expert Booker MVP",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const flags = await getToggleFlags();

  return (
    <html lang="en">
      {/* Expose flags to the app without adding a client Provider yet */}
      <body
        data-show-program-name={String(flags.showProgramName)}
        data-show-host-name={String(flags.showHostName)}
        data-show-talking-points={String(flags.showTalkingPoints)}
        className=""
      >
        {children}
      </body>
    </html>
  );
}
