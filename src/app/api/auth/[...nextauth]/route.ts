/**
 * NextAuth route handler (App Router).
 * Keep this file minimal: only export GET/POST and (optionally) runtime.
 * All configuration (providers, Prisma client, callbacks, etc.) lives in src/lib/auth.ts.
 */
import NextAuth from "next-auth";

// From: src/app/api/auth/[...nextauth]/route.ts -> src/lib/auth.ts
import { authOptions } from "../../../../lib/auth";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };

// Prisma requires Node runtime (not Edge).
export const runtime = "nodejs";
