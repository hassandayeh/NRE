// src/app/api/policy/guest-email/route.ts
import { NextRequest, NextResponse } from "next/server";

/**
 * Domain claims & guest email policy (server check only).
 *
 * POLICY
 * - Claimed org domains are STAFF-ONLY.
 * - Guest must use a personal email (gmail/outlook/icloud/etc.).
 *
 * HOW IT WORKS
 * - Read claimed domains from env CLAIMED_ORG_DOMAINS (comma-separated).
 * - If email domain matches a claimed domain or any of its subdomains, reject.
 *
 * USAGE
 * - POST /api/policy/guest-email  { "email": "person@example.com" }
 * - GET  /api/policy/guest-email?email=person@example.com  (for quick manual checks)
 *
 * RESPONSES
 *  200 { ok: true }
 *  400 { ok: false, reason: "invalid_email" }
 *  409 { ok: false, reason: "org_domain_blocked", message: "...guidance..." }
 */

export const runtime = "nodejs";

function parseClaimedDomains(): string[] {
  const raw = process.env.CLAIMED_ORG_DOMAINS || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function extractDomain(email: string): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  // ignore plus-addressing in the local part; domain is the substring after @
  return email.slice(at + 1).toLowerCase();
}

function isClaimed(domain: string, claimed: string[]): boolean {
  // Match exact domain or any subdomain: a.b.example.com matches example.com
  return claimed.some((c) => domain === c || domain.endsWith("." + c));
}

function guidance(domain: string) {
  return (
    `This email domain (${domain}) is managed by an organization here. ` +
    `To continue: use a personal email for guest access, or choose "I was invited" to join as staff.`
  );
}

async function check(email: string) {
  const claimed = parseClaimedDomains();
  const domain = extractDomain(email || "");
  if (!domain) {
    return NextResponse.json(
      { ok: false, reason: "invalid_email" },
      { status: 400 }
    );
  }
  if (isClaimed(domain, claimed)) {
    return NextResponse.json(
      { ok: false, reason: "org_domain_blocked", message: guidance(domain) },
      {
        status: 409,
        headers: { "x-policy-reason": "org_domain_blocked" },
      }
    );
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  return check(body?.email ?? "");
}

// Handy for manual testing in the browser:
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email") ?? "";
  return check(email);
}
