import type { Metadata } from "next";
import React from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "./api/auth/[...nextauth]/route";
import "./globals.css";

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Client pieces
import HeaderAuthActions from "../components/header-auth-actions";
import AuthProvider from "../components/auth-provider";
import ThemeProvider from "../components/theme-provider"; // user-level theme (light by default)

export const metadata: Metadata = {
  title: "NRE",
  description: "Expert Booker MVP",
};

async function HeaderBar() {
  const session = await getServerSession(authOptions);

  // Preserve your active org name lookup
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
    orgName = null;
  }

  return (
    <header
      role="banner"
      className="border-b bg-white/70 backdrop-blur dark:bg-black/50"
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <nav aria-label="Primary" className="flex items-center gap-4">
          <Link href="/" className="font-semibold">
            NRE
          </Link>
          <Link
            href="/modules/booking"
            className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
          >
            Bookings
          </Link>
          {orgName ? (
            <span
              className="hidden text-sm text-gray-600 dark:text-gray-300 md:inline"
              aria-live="polite"
            >
              — Org: {orgName}
            </span>
          ) : null}
        </nav>

        {/* Auth chip (instant flip) */}
        <AuthProvider>
          <HeaderAuthActions />
        </AuthProvider>
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
    <html lang="en" className="h-full">
      <body className="min-h-screen bg-white text-gray-900 dark:bg-black dark:text-gray-100">
        {/* ThemeProvider controls the "dark" class on <html>; default is LIGHT */}
        <ThemeProvider>
          {await HeaderBar()}
          <main role="main" className="mx-auto max-w-5xl px-4 py-6">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
