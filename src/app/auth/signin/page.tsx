"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function SignInPage() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // NextAuth Credentials provider
    const res = await signIn("credentials", {
      redirect: true,
      email,
      password,
      // Keep existing behavior for now (we'll adjust home routing later)
      callbackUrl: "/modules/booking",
    });

    // If redirect is true, NextAuth will navigate away; no need to handle res.
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-sm text-gray-600">
        Use your email and password (seed or existing user).
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            className="w-full rounded-md border px-3 py-2 outline-none focus:ring"
            placeholder="owner@nre.test"
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
            placeholder="123"
            required
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
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* New: self-serve sign-up entry point */}
      <p className="text-sm text-gray-700">
        New here?{" "}
        <Link
          href="/auth/signup"
          className="underline underline-offset-2 hover:opacity-80"
        >
          Create an account
        </Link>
        .
      </p>

      <p className="text-xs text-gray-500">
        Prefer the default page?{" "}
        <a
          href="/api/auth/signin"
          className="underline underline-offset-2 hover:opacity-80"
        >
          Use NextAuth default sign-in
        </a>
        .
      </p>
    </div>
  );
}
