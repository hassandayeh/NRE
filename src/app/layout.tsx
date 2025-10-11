// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";

export const metadata: Metadata = {
  title: "NRE",
  description: "Newsroom booking & expert management",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  // Signed-out: render page content without the app shell
  if (!session) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  // ---- Minimal, schema-agnostic identity (no prisma, no legacy imports)
  const user: any = (session as any)?.user ?? {};
  const sessionEmail =
    (user?.email as string) ?? (user?.name as string) ?? "Account";

  // Single-org policy: org id comes only from the authenticated session
  const orgId: string | null =
    (session as any)?.exclusiveOrgId ?? (session as any)?.orgId ?? null;

  // Treat account as "guest" when any of these are present.
  // (If none exist, this evaluates false and staff see everything.)
  const isGuest =
    Boolean(user?.guestProfileId) ||
    user?.role === "guest" ||
    Boolean((session as any)?.guestProfileId);

  // Build Settings href with the viewer's org id — no cross-org fallback
  const settingsHref = orgId
    ? `/modules/settings?orgId=${encodeURIComponent(orgId)}`
    : "/modules/settings";

  const links = [
    { href: "/modules/booking", label: "Bookings" },
    { href: "/modules/directory", label: "Directory" },
    // Settings is staff-only — hidden for guest/expert identities
    ...(isGuest ? [] : [{ href: settingsHref, label: "Settings" }]),
    { href: "/modules/profile", label: "Profile" },
  ];

  return (
    <html lang="en">
      <body>
        {/* Fixed navbar */}
        <header className="fixed inset-x-0 top-0 z-50 border-b bg-white/80 backdrop-blur">
          <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4">
            <div className="flex items-center gap-4">
              <Link href="/" className="font-semibold">
                NRE
              </Link>
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-sm text-neutral-700 hover:underline"
                >
                  {l.label}
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-neutral-600">{sessionEmail}</span>
              <Link
                href="/api/auth/signout"
                className="text-sm text-neutral-700 hover:underline"
              >
                Sign out
              </Link>
            </div>
          </div>
        </header>

        {/* Spacer to offset the fixed header height */}
        <div className="h-12" />

        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

/** Keep Node.js runtime here (Prisma not compatible with Edge) */
export const runtime = "nodejs";
