// src/app/api/guest/send-code/route.ts
export const runtime = "nodejs";

/**
 * POST /api/guest/send-code
 *
 * Dev-safe endpoint that:
 * 1) Validates the email.
 * 2) Enforces claimed-domain policy (same as /api/policy/guest-email).
 * 3) Applies a small per-IP rate limit (in-memory).
 * 4) Generates a 6-digit code, stores it in-memory (10 min TTL), and "sends" it (stub).
 *    In non-production, the code is returned in the response for easy testing.
 *
 * Notes:
 * - No feature flags.
 * - The in-memory store is module-global and resets on server restart/redeploy.
 * - Next slice will add /api/guest/verify-code to check the stored code.
 */

type Json = Record<string, unknown>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PER_WINDOW = 5;

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_VERIFY_ATTEMPTS = 6; // will be enforced by /verify-code

// ---- Simple per-client rate limiter (IP + UA), in-memory
const rlBucket = new Map<string, { count: number; resetAt: number }>();

function getClientKey(req: Request) {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim() || "local";
  const ua = req.headers.get("user-agent") || "ua";
  return `${ip}::${ua}`;
}

// ---- Claimed domain parsing
function parseClaimedDomains(): Set<string> {
  const raw = process.env.CLAIMED_ORG_DOMAINS || "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function json(status: number, body: Json, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });
}

// ---- In-memory code store (module-global)
//
// We intentionally keep this here to avoid adding new files in this slice.
// Both send-code and the upcoming verify-code route will read/write this store.
type CodeEntry = {
  code: string;
  exp: number; // epoch ms
  attempts: number; // incremented on /verify-code
};

declare global {
  // eslint-disable-next-line no-var
  var __guestCodeStore: Map<string, CodeEntry> | undefined;
}
function getStore(): Map<string, CodeEntry> {
  if (!globalThis.__guestCodeStore) {
    globalThis.__guestCodeStore = new Map<string, CodeEntry>();
  }
  return globalThis.__guestCodeStore;
}
function pruneExpired(store: Map<string, CodeEntry>) {
  const now = Date.now();
  for (const [email, entry] of store) {
    if (entry.exp <= now) store.delete(email);
  }
}

export async function POST(req: Request) {
  // ---- Rate limit (simple, in-memory; fine for dev/staging)
  const key = getClientKey(req);
  const now = Date.now();
  const rec = rlBucket.get(key);
  if (!rec || now >= rec.resetAt) {
    rlBucket.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    rec.count += 1;
    if (rec.count > MAX_PER_WINDOW) {
      const retryIn = Math.max(0, Math.ceil((rec.resetAt - now) / 1000));
      return json(429, {
        ok: false,
        reason: "rate_limited",
        message: `Too many requests. Try again in ~${retryIn}s.`,
      });
    }
  }

  // ---- Parse & validate
  let email = "";
  try {
    const body = (await req.json()) as { email?: string } | undefined;
    email = (body?.email || "").trim().toLowerCase();
  } catch {
    // fallthrough with empty email -> invalid
  }
  if (!EMAIL_RE.test(email)) {
    return json(400, { ok: false, reason: "invalid_email" });
  }

  // ---- Policy check (claimed org domains cannot proceed as guest)
  const domain = email.split("@")[1] || "";
  const claimed = parseClaimedDomains();
  if (claimed.has(domain)) {
    return json(409, {
      ok: false,
      reason: "org_domain_blocked",
      message:
        `This email domain (${domain}) is managed by an organization here. ` +
        `Use a personal email for guest access, or choose "I was invited" to join as staff.`,
    });
  }

  // ---- Generate a one-time code (6 digits)
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // ---- Store the code (10 min TTL)
  const store = getStore();
  pruneExpired(store);
  store.set(email, {
    code,
    exp: Date.now() + CODE_TTL_MS,
    attempts: 0,
  });

  // TODO: Replace this stub with your email provider (Resend/SES/etc.)
  const isProd = process.env.NODE_ENV === "production";

  return json(200, {
    ok: true,
    message: isProd ? "Code sent." : "Code generated (dev stub).",
    // For dev convenience only:
    ...(isProd
      ? {}
      : { devCode: code, ttlSeconds: Math.floor(CODE_TTL_MS / 1000) }),
  });
}
