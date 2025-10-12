"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function SignInPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [email, setEmail] = React.useState<string>("");
  const [password, setPassword] = React.useState<string>("");
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  // If NextAuth sent us back with ?error=..., show a friendly message inline
  React.useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) {
      setError(
        "We couldn’t sign you in. If you’re a guest and haven’t set a password yet, use “Prepare guest login” to set one first."
      );
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Keep user on THIS page when credentials are wrong.
    const res = await signIn("credentials", {
      redirect: false,
      email,
      password,
      callbackUrl: "/modules/booking",
    });

    if (res?.error) {
      setError(
        "We couldn’t sign you in. If you’re a guest and haven’t set a password yet, use “Prepare guest login” to set one first."
      );
      setLoading(false);
      return;
    }

    if (res?.url) {
      router.replace(res.url);
      return;
    }

    setLoading(false);
  }

  return (
    <main className="container mx-auto max-w-2xl px-6 py-16">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Use your email and password (seed or existing user).
        </p>
      </header>

      {/* Friendly inline error (guest hint), minimal styling */}
      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="mb-4 text-sm text-red-600"
        >
          {error}{" "}
          <Link
            href="/account/prepare-guest"
            className="font-medium underline underline-offset-2"
          >
            Prepare guest login
          </Link>
          .
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setEmail(e.currentTarget.value)
            }
            placeholder="owner@nre.test"
            required
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          />
        </div>

        {/* Password */}
        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setPassword(e.currentTarget.value)
            }
            placeholder="•••"
            required
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          />
        </div>

        {/* Submit — full-width purple like your original */}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {/* Secondary actions */}
      <div className="mt-6 space-y-2 text-sm">
        <p>
          New here?{" "}
          <Link href="/auth/signup" className="text-indigo-600 underline">
            Create account
          </Link>
          .
        </p>
        <p>
          No password yet?{" "}
          <Link
            href="/account/prepare-guest"
            className="text-indigo-600 underline"
          >
            Prepare guest login
          </Link>
          .
        </p>
        <p>
          <Link
            href="/api/auth/signin"
            className="underline text-muted-foreground"
          >
            Use NextAuth default sign-in
          </Link>
        </p>
      </div>
    </main>
  );
}
