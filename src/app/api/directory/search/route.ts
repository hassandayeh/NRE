// src/app/api/directory/search/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Directory Search API
 *
 * v=2 (Directory V2):
 *   - scope=internal|global (default: global)
 *   - inviteable=true|false
 *       * DEFAULT (when param absent) for INTERNAL is **true** → keep only bookable/inviteable people.
 *       * Set inviteable=false to relax this filter (show all internal staff).
 *   - q, country, city, topic=*, region=*, lang=code:CEFR
 *   - availableAt=ISO  slotMin=number  tz=IANA
 *   - take, cursor (for public)
 *   - Returns: { ok: true, items: Array<LeanItem>, nextCursor? }
 *
 * v≠2 fallback:
 *   - Thin proxy that returns downstream JSON **unchanged** (no regression).
 */

type LeanItem = {
  id: string;
  displayName: string;
  headline?: string | null;
  city?: string | null;
  countryCode?: string | null;
  avatarUrl?: string | null;
  languages?: Array<{ code: string; level: string }>;
  topics?: string[];
  regions?: string[];
};

type ApiOk = { ok: true; items: LeanItem[]; nextCursor?: string | null };
type ApiErr = { ok: false; message?: string };

function ok(items: LeanItem[], nextCursor?: string | null) {
  const body: ApiOk = {
    ok: true,
    items,
    ...(nextCursor ? { nextCursor } : {}),
  };
  return NextResponse.json(body, { status: 200 });
}
function err(status: number, message: string) {
  const body: ApiErr = { ok: false, message };
  return NextResponse.json(body, { status });
}
const toBool = (v: unknown) =>
  v === true || v === "true" || v === 1 || v === "1";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const v = (sp.get("v") || "").trim();
  const scope = (sp.get("scope") || "global").toLowerCase();

  // — Internal filter default: true (bookable-only) unless caller explicitly sends inviteable=false
  const inviteableParam = sp.get("inviteable");
  const inviteableOnly =
    inviteableParam == null
      ? scope === "internal"
        ? true
        : false
      : toBool(inviteableParam);

  // Common filters
  const q = (sp.get("q") || "").trim();
  const country = (sp.get("country") || "").trim().toUpperCase();
  const city = (sp.get("city") || "").trim();
  const topics = sp.getAll("topic");
  const regions = sp.getAll("region");
  const langs = sp.getAll("lang"); // "en:B2" pairs

  // Availability window
  const availableAt = sp.get("availableAt");
  const slotMin = Math.max(5, Number(sp.get("slotMin") || "30"));
  const tz = (sp.get("tz") || "").trim();

  // Pagination (public)
  const take = sp.get("take");
  const cursor = sp.get("cursor");

  // Forward auth/session and org context
  const cookie = req.headers.get("cookie") || "";
  const authz = req.headers.get("authorization") || "";
  const orgHeader = req.headers.get("x-org-id") || undefined;

  const baseHeaders: Record<string, string> = {
    ...(cookie ? { cookie } : {}),
    ...(authz ? { authorization: authz } : {}),
    ...(orgHeader ? { "x-org-id": orgHeader } : {}),
  };

  // Helper: convert availableAt/slotMin → start/end/startAt/durationMins (internal)
  const internalWindow = (() => {
    if (!availableAt) return null;
    const start = new Date(availableAt);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + slotMin * 60_000);
    return {
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      durationMins: slotMin,
    };
  })();

  try {
    /* ============================================================
       v2 — New behavior (Directory V2)
       ============================================================ */
    if (v === "2") {
      if (scope === "internal") {
        // Build /api/directory/org query
        const orgQs = new URLSearchParams();
        if (q) orgQs.set("q", q);
        if (internalWindow) {
          orgQs.set("start", internalWindow.startISO);
          orgQs.set("end", internalWindow.endISO);
          // compatibility variants used elsewhere in the app
          orgQs.set("startAt", internalWindow.startISO);
          orgQs.set("durationMins", String(internalWindow.durationMins));
        }

        const orgUrl = new URL(
          `/api/directory/org?${orgQs.toString()}`,
          url
        ).toString();
        const res = await fetch(orgUrl, {
          headers: baseHeaders,
          cache: "no-store",
        });
        const j: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          const m =
            (j && (j.error || j.message)) ||
            `Internal directory failed (${res.status})`;
          return err(res.status, m);
        }

        const rows: any[] = Array.isArray(j.items) ? j.items : [];

        // inviteableOnly → keep only bookable (or inviteable alias). If flags
        // are missing (roles degraded), do NOT hide rows.
        const filtered = inviteableOnly
          ? rows.filter((u) =>
              Object.prototype.hasOwnProperty.call(u ?? {}, "bookable")
                ? u.bookable === true
                : Object.prototype.hasOwnProperty.call(u ?? {}, "inviteable")
                ? u.inviteable === true
                : true
            )
          : rows;

        const items: LeanItem[] = filtered.map((u) => ({
          id: String(u.id ?? u.userId ?? ""),
          displayName:
            (u.displayName as string) ||
            (u.name as string) ||
            (u.email as string) ||
            "Unnamed",
          headline: null,
          city: (u.city as string) ?? null,
          countryCode: (u.countryCode as string) ?? null,
          avatarUrl: (u.avatarUrl as string) ?? null,
          languages: [],
          topics: [],
          regions: [],
        }));

        return ok(items);
      }

      // GLOBAL scope → public experts search
      const pubQs = new URLSearchParams();
      pubQs.set("visibility", "public");
      if (q) pubQs.set("q", q);
      if (country) pubQs.set("country", country);
      if (city) pubQs.set("city", city);
      topics.forEach((t) => pubQs.append("topic", t));
      regions.forEach((r) => pubQs.append("region", r));
      langs.forEach((lp) => pubQs.append("lang", lp));
      if (availableAt) pubQs.set("availableAt", availableAt);
      if (slotMin) pubQs.set("slotMin", String(slotMin));
      if (tz) pubQs.set("tz", tz);
      // Default page size so empty-text searches return something
      pubQs.set("take", take || "20");
      if (cursor) pubQs.set("cursor", cursor);

      // Ensure orgId is provided; /api/experts/search requires it
      let expertsOrgId = (sp.get("orgId") || "").trim();
      if (!expertsOrgId && orgHeader) expertsOrgId = orgHeader.trim();
      if (!expertsOrgId) {
        try {
          const sessRes = await fetch(
            new URL("/api/auth/session", url).toString(),
            {
              headers: cookie ? { cookie } : {},
              cache: "no-store",
            }
          );
          if (sessRes.ok) {
            const sess: any = await sessRes.json().catch(() => null);
            expertsOrgId =
              (sess?.orgId as string) ??
              (sess?.user?.orgId as string) ??
              (sess?.user?.org?.id as string) ??
              "";
          }
        } catch {
          // ignore; handled below
        }
      }
      if (!expertsOrgId) {
        return err(
          401,
          "Unauthorized (missing orgId for global experts search)."
        );
      }
      pubQs.set("orgId", expertsOrgId);

      const pubUrl = new URL(
        `/api/experts/search?${pubQs.toString()}`,
        url
      ).toString();

      // Call with session cookie so /api/experts/search can read the viewer
      const res = await fetch(pubUrl, {
        headers: baseHeaders,
        cache: "no-store",
      });

      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const m =
          (j && (j.error || j.message)) ||
          `Public search failed (${res.status})`;
        return err(res.status, m);
      }

      const itemsRaw: any[] = Array.isArray(j.items) ? j.items : [];
      const items: LeanItem[] = itemsRaw.map((e) => ({
        id: String(e.id),
        displayName: (e.name as string) ?? "Unnamed",
        headline: (e.headline as string) ?? null,
        city: (e.city as string) ?? null,
        countryCode: (e.countryCode as string) ?? null,
        avatarUrl: (e.avatarUrl as string) ?? null,
        languages: Array.isArray(e.languages)
          ? e.languages
              .filter((l: any) => l && typeof l.code === "string" && l.level)
              .map((l: any) => ({
                code: String(l.code),
                level: String(l.level),
              }))
          : [],
        topics: (Array.isArray(e.topics) ? e.topics : []) as string[],
        regions: (Array.isArray(e.regions) ? e.regions : []) as string[],
      }));

      const nextCursor =
        (typeof j.nextCursor === "string" && j.nextCursor) || null;

      return ok(items, nextCursor || undefined);
    }

    /* ============================================================
       v≠2 fallback — return legacy behavior unchanged (no regression)
       ============================================================ */
    if (scope === "internal") {
      const orgQs = new URLSearchParams();
      if (q) orgQs.set("q", q);
      if (internalWindow) {
        orgQs.set("start", internalWindow.startISO);
        orgQs.set("end", internalWindow.endISO);
        orgQs.set("startAt", internalWindow.startISO);
        orgQs.set("durationMins", String(internalWindow.durationMins));
      }
      const orgUrl = new URL(
        `/api/directory/org?${orgQs.toString()}`,
        url
      ).toString();
      const res = await fetch(orgUrl, {
        headers: baseHeaders,
        cache: "no-store",
      });
      const j = await res.json().catch(() => ({}));
      return NextResponse.json(j, { status: res.status });
    } else {
      const pubQs = new URLSearchParams();
      pubQs.set("visibility", "public");
      if (q) pubQs.set("q", q);
      if (country) pubQs.set("country", country);
      if (city) pubQs.set("city", city);
      topics.forEach((t) => pubQs.append("topic", t));
      regions.forEach((r) => pubQs.append("region", r));
      langs.forEach((lp) => pubQs.append("lang", lp));
      if (availableAt) pubQs.set("availableAt", availableAt);
      if (slotMin) pubQs.set("slotMin", String(slotMin));
      if (tz) pubQs.set("tz", tz);
      if (take) pubQs.set("take", take || "");
      if (cursor) pubQs.set("cursor", cursor || "");

      const pubUrl = new URL(
        `/api/experts/search?${pubQs.toString()}`,
        url
      ).toString();
      let res = await fetch(pubUrl, {
        headers: baseHeaders,
        cache: "no-store",
      });
      if (res.status === 401) {
        res = await fetch(pubUrl, { cache: "no-store" });
      }
      const j = await res.json().catch(() => ({}));
      return NextResponse.json(j, { status: res.status });
    }
  } catch (e: any) {
    return err(500, e?.message || "Directory search failed");
  }
}
