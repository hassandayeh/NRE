// src/app/api/guest/complete/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";

/**
 * POST /api/guest/complete
 *
 * Validates the short-lived "guest_verify" cookie (set by /api/guest/verify-code),
 * then creates or reuses a GuestProfile (by personalEmail) and returns its id.
 * Now with robust try/catch so DB errors are returned as helpful JSON instead of opaque 500s.
 *
 * Status:
 * - 200: { ok: true, email, guestProfileId }
 * - 401: { ok: false, reason: "no_ticket" }
 * - 404: { ok: false, reason: "not_found" }
 * - 410: { ok: false, reason: "expired" }
 * - 500: { ok: false, reason: "db_error" | "prisma_client_out_of_date", message }
 */

type TicketEntry = { email: string; exp: number };

declare global {
  // created in /api/guest/verify-code
  // eslint-disable-next-line no-var
  var __guestVerifyTickets: Map<string, TicketEntry> | undefined;

  // prisma singleton for dev hot-reload
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function getTicketStore(): Map<string, TicketEntry> {
  if (!globalThis.__guestVerifyTickets) {
    globalThis.__guestVerifyTickets = new Map<string, TicketEntry>();
  }
  return globalThis.__guestVerifyTickets;
}

function getPrisma(): PrismaClient {
  if (!globalThis.__prisma) {
    globalThis.__prisma = new PrismaClient();
  }
  return globalThis.__prisma;
}

function clearCookie(res: NextResponse) {
  res.cookies.delete("guest_verify");
  return res;
}

function asMsg(e: unknown) {
  const err = e as any;
  // Prisma errors often have code/meta; surface a concise message.
  if (err?.message) return String(err.message);
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown database error";
  }
}

export async function POST() {
  const jar = cookies();
  const ticket = jar.get("guest_verify")?.value || "";

  if (!ticket) {
    return NextResponse.json(
      { ok: false, reason: "no_ticket" },
      { status: 401 }
    );
  }

  const tickets = getTicketStore();
  const entry = tickets.get(ticket);

  if (!entry) {
    return clearCookie(
      NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 })
    );
  }

  if (Date.now() >= entry.exp) {
    tickets.delete(ticket);
    return clearCookie(
      NextResponse.json({ ok: false, reason: "expired" }, { status: 410 })
    );
  }

  // Consume the ticket so it can't be replayed
  tickets.delete(ticket);

  const email = entry.email.toLowerCase().trim();
  const prisma = getPrisma();

  // Access the model dynamically so TS compiles even if the client types are stale.
  const gp = (prisma as any).guestProfile;
  if (!gp) {
    return clearCookie(
      NextResponse.json(
        {
          ok: false,
          reason: "prisma_client_out_of_date",
          message:
            "Prisma Client is missing model GuestProfile. Run `npx prisma generate` and restart the dev server.",
        },
        { status: 500 }
      )
    );
  }

  try {
    // Try unique lookup first. If personalEmail isn't unique yet, this throws — we catch below.
    let profile =
      (await gp
        .findUnique({ where: { personalEmail: email } })
        .catch(() => null)) ?? null;

    if (!profile) {
      // Safe fallback even if personalEmail isn't unique: find first, else create.
      profile =
        (await gp.findFirst({ where: { personalEmail: email } })) ??
        (await gp.create({
          data: {
            personalEmail: email,
            // Schema defaults (e.g., visibility/inviteable) will apply automatically.
          },
        }));
    }

    return clearCookie(
      NextResponse.json({
        ok: true,
        email,
        guestProfileId: profile.id,
      })
    );
  } catch (e) {
    // Log for dev; return helpful message to the client.
    console.error("[/api/guest/complete] DB error:", e);
    return clearCookie(
      NextResponse.json(
        {
          ok: false,
          reason: "db_error",
          message:
            asMsg(e) ||
            "Database error while creating/fetching GuestProfile. Make sure migrations are applied.",
        },
        { status: 500 }
      )
    );
  }
}

// Optional: quick probe
export async function GET() {
  return new Response("complete route is POST-only", { status: 405 });
}
