// src/app/api/uploads/profile-photo/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import sharp from "sharp";
import { put, del as blobDel } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const AVATAR_SIZE = 512; // square 512x512

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function keyForUser(userId: string) {
  // One file per user (always .webp)
  return `avatars/${userId}.webp`;
}

/**
 * POST /api/uploads/profile-photo
 * - Requires session
 * - Accepts multipart/form-data (field: "file" OR "headshot")
 * - Normalizes to 512x512 WEBP and stores at avatars/<userId>.webp
 * - Overwrites previous file (no accumulation)
 * - Returns { ok: true, url }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session as any)?.user?.id as string | undefined;
    if (!userId) return json(401, { ok: false, message: "Unauthorized" });

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token)
      return json(500, { ok: false, message: "Missing BLOB_READ_WRITE_TOKEN" });

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
    if (!file.type?.startsWith("image/")) {
      return json(400, { ok: false, message: "Only image files are allowed" });
    }
    if (file.size > MAX_BYTES) {
      return json(400, { ok: false, message: "Image too large (max 5 MB)" });
    }

    // Normalize -> 512x512 WEBP (strip metadata)
    const inputBuf = Buffer.from(await file.arrayBuffer());
    const processed = await sharp(inputBuf)
      .resize(AVATAR_SIZE, AVATAR_SIZE, {
        fit: "cover",
        position: "center",
        withoutEnlargement: true,
      })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();

    const key = keyForUser(userId);

    // Overwrite existing blob at the same key (no accumulation)
    const { url } = await put(key, processed, {
      access: "public",
      contentType: "image/webp",
      addRandomSuffix: false,
      allowOverwrite: true, // one-photo-per-user: overwrite same key
      token,
    });

    return json(200, { ok: true, url });
  } catch (err) {
    console.error("[upload avatar] error:", err);
    return json(500, { ok: false, message: "Upload failed" });
  }
}

/**
 * DELETE /api/uploads/profile-photo
 * - Requires session
 * - Deletes avatars/<userId>.webp from Blob
 * - Returns { ok: true }
 */
export async function DELETE(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session as any)?.user?.id as string | undefined;
    if (!userId) return json(401, { ok: false, message: "Unauthorized" });

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token)
      return json(500, { ok: false, message: "Missing BLOB_READ_WRITE_TOKEN" });

    const key = keyForUser(userId);

    await blobDel(key, { token });

    return json(200, { ok: true });
  } catch (err) {
    console.error("[delete avatar] error:", err);
    return json(500, { ok: false, message: "Delete failed" });
  }
}
