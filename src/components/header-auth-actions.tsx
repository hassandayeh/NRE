// src/components/header-auth-actions.tsx
"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";

export default function HeaderAuthActions() {
  const { data: session, status } = useSession();

  // Loading state to avoid flicker while NextAuth hydrates
  if (status === "loading") {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="h-9 w-28 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800"
      />
    );
  }

  // Signed in → show user + Sign out
  if (session?.user) {
    const nameOrEmail = session.user.name ?? session.user.email ?? "Account";
    return (
      <div className="flex items-center gap-3">
        <span
          className="text-sm text-gray-700 dark:text-gray-200"
          aria-live="polite"
        >
          {nameOrEmail}
        </span>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="rounded-full border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-900"
          aria-label="Sign out"
        >
          Sign out
        </button>
      </div>
    );
  }

  // Signed out → offer Sign in
  return (
    <div className="flex items-center gap-3">
      <Link
        href="/auth/signin"
        className="rounded-full border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-900"
        aria-label="Go to sign in"
        onClick={(e) => {
          // if you prefer the NextAuth modal flow instead of page navigation, replace with:
          // e.preventDefault(); signIn(undefined, { callbackUrl: "/modules/booking" });
        }}
      >
        Sign in
      </Link>
    </div>
  );
}
