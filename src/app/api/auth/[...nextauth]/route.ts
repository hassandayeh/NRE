/**
 * NextAuth route handler (App Router).
 * Keep this file minimal: only export GET/POST and (optionally) runtime.
 * All configuration (providers, Prisma client, callbacks, etc.) lives in src/lib/auth.ts.
 */
import NextAuth from "next-auth";

// Lightweight dev telemetry (no-op in production)
function devInfo(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
    console.info("[telemetry]", ...args);
  }
}

// From: src/app/api/auth/[...nextauth]/route.ts -> src/lib/auth.ts
import { authOptions } from "../../../../lib/auth";

// Wrap sign-in to add dev logs without touching authOptions source
const _originalSignIn = authOptions.callbacks?.signIn;
authOptions.callbacks = {
  ...(authOptions.callbacks ?? {}),
  async signIn(params) {
    try {
      devInfo("auth:sign_in:request", {
        provider: params?.account?.provider,
        email: params?.user?.email,
      });
      const ok = _originalSignIn ? await _originalSignIn(params) : true;
      devInfo(ok ? "auth:sign_in:allow" : "auth:sign_in:deny", {
        provider: params?.account?.provider,
        email: params?.user?.email,
      });
      return ok;
    } catch (err: any) {
      devInfo("auth:sign_in:error", {
        provider: params?.account?.provider,
        email: params?.user?.email,
        message: err?.message,
      });
      throw err;
    }
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };

// Prisma requires Node runtime (not Edge).
export const runtime = "nodejs";
