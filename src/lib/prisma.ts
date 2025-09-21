// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton for Next.js (prevents exhausting DB connections during HMR).
 * In dev, we stash the client on globalThis; in prod, we create a single instance.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // You can uncomment logs while debugging Prisma:
    // log: ["query", "error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
