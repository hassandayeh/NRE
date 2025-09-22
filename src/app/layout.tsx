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
import ThemeProvider from "../components/theme-provider";

// user-level theme (light by default)
export const metadata: Metadata = {
  title: "NRE",
  description: "Expert Booker MVP",
};

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
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        {/* Left: Brand + module */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-base font-semibold tracking-tight hover:opacity-80"
          >
            NRE
          </Link>
          <span className="text-gray-400">/</span>
          <Link
            href="/modules/booking"
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            Bookings
          </Link>

          {/* Org label for single-org staff (Owners/Producers).
              Experts typically won't have an org and won't see this chip. */}
          {orgName ? (
            <span className="ml-3 rounded-lg border px-2.5 py-1 text-xs text-gray-700">
              Org: <span className="font-medium">{orgName}</span>
            </span>
          ) : null}
        </div>

        {/* Right: auth actions only (no org switcher) */}
        <div className="flex items-center gap-3">
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
      <ThemeProvider>
        <body className="min-h-screen bg-gray-50 antialiased">
          <AuthProvider>
            {await HeaderBar()}
            <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          </AuthProvider>
        </body>
      </ThemeProvider>
    </html>
  );
}
