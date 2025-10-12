// src/app/api/guest/complete/route.ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

/**
 * POST /api/guest/complete
 *
 * Validates the short-lived "guest_verify" cookie (set by /api/guest/verify-code),
 * then creates or reuses a GuestProfile (by personalEmail) and returns its id.
 * Optionally accepts { password } to set a guest password (hashed).
 *
 * Status:
 * - 200: { ok: true, email, guestProfileId }
 * - 401: { ok: false, reason: "no_ticket" }
 * - 404: { ok: false, reason: "not_found" }
 * - 410: { ok: false, reason: "expired" }
 * - 500: { ok: false, reason: "db_error" | "prisma_client_out_of_date", message }
 */

// ---------------- Dev-only telemetry ----------------
const DEV = process.env.NODE_ENV !== "production";
function devLog(label: string, payload: Record<string, unknown>) {
  if (!DEV) return;
  // eslint-disable-next-line no-console
  console.log(`[guest_complete:${label}] ${new Date().toISOString()}`, payload);
}

// ---------------- Ticket store + Prisma singleton ----------------
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
    globalThis.__guestVerifyTickets = new Map();
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
  if (err?.message) return String(err.message);
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown database error";
  }
}

// Platform policy helper: split email domain
function emailDomain(e: string) {
  const at = e.indexOf("@");
  return at > 0 ? e.slice(at + 1).toLowerCase() : "";
}

// ---------------- Handler ----------------
export async function POST(req: Request) {
  const jar = cookies();
  const ticket = jar.get("guest_verify")?.value || "";

  if (!ticket) {
    devLog("no_ticket", {});
    return NextResponse.json(
      { ok: false, reason: "no_ticket" },
      { status: 401 }
    );
  }

  const tickets = getTicketStore();
  const entry = tickets.get(ticket);

  if (!entry) {
    devLog("not_found", {});
    return clearCookie(
      NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 })
    );
  }

  if (Date.now() >= entry.exp) {
    tickets.delete(ticket);
    devLog("expired", { email: entry.email });
    return clearCookie(
      NextResponse.json({ ok: false, reason: "expired" }, { status: 410 })
    );
  }

  // Consume the ticket so it can't be replayed
  tickets.delete(ticket);
  const email = entry.email.toLowerCase().trim();

  // Platform-level policy: the personal (guest) email must not share the same domain
  // as the currently signed-in email. We fetch the session with the forwarded cookie.
  try {
    const base = new URL(req.url);
    const cookieHeader = req.headers.get("cookie") || "";
    const sessRes = await fetch(new URL("/api/auth/session", base).toString(), {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (sessRes.ok) {
      const sess: any = await sessRes.json().catch(() => null);
      const currentEmail: string | null =
        (sess?.email as string) ?? (sess?.user?.email as string) ?? null;
      if (currentEmail) {
        const dCur = emailDomain(currentEmail);
        const dTar = emailDomain(email);
        if (dCur && dTar && dCur === dTar) {
          devLog("use_personal_email", { currentEmail, target: email });
          return clearCookie(
            NextResponse.json(
              { ok: false, reason: "use_personal_email" },
              { status: 400 }
            )
          );
        }
      }
    }
  } catch {
    // If session fetch fails, proceed; other guards exist in the flow.
  }

  // Optional password from body
  let providedPassword: string | undefined;
  try {
    const body = (await req.json().catch(() => null)) as {
      password?: string;
    } | null;
    if (body && typeof body.password === "string") {
      const p = body.password.trim();
      // keep len minimal; you can harden later if needed
      if (p.length >= 6 && p.length <= 200) providedPassword = p;
    }
  } catch {
    // ignore malformed bodies; password remains undefined
  }

  devLog("start", { email, hasPassword: Boolean(providedPassword) });

  const prisma = getPrisma();

  // Access the model dynamically so TS compiles even if the client types are stale.
  const gp = (prisma as any).guestProfile;
  if (!gp) {
    devLog("prisma_client_out_of_date", {});
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

    let created = false;
    let passwordAction: "set" | "updated" | "unchanged" = "unchanged";

    if (!profile) {
      // Safe fallback even if personalEmail isn't unique: find first, else create.
      const baseData: any = { personalEmail: email };
      if (providedPassword) {
        baseData.passwordHash = await bcrypt.hash(providedPassword, 10);
        passwordAction = "set";
      }
      profile =
        (await gp.findFirst({ where: { personalEmail: email } })) ??
        (await gp.create({ data: baseData }));
      created = !("id" in (profile ?? {})) ? false : true;
    } else if (providedPassword) {
      // Update password when provided
      await gp.update({
        where: { id: profile.id },
        data: { passwordHash: await bcrypt.hash(providedPassword, 10) },
      });
      passwordAction = "updated";
    }

    devLog("success", {
      email,
      guestProfileId: profile.id,
      created,
      password: passwordAction,
    });

    return clearCookie(
      NextResponse.json({
        ok: true,
        email,
        guestProfileId: profile.id,
      })
    );
  } catch (e) {
    // Log for dev; return helpful message to the client.
    devLog("db_error", { email, message: asMsg(e) });
    // eslint-disable-next-line no-console
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
