// src/lib/server/profile/notes.ts

import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton for Next.js (safe across hot-reloads).
 * If you already export a shared client elsewhere, replace this block with:
 *   import { prisma } from "<your-shared-client>";
 */
const g = globalThis as unknown as { __prisma?: PrismaClient };
export const prisma: PrismaClient =
  g.__prisma ?? new PrismaClient({ log: ["warn", "error"] });
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;

/** Public shape returned to the UI */
export type OrgGuestNoteDTO = {
  id: string;
  body: string;
  authorUserId: string;
  authorName: string | null;
  createdAt: string; // ISO 8601
};

/** List notes for an org+guest (newest first). */
export async function listNotes(
  orgId: string,
  guestId: string
): Promise<OrgGuestNoteDTO[]> {
  if (!orgId || !guestId) return [];

  const rows = await prisma.orgGuestNote.findMany({
    where: { orgId, guestId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      body: true,
      authorUserId: true,
      authorName: true,
      createdAt: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    authorUserId: r.authorUserId,
    authorName: r.authorName ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Create a new note for org+guest. Returns the created DTO. */
export async function createNote(input: {
  orgId: string;
  guestId: string;
  authorUserId: string;
  authorName?: string | null;
  body: string;
}): Promise<OrgGuestNoteDTO | null> {
  const orgId = input.orgId?.trim();
  const guestId = input.guestId?.trim();
  const authorUserId = input.authorUserId?.trim();
  const body = input.body?.trim();

  if (!orgId || !guestId || !authorUserId || !body) return null;

  const row = await prisma.orgGuestNote.create({
    data: {
      orgId,
      guestId,
      authorUserId,
      authorName: input.authorName ?? null,
      body,
    },
    select: {
      id: true,
      body: true,
      authorUserId: true,
      authorName: true,
      createdAt: true,
    },
  });

  return {
    id: row.id,
    body: row.body,
    authorUserId: row.authorUserId,
    authorName: row.authorName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
