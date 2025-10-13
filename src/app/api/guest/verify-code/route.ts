// src/app/api/guest/verify-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ok = { ok: true };
type Err = { ok: false; reason?: string; message?: string };

function json(status: number, body: Ok | Err) {
  return NextResponse.json(body, { status });
}

function b64urlToBuf(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  if (pad) s += "=".repeat(pad);
  return Buffer.from(s, "base64");
}

function b64url(input: Buffer | string) {
  const base = Buffer.isBuffer(input)
    ? input.toString("base64")
    : Buffer.from(input).toString("base64");
  return base.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function verifyHs256(token: string, secret: string) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("bad_token_format");

  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const expected = createHmac("sha256", secret).update(data).digest();
  const got = b64urlToBuf(s);

  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new Error("bad_signature");
  }

  const payloadJson = b64urlToBuf(p).toString("utf8");
  const payload = JSON.parse(payloadJson) as {
    email?: string;
    code?: string;
    iat?: number;
    exp?: number;
    v?: number;
  };

  if (!payload || typeof payload !== "object") throw new Error("bad_payload");
  return payload;
}

export async function POST(req: NextRequest) {
  let token = "";
  let code = "";

  try {
    const j = await req.json();
    token = (j?.token ?? "").toString();
    code = (j?.code ?? "").toString().trim();
  } catch {
    return json(400, {
      ok: false,
      reason: "invalid_json",
      message: "Invalid request body.",
    });
  }

  if (!token) {
    return json(400, {
      ok: false,
      reason: "token_required",
      message: "Missing verification token.",
    });
  }
  if (!/^\d{6}$/.test(code)) {
    return json(400, {
      ok: false,
      reason: "invalid_code",
      message: "Code must be 6 digits.",
    });
  }

  const secret = process.env.NEXTAUTH_SECRET || "dev-secret-only";
  let payload: {
    email?: string;
    code?: string;
    iat?: number;
    exp?: number;
    v?: number;
  };

  try {
    payload = verifyHs256(token, secret);
  } catch (e: any) {
    const reason =
      e?.message === "bad_signature"
        ? "invalid_token"
        : e?.message === "bad_token_format"
        ? "invalid_token"
        : "invalid_token";
    return json(400, {
      ok: false,
      reason,
      message: "Invalid or expired code.",
    });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || nowSec >= payload.exp) {
    return json(400, {
      ok: false,
      reason: "expired",
      message: "Invalid or expired code.",
    });
  }

  // Compare codes safely (they are 6-digit strings)
  const a = Buffer.from(payload.code ?? "", "utf8");
  const b = Buffer.from(code, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json(400, {
      ok: false,
      reason: "mismatch",
      message: "Invalid or expired code.",
    });
  }

  // All good
  return json(200, { ok: true });
}
