// src/components/profile/OrgOverlay.tsx

import * as React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth";

/**
 * Org overlay (stub)
 * Renders only for ORG accounts. Guests see nothing.
 *
 * Props kept minimal for now; we’ll expand when internal notes land.
 */
export default async function OrgOverlay(props: {
  orgId: string;
  guestId: string;
}) {
  const session = await getServerSession(authOptions);
  const role =
    (session as any)?.user?.role ||
    (session as any)?.role ||
    (session as any)?.user?.roles?.[0] ||
    "";

  if (role !== "org") return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="text-sm font-medium text-amber-900">
        Internal notes (coming soon)
      </div>
      <p className="mt-1 text-sm text-amber-800/90">
        Org: <span className="font-mono">{props.orgId || "—"}</span>
        <br />
        Guest: <span className="font-mono">{props.guestId}</span>
      </p>
    </div>
  );
}
