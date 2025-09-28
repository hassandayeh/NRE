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
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin",
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
      authorize: async (creds) => {
        const email = String((creds as any)?.email || "")
          .toLowerCase()
          .trim();
        const password = String((creds as any)?.password || "");
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
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
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
        session.user = { email: (token as any).email as string } as any;
      }
      (session as any).activeOrgId = (token as any).activeOrgId ?? null;
      return session;
    },
    async redirect({ url, baseUrl }) {
      let u: URL;
      try {
        u = new URL(url, baseUrl);
      } catch {
        return `${baseUrl}/modules/booking`;
      }

      const isCallback = u.pathname.startsWith("/api/auth/callback");
      const isSignInRoute =
        u.pathname === "/auth/signin" ||
        u.pathname.startsWith("/api/auth/signin");
      const isSignOutApi = u.pathname.startsWith("/api/auth/signout");

      // ✅ After successful sign-in or callback → Bookings
      if (isSignInRoute || isCallback) {
        return `${baseUrl}/modules/booking`;
      }

      // ✅ After sign-out, NextAuth often redirects to baseUrl ("/") by default.
      // Treat base-url root as a sign-out fallback and send to /auth/signin.
      const isBaseRoot =
        u.origin === baseUrl && (u.pathname === "/" || u.pathname === "");
      if (
        isSignOutApi ||
        isBaseRoot ||
        u.searchParams.get("from") === "signout"
      ) {
        return `${baseUrl}/auth/signin`;
      }

      // Same-origin URLs are allowed; block external redirects
      if (u.origin === baseUrl) return u.toString();
      return baseUrl;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === "development",
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
