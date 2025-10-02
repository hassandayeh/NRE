// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth"; // keep your existing auth config (no prisma import)

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

  // Minimal, schema-agnostic identity (no prisma, no legacy fields)
  const sessionEmail =
    (session as any)?.user?.email ?? (session as any)?.user?.name ?? "Account";

  const links = [
    { href: "/modules/booking", label: "Bookings" },
    { href: "/modules/experts", label: "Directory" },
    { href: "/modules/settings", label: "Settings" },
    { href: "/modules/profile", label: "Profile" },
  ];

  return (
    <html lang="en">
      <body>
        {/* Fixed navbar */}
        <header className="fixed top-0 inset-x-0 z-50 border-b bg-white/80 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/" className="font-semibold">
                NRE
              </Link>
              <nav className="hidden md:flex items-center gap-4 text-sm text-gray-700">
                {links.map((l) => (
                  <Link key={l.href} href={l.href} className="hover:underline">
                    {l.label}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-gray-600">{sessionEmail}</span>
              {/* Simple sign-out link; your signout handler can upgrade this to a POST if needed */}
              <Link href="/api/auth/signout?callbackUrl=/" prefetch={false}>
                Sign out
              </Link>
            </div>
          </div>
        </header>

        {/* Spacer to offset the fixed header height */}
        <div className="h-14" />

        <main className="min-h-screen">{children}</main>
      </body>
    </html>
  );
}

/** Keep Node.js runtime here (Prisma not compatible with Edge) */
export const runtime = "nodejs";
