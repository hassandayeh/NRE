// src/app/layout.tsx
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
import ThemeProvider from "../components/theme-provider"; // wraps the app (light by default)

export const metadata: Metadata = {
  title: "NRE",
  description: "Expert Booker MVP",
};

// Server-rendered top bar (SSR-safe)
async function HeaderBar() {
  const session = await getServerSession(authOptions);

  // Server-rendered org name (fast, SSR-safe)
  let orgName: string | null = null;
  try {
    const activeOrgId =
      (session?.user as any)?.organizationId || // single-org staff
      (session?.user as any)?.activeOrgId || // legacy field if present
      (session as any)?.activeOrgId;

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
    <header className="border-b bg-white/70 backdrop-blur dark:bg-gray-950/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 p-4">
        {/* Left: Brand + module */}
        <div className="flex items-center gap-3">
          <Link href="/modules/booking" className="font-semibold">
            NRE <span className="text-gray-500">/</span> Bookings
          </Link>

          {/* Org label for single-org staff (Owners/Producers). Experts typically won't have an org and won't see this chip. */}
          {orgName ? (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 ring-1 ring-inset ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-800">
              Org: {orgName}
            </span>
          ) : null}
        </div>

        {/* Right: Profile (if signed in) + auth actions */}
        <div className="flex items-center gap-3">
          {session?.user ? (
            <Link
              href="/modules/profile"
              className="text-sm text-gray-700 underline underline-offset-2 hover:text-gray-900 dark:text-gray-200 dark:hover:text-white"
              aria-label="Open my profile"
            >
              Profile
            </Link>
          ) : null}

          <HeaderAuthActions />
        </div>
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
      {/* ThemeProvider controls the "dark" class on <html>; default is LIGHT */}
      <body className="min-h-dvh bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        <AuthProvider>
          {/* Keep SSR components OUTSIDE the client provider boundary */}
          {await HeaderBar()}

          {/* Client provider wraps the app so radios/toggles can change theme */}
          <ThemeProvider>
            <main className="mx-auto max-w-6xl p-4">{children}</main>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
