// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "./api/auth/[...nextauth]/route";
import { PrismaClient } from "@prisma/client";

/** ---------- Metadata ---------- */
export const metadata: Metadata = {
  title: "NRE",
  description: "Newsroom booking & expert management",
};

/** ---------- Prisma singleton (dev-safe) ---------- */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

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
        <header className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur border-b">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-4">
            <Link href="/modules/booking" className="font-semibold text-lg">
              NRE
            </Link>

            <nav
              role="navigation"
              aria-label="Main"
              className="flex items-center gap-2"
            >
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-sm px-3 py-1.5 rounded-md hover:bg-gray-100"
                >
                  {l.label}
                </Link>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="text-sm text-gray-700 font-medium truncate max-w-[240px] flex-shrink-0"
                  title={display}
                >
                  {display}
                </span>
                <span
                  aria-label={`User role: ${roleLabel}`}
                  className="text-xs leading-5 px-2 py-0.5 rounded-full border text-gray-700"
                >
                  {roleLabel}
                </span>
              </div>

              {/* Link-based sign out keeps this server-only (no client hook required) */}
              <a
                href="/api/auth/signout?callbackUrl=/auth/signin%3Ffrom%3Dsignout"
                className="text-sm rounded-md border px-3 py-1.5 hover:bg-gray-50"
              >
                Sign out
              </a>
            </div>
          </div>
        </header>

        {/* Spacer to offset the fixed header height */}
        <div className="h-14" aria-hidden="true" />

        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
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
