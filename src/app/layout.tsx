// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
// ✅ Use the central auth config + prisma from src/lib/auth
import { authOptions, prisma } from "../lib/auth";

/** ---------- Metadata ---------- */
export const metadata: Metadata = {
  title: "NRE",
  description: "Newsroom booking & expert management",
};

/** ---------- Root Layout (Server) ---------- */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  // Signed-out: show page content (e.g., /auth/signin) with NO app shell
  if (!session) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  // Signed-in: fetch minimal identity (no "role" field on User model)
  let name: string | null = null;
  let displayName: string | null = null;
  let email: string | null = null;
  let exclusiveOrgId: string | null = null;

  try {
    const me = await prisma.user.findUnique({
      where: { id: (session as any).userId as string },
      select: {
        name: true,
        displayName: true,
        email: true,
        exclusiveOrgId: true,
      },
    });

    name = me?.name ?? null;
    displayName = me?.displayName ?? null;
    email = me?.email ?? null;
    exclusiveOrgId = (me?.exclusiveOrgId as string | null) ?? null;
  } catch {
    // Graceful fallback handled below
  }

  // Heuristic for role label: Experts have exclusiveOrgId; staff don't.
  const isExpert = Boolean(exclusiveOrgId);
  const roleLabel = isExpert ? "EXPERT" : "STAFF";

  // Always show *something* for the user: displayName → name → email → session.user.email
  const sessionEmail = (session as any)?.user?.email as string | undefined;
  const display = displayName ?? name ?? email ?? sessionEmail ?? "Account";

  const links = buildLinks({ isExpert });

  return (
    <html lang="en">
      <body>
        {/* Fixed navbar */}
        <header className="fixed inset-x-0 top-0 z-50 bg-white/70 backdrop-blur border-b">
          <nav className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/modules/booking" className="font-semibold">
                NRE
              </Link>
              <ul className="hidden md:flex items-center gap-4">
                {links.map((l) => (
                  <li key={l.href}>
                    <Link className="hover:underline" href={l.href}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-700">{display}</span>
              <span className="rounded bg-gray-100 px-2 py-0.5">
                {roleLabel}
              </span>
              {/* Link-based sign out keeps this server-only (no client hook required) */}
              <Link
                href="/api/auth/signout?from=signout"
                prefetch={false}
                className="text-red-600 hover:underline"
              >
                Sign out
              </Link>
            </div>
          </nav>
        </header>

        {/* Spacer to offset the fixed header height */}
        <div className="h-14" />
        {children}
      </body>
    </html>
  );
}

/** ---------- Helpers (Server) ---------- */
function buildLinks({
  isExpert,
}: {
  isExpert: boolean;
}): Array<{ href: string; label: string }> {
  const items: Array<{ href: string; label: string }> = [
    { href: "/modules/booking", label: "Bookings" },
  ];

  if (!isExpert) {
    items.push({ href: "/modules/experts", label: "Directory" });
    // If/when we wire exact Owner detection, add:
    // items.push({ href: "/modules/org/settings", label: "Org Settings" });
  }

  items.push({ href: "/modules/settings", label: "Settings" });
  items.push({ href: "/modules/profile", label: "Profile" });
  return items;
}

/** Keep Node.js runtime here (Prisma not compatible with Edge) */
export const runtime = "nodejs";
