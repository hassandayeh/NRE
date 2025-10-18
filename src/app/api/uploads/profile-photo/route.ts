// src/app/api/uploads/profile-photo/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";
import sharp from "sharp";
import { put, del as blobDel } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const AVATAR_SIZE = 512; // square 512x512

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

// Versioned key: avatars/<guestId>-<epochMs>.webp
function keyForGuestProfileVersioned(guestProfileId: string, epochMs: number) {
  return `avatars/${guestProfileId}-${epochMs}.webp`;
}

// Extract the blob key from a public URL (public.blob.vercel-storage.com/<key>)
function keyFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // pathname starts with "/"; drop the leading slash
    const key = u.pathname.startsWith("/") ? u.pathname.slice(1) : u.pathname;
    return key || null;
  } catch {
    return null;
  }
}

// Resolve a usable guestProfileId even if the session payload is missing it.
async function resolveGuestProfileId(session: any): Promise<string | null> {
  const user = session?.user;
  if (!user) return null;

  const gpId =
    user.guestProfileId ||
    user.guest_profile_id || // defensive
    null;
  if (gpId && typeof gpId === "string") return gpId;

  const userId = user.id || user.userId || user.uid || null;
  const email =
    typeof user.email === "string" ? user.email.toLowerCase().trim() : null;

  try {
    if (userId) {
      const byUserId = await (prisma as any).guestProfile.findFirst({
        where: { userId },
        select: { id: true },
      });
      if (byUserId?.id) return byUserId.id as string;
    }
  } catch {}

  try {
    if (email) {
      const byEmail = await (prisma as any).guestProfile.findFirst({
        where: { personalEmail: email },
        select: { id: true },
      });
      if (byEmail?.id) return byEmail.id as string;
    }
  } catch {}

  return null;
}

/**
 * POST /api/uploads/profile-photo
 * - Requires session
 * - Accepts multipart/form-data (field: "file" or "headshot")
 * - Validates images only, normalizes to 512x512 WEBP
 * - Writes to a NEW versioned key avatars/<guestId>-<ts>.webp
 * - Deletes the previous key (if any) so we don't pile up
 * - Persists avatarUrl immediately on GuestProfile
 * - Returns { ok: true, url, bust }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const gpId = await resolveGuestProfileId(session);
    if (!gpId) {
      return json(401, { ok: false, message: "Unauthorized" });
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return json(500, { ok: false, message: "Missing BLOB_READ_WRITE_TOKEN" });
    }

    // Parse multipart
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json(400, { ok: false, message: "Expecting multipart/form-data" });
    }

    const picked = form.get("file") || form.get("headshot");
    if (!picked || typeof picked === "string") {
      return json(400, { ok: false, message: "Missing file" });
    }
    const file = picked as File;

    // Server-side "images only" validation (MIME + actual decode by sharp)
    if (!file.type?.startsWith("image/")) {
      return json(400, { ok: false, message: "Only image files are allowed" });
    }
    if (file.size > MAX_BYTES) {
      return json(400, { ok: false, message: "Image too large (max 5 MB)" });
    }

    const inputBuf = Buffer.from(await file.arrayBuffer());

    // Decode and normalize; if decode fails, sharp throws (guards against MIME spoofing)
    const processed = await sharp(inputBuf)
      .resize(AVATAR_SIZE, AVATAR_SIZE, {
        fit: "cover",
        position: "center",
        withoutEnlargement: true,
      })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();

    // Get existing url/key BEFORE writing a new one
    const existing = await prisma.guestProfile.findUnique({
      where: { id: gpId },
      select: { avatarUrl: true },
    });
    const oldKey = keyFromPublicUrl(existing?.avatarUrl || null);

    // Create a fresh versioned object to defeat CDN staleness
    const ts = Date.now();
    const newKey = keyForGuestProfileVersioned(gpId, ts);

    const { url: newUrl } = await put(newKey, processed, {
      access: "public",
      contentType: "image/webp",
      // Reduce cache stickiness for future fetches; some CDNs still cache by path only.
      cacheControlMaxAge: 0 as any, // tolerated by Blob API; ignored if unsupported
      addRandomSuffix: false,
      token,
    });

    // Persist immediately (auto-save)
    await prisma.guestProfile.update({
      where: { id: gpId },
      data: { avatarUrl: newUrl },
    });

    // Best-effort delete of the previous object (keeps storage tidy)
    if (oldKey && oldKey !== newKey) {
      try {
        await blobDel(oldKey, { token });
      } catch (e) {
        console.warn(
          "[avatar cleanup] failed to delete previous key:",
          oldKey,
          e
        );
      }
    }

    // Cache-buster for the client (harmless extra)
    const bust = ts;
    return json(200, { ok: true, url: newUrl, bust });
  } catch (err) {
    console.error("[upload avatar] error:", err);
    return json(500, { ok: false, message: "Upload failed" });
  }
}

/**
 * DELETE /api/uploads/profile-photo
 * - Requires session
 * - Deletes the CURRENT key (parsed from DB url)
 * - Clears avatarUrl on GuestProfile immediately
 * - Returns { ok: true }
 */
export async function DELETE(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const gpId = await resolveGuestProfileId(session);
    if (!gpId) {
      return json(401, { ok: false, message: "Unauthorized" });
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return json(500, { ok: false, message: "Missing BLOB_READ_WRITE_TOKEN" });
    }

    const profile = await prisma.guestProfile.findUnique({
      where: { id: gpId },
      select: { avatarUrl: true },
    });

    const currentKey = keyFromPublicUrl(profile?.avatarUrl || null);

    // Best-effort delete; if missing, we still proceed
    if (currentKey) {
      try {
        await blobDel(currentKey, { token });
      } catch (e) {
        console.warn(
          "[delete avatar] blob delete failed (possibly missing):",
          e
        );
      }
    }

    // Persist removal immediately
    await prisma.guestProfile.update({
      where: { id: gpId },
      data: { avatarUrl: null },
    });

    return json(200, { ok: true });
  } catch (err) {
    console.error("[delete avatar] error:", err);
    return json(500, { ok: false, message: "Delete failed" });
  }
}
