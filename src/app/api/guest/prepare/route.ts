// src/app/api/guest/prepare/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { createHmac, randomInt } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ok = { ok: true; token: string; devCode?: string; retryAfter?: number };
type Err = {
  ok: false;
  reason?: string;
  message?: string;
  retryAfter?: number;
};

function json(status: number, body: Ok | Err) {
  return NextResponse.json(body, { status });
}

function b64url(buf: Buffer | string) {
  const base = Buffer.isBuffer(buf)
    ? buf.toString("base64")
    : Buffer.from(buf).toString("base64");
  return base.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sign(payload: object, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const p1 = b64url(JSON.stringify(header));
  const p2 = b64url(JSON.stringify(payload));
  const data = `${p1}.${p2}`;
  const sig = createHmac("sha256", secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

function domainOf(email: string) {
  const m = (email || "")
    .trim()
    .toLowerCase()
    .match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/);
  return m?.[1] || null;
}

/** Simple in-memory rate limiter (per IP+email): 5 reqs / 15 min. */
const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 5;
const bucket = new Map<string, number[]>();
const keyFor = (ip: string, email: string) =>
  `${ip}::${email.toLowerCase().trim()}`;
function rateLimit(ip: string, email: string) {
  const now = Date.now();
  const k = keyFor(ip, email);
  const arr = (bucket.get(k) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= LIMIT) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - arr[0])) / 1000);
    return { limited: true, retryAfter };
  }
  arr.push(now);
  bucket.set(k, arr);
  return { limited: false, retryAfter: 0 };
}

/** Parse env CLAIMED_ORG_DOMAINS=acme.com,widgets.co.uk */
function envClaimedDomains(): Set<string> {
  const raw = process.env.CLAIMED_ORG_DOMAINS || "";
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(list);
}

export async function POST(req: NextRequest) {
  // 1) Parse input
  let email = "";
  try {
    const j = await req.json();
    email = (j?.email ?? "").toString().trim().toLowerCase();
  } catch {
    return json(400, {
      ok: false,
      reason: "invalid_json",
      message: "Invalid request body.",
    });
  }

  // 2) Basic email validation
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailValid) {
    return json(400, {
      ok: false,
      reason: "invalid_email",
      message: "Enter a valid email address.",
    });
  }

  // 3) Domain separation policy
  const inputDomain = domainOf(email);
  const claimed = envClaimedDomains();

  // Check against session domain if available (but DO NOT 401 if no session)
  let sessionDomain: string | null = null;
  try {
    const session = await getServerSession(authOptions);
    const sEmail =
      ((session as any)?.email as string) ||
      ((session as any)?.user?.email as string) ||
      null;
    sessionDomain = sEmail ? domainOf(sEmail) : null;
  } catch {
    // swallow — lack of session MUST NOT 401 this endpoint
  }

  // Block when input domain equals either the current session domain or any claimed org domain from env.
  if (
    inputDomain &&
    ((sessionDomain && inputDomain === sessionDomain) ||
      (claimed.size > 0 && claimed.has(inputDomain)))
  ) {
    return json(400, {
      ok: false,
      reason: "use_personal_email",
      message: "Use a personal email for guest access.",
    });
  }

  // 4) Rate limit
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.ip ||
    "127.0.0.1";
  const rl = rateLimit(ip, email);
  if (rl.limited) {
    return json(429, {
      ok: false,
      reason: "too_many",
      message: "Too many requests.",
      retryAfter: rl.retryAfter,
    });
  }

  // 5) Build token + code (no DB writes)
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + 15 * 60; // 15 minutes
  const secret = process.env.NEXTAUTH_SECRET || "dev-secret-only";

  const token = sign({ v: 1, email, code, iat: nowSec, exp: expSec }, secret);

  // 6) TODO: send the code via your email provider (next slice).
  const body: Ok = { ok: true, token };
  if (process.env.NODE_ENV !== "production") {
    body.devCode = code;
  }
  return json(200, body);
}

// Optional hardening: disallow GET.
export async function GET() {
  return new Response("prepare route is POST-only", { status: 405 });
}
