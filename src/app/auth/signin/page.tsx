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
      // After success, our authOptions.redirect() sends to /modules/booking
      callbackUrl: "/modules/booking",
    });

    // If redirect is true, NextAuth will navigate away; no need to handle res here
    setLoading(false);
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 text-sm text-gray-600">
        Use your email and password (seed or existing user).
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email */}
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border px-3 py-2 outline-none focus:ring"
            placeholder="owner@nre.test"
            required
          />
        </div>

        {/* Password */}
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border px-3 py-2 outline-none focus:ring"
            placeholder="•••"
            required
          />
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          className="inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={loading || !email || !password}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* Secondary actions */}
      <div className="mt-6 space-y-2 text-sm">
        <div className="text-gray-700">
          New here?{" "}
          <Link
            href="/entry"
            className="font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
          >
            Create account
          </Link>
        </div>

        <div className="text-gray-700">
          No password yet?{" "}
          <Link
            href="/account/prepare-guest"
            className="font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
          >
            Prepare guest login
          </Link>
        </div>

        {/* Keep the original escape hatch */}
        <div>
          <Link
            href="/api/auth/signin"
            className="text-gray-500 underline hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
          >
            Use NextAuth default sign-in
          </Link>
        </div>
      </div>
    </div>
  );
}
