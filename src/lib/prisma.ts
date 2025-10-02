// src/lib/prisma.ts
// Single Prisma client for the whole app.
// Exports BOTH a default and a named `prisma` to avoid import-style mismatches.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  __prisma?: PrismaClient;
};

const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

export { prisma }; // named export
export default prisma; // default export
