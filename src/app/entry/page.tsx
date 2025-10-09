// src/app/entry/page.tsx
import Link from "next/link";

/**
 * Entry screen (route-only split).
 * No business logic here — just links to existing flows.
 *
 * Paths chosen to be safe defaults:
 * - Admin → NextAuth sign-in with hint
 * - Invited staff → NextAuth sign-in with hint
 * - Expert (guest) → NextAuth sign-in with hint (guest flow will enforce email policy later)
 *
 * If you already have dedicated pages (e.g. /signup, /invite/accept),
 * feel free to change hrefs to those routes — the UI is self-contained.
 */

export default function EntryPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">
          How do you want to start?
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Choose one. You can switch later — no data moves between org and
          guest.
        </p>
      </header>

      <ul
        role="list"
        className="grid gap-4 md:grid-cols-3"
        aria-label="Entry options"
      >
        {/* Org Admin */}
        <li className="rounded-2xl border bg-white/60 p-5 shadow-sm transition hover:shadow-md focus-within:ring-2 focus-within:ring-black/10">
          <h2 className="text-lg font-medium">I’m an org admin</h2>
          <p className="mt-1 text-xs text-gray-500">
            Create or manage an organization.
          </p>
          <Link
            href="/api/auth/signin?entry=admin"
            className="mt-4 inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
            aria-label="Continue as organization admin"
          >
            Continue
            <span aria-hidden="true" className="ml-1">
              →
            </span>
          </Link>
        </li>

        {/* Invited Staff */}
        <li className="rounded-2xl border bg-white/60 p-5 shadow-sm transition hover:shadow-md focus-within:ring-2 focus-within:ring-black/10">
          <h2 className="text-lg font-medium">I was invited</h2>
          <p className="mt-1 text-xs text-gray-500">
            Join as staff with your work email.
          </p>
          <Link
            href="/api/auth/signin?entry=invited"
            className="mt-4 inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
            aria-label="Continue with an invite"
          >
            Continue
            <span aria-hidden="true" className="ml-1">
              →
            </span>
          </Link>
        </li>

        {/* Expert (Guest) */}
        <li className="rounded-2xl border bg-white/60 p-5 shadow-sm transition hover:shadow-md focus-within:ring-2 focus-within:ring-black/10">
          <h2 className="text-lg font-medium">I’m an expert (guest)</h2>
          <p className="mt-1 text-xs text-gray-500">
            Work independently with your personal email.
          </p>
          <Link
            href="/api/auth/signin?entry=guest"
            className="mt-4 inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
            aria-label="Continue as guest"
          >
            Continue
            <span aria-hidden="true" className="ml-1">
              →
            </span>
          </Link>
        </li>
      </ul>

      <p className="mt-6 text-xs text-gray-500">
        Tip: Guests can be invited across orgs without exposing old-org content.
      </p>
    </main>
  );
}
