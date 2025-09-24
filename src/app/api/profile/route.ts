// src/app/api/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import prisma from "../../../lib/prisma";
import { z } from "zod";

// ---- helpers ----
function json(data: unknown, init?: number | ResponseInit) {
  const normalized: ResponseInit | undefined =
    typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, normalized);
}

async function requireUser() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return null;
  const id = (session.user as any)?.id as string | undefined;
  const email = (session.user as any)?.email as string | undefined;

  if (id) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (user) return user;
  }
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) return user;
  }
  return null;
}

function pickProfile(u: any) {
  return {
    id: u?.id ?? null,
    email: u?.email ?? null,
    displayName: u?.displayName ?? null,
    avatarUrl: u?.avatarUrl ?? null,
    bio: u?.bio ?? null,
    languages: Array.isArray(u?.languages) ? u.languages : [],
    timeZone: u?.timeZone ?? null,
  };
}

// ---- validation ----
const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    avatarUrl: z.string().trim().url().max(2000).optional(),
    bio: z.string().trim().max(2000).optional(),
    languages: z.array(z.string().trim().min(1).max(20)).max(20).optional(),
    timeZone: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export async function GET() {
  const user = await requireUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  // No `select` to avoid TS errors if the generated client is outdated.
  const fresh = (await prisma.user.findUnique({
    where: { id: (user as any).id as string },
  })) as any;

  if (!fresh) return json({ error: "User not found" }, 404);
  return json({ profile: pickProfile(fresh) });
}

export async function PUT(req: NextRequest) {
  const user = await requireUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  let payload: unknown = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = profileSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;

  // Normalize languages to unique, lowercase codes
  let languages: string[] | undefined = data.languages;
  if (languages) {
    const uniq = Array.from(
      new Set(languages.map((s) => s.trim().toLowerCase()))
    ).filter(Boolean);
    languages = uniq;
  }

  // Cast to any so the route compiles even if Prisma types are behind schema
  const updateData: any = {
    ...(data.displayName !== undefined && { displayName: data.displayName }),
    ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
    ...(data.bio !== undefined && { bio: data.bio }),
    ...(languages !== undefined && { languages }),
    ...(data.timeZone !== undefined && { timeZone: data.timeZone }),
  };

  const updated = (await prisma.user.update({
    where: { id: (user as any).id as string },
    data: updateData as any,
  })) as any;

  return json({ profile: pickProfile(updated) });
}

// PATCH behaves like PUT
export const PATCH = PUT;
