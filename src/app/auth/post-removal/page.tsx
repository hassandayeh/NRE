// src/app/auth/post-removal/page.tsx

// Server component: pure UI, no client handlers.
export const runtime = "nodejs";

/**
 * Post-removal screen (route-only skeleton)
 *
 * Intent:
 *  When a user’s org staff membership has been removed, we show a friendly screen:
 *    “Your staff access ended. Keep working as a guest?”
 *
 * Behavior in this slice:
 *  - No mutations or token logic.
 *  - Two safe links only:
 *      • Continue as guest → kicks user to auth with an intent hint (?entry=guest)
 *      • Sign in again as staff → back to regular sign-in (for cases like re-invite)
 *
 * Notes:
 *  - Later slices will wire: one-use tokens, audit, and the guest creation/attach flow
 *    (with org-domain block enforced by /api/policy/guest-email).
 */

export default async function PostRemovalPage() {
  const enabled =
    (process.env.NEXT_PUBLIC_GUEST_PROFILE_ENABLED ?? "")
      .toLowerCase()
      .match(/^(1|true|on|yes)$/) !== null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Your staff access ended
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Your organization account is no longer active. You can keep working as
          a guest with a personal email.{" "}
          <strong>No organization messages or files carry over.</strong>
        </p>
      </header>

      <section className="rounded-2xl border bg-white/60 p-6 shadow-sm">
        <h2 className="text-lg font-medium">Keep working as a guest?</h2>
        <p className="mt-1 text-xs text-gray-500">
          We’ll help you set up a personal guest login. Organization domains are
          blocked for guests — use a personal address.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {/* Route-only links — no client handlers */}
          <a
            href="/api/auth/signin?entry=guest"
            className="inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
            aria-label="Continue as guest with a personal email"
          >
            Continue as guest
            <span aria-hidden="true" className="ml-1">
              →
            </span>
          </a>

          <a
            href="/api/auth/signin?entry=invited"
            className="inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
            aria-label="Sign in as staff (if you were re-invited)"
          >
            Sign in as staff
          </a>
        </div>

        {!enabled && (
          <p className="mt-3 text-xs text-amber-600">
            Guest setup is staged. Ask your admin to enable{" "}
            <code>NEXT_PUBLIC_GUEST_PROFILE_ENABLED</code> to proceed.
          </p>
        )}
      </section>

      <div className="mt-6 rounded-2xl border bg-white/60 p-5 text-xs text-gray-600">
        <p>
          <strong>Privacy note:</strong> Guest work is separate from your former
          organization. You’ll keep notifications and booking context, but you
          won’t see old organization messages or files.
        </p>
      </div>
    </main>
  );
}
