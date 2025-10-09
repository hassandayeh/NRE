// src/app/admin/remove-staff-demo/page.tsx
"use client";

/**
 * Remove Staff — modal copy (demo only)
 *
 * This is an isolated demo route to review the UX/microcopy for removing staff.
 * No network calls. The "Remove staff" action is disabled in this slice.
 *
 * Later slices will wire:
 *  - revoke org access + free seat
 *  - drop thread/file participants
 *  - invalidate presigned links
 *  - mark impacted bookings "Needs replacement"
 *  - audit entries
 */

import { useState } from "react";

function flagGuestEnabled() {
  const v = (process.env.NEXT_PUBLIC_GUEST_PROFILE_ENABLED ?? "").toLowerCase();
  return ["1", "true", "on", "yes"].includes(v);
}

export default function RemoveStaffDemoPage() {
  const [open, setOpen] = useState(false);
  const guestEnabled = flagGuestEnabled();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-gray-500">
          Demo-only list to preview the “Remove staff” modal copy.
        </p>
      </header>

      <div className="rounded-2xl border bg-white/60 p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Alex Expert</div>
            <div className="text-xs text-gray-500">
              alex@acme.com — Role: Producer
            </div>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
          >
            Remove…
          </button>
        </div>
      </div>

      {/* Accessible modal (demo) */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-staff-title"
        >
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* panel */}
          <div className="relative z-10 w-[32rem] max-w-[95vw] rounded-2xl border bg-white p-6 shadow-xl">
            <h2 id="remove-staff-title" className="text-lg font-semibold">
              Remove staff access
            </h2>

            <div className="mt-3 space-y-3 text-sm text-gray-600">
              <p>
                Removing this person will{" "}
                <strong>revoke organization access immediately</strong> and{" "}
                <strong>free the seat</strong>.
              </p>
              <ul className="list-disc pl-5">
                <li>
                  They’re removed from organization threads and file access.
                </li>
                <li>Any presigned file links they used are invalidated.</li>
                <li>
                  Bookings they own or are assigned will show{" "}
                  <strong>“Needs replacement”</strong>.
                </li>
              </ul>
              <p className="text-gray-500">
                <strong>No organization messages or files are moved</strong> to
                personal space.
              </p>

              {guestEnabled ? (
                <p className="text-gray-600">
                  If they still need to collaborate, they can{" "}
                  <a
                    href="/auth/post-removal"
                    className="underline decoration-gray-300 underline-offset-4 hover:decoration-gray-400"
                  >
                    continue as a guest
                  </a>{" "}
                  with a personal email (organization domains are blocked).
                </p>
              ) : (
                <p className="text-amber-700">
                  Guest continuity is staged. Ask an admin to enable{" "}
                  <code>NEXT_PUBLIC_GUEST_PROFILE_ENABLED</code>.
                </p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Disabled in this slice — effects wired in next slice"
                className="rounded-xl border bg-gray-50 px-3 py-2 text-sm text-gray-400"
              >
                Remove staff
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-gray-500">
        Demo only. No changes are made to data in this route.
      </p>
    </main>
  );
}
