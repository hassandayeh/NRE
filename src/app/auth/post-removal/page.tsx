// src/app/auth/post-removal/page.tsx

import Link from "next/link";

/**
 * Staff access ended → continuity screen.
 * Always on (no flags). Clear path to continue as a guest.
 *
 * Notes:
 * - This page is intentionally static (server component).
 * - If you later detect context (e.g., reason code), you can tailor the copy.
 */

export const runtime = "nodejs";

export default function PostRemovalPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Your staff access has ended
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Organization data (messages, files, and internal tools) are no longer
          available. You can still keep working independently as a guest using
          your personal email. No organization content is moved or copied.
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 p-5 shadow-sm">
        <h2 className="text-lg font-medium">Continue as a guest</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Create or attach a self-managed guest login tied to your personal
          email.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/account/prepare-guest"
            className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
          >
            Prepare guest login →
          </Link>

          <Link
            href="/api/auth/signin?hint=staff"
            className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
          >
            I still have a staff invite →
          </Link>
        </div>

        <p className="mt-4 text-xs text-neutral-500">
          Guests are self-managed: they can be invited to multiple organizations
          without exposing old-org content.
        </p>
      </section>

      <p className="mt-6 text-xs text-neutral-500">
        If you believe this was a mistake, contact your organization admin.
      </p>
    </main>
  );
}
