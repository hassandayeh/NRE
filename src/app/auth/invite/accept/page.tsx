"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

/** Base64URL decode (payload-only; no signature verification on client) */
function b64urlToJson<T = any>(b64url: string | null): T | null {
  if (!b64url) return null;
  try {
    const b64 =
      b64url.replace(/-/g, "+").replace(/_/g, "/") +
      "===".slice((b64url.length + 3) % 4);
    const json = atob(b64);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

type InvitePayload = {
  typ: "invite";
  orgId: string;
  userId: string;
  email: string;
  iat: number;
  exp: number;
};

export default function InviteAcceptPage() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const payload = useMemo<InvitePayload | null>(() => {
    if (!token || token.split(".").length !== 3) return null;
    const [, p2] = token.split(".");
    return b64urlToJson<InvitePayload>(p2);
  }, [token]);

  const expired = useMemo(() => {
    if (!payload) return false;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp <= now;
  }, [payload]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);

    if (!token || !payload) {
      setError("Invalid invite link.");
      return;
    }
    if (expired) {
      setError("This invite link has expired. Ask your admin for a new one.");
      return;
    }
    if (!password || password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/invite/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token, password }),
      });
      const body = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        setError(body?.error || `Request failed (${res.status})`);
        return;
      }

      setOk("Password set. You can now sign in.");
      // Optional: send them to sign-in after a short pause
      setTimeout(() => router.push("/auth/signin"), 800);
    } catch (err: any) {
      setError(err?.message || "Failed to complete invite.");
    } finally {
      setSubmitting(false);
    }
  }

  // Simple card layout
  return (
    <div className="mx-auto max-w-md p-6">
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold">Accept invitation</h1>
        {!token && (
          <p className="mt-2 text-sm text-red-600">
            Missing token. Please use the link provided in your invitation.
          </p>
        )}

        {token && !payload && (
          <p className="mt-2 text-sm text-red-600">Invalid token format.</p>
        )}

        {payload && (
          <div className="mt-2 text-sm">
            <div className="text-gray-700">
              You&apos;re setting a password for:{" "}
              <strong>{payload.email}</strong>
            </div>
            <div className="text-gray-500">
              Org ID: <code>{payload.orgId}</code>
            </div>
            <div
              className={`mt-1 ${expired ? "text-red-600" : "text-gray-500"}`}
            >
              Expires: {new Date(payload.exp * 1000).toLocaleString()}
              {expired && " (expired)"}
            </div>
          </div>
        )}

        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-gray-600">
              New password
            </span>
            <input
              type="password"
              className="w-full rounded border px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              aria-label="New password"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-gray-600">
              Confirm password
            </span>
            <input
              type="password"
              className="w-full rounded border px-3 py-2 text-sm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              aria-label="Confirm password"
            />
          </label>

          {error && <div className="text-sm text-red-600">{error}</div>}
          {ok && <div className="text-sm text-green-700">{ok}</div>}

          <button
            type="submit"
            disabled={!payload || expired || submitting}
            className="w-full rounded-lg bg-black px-4 py-2 text-sm text-white shadow-sm disabled:opacity-50"
          >
            {submitting ? "Setting password..." : "Set password"}
          </button>
        </form>

        <p className="mt-3 text-xs text-gray-500">
          Having trouble? Ask your admin to regenerate the invite link.
        </p>
      </div>
    </div>
  );
}
