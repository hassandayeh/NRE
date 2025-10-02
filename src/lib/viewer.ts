// src/lib/viewer.ts
// Minimal viewer helper for API routes & server components.
// Uses NextAuth session only — no Prisma or legacy membership tables.

import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export type Viewer = {
  isSignedIn: boolean;
  userId?: string;
  email?: string;
};

/**
 * Resolve the current viewer from the request context.
 * (App Router route handlers don't need req/res for getServerSession.)
 */
export async function resolveViewerFromRequest(
  _req?: Request
): Promise<Viewer> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return { isSignedIn: false };
  }

  const userId = (session.user as any)?.id as string | undefined;
  const email = session.user.email ?? undefined;

  return {
    isSignedIn: true,
    userId,
    email,
  };
}
