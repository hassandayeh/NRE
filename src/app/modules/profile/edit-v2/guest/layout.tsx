// src/app/modules/profile/edit-v2/guest/layout.tsx
import * as React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { redirect } from "next/navigation";

// Keep Node runtime for next-auth / prisma helpers
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Route guard for the Guest Editor.
 * Only signed-in users with a guest identity may access this route.
 * Everyone else (staff, unauth, etc.) gets redirected away.
 */
export default async function GuestEditGuardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const u = (session as any)?.user;
  const role = u?.role || null;
  const guestProfileId = u?.guestProfileId || null;

  // Must be a guest with an associated guestProfileId
  const allowed = !!u && role === "guest" && !!guestProfileId;
  if (!allowed) {
    // Choose your preferred destination; home is safe and simple.
    redirect("/");
  }

  return <>{children}</>;
}
