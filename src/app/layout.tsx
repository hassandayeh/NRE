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

  const signedIn = !!session?.user;
  const nameOrEmail =
    (session as any)?.user?.name || (session as any)?.user?.email || "Account";
  const orgId = (session as any)?.user?.orgId as string | undefined;
  const roleSlot = (session as any)?.user?.roleSlot as number | undefined;
  const roleLabelFromSession = (session as any)?.user?.roleLabel as
    | string
    | undefined;

  // Server-side resolution for the label (no client hooks)
  let roleLabelToShow: string | undefined = roleLabelFromSession;
  if (!roleLabelToShow && orgId && roleSlot) {
    try {
      const eff = await getEffectiveRole(orgId, roleSlot);
      roleLabelToShow = eff?.label || `Role ${roleSlot}`;
    } catch {
      roleLabelToShow = `Role ${roleSlot}`;
    }
  }

  const links = [
    { href: "/modules/booking", label: "Bookings" },
    { href: "/modules/directory", label: "Directory" },
    { href: "/modules/settings", label: "Settings" },
    { href: "/modules/profile", label: "Profile" },
  ];

  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900">
        {/* Fixed navbar — always visible */}
        <header className="fixed inset-x-0 top-0 z-50 border-b bg-white/80 backdrop-blur">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="font-semibold tracking-tight hover:opacity-80"
                aria-label="NRE Home"
              >
                NRE
              </Link>

              <ul className="hidden gap-4 sm:flex">
                {links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="rounded px-2 py-1 text-sm hover:bg-gray-100 focus:outline-none focus:ring"
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
                  <span className="text-sm text-gray-700">
                    {nameOrEmail}
                    {roleSlot ? <> — {roleLabelToShow}</> : null}
                  </span>

                  {/* Simple sign-out link for now */}
                  <a
                    href="/api/auth/signout"
                    className="rounded border px-2 py-1 text-sm hover:bg-gray-50 focus:outline-none focus:ring"
                  >
                    Sign out
                  </a>
                </>
              ) : (
                <>
                  <Link
                    href="/auth/signin"
                    className="rounded border px-2 py-1 text-sm hover:bg-gray-50 focus:outline-none focus:ring"
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </nav>
        </header>

        {/* Spacer to offset the fixed header height */}
        <div className="h-14 sm:h-[3.5rem]" />

        {/* Page content */}
        <main className="mx-auto max-w-6xl px-4 py-4">{children}</main>
      </body>
    </html>
  );
}
