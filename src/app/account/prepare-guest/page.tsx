// src/app/account/prepare-guest/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/**
 * Prepare Guest Login — always on (no feature flag).
 * - Debounced GET /api/policy/guest-email?email=... for allow/deny.
 * - POST /api/guest/send-code to request a one-time code (rate-limited).
 * - POST /api/guest/verify-code to confirm the 6-digit code (sets short-lived cookie).
 * - POST /api/guest/complete to consume the ticket and finish the flow.
 */

type PolicyState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "allowed" }
  | { kind: "invalid" }
  | { kind: "blocked"; message: string }
  | { kind: "error"; message: string };

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; devCode?: string }
  | { kind: "error"; message: string };

type VerifyState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

type CompleteState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok"; email: string }
  | { kind: "error"; message: string };

export default function PrepareGuestPage() {
  const [email, setEmail] = useState("");
  const [policy, setPolicy] = useState<PolicyState>({ kind: "idle" });
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [verify, setVerify] = useState<VerifyState>({ kind: "idle" });
  const [complete, setComplete] = useState<CompleteState>({ kind: "idle" });

  const canCheck = useMemo(() => email.includes("@"), [email]);

  useEffect(() => {
    if (policy.kind !== "allowed") {
      setSend({ kind: "idle" });
      setCode("");
      setVerify({ kind: "idle" });
      setComplete({ kind: "idle" });
    }
  }, [policy.kind, email]);

  useEffect(() => {
    let cancelled = false;
    if (!canCheck) {
      setPolicy(email ? { kind: "invalid" } : { kind: "idle" });
      return;
    }
    setPolicy({ kind: "checking" });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/policy/guest-email?email=${encodeURIComponent(email)}`,
          { method: "GET", headers: { Accept: "application/json" } }
        );
        if (cancelled) return;
        if (res.status === 200) return setPolicy({ kind: "allowed" });
        if (res.status === 400) return setPolicy({ kind: "invalid" });
        if (res.status === 409) {
          const data = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          return setPolicy({
            kind: "blocked",
            message:
              data?.message ??
              "This looks like a work domain. Use a personal email or join as staff.",
          });
        }
        const txt = await res.text().catch(() => "");
        setPolicy({
          kind: "error",
          message: txt || `Unexpected response: ${res.status}`,
        });
      } catch (e: any) {
        if (!cancelled) {
          setPolicy({
            kind: "error",
            message: e?.message ?? "Network error while checking policy",
          });
        }
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [email, canCheck]);

  const sendDisabled = policy.kind !== "allowed" || send.kind === "sending";

  async function handleSend() {
    if (sendDisabled) return;
    setSend({ kind: "sending" });
    setVerify({ kind: "idle" });
    setCode("");
    setComplete({ kind: "idle" });

    try {
      const res = await fetch("/api/guest/send-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        devCode?: string;
      };
      if (res.status === 200 && data?.ok) {
        setSend({ kind: "sent", devCode: data.devCode });
        return;
      }
      if (res.status === 409) {
        setPolicy({
          kind: "blocked",
          message:
            data?.message ??
            "This email domain is managed by an organization here.",
        });
        setSend({ kind: "idle" });
        return;
      }
      if (res.status === 400) {
        setPolicy({ kind: "invalid" });
        setSend({ kind: "idle" });
        return;
      }
      if (res.status === 429) {
        setSend({
          kind: "error",
          message:
            data?.message ??
            "Too many requests. Please wait a moment and try again.",
        });
        return;
      }
      setSend({
        kind: "error",
        message:
          data?.message ??
          `Unexpected response when sending code: ${res.status}`,
      });
    } catch (e: any) {
      setSend({
        kind: "error",
        message: e?.message ?? "Network error while sending code",
      });
    }
  }

  const codeValid = /^\d{6}$/.test(code);
  const verifyDisabled =
    policy.kind !== "allowed" ||
    send.kind !== "sent" ||
    !codeValid ||
    verify.kind === "verifying";

  async function handleVerify() {
    if (verifyDisabled) return;
    setVerify({ kind: "verifying" });
    setComplete({ kind: "idle" });

    try {
      const res = await fetch("/api/guest/verify-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, code }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        attemptsRemaining?: number;
      };
      if (res.status === 200 && data?.ok) {
        setVerify({ kind: "ok" });
        return;
      }
      if (res.status === 401 && data?.reason === "invalid_code") {
        const left =
          typeof data.attemptsRemaining === "number"
            ? ` (${data.attemptsRemaining} attempt${
                data.attemptsRemaining === 1 ? "" : "s"
              } left)`
            : "";
        setVerify({
          kind: "error",
          message: `That code isn’t correct${left}.`,
        });
        return;
      }
      if (res.status === 404) {
        setVerify({
          kind: "error",
          message:
            "No active code found for this email. Please request a new code.",
        });
        return;
      }
      if (res.status === 410) {
        setVerify({
          kind: "error",
          message: "This code expired. Request a new one.",
        });
        return;
      }
      if (res.status === 429) {
        setVerify({
          kind: "error",
          message: "Too many attempts. Please wait and try again.",
        });
        return;
      }
      setVerify({
        kind: "error",
        message: `Unexpected response: ${res.status}`,
      });
    } catch (e: any) {
      setVerify({
        kind: "error",
        message: e?.message ?? "Network error while verifying code",
      });
    }
  }

  const completeDisabled = verify.kind !== "ok" || complete.kind === "saving";

  async function handleComplete() {
    if (completeDisabled) return;
    setComplete({ kind: "saving" });

    try {
      const res = await fetch("/api/guest/complete", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        email?: string;
        reason?: string;
        message?: string;
      };

      if (res.status === 200 && data?.ok && data?.email) {
        setComplete({ kind: "ok", email: data.email });
        return;
      }
      if (res.status === 401 || data?.reason === "no_ticket") {
        setComplete({
          kind: "error",
          message:
            "Verification session not found. Please verify your email again.",
        });
        return;
      }
      if (res.status === 404 || data?.reason === "not_found") {
        setComplete({
          kind: "error",
          message: "This verification has already been used. Send a new code.",
        });
        return;
      }
      if (res.status === 410 || data?.reason === "expired") {
        setComplete({
          kind: "error",
          message:
            "Verification expired. Please request and verify a new code.",
        });
        return;
      }
      // NEW: surface server message on 500 (db_error / prisma_client_out_of_date)
      if (res.status === 500) {
        setComplete({
          kind: "error",
          message: data?.message || "Server error while finishing setup.",
        });
        return;
      }

      setComplete({
        kind: "error",
        message: `Unexpected response: ${res.status}`,
      });
    } catch (e: any) {
      setComplete({
        kind: "error",
        message: e?.message ?? "Network error while completing setup",
      });
    }
  }

  const frozen = complete.kind === "ok";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Prepare a personal guest login
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Set up a self-managed guest identity tied to your personal email so
          you can keep working even if your staff access ends. No organization
          messages or files are moved.
        </p>
      </header>

      {/* Section 1 */}
      <section className="mb-8 rounded-2xl border border-neutral-200 p-5 shadow-sm">
        <h2 className="text-lg font-medium">1) Verify your personal email</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Use a personal address (not a work domain). We’ll check and send a
          one-time code to confirm.
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label htmlFor="personalEmail" className="sr-only">
            Personal email
          </label>
          <input
            id="personalEmail"
            type="email"
            placeholder="you@example.com"
            className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-black/20"
            aria-describedby="personalEmailHelp policyStatus sendStatus verifyStatus completeStatus"
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            autoComplete="email"
            inputMode="email"
            disabled={frozen}
          />
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20 disabled:opacity-60"
            disabled={sendDisabled || frozen}
            onClick={handleSend}
          >
            {send.kind === "sending" ? "Sending…" : "Send code"}
          </button>
        </div>

        <div id="policyStatus" className="mt-2 min-h-5 text-xs">
          {policy.kind === "idle" && (
            <span className="text-neutral-500">Enter your personal email.</span>
          )}
          {policy.kind === "checking" && (
            <span className="text-neutral-500">Checking…</span>
          )}
          {policy.kind === "allowed" && (
            <span className="rounded-md bg-green-50 px-2 py-1 text-green-700">
              Allowed as guest ✔
            </span>
          )}
          {policy.kind === "invalid" && (
            <span className="text-amber-700">
              That doesn’t look like a valid email.
            </span>
          )}
          {policy.kind === "blocked" && (
            <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-700">
              {policy.message}
            </span>
          )}
          {policy.kind === "error" && (
            <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">
              {policy.message}
            </span>
          )}
        </div>

        <div id="sendStatus" className="mt-2 min-h-5 text-xs">
          {send.kind === "sent" && (
            <span className="rounded-md bg-green-50 px-2 py-1 text-green-700">
              Code sent.{" "}
              {send.devCode ? (
                <>
                  Dev code: <strong>{send.devCode}</strong>
                </>
              ) : (
                <>Check your inbox.</>
              )}
            </span>
          )}
          {send.kind === "error" && (
            <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">
              {send.message}
            </span>
          )}
        </div>

        {send.kind === "sent" && (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <label htmlFor="guestCode" className="sr-only">
              Verification code
            </label>
            <input
              id="guestCode"
              type="text"
              placeholder="6-digit code"
              inputMode="numeric"
              pattern="\d*"
              maxLength={6}
              className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-black/20"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              disabled={frozen}
            />
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20 disabled:opacity-60"
              disabled={verifyDisabled || frozen}
              onClick={handleVerify}
            >
              {verify.kind === "verifying" ? "Verifying…" : "Verify"}
            </button>
          </div>
        )}

        <div id="verifyStatus" className="mt-2 min-h-5 text-xs">
          {verify.kind === "ok" && (
            <span className="rounded-md bg-green-50 px-2 py-1 text-green-700">
              Verified ✔ Your guest email is confirmed.
            </span>
          )}
          {verify.kind === "error" && (
            <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">
              {verify.message}
            </span>
          )}
        </div>

        <div id="completeStatus" className="mt-2 min-h-5 text-xs">
          {complete.kind === "ok" && (
            <span className="rounded-md bg-green-50 px-2 py-1 text-green-700">
              Guest setup complete for <strong>{complete.email}</strong>.
            </span>
          )}
          {complete.kind === "error" && (
            <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">
              {complete.message}
            </span>
          )}
        </div>

        <p id="personalEmailHelp" className="mt-2 text-xs text-neutral-500">
          We never move org content into your guest account. This only prepares
          a separate login.
        </p>
      </section>

      {/* Section 2 */}
      <section className="mb-8 rounded-2xl border border-neutral-200 p-5 shadow-sm">
        <h2 className="text-lg font-medium">2) Choose how you’ll sign in</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Password or SSO — your choice. You can change this later from your
          guest account.
        </p>

        <div className="mt-4 grid gap-3">
          <div className="flex flex-col gap-2">
            <label htmlFor="guestPassword" className="text-sm font-medium">
              Password{" "}
              <span className="font-normal text-neutral-500">(optional)</span>
            </label>
            <input
              id="guestPassword"
              type="password"
              placeholder="••••••••"
              className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-black/20"
              disabled={verify.kind !== "ok" || complete.kind === "ok"}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20 disabled:opacity-60"
              disabled={verify.kind !== "ok" || complete.kind === "ok"}
              aria-disabled={verify.kind !== "ok" || complete.kind === "ok"}
            >
              Continue with Google
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20 disabled:opacity-60"
              disabled={verify.kind !== "ok" || complete.kind === "ok"}
              aria-disabled={verify.kind !== "ok" || complete.kind === "ok"}
            >
              Continue with Apple
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            These remain disabled until your email is verified.
          </p>
        </div>
      </section>

      {/* Footer */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20 disabled:opacity-60"
          disabled={
            verify.kind !== "ok" ||
            complete.kind === "saving" ||
            complete.kind === "ok"
          }
          onClick={handleComplete}
        >
          {complete.kind === "saving" ? "Saving…" : "Save & enable"}
        </button>

        {complete.kind === "ok" && (
          <Link
            href="/api/auth/signin?hint=guest"
            className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
          >
            Continue as guest →
          </Link>
        )}
      </div>

      <p className="mt-4 text-xs text-neutral-500">
        Important: This creates a separate, self-managed guest identity tied to
        your personal email. It does not copy or expose any organization
        content. If your staff access is removed, you’ll be offered to continue
        as a guest using this login.
      </p>
    </main>
  );
}
