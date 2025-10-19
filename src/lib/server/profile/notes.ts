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

/** Internal helper to normalize a Prisma row -> DTO */
function toDTO(row: {
  id: string;
  body: string;
  authorUserId: string;
  authorName: string | null;
  createdAt: Date;
}): OrgGuestNoteDTO {
  return {
    id: row.id,
    body: row.body,
    authorUserId: row.authorUserId,
    authorName: row.authorName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

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

  return rows.map(toDTO);
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

  return toDTO(row);
}

/**
 * Update an existing note's body (author-only).
 * - Does NOT touch createdAt (keeps list position stable).
 * - Client (UI) already appends a plain "[edited]" marker if needed.
 */
export async function updateNote(input: {
  id: string;
  orgId: string;
  guestId: string;
  authorUserId: string; // must match note.authorUserId
  body: string;
}): Promise<OrgGuestNoteDTO | null> {
  const id = input.id?.trim();
  const orgId = input.orgId?.trim();
  const guestId = input.guestId?.trim();
  const authorUserId = input.authorUserId?.trim();
  const body = input.body?.trim();

  if (!id || !orgId || !guestId || !authorUserId || !body) return null;

  // Look up within org/guest scope, then enforce author ownership
  const existing = await prisma.orgGuestNote.findFirst({
    where: { id, orgId, guestId },
    select: { id: true, authorUserId: true },
  });
  if (!existing) return null;
  if (existing.authorUserId !== authorUserId) return null;

  const updated = await prisma.orgGuestNote.update({
    where: { id },
    data: { body }, // keep createdAt unchanged
    select: {
      id: true,
      body: true,
      authorUserId: true,
      authorName: true,
      createdAt: true,
    },
  });

  return toDTO(updated);
}

/**
 * Delete a note (author-only) and create a tombstone entry:
 * "— {authorName|authorUserId} deleted a note on {ISO_TIME}"
 *
 * The tombstone inherits the ORIGINAL createdAt of the deleted note,
 * so it stays in the same position in the list.
 */
export async function deleteNote(input: {
  id: string;
  orgId: string;
  guestId: string;
  authorUserId: string; // must match note.authorUserId
  authorName?: string | null; // for tombstone display
}): Promise<OrgGuestNoteDTO | null> {
  const id = input.id?.trim();
  const orgId = input.orgId?.trim();
  const guestId = input.guestId?.trim();
  const authorUserId = input.authorUserId?.trim();
  const authorName =
    typeof input.authorName === "string" ? input.authorName.trim() : null;

  if (!id || !orgId || !guestId || !authorUserId) return null;

  return await prisma.$transaction(async (tx) => {
    // Fetch original to get createdAt for stable positioning
    const existing = await tx.orgGuestNote.findFirst({
      where: { id, orgId, guestId },
      select: { id: true, authorUserId: true, createdAt: true },
    });
    if (!existing) return null;
    if (existing.authorUserId !== authorUserId) return null;

    // Delete only if author matches
    const delRes = await tx.orgGuestNote.deleteMany({
      where: { id, orgId, guestId, authorUserId },
    });
    if (delRes.count !== 1) return null;

    const whenISO = new Date().toISOString();
    const actor = authorName || authorUserId;
    const tombstoneBody = `— ${actor} deleted a note on ${whenISO}`;

    const tombstone = await tx.orgGuestNote.create({
      data: {
        orgId,
        guestId,
        authorUserId, // attribute to actor (for audit trail)
        authorName: authorName ?? null,
        body: tombstoneBody,
        createdAt: existing.createdAt, // <-- keep original position
      },
      select: {
        id: true,
        body: true,
        authorUserId: true,
        authorName: true,
        createdAt: true,
      },
    });

    return toDTO(tombstone);
  });
}
