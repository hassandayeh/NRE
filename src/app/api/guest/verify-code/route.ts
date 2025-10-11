// src/app/api/guest/verify-code/route.ts
import { NextResponse } from "next/server";
export const runtime = "nodejs";

/**
 * POST /api/guest/verify-code
 *
 * Body: { email: string, code: string }
 *
 * Validates a 6-digit code previously created by /api/guest/send-code.
 * On success:
 *   - Deletes the code entry to prevent reuse.
 *   - Mints a short-lived, HttpOnly cookie ("guest_verify") that carries a random ticket.
 *   - Stores the ticket -> { email, exp } in a module-global map for the follow-up step.
 *
 * Status codes:
 * - 200: { ok: true }
 * - 400: { ok: false, reason:"invalid_input" }
 * - 404: { ok: false, reason:"not_found" }
 * - 410: { ok: false, reason:"expired" }
 * - 401: { ok: false, reason:"invalid_code", attemptsRemaining:number }
 * - 429: { ok: false, reason:"too_many_attempts" }
 */

type Json = Record<string, unknown>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;
const MAX_VERIFY_ATTEMPTS = 6;
const TICKET_TTL_SEC = 10 * 60; // 10 minutes

type CodeEntry = { code: string; exp: number; attempts: number };
type TicketEntry = { email: string; exp: number };

declare global {
  // created by /api/guest/send-code
  // eslint-disable-next-line no-var
  var __guestCodeStore: Map<string, CodeEntry> | undefined;

  // created/used here and by the upcoming /api/guest/complete
  // eslint-disable-next-line no-var
  var __guestVerifyTickets: Map<string, TicketEntry> | undefined;
}

function getCodeStore(): Map<string, CodeEntry> {
  if (!globalThis.__guestCodeStore) {
    globalThis.__guestCodeStore = new Map<string, CodeEntry>();
  }
  return globalThis.__guestCodeStore;
}
function getTicketStore(): Map<string, TicketEntry> {
  if (!globalThis.__guestVerifyTickets) {
    globalThis.__guestVerifyTickets = new Map<string, TicketEntry>();
  }
  return globalThis.__guestVerifyTickets;
}

function json(status: number, body: Json, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

function randomTicket(): string {
  // 32 hex chars
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: Request) {
  let email = "";
  let code = "";

  // ---- Parse body
  try {
    const body = (await req.json()) as
      | { email?: string; code?: string }
      | undefined;
    email = (body?.email || "").trim().toLowerCase();
    code = (body?.code || "").trim();
  } catch {
    // fallthrough to invalid input
  }

  // ---- Validate formats
  if (!EMAIL_RE.test(email) || !CODE_RE.test(code)) {
    return json(400, { ok: false, reason: "invalid_input" });
  }

  // ---- Lookup entry
  const store = getCodeStore();
  const entry = store.get(email);
  if (!entry) {
    return json(404, { ok: false, reason: "not_found" });
  }

  // ---- Expiry
  if (Date.now() >= entry.exp) {
    store.delete(email);
    return json(410, { ok: false, reason: "expired" });
  }

  // ---- Attempts lockout
  if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
    return json(429, { ok: false, reason: "too_many_attempts" });
  }

  // ---- Check code
  if (code !== entry.code) {
    entry.attempts += 1;
    const remaining = Math.max(0, MAX_VERIFY_ATTEMPTS - entry.attempts);
    return json(401, {
      ok: false,
      reason: "invalid_code",
      attemptsRemaining: remaining,
    });
  }

  // ---- Success: consume code and mint a short-lived verification ticket
  store.delete(email);

  const ticket = randomTicket();
  const exp = Math.floor(Date.now() / 1000) + TICKET_TTL_SEC;

  const tickets = getTicketStore();
  tickets.set(ticket, { email, exp: exp * 1000 });

  // Set HttpOnly cookie with the ticket so the next step can create the GuestProfile securely.
  const res = NextResponse.json({ ok: true });
  res.cookies.set("guest_verify", ticket, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TICKET_TTL_SEC,
  });

  return res;
}

// (Optional) Keep this GET helper if you found it useful during bring-up.
// export async function GET() {
//   return new Response("verify-code route is alive (POST only)", { status: 405 });
// }
