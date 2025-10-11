// src/app/entry/page.tsx
import Link from "next/link";

export const runtime = "nodejs";

/**
 * Entry screen (route-only split).
 * Routing:
 * - Admin  → /auth/signup?as=admin
 * - Invited staff → /auth/invited
 * - Expert (guest) → /account/prepare-guest
 */

export default function EntryPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          How do you want to start?
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Pick one. You can switch later — org data (staff) and personal data
          (guest) stay separate.
        </p>
      </header>

      <div className="space-y-5">
        {/* Org Admin */}
        <section className="rounded-2xl border border-neutral-200 p-5 shadow-sm">
          <h2 className="text-lg font-medium">I’m an org admin</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Create or manage an organization.
          </p>
          <div className="mt-3">
            <Link
              href="/auth/signup?as=admin"
              className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
            >
              Continue →
            </Link>
          </div>
        </section>

        {/* Invited Staff */}
        <section className="rounded-2xl border border-neutral-200 p-5 shadow-sm">
          <h2 className="text-lg font-medium">
            I was invited (use work email)
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            We’ll sign you in — or create your account if it’s your first time —
            then attach your invites.
          </p>
          <div className="mt-3">
            <Link
              href="/auth/invited"
              className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
            >
              Continue →
            </Link>
          </div>
        </section>

        {/* Expert (Guest) */}
        <section className="rounded-2xl border border-neutral-200 p-5 shadow-sm">
          <h2 className="text-lg font-medium">I’m an expert (guest)</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Work independently with your personal email.
          </p>
          <div className="mt-3">
            <Link
              href="/account/prepare-guest"
              className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
            >
              Continue →
            </Link>
          </div>
        </section>
      </div>

      <p className="mt-4 text-xs text-neutral-500">
        Tip: Guests can be invited across orgs without exposing old-org content.
      </p>
    </main>
  );
}
