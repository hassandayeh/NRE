"use client";

import * as React from "react";
import Link from "next/link";

type ApiResult =
  | { ok: true; redirect?: string }
  | { ok: false; message: string };

export default function SignUpPage() {
  const [displayName, setDisplayName] = React.useState("");
  const [orgName, setOrgName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // API will: create org, seed roles, create user, assign slot #1, sign in
        body: JSON.stringify({ displayName, orgName, email, password }),
        credentials: "include",
      });

      // Handle success (any 2xx) — user should now be signed in
      if (res.ok) {
        let redirect = "/modules/booking"; // keep parity with current sign-in; we can change later
        // Try to read redirect hint if API provides one
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const json = (await res.json()) as ApiResult;
          if (json.ok && json.redirect) redirect = json.redirect;
        }
        window.location.href = redirect;
        return;
      }

      // Error path: try to read a message
      let msg = "Sign-up failed. Please try again.";
      try {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j = (await res.json()) as { message?: string; error?: string };
          msg = j.message || j.error || msg;
        } else {
          const text = await res.text();
          if (text) msg = text;
        }
      } catch {
        /* ignore parse errors */
      }
      setError(msg);
    } catch {
      setError("Network error. Please check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="text-sm text-gray-600">
        This will create a new organization and assign you to{" "}
        <strong>Role 1</strong> (Admin) automatically.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <label className="block text-sm">
          <span className="mb-1 block">Full name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.currentTarget.value)}
            className="w-full rounded-md border px-3 py-2 outline-none focus:ring"
            placeholder="Admin One"
            required
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block">Organization name</span>
          <input
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.currentTarget.value)}
            className="w-full rounded-md border px-3 py-2 outline-none focus:ring"
            placeholder="My Newsroom"
            required
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            className="w-full rounded-md border px-3 py-2 outline-none focus:ring"
            placeholder="admin@demo.test"
            required
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            className="w-full rounded-md border px-3 py-2 outline-none focus:ring"
            placeholder="••••••••"
            required
            minLength={6}
          />
        </label>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-black px-4 py-2 text-white hover:opacity-90 disabled:opacity-60"
          aria-busy={loading}
        >
          {loading ? "Creating your account…" : "Create account"}
        </button>
      </form>

      <p className="text-sm text-gray-700">
        Already have an account?{" "}
        <Link
          href="/auth/signin"
          className="underline underline-offset-2 hover:opacity-80"
        >
          Sign in
        </Link>
        .
      </p>

      <p className="text-xs text-gray-500">
        By continuing, you agree that this is a test environment (MVP). Do not
        use real production data.
      </p>
    </div>
  );
}
