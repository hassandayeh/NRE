// src/app/api/auth/[...nextauth]/route.ts
import NextAuth, { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Minimal Prisma singleton to avoid hot-reload duplication in dev
const globalForPrisma = global as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  // NOTE: No `pages.signIn` override in App Router.
  // NextAuth will serve its built-in sign-in UI at /api/auth/signin.

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
        const email = ((creds?.email as string) || "").toLowerCase().trim();
        const password = (creds?.password as string) || "";

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
    async jwt({ token, user }: any) {
      if (user) {
        token.userId = (user as any).id;
        token.email = (user as any).email;
        token.activeOrgId = (user as any).activeOrgId ?? null;
      }
      return token;
    },
    async session({ session, token }: any) {
      session.userId = token.userId;
      if (session.user) {
        session.user.email = token.email as string;
      } else {
        session.user = { email: token.email as string };
      }
      session.activeOrgId = token.activeOrgId ?? null;
      return session;
    },
  },

  // Use env; NextAuth requires a secret for JWT signing
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
