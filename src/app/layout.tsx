// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";
import { getEffectiveRole } from "../lib/access/permissions";

export const metadata: Metadata = {
  title: "NRE",
  description: "Newsroom booking & expert management",
};

// Keep Node runtime (Prisma/access helpers need Node, not Edge)
export const runtime = "nodejs";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  const signedIn = !!(session as any)?.user;
  const nameOrEmail =
    (session as any)?.user?.name || (session as any)?.user?.email || "Account";

  const orgId = (session as any)?.user?.orgId as string | undefined;
  const roleSlot = (session as any)?.user?.roleSlot as number | undefined;
  const roleLabelFromSession = (session as any)?.user?.roleLabel as
    | string
    | undefined;

  // Server-side resolution for the role label (no client hooks)
  let roleLabelToShow: string | undefined = roleLabelFromSession;
  if (!roleLabelToShow && orgId && roleSlot) {
    try {
      const eff = await getEffectiveRole(orgId, roleSlot);
      roleLabelToShow = eff?.label || `Role ${roleSlot}`;
    } catch {
      roleLabelToShow = `Role ${roleSlot}`;
    }
  }

  // ✅ Settings link logic:
  // - Staff: include orgId in query
  // - Guest (or any signed-in without org): no orgId in the URL
  const settingsHref = orgId
    ? `/modules/settings?orgId=${encodeURIComponent(orgId)}`
    : `/modules/settings`;

  const links: Array<{ href: string; label: string }> = [
    { href: "/modules/booking", label: "Bookings" },
    { href: "/modules/directory", label: "Directory" },
    // Keep Settings in the main nav; guests are entitled to their personal settings
    { href: settingsHref, label: "Settings" },
    { href: "/modules/profile", label: "Profile" },
  ];

  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        {/* Fixed navbar — always visible */}
        <header className="fixed inset-x-0 top-0 z-50 border-b bg-white/80 backdrop-blur">
          <nav
            aria-label="Top navigation"
            className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8"
          >
            {/* Left side: brand + main links */}
            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="font-semibold tracking-tight hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
              >
                NRE
              </Link>

              <ul className="hidden items-center gap-4 sm:flex">
                {links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="px-2 py-1 text-sm hover:text-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right side: auth area */}
            <div className="flex items-center gap-3">
              {signedIn ? (
                <>
                  <span className="text-sm text-gray-600">
                    {nameOrEmail}
                    {roleSlot ? (
                      <>
                        {" "}
                        — <span className="font-medium">{roleLabelToShow}</span>
                      </>
                    ) : null}
                  </span>
                  {/* Simple sign-out link for now */}
                  <Link
                    href="/api/auth/signout?callbackUrl=/"
                    className="text-sm text-gray-600 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                  >
                    Sign out
                  </Link>
                </>
              ) : (
                <Link
                  href="/auth/signin"
                  className="text-sm text-indigo-600 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                >
                  Sign in
                </Link>
              )}
            </div>
          </nav>
        </header>

        {/* Spacer to offset the fixed header height */}
        <div className="h-14" aria-hidden="true" />

        {/* Page content */}
        <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
      </body>
    </html>
  );
}
