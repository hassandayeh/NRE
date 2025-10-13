// src/app/account/prepare-guest/page.tsx
"use client";

import React from "react";
import { signIn } from "next-auth/react";

type PolicyResp =
  | { ok: true; allow: true }
  | { ok: false; allow: false; reason?: string };

type PrepareResp =
  | {
      ok: true;
      token: string; // <-- capture this
      devCode?: string | number;
      retryAfter?: number;
    }
  | { ok: false; reason?: string; message?: string; retryAfter?: number };

type VerifyResp = { ok: boolean };

type CompleteResp =
  | { ok: true; email: string; guestProfileId: string }
  | { ok: false; reason: string; message?: string };

export default function PrepareGuestPage() {
  const [email, setEmail] = React.useState("");
  const [policy, setPolicy] = React.useState<PolicyResp | null>(null);

  const [sending, setSending] = React.useState(false);
  const [devCode, setDevCode] = React.useState<string | null>(null);
  const [tooManyMsg, setTooManyMsg] = React.useState<string | null>(null);
  const [prepareToken, setPrepareToken] = React.useState<string | null>(null); // <-- NEW

  const [code, setCode] = React.useState("");
  const [verified, setVerified] = React.useState(false);
  const [verifyBusy, setVerifyBusy] = React.useState(false);
  const [verifyMsg, setVerifyMsg] = React.useState<string | null>(null);

  const [password, setPassword] = React.useState("");
  const [submitBusy, setSubmitBusy] = React.useState(false);
  const [submitMsg, setSubmitMsg] = React.useState<string | null>(null);

  const normEmail = (email || "").trim().toLowerCase();

  // ----- Helpers -------------------------------------------------------------

  async function fetchPolicy(forEmail: string): Promise<PolicyResp | null> {
    try {
      const r = await fetch(
        `/api/policy/guest-email?email=${encodeURIComponent(forEmail)}`,
        { cache: "no-store" }
      );
      const j = (await r.json()) as PolicyResp;
      setPolicy(j);
      return j;
    } catch {
      // Treat network as "unknown" — do not block UI while typing.
      setPolicy(null);
      return null;
    }
  }

  async function sendCode() {
    setTooManyMsg(null);
    setDevCode(null);
    setSending(true);
    setSubmitMsg(null);
    setPrepareToken(null); // reset previous token on new attempt
    setVerified(false);

    // Gate ONLY when explicitly blocked with use_personal_email
    const p = await fetchPolicy(normEmail);
    if (
      p &&
      (p as any).allow === false &&
      (p as any).reason === "use_personal_email"
    ) {
      setPolicy(p as any); // show banner as a RESULT of clicking Send
      setSending(false);
      return;
    }

    try {
      const r = await fetch("/api/guest/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normEmail }),
      });
      const j = (await r.json()) as PrepareResp;

      if (!r.ok || !("ok" in j) || !j.ok) {
        if (r.status === 400 && (j as any)?.reason === "use_personal_email") {
          setPolicy({
            ok: false,
            allow: false,
            reason: "use_personal_email",
          } as any);
          setTooManyMsg(null);
        } else if (r.status === 429 || (j as any)?.reason === "too_many") {
          const wait = (j as any)?.retryAfter ?? 300;
          setTooManyMsg(`Too many requests. Try again in ~${wait}s.`);
        } else {
          setTooManyMsg(
            (j as any)?.message || "Could not send code. Try again."
          );
        }
      } else {
        // Capture the token for verification
        setPrepareToken(j.token);

        // Surface dev code in dev if provided by the API
        if ("devCode" in j && j.devCode != null) {
          setDevCode(String(j.devCode));
        }
        setTooManyMsg(null);
      }
    } catch {
      setTooManyMsg("Network error. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function verifyCode() {
    setVerifyBusy(true);
    setVerifyMsg(null);
    setSubmitMsg(null); // keep Step-2 area clean
    try {
      const r = await fetch("/api/guest/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: prepareToken, // required
          code: code.trim(),
        }),
      });
      const j = (await r.json().catch(() => ({}))) as any;

      if (r.ok && j?.ok) {
        setVerified(true);
        setVerifyMsg(null);
        return;
      }

      // Map common server reasons to concise messages near the code input
      if (r.status === 400 && j?.reason === "invalid_code") {
        setVerifyMsg("Code must be 6 digits.");
      } else if (
        r.status === 400 &&
        (j?.reason === "expired" || j?.reason === "invalid_token")
      ) {
        setVerifyMsg("Invalid or expired code.");
      } else {
        setVerifyMsg(j?.message || "Invalid or expired code.");
      }
      setVerified(false);
    } catch {
      setVerifyMsg("Network error while verifying code.");
      setVerified(false);
    } finally {
      setVerifyBusy(false);
    }
  }

  // Single action: save password (if provided) and sign the user in.
  async function saveAndSignIn() {
    setSubmitBusy(true);
    setSubmitMsg(null);

    const pass = (password || "").trim();
    const body: Record<string, any> = {};

    // include password if present
    if (pass.length >= 6) body.password = pass;

    // include the prepare token so /api/guest/complete can finalize the flow
    if (prepareToken) body.token = prepareToken;

    // include normalized email for server-side convenience (token already embeds it)
    body.email = normEmail;

    try {
      const r = await fetch("/api/guest/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as CompleteResp;

      if (!r.ok || !j.ok) {
        const msg =
          (j as any)?.message ||
          (j as any)?.reason ||
          "Unexpected error while completing setup.";
        setSubmitMsg(typeof msg === "string" ? msg : "Setup failed.");
        return;
      }

      // Require a password to auto sign in (one-button flow by design).
      await signIn("credentials", {
        email: normEmail,
        password: pass,
        callbackUrl: "/",
      });
    } catch {
      setSubmitMsg("Network error while saving.");
    } finally {
      setSubmitBusy(false);
    }
  }

  // Only do a CLIENT plausibility check while typing — no server call.
  React.useEffect(() => {
    const id = setTimeout(() => {
      const plausible = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail);
      setPolicy(plausible ? ({ ok: true, allow: true } as any) : null);
    }, 250);
    return () => clearTimeout(id);
  }, [normEmail]);

  const plausible = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail);
  const allowed = policy?.ok && (policy as any).allow !== false && plausible;
  const showManaged =
    !!policy &&
    (policy as any).allow === false &&
    (policy as any).reason === "use_personal_email";

  const canSend = allowed && normEmail.length >= 6 && !sending;
  const canVerify =
    Boolean(prepareToken) && code.trim().length === 6 && !verifyBusy; // <-- require token & 6 digits

  const canSaveAndSignIn =
    verified && password.trim().length >= 6 && !submitBusy;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Prepare a personal guest login
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        Set up a self-managed guest identity tied to your personal email so you
        can keep working even if your staff access ends. No organization
        messages or files are moved.
      </p>

      {/* Step 1: email & code */}
      <section className="mt-6 rounded-2xl border border-neutral-200 p-5 shadow-sm">
        <h2 className="text-lg font-medium">1) Verify your personal email</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Use a personal address (not a work domain). We’ll check and send a
          one-time code to confirm.
        </p>

        <div className="mt-4 flex items-stretch gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20"
          />
          <button
            type="button"
            onClick={sendCode}
            disabled={!canSend}
            className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            Send
            <br />
            code
          </button>
        </div>

        {/* Policy / status line */}
        <div className="mt-2 text-xs">
          {allowed ? (
            <span className="rounded bg-green-50 px-2 py-1 text-green-700">
              Allowed as guest ✓
            </span>
          ) : showManaged ? (
            <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">
              This email domain is managed by an organization here. Use a
              personal email for guest access, or choose “I was invited” to join
              as staff.
            </span>
          ) : null}

          {devCode ? (
            <span className="ml-2 rounded bg-emerald-50 px-2 py-1 text-emerald-700">
              Code sent. <strong>Dev code:</strong> {devCode}
            </span>
          ) : null}

          {tooManyMsg ? (
            <span className="ml-2 rounded bg-rose-50 px-2 py-1 text-rose-700">
              {tooManyMsg}
            </span>
          ) : null}
        </div>

        {/* Verify row */}
        <div className="mt-3 flex items-stretch gap-3">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setVerified(false);
              setVerifyMsg(null);
            }}
            placeholder="6-digit code"
            className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20"
            disabled={!email}
          />
          <button
            type="button"
            onClick={verifyCode}
            disabled={!canVerify}
            className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            Verify
          </button>
        </div>

        {verified ? (
          <div className="mt-2 text-xs">
            <span className="rounded bg-green-50 px-2 py-1 text-green-700">
              Verified ✓ Your guest email is confirmed.
            </span>
          </div>
        ) : verifyMsg ? (
          <div className="mt-2 text-xs">
            <span className="rounded bg-rose-50 px-2 py-1 text-rose-700">
              {verifyMsg}
            </span>
          </div>
        ) : null}
      </section>

      {/* Step 2: password + one action */}
      <section className="mt-6 rounded-2xl border border-neutral-200 p-5 shadow-sm">
        <h2 className="text-lg font-medium">2) Choose how you’ll sign in</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Set a password now to sign in immediately as a guest.
        </p>

        <div className="mt-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (6+ characters)"
            className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20"
            disabled={!verified}
          />
        </div>

        {submitMsg ? (
          <p className="mt-3 text-sm text-neutral-700">{submitMsg}</p>
        ) : null}
      </section>

      <div className="mt-4">
        <button
          type="button"
          onClick={saveAndSignIn}
          disabled={!canSaveAndSignIn}
          className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          title="Save and sign in"
        >
          Save &amp; sign in →
        </button>
      </div>

      <p className="mt-6 text-xs text-neutral-500">
        Important: This creates a separate, self-managed guest identity tied to
        your personal email. It does not copy or expose any organization
        content. If your staff access is removed, you’ll be offered to continue
        as a guest using this login.
      </p>
    </main>
  );
}
