// src/lib/auth.ts
// NextAuth options: staff (User) + guest (GuestProfile) credentials.
// - Staff: lookup by User.email → verify password (bcrypt preferred, legacy plaintext ok for MVP).
// - Guest: fallback by GuestProfile.personalEmail → verify passwordHash (bcrypt preferred).
// - Guests never get org context in the token/session.
// - Dev-only convenience: if NODE_ENV !== "production" and a stored password equals "seeded",
//   then password "seeded" logs in. This mirrors seed data without forcing bcrypt in dev.

import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import prisma from "./prisma";
import { getEffectiveRole } from "./access/permissions";

// Choose an org membership for staff (single-org policy: first/only assignment).
async function pickUserOrgAndSlot(userId: string) {
  const ur = await prisma.userRole.findFirst({
    where: { userId },
    orderBy: { assignedAt: "asc" }, // schema has assignedAt
    select: { orgId: true, slot: true },
  });
  if (!ur) return null;
  return { orgId: ur.orgId, slot: ur.slot };
}

// Dev-only helper: allow "seeded" password when stored value is literally "seeded".
function devSeedOk(input: string, stored: string | null | undefined) {
  return (
    process.env.NODE_ENV !== "production" &&
    input === "seeded" &&
    (stored ?? "") === "seeded"
  );
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

        // 1) STAFF USER
        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            displayName: true,
            hashedPassword: true,
          },
        });

        if (user) {
          const stored = user.hashedPassword || "";
          let ok = false;

          if (devSeedOk(password, stored)) {
            ok = true;
          } else if (/^\$2[aby]\$/.test(stored)) {
            // bcrypt hash
            try {
              ok = await bcrypt.compare(password, stored);
            } catch {
              ok = false;
            }
          } else {
            // legacy/plaintext (MVP)
            ok = stored.length > 0 && password === stored;
          }

          if (!ok) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.displayName || user.email,
          };
        }

        // 2) GUEST PROFILE (fallback)
        const gp = await prisma.guestProfile.findUnique({
          where: { personalEmail: email },
        });
        if (!gp) return null;

        // Read via any to avoid transient Prisma typing mismatch after new column
        const guestId = (gp as any).id as string;
        const guestEmail = (gp as any).personalEmail as string;
        const guestName =
          ((gp as any).displayName as string | null) || guestEmail;
        const storedGuest = ((gp as any).passwordHash as string | null) || "";

        let okGuest = false;

        if (devSeedOk(password, storedGuest)) {
          okGuest = true;
        } else if (/^\$2[aby]\$/.test(storedGuest)) {
          try {
            okGuest = await bcrypt.compare(password, storedGuest);
          } catch {
            okGuest = false;
          }
        } else {
          okGuest =
            typeof storedGuest === "string" &&
            storedGuest.length > 0 &&
            password === storedGuest;
        }

        if (!okGuest) return null;

        return {
          id: `guest:${guestId}`,
          email: guestEmail,
          name: guestName,
          guestProfileId: guestId,
          role: "guest",
        } as any;
      },
    }),
  ],
  pages: {
    // Keep default NextAuth pages for now.
    // signIn: "/auth/signin",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Identity on initial sign-in
        token.sub = (user as any).id;
        token.email = user.email;
        token.name = user.name;

        // Mark guest identity (no org context)
        if ((user as any).guestProfileId) {
          (token as any).guestProfileId = (user as any).guestProfileId;
          (token as any).role = "guest";
          delete (token as any).orgId;
          delete (token as any).roleSlot;
          delete (token as any).roleLabel;
        }
      }

      // Hydrate org context for STAFF ONLY
      if (!(token as any).guestProfileId) {
        if (!(token as any).orgId || !(token as any).roleSlot) {
          const userId = (user as any)?.id || token.sub;
          if (userId) {
            const picked = await pickUserOrgAndSlot(userId);
            if (picked) {
              (token as any).orgId = picked.orgId;
              (token as any).roleSlot = picked.slot;
              try {
                const eff = await getEffectiveRole(picked.orgId, picked.slot);
                (token as any).roleLabel = eff?.label;
              } catch {
                // Non-fatal; UI can fetch label later if needed.
              }
            }
          }
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
        session.user.email = token.email as string | undefined;
        session.user.name = token.name as string | undefined;

        const gpid = (token as any).guestProfileId as string | undefined;
        if (gpid) {
          // Guest UI signal + guarantee no org context on session
          (session as any).guestProfileId = gpid;
          (session.user as any).role = "guest";
          (session.user as any).orgId = undefined;
          (session.user as any).roleSlot = undefined;
          (session.user as any).roleLabel = undefined;
        } else {
          // Staff context
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
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
