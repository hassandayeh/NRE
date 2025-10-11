// src/app/auth/invited/page.tsx
import Link from "next/link";

export const runtime = "nodejs";

/**
 * Invited staff landing
 *
 * Purpose:
 * - Clear explanation for invited users who may not have an invite link.
 * - Works for both first-time and existing users.
 * - CTA continues to NextAuth sign-in using the *work email*.
 *
 * After auth (not in this file):
 * - The app can look up pending invites by email and attach/accept them.
 */

export default function InvitedLandingPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Join your organization
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Sign in with your <strong>work email</strong>. If it’s your first
          time, we’ll create your account automatically. We’ll then find any
          pending invitations for your email so you can join the right
          organization.
        </p>
      </header>

      <section className="rounded-2xl border border-neutral-200 p-5 shadow-sm">
        <h2 className="text-lg font-medium">How it works</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-700">
          <li>
            Use your <strong>work email</strong> (the one your teammate
            invited).
          </li>
          <li>
            We’ll sign you in — or create your account if it’s your first time.
          </li>
          <li>
            If there are invites for your email, you’ll be able to accept them
            right away.
          </li>
          <li>
            If none are found, you can request access from your admin or
            continue as a guest.
          </li>
        </ul>

        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/api/auth/signin?hint=staff"
            className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
          >
            Continue to sign in →
          </Link>

          <Link
            href="/account/prepare-guest"
            className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
          >
            Continue as guest
          </Link>

          <Link
            href="/entry"
            className="inline-flex items-center justify-center rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
          >
            Back
          </Link>
        </div>

        <p className="mt-3 text-xs text-neutral-500">
          Tip: If your company uses SSO, choose your SSO provider on the next
          screen. We’ll connect your invites automatically after sign-in.
        </p>
      </section>
    </main>
  );
}
