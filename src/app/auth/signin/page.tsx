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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border p-6 shadow-sm">
        <h1 className="text-xl font-semibold mb-2">Sign in</h1>
        <p className="text-sm text-gray-500 mb-6">
          Use your email and password (seed or existing user).
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border px-3 py-2 outline-none focus:ring"
              placeholder="owner@nre.test"
              required
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border px-3 py-2 outline-none focus:ring"
              placeholder="123"
              required
            />
          </div>

          {error && (
            <div className="text-sm text-red-600" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-black text-white py-2 font-medium disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <Link
            href="/api/auth/signin"
            className="text-xs text-gray-500 underline"
            prefetch={false}
          >
            Use NextAuth default sign-in
          </Link>
        </div>
      </div>
    </div>
  );
}
