// src/lib/auth.ts
// NextAuth options wired to our clean User model (no legacy fields).
// - Uses JWT sessions (no Prisma Adapter tables required).
// - Credentials provider: looks up user by email in prisma.user
//   and accepts the dev password "seeded" (from prisma/seed.js) or an exact match to hashedPassword.
//   This keeps local/dev simple while we wire the rest of the MVP.

import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import prisma from "./prisma";

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

        // DEV-ONLY auth: accept "seeded" (matches prisma/seed.js) or exact match in DB.
        const ok =
          password === "seeded" ||
          (typeof user.hashedPassword === "string" &&
            password === user.hashedPassword);

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
    // keep your existing sign-in page if you have one, or default NextAuth page
    // signIn: "/signin",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // on login
        token.sub = (user as any).id;
        token.email = user.email;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      // expose user id/email/name to the app
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
