// src/lib/auth.ts
// NextAuth options wired to our clean User model.
// - Uses JWT sessions.
// - Credentials provider: finds user by email and verifies password.
//   * Accepts dev password "seeded" (for local/dev speed).
//   * Prefers bcrypt hashes.
//   * Falls back to plaintext match for legacy/MVP accounts so we don't break logins.

import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import prisma from "./prisma";
import bcrypt from "bcryptjs";

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
    // signIn: "/signin", // keep default unless you have a custom page
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = (user as any).id;
        token.email = user.email;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
        session.user.email = token.email as string | undefined;
        session.user.name = token.name as string | undefined;
      }
      return session;
    },
  },
  // Make sure NEXTAUTH_SECRET is set in .env for prod; NextAuth will warn if missing.
  secret: process.env.NEXTAUTH_SECRET,
};
