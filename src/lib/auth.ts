// src/lib/auth.ts
// NextAuth options wired to our clean User model.
// - Uses JWT sessions.
// - Credentials provider: finds user by email and verifies password.
// * Accepts dev password "seeded" (for local/dev speed).
// * Prefers bcrypt hashes; falls back to plaintext for legacy rows (kept for MVP).

import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import prisma from "./prisma";
import { getEffectiveRole } from "./access/permissions";

// Helper: choose a membership to hydrate org context.
// For now, pick the first UserRole we find (stable and deterministic).
async function pickUserOrgAndSlot(userId: string) {
  const ur = await prisma.userRole.findFirst({
    where: { userId },
    orderBy: { assignedAt: "asc" }, // <-- FIX: UserRole has assignedAt (not createdAt)
    select: { orgId: true, slot: true },
  });
  if (!ur) return null;
  return { orgId: ur.orgId, slot: ur.slot };
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },

  providers: [
    Credentials({
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        const email = (creds?.email || "").toString().trim().toLowerCase();
        const password = (creds?.password || "").toString();
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            displayName: true,
            hashedPassword: true,
          },
        });
        if (!user) return null;

        // DEV-ONLY bypass: matches prisma/seed.js
        if (password === "seeded") {
          return {
            id: user.id,
            email: user.email,
            name: user.displayName || user.email,
          };
        }

        const stored = user.hashedPassword || "";
        let ok = false;

        // If it's a bcrypt hash (starts with $2a/$2b/$2y), use bcrypt.compare
        if (typeof stored === "string" && /^\$2[aby]\$/.test(stored)) {
          try {
            ok = await bcrypt.compare(password, stored);
          } catch {
            ok = false;
          }
        } else {
          // Fallback for MVP/legacy rows saved in plaintext
          ok = typeof stored === "string" && password === stored;
        }

        if (!ok) return null;

        // Minimal user shape for NextAuth
        return {
          id: user.id,
          email: user.email,
          name: user.displayName || user.email,
        };
      },
    }),
  ],

  pages: {
    // Keep NextAuth default pages unless/until we add custom ones.
    // signIn: "/auth/signin",
  },

  callbacks: {
    // Hydrate JWT with identity + org/role context (slot-based RBAC).
    async jwt({ token, user }) {
      if (user) {
        // Set identity on initial sign-in
        token.sub = (user as any).id;
        token.email = user.email;
        token.name = user.name;
      }

      // If org/slot are missing (first login or token just created), hydrate them.
      if (!(token as any).orgId || !(token as any).roleSlot) {
        const userId = (user as any)?.id || token.sub;
        if (userId) {
          const picked = await pickUserOrgAndSlot(userId);
          if (picked) {
            (token as any).orgId = picked.orgId;
            (token as any).roleSlot = picked.slot;

            // Try to resolve label via access layer (optional).
            try {
              const eff = await getEffectiveRole(picked.orgId, picked.slot);
              (token as any).roleLabel = eff?.label;
            } catch {
              // Non-fatal; navbar can fetch /api/org/roles for label later.
            }
          }
        }
      }

      return token;
    },

    // Expose JWT fields on session.user so the UI can read them.
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
        session.user.email = token.email as string | undefined;
        session.user.name = token.name as string | undefined;

        // New fields (slot-based RBAC context)
        (session.user as any).orgId = (token as any).orgId as
          | string
          | undefined;
        (session.user as any).roleSlot = (token as any).roleSlot as
          | number
          | undefined;
        (session.user as any).roleLabel = (token as any).roleLabel as
          | string
          | undefined;
      }
      return session;
    },
  },

  // Make sure NEXTAUTH_SECRET is set in .env for prod; NextAuth will warn if missing.
  secret: process.env.NEXTAUTH_SECRET,
};
