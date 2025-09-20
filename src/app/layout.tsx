import type { Metadata } from "next";
import React from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "./api/auth/[...nextauth]/route";
import "./globals.css";

// NEW: fetch org name server-side
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const metadata: Metadata = {
  title: "NRE",
  description: "Expert Booker MVP",
};

async function HeaderBar() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  // Resolve active org name (safe & optional)
  let orgName: string | null = null;
  try {
    const activeOrgId =
      (session?.user as any)?.activeOrgId || (session as any)?.activeOrgId;

    if (activeOrgId) {
      const org = await prisma.organization.findUnique({
        where: { id: String(activeOrgId) },
        select: { name: true },
      });
      orgName = org?.name ?? null;
    }
  } catch {
    // Avoid throwing in header; leave orgName null if anything goes wrong
    orgName = null;
  }

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-base font-semibold">
          NRE
        </Link>

        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/modules/booking"
            className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
          >
            Bookings
          </Link>

          {email ? (
            <>
              <span className="hidden sm:inline text-gray-700">
                Signed in as <strong>{email}</strong>
                {orgName ? (
                  <>
                    {" "}
                    — Org: <strong>{orgName}</strong>
                  </>
                ) : null}
              </span>
              <Link
                href="/api/auth/signout"
                className="rounded-lg bg-black px-3 py-1.5 text-white hover:opacity-90"
              >
                Sign out
              </Link>
            </>
          ) : (
            <Link
              href="/api/auth/signin"
              className="rounded-lg bg-black px-3 py-1.5 text-white hover:opacity-90"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-white antialiased">
        {await HeaderBar()}
        <main>{children}</main>
      </body>
    </html>
  );
}
