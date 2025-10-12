// src/lib/auth.ts
// NextAuth options: staff (User) + guest (GuestProfile) credentials.
// Dev telemetry is enabled only when NODE_ENV !== "production".

import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import prisma from "./prisma";
import { getEffectiveRole } from "./access/permissions";

// ---------- Dev-only logger (no secrets/PII beyond email)
const DEV = process.env.NODE_ENV !== "production";
function devLog(label: string, payload: Record<string, unknown>) {
  if (!DEV) return;
  // eslint-disable-next-line no-console
  console.log(`[auth:${label}] ${new Date().toISOString()}`, payload);
}

// ---------- Choose an org membership for staff (single-org policy)
async function pickUserOrgAndSlot(userId: string) {
  const ur = await prisma.userRole.findFirst({
    where: { userId },
    orderBy: { assignedAt: "asc" },
    select: { orgId: true, slot: true },
  });
  if (!ur) return null;
  return { orgId: ur.orgId, slot: ur.slot };
}

// ---------- Dev-only helper: allow "seeded" password when stored value is literally "seeded".
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
            try {
              ok = await bcrypt.compare(password, stored);
            } catch {
              ok = false;
            }
          } else {
            ok = stored.length > 0 && password === stored; // legacy/plaintext (MVP)
          }

          if (!ok) return null;

          const authed = {
            id: user.id,
            email: user.email,
            name: user.displayName || user.email,
          };

          devLog("authorize.success", { email: user.email, kind: "staff" });
          return authed as any;
        }

        // 2) GUEST PROFILE (fallback)
        const gp = await prisma.guestProfile.findUnique({
          where: { personalEmail: email },
        });
        if (!gp) return null;

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

        const authedGuest = {
          id: `guest:${guestId}`,
          email: guestEmail,
          name: guestName,
          guestProfileId: guestId,
          role: "guest",
        };

        devLog("authorize.success", { email: guestEmail, kind: "guest" });
        return authedGuest as any;
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
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

      // Identity flag (derived; no extra DB calls)
      (token as any).identity = (token as any).guestProfileId
        ? "guest"
        : "staff";
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
        session.user.email = token.email as string | undefined;
        session.user.name = token.name as string | undefined;

        const gpid = (token as any).guestProfileId as string | undefined;
        if (gpid) {
          (session as any).guestProfileId = gpid;
          (session.user as any).role = "guest";
          (session.user as any).orgId = undefined;
          (session.user as any).roleSlot = undefined;
          (session.user as any).roleLabel = undefined;
        } else {
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

      // Dev telemetry (compact)
      devLog("session", {
        email: token.email ?? null,
        orgId: (token as any).orgId ?? null,
        guestProfileId: (token as any).guestProfileId ?? null,
        role: (token as any).role ?? (session as any)?.user?.role ?? null,
      });

      (session.user as any).identity =
        (token as any)?.identity ??
        ((token as any)?.guestProfileId ? "guest" : "staff");
      return session;
    },
  },

  // Event telemetry (dev only) — supported events only
  events: {
    async signIn(message) {
      devLog("signIn", {
        provider: message?.account?.provider ?? "credentials",
        email: message?.user?.email ?? null,
        isNewUser: message?.isNewUser ?? false,
      });
    },
    async signOut() {
      devLog("signOut", {});
    },
  },

  // Required for JWT signing (set in .env)
  secret: process.env.NEXTAUTH_SECRET,

  // Helpful logs during dev
  debug: DEV,
};
