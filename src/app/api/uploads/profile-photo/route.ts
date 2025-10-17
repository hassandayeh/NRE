// src/app/api/uploads/profile-photo/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const AVATAR_SIZE = 512; // square 512x512

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    // Require a signed-in user so we can folderize by userId
    const session = await getServerSession(authOptions);
    const userId = (session as any)?.user?.id;
    if (!userId) return json(401, { ok: false, message: "Unauthorized" });

    const form = await req.formData();
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

    const buf = Buffer.from(await file.arrayBuffer());

    // Normalize: square crop, strip EXIF, encode to webp
    const processed = await sharp(buf, { failOn: "error" })
      .resize(AVATAR_SIZE, AVATAR_SIZE, {
        fit: "cover",
        position: "center",
        withoutEnlargement: true,
      })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();

    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const key = `avatars/${userId}/${yyyy}/${mm}/${randomUUID()}.webp`;

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token)
      return json(500, { ok: false, message: "Missing BLOB_READ_WRITE_TOKEN" });

    const { url } = await put(key, processed, {
      access: "public",
      contentType: "image/webp",
      addRandomSuffix: false,
      token,
    });

    return json(200, { ok: true, url });
  } catch (err) {
    console.error("[upload avatar] error:", err);
    return json(500, { ok: false, message: "Upload failed" });
  }
}
