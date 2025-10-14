// src/app/modules/directory/layout.tsx
import * as React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { redirect } from "next/navigation";

/**
 * Guards the Directory module so that "guest" users cannot access it.
 * Guests are users without an active staff role in the current org context.
 * (We infer that from the same orgId/roleSlot flags used in app/layout.tsx.)
 */
export default async function DirectoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const orgId = (session?.user as any)?.orgId ?? null;
  const roleSlot = (session?.user as any)?.roleSlot ?? null;

  const isGuest = !orgId || !roleSlot;
  if (isGuest) {
    // Keep it explicit; include a hint param for telemetry/UX if needed
    redirect("/modules/profile/guest?denied=directory");
  }

  return <>{children}</>;
}
