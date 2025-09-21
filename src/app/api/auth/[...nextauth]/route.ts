// src/app/api/auth/[...nextauth]/route.ts
import NextAuth, { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// ---- Prisma singleton (dev-safe; avoids multiple clients)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export const authOptions: NextAuthOptions = {
  // Use JWT sessions (no DB adapter needed for auth)
  session: { strategy: "jwt" },

  // IMPORTANT: point NextAuth to our custom sign-in page
  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin", // surface ?error=... on the same page
  },

  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: {
          label: "Email",
          type: "email",
          placeholder: "dev@example.com",
        },
        password: { label: "Password", type: "password" },
      },
      authorize: async (creds: Record<string, unknown> | undefined) => {
        const email = String(creds?.email || "")
          .toLowerCase()
          .trim();
        const password = String(creds?.password || "");
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            hashedPassword: true,
            activeOrgId: true,
          },
        });
        if (!user || !user.hashedPassword) return null;

        const ok = await bcrypt.compare(password, user.hashedPassword);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          activeOrgId: user.activeOrgId ?? null,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Persist minimal user data in the JWT
        const u = user as any;
        token.userId = u.id;
        token.email = u.email;
        token.activeOrgId = u.activeOrgId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).userId = (token as any).userId;
      if (session.user) {
        session.user.email = (token as any).email as string;
      } else {
        session.user = { email: (token as any).email as string };
      }
      (session as any).activeOrgId = (token as any).activeOrgId ?? null;
      return session;
    },
  },

  // Required for JWT signing (set in .env)
  secret: process.env.NEXTAUTH_SECRET,

  // Helpful logs during dev
  debug: process.env.NODE_ENV === "development",
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
