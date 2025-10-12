// src/app/api/guest/prepare/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

/**
 * POST /api/guest/prepare
 * Body: { email: string }
 *
 * Platform-level policy:
 * - Signed-in only (no role gate).
 * - "Personal email" must NOT share the same domain as the current sign-in email.
 * - No org data is copied; this endpoint only issues a short-lived, signed token.
 * - Throttle to prevent abuse; generic errors to avoid enumeration.
 *
 * Response: { ok: true, token: string }  (no code is returned)
 */

// ---- session helper (reuse cookie) ----
async function getSession(req: NextRequest) {
  const url = new URL(req.url);
  const cookie = req.headers.get("cookie") || "";
  const res = await fetch(new URL("/api/auth/session", url).toString(), {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ---- simple in-memory throttle (per process) ----
type Hit = { t: number; n: number };
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT = 5; // 5 attempts per window
const g = globalThis as unknown as { __nre_rate?: Map<string, Hit> };
const rate = g.__nre_rate ?? new Map<string, Hit>();
if (!g.__nre_rate) g.__nre_rate = rate;

function throttleKey(ip: string, email: string) {
  return `${ip}::${email.toLowerCase()}`;
}
function recordAndCheck(ip: string, email: string) {
  const k = throttleKey(ip, email);
  const now = Date.now();
  const prev = rate.get(k);
  if (!prev || now - prev.t > RATE_WINDOW_MS) {
    rate.set(k, { t: now, n: 1 });
    return true;
  }
  if (prev.n >= RATE_LIMIT) return false;
  prev.n += 1;
  return true;
}

// ---- token helpers (HMAC; no DB) ----
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TOKEN_TTL_MS = 12 * 60 * 1000; // token lives slightly longer than code

function getSecret() {
  // Prefer your NextAuth secret if present; otherwise dev-only fallback
  return process.env.NEXTAUTH_SECRET || "dev-only-secret-do-not-use-in-prod";
}

function b64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sign(payload: object) {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf8");
  const sig = crypto.createHmac("sha256", getSecret()).update(body).digest();
  return `${b64url(body)}.${b64url(sig)}`;
}

function verify(token: string) {
  const [b, s] = token.split(".");
  if (!b || !s) return null;
  const body = Buffer.from(b.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const expect = crypto.createHmac("sha256", getSecret()).update(body).digest();
  const got = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (!crypto.timingSafeEqual(expect, got)) return null;
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
}

function sha256(s: string) {
  return b64url(crypto.createHash("sha256").update(s).digest());
}

function emailDomain(e: string) {
  const at = e.indexOf("@");
  return at > 0 ? e.slice(at + 1).toLowerCase() : "";
}

export async function POST(req: NextRequest) {
  // 1) Auth required
  const session = await getSession(req);
  const currentEmail: string | null =
    (session?.email as string) ?? (session?.user?.email as string) ?? null;

  if (!currentEmail) {
    // generic to avoid enumeration
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  // 2) Parse input
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_request" },
      { status: 400 }
    );
  }
  const targetEmail = String(body?.email || "")
    .trim()
    .toLowerCase();

  // Minimal email sanity
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    return NextResponse.json(
      { ok: false, error: "invalid_email" },
      { status: 400 }
    );
  }

  // 3) Platform policy: domain separation
  const dCurrent = emailDomain(currentEmail);
  const dTarget = emailDomain(targetEmail);
  if (dCurrent && dTarget && dCurrent === dTarget) {
    return NextResponse.json(
      { ok: false, error: "use_personal_email" },
      { status: 400 }
    );
  }

  // 4) Throttle (IP + email)
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "0.0.0.0";
  if (!recordAndCheck(ip, targetEmail)) {
    // Generic message; do not leak enumeration signals
    return NextResponse.json(
      { ok: false, error: "try_later" },
      { status: 429 }
    );
  }

  // 5) Generate code and issue a **signed** short-lived token (no DB writes)
  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
  const now = Date.now();
  const payload = {
    v: 1,
    type: "guest-prepare",
    email: targetEmail,
    codeHash: sha256(code),
    iat: now,
    exp: now + TOKEN_TTL_MS,
    codeExp: now + CODE_TTL_MS,
    jti: crypto.randomUUID(),
  };
  const token = sign(payload);

  // TODO: integrate your mailer; for now we just acknowledge.
  // IMPORTANT: do NOT return the code — that’s sent via email.

  return NextResponse.json({ ok: true, token });
}

// Optional: lightweight checker if you need to verify a token (not required by UI)
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token") || "";
  const parsed = verify(token);
  if (
    !parsed ||
    parsed.type !== "guest-prepare" ||
    Date.now() > (parsed.exp || 0)
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_token" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, email: parsed.email, exp: parsed.exp });
}
