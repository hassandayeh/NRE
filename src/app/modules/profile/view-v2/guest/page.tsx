// src/app/modules/profile/view-v2/guest/page.tsx

import GuestProfileRenderer from "../../../../../components/profile/GuestProfileRenderer";
import GuestProfileMeClient from "../../../../../components/profile/GuestProfileMeClient";
import type { GuestProfileV2DTO } from "../../../../../lib/profile/guestSchema";
import { headers, cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApiOk = { ok: true; profile: GuestProfileV2DTO };
type ApiErr = { ok: false; message?: string };
type ApiRes = ApiOk | ApiErr;

export default async function GuestProfileView() {
  try {
    // Build absolute origin for server-side fetch (works in dev & prod)
    const h = headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto =
      h.get("x-forwarded-proto") ??
      (process.env.NODE_ENV === "production" ? "https" : "http");

    const envOrigin =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

    const origin =
      envOrigin ?? (host ? `${proto}://${host}` : "http://localhost:3000");
    const url = `${origin}/api/profile/guest/me`;

    // Forward cookies so NextAuth sees the session in server fetch
    const cookieHeader = cookies().toString();

    const res = await fetch(url, {
      cache: "no-store",
      headers: { cookie: cookieHeader },
      redirect: "manual",
    });

    // If middleware redirected (3xx) or we didn't get JSON, fall back to client
    const ct = res.headers.get("content-type") || "";
    if (res.status >= 300 || !ct.includes("application/json")) {
      return <GuestProfileMeClient />;
    }

    const dto: ApiRes = await res.json();
    if (!("ok" in dto) || !dto.ok) {
      return <GuestProfileMeClient />;
    }

    return <GuestProfileRenderer profile={dto.profile} canEdit />;
  } catch {
    // Any unexpected condition → graceful client-side fetch
    return <GuestProfileMeClient />;
  }
}
