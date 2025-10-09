// src/app/account/prepare-guest/page.tsx

// Server component: we read the feature flag from env here.
export const runtime = "nodejs";

/**
 * Feature flag:
 *  - Add NEXT_PUBLIC_GUEST_PROFILE_ENABLED=1 in your .env to show this page.
 *  - When the flag is falsy, we render a friendly "not available" message.
 *
 * Route-only skeleton:
 *  - No mutations or client handlers; all buttons are disabled.
 *  - Copy matches the spec: "Prepare a personal guest login" (self-serve continuity).
 */

function isEnabled() {
  const v = process.env.NEXT_PUBLIC_GUEST_PROFILE_ENABLED ?? "";
  return ["1", "true", "on", "yes"].includes(v.toLowerCase());
}

export default async function PrepareGuestPage() {
  const enabled = isEnabled();

  if (!enabled) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">
          Prepare a personal guest login
        </h1>
        <p className="mt-3 text-sm text-gray-500">
          This feature isn’t available yet. Ask your admin to enable it or try
          again after rollout (<code>NEXT_PUBLIC_GUEST_PROFILE_ENABLED</code>).
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Prepare a personal guest login
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Set up a personal login so you can keep working as a guest if your
          staff access ends.
          <br />
          <strong className="font-medium">
            No organization messages or files are moved.
          </strong>
        </p>
      </header>

      <section
        aria-labelledby="verify-email"
        className="rounded-2xl border bg-white/60 p-6 shadow-sm"
      >
        <h2 id="verify-email" className="text-lg font-medium">
          1) Verify your personal email
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Use a personal address (not a work domain). We’ll send a one-time code
          to confirm.
        </p>

        {/* No client handlers in a Server Component */}
        <form className="mt-4 space-y-3" action="#">
          <label className="block">
            <span className="text-sm">Personal email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder="you@gmail.com"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
            />
          </label>

          <div className="flex gap-3">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex items-center rounded-xl border bg-gray-50 px-3 py-2 text-sm text-gray-400"
              title="Disabled in this slice (no business logic yet)"
            >
              Send code
            </button>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Enter 6-digit code"
              className="w-40 rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
              aria-label="Verification code"
            />
          </div>
        </form>
      </section>

      <section
        aria-labelledby="set-password"
        className="mt-6 rounded-2xl border bg-white/60 p-6 shadow-sm"
      >
        <h2 id="set-password" className="text-lg font-medium">
          2) Choose how you’ll sign in
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Password or SSO — your choice. You can change this later from your
          guest account.
        </p>

        {/* No client handlers in a Server Component */}
        <form className="mt-4 space-y-3" action="#">
          <label className="block">
            <span className="text-sm">Password (optional)</span>
            <input
              type="password"
              name="password"
              placeholder="••••••••"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex items-center rounded-xl border bg-gray-50 px-3 py-2 text-sm text-gray-400"
              title="Disabled in this slice"
            >
              Continue with Google
            </button>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex items-center rounded-xl border bg-gray-50 px-3 py-2 text-sm text-gray-400"
              title="Disabled in this slice"
            >
              Continue with Apple
            </button>
          </div>
        </form>
      </section>

      <div className="mt-6 rounded-2xl border bg-white/60 p-5 text-xs text-gray-600">
        <p>
          <strong>Important:</strong> This creates a separate, self-managed
          guest identity tied to your personal email. It does not copy or expose
          any organization content. If your staff access is removed, you’ll be
          offered to continue as a guest using this login.
        </p>
      </div>

      <footer className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="inline-flex items-center rounded-xl border bg-gray-50 px-4 py-2 text-sm text-gray-400"
          title="Disabled in this slice"
        >
          Save &amp; enable
        </button>
      </footer>
    </main>
  );
}
