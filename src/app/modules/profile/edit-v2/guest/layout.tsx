// src/app/modules/profile/edit-v2/guest/layout.tsx
import * as React from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pass-through layout. (Guard moved to the page/client path.)
 */
export default function GuestEditLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
