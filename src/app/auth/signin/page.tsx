"use client";

import { useState, FormEvent, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function SignInPage() {
  const router = useRouter();
  const params = useSearchParams();

  const callbackUrl = useMemo(() => {
    const raw = params.get("callbackUrl");
    try {
      return raw ? decodeURIComponent(raw) : "/modules/booking";
    } catch {
      return "/modules/booking";
    }
  }, [params]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const err = params.get("error");
    if (err === "CredentialsSignin") setError("Invalid email or password.");
    if (err === "OAuthAccountNotLinked")
      setError("Account not linked to these credentials.");
  }, [params]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (res?.ok) {
        const dest = res.url ?? callbackUrl;
        // Navigate, then force a fresh server render so header reads the new session cookie
        router.replace(dest);
        router.refresh();
        return;
      }

      setError(res?.error || "Invalid email or password.");
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-2 text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 text-gray-600">Use your email and password.</p>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            className="mt-1 w-full rounded-lg border p-2"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            className="mt-1 w-full rounded-lg border p-2"
            placeholder="••••••••"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-xs text-gray-500">
        Trouble signing in? You can reset the password for a user in Prisma
        Studio.
      </p>

      <p className="mt-2 text-xs text-gray-500">
        <Link href="/" className="underline">
          Back to home
        </Link>
      </p>
    </main>
  );
}
