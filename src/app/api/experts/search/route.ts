// src/app/api/experts/search/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import prisma from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

type Visibility = "public" | "org" | "both";

function parseCsv(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function parseBoolLoose(v: string | null): boolean | undefined {
  if (!v) return undefined;
  const s = v.toString().trim().toLowerCase();
  if (["true", "yes", "1"].includes(s)) return true;
  if (["false", "no", "0"].includes(s)) return false;
  if (s === "any") return undefined;
  return undefined;
}
function parseVisibility(url: URL): Visibility {
  const v = (
    url.searchParams.get("visibility") ||
    url.searchParams.get("mode") ||
    "public"
  )
    .toString()
    .trim()
    .toLowerCase();
  if (v === "org" || v === "organization") return "org";
  if (v === "both") return "both";
  return "public";
}
function parseTake(url: URL): number {
  const raw =
    url.searchParams.get("take") || url.searchParams.get("limit") || "20";
  const n = Number(raw);
  return Math.max(1, Math.min(50, Number.isFinite(n) ? n : 20));
}
function buildQor(q: string): any | null {
  const t = (q || "").trim();
  if (!t) return null;
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  const upper = t.toUpperCase();
  const variants = Array.from(new Set([t, cap, upper]));
  return {
    OR: [
      { OR: variants.map((v) => ({ name: { contains: v } })) },
      { OR: variants.map((v) => ({ bio: { contains: v } })) },
    ],
  } as any;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // ------- inputs -------
    const q = (url.searchParams.get("q") || "").trim();
    const visibility = parseVisibility(url);

    const languages = parseCsv(url.searchParams.get("languages"));
    const tags = parseCsv(url.searchParams.get("tags"));

    const supportsOnline = parseBoolLoose(
      url.searchParams.get("supportsOnline")
    );
    const supportsInPerson = parseBoolLoose(
      url.searchParams.get("supportsInPerson")
    );

    const city = (url.searchParams.get("city") || "").trim();
    const countryCode = (url.searchParams.get("countryCode") || "").trim();

    const take = parseTake(url);
    const cursor = url.searchParams.get("cursor") || undefined;

    // Slot-aware availability flags
    const startAtParam = url.searchParams.get("startAt");
    const durationMinsParam = url.searchParams.get("durationMins");
    const onlyAvailable =
      parseBoolLoose(url.searchParams.get("onlyAvailable")) === true;

    const startAt =
      startAtParam && !Number.isNaN(Date.parse(startAtParam))
        ? new Date(startAtParam)
        : null;
    const durationMins =
      durationMinsParam && !Number.isNaN(Number(durationMinsParam))
        ? Number(durationMinsParam)
        : null;
    const windowEnd =
      startAt && durationMins != null
        ? new Date(startAt.getTime() + durationMins * 60_000)
        : null;

    // ------- session (optional) -------
    const session = await getServerSession(authOptions).catch(() => null);
    const email = (session?.user as any)?.email as string | undefined;

    // Prefer activeOrgId; else any staff org; else undefined
    let staffOrgId: string | undefined;
    if (email) {
      const me = await prisma.user.findUnique({
        where: { email },
        select: { id: true, activeOrgId: true },
      });
      staffOrgId = me?.activeOrgId ?? undefined;
      if (!staffOrgId && me?.id) {
        const membership = await prisma.organizationMembership.findFirst({
          where: {
            userId: me.id,
            role: { in: ["OWNER", "ADMIN", "PRODUCER", "HOST"] as any },
          },
          select: { orgId: true },
        });
        staffOrgId = membership?.orgId ?? undefined;
      }
    }

    // ------- where filters -------
    const AND: any[] = [];

    // Exclude HOST-only users
    AND.push({
      NOT: {
        AND: [
          { memberships: { some: { role: "HOST" } } },
          { memberships: { none: { role: "EXPERT" } } },
        ],
      },
    } as any);

    const qOr = buildQor(q);
    if (qOr) AND.push(qOr);

    if (languages.length > 0)
      AND.push({ languages: { hasSome: languages } } as any);
    if (tags.length > 0) AND.push({ tags: { hasSome: tags } } as any);
    if (typeof supportsOnline === "boolean")
      AND.push({ supportsOnline } as any);
    if (typeof supportsInPerson === "boolean")
      AND.push({ supportsInPerson } as any);
    if (city) AND.push({ city: { contains: city } } as any);
    if (countryCode)
      AND.push({ countryCode: countryCode.toUpperCase() } as any);

    // Visibility using expertVisStatus + memberships
    const publicClause = { expertVisStatus: "PUBLIC" } as any;
    const orgClause = staffOrgId
      ? ({
          OR: [
            {
              memberships: { some: { role: "EXPERT", orgId: staffOrgId } },
            } as any,
            { expertVisStatus: "EXCLUSIVE", exclusiveOrgId: staffOrgId } as any,
          ],
        } as any)
      : ({ id: "__no_org__" } as any); // ensures empty set if no org context

    if (visibility === "public") {
      AND.push(publicClause);
    } else if (visibility === "org") {
      AND.push(orgClause);
    } else {
      // both
      AND.push({ OR: [orgClause, publicClause] } as any);
    }

    // ------- query -------
    const users = await (prisma.user as any).findMany({
      where: { AND } as any,
      orderBy: [{ name: "asc" }, { id: "asc" }] as any,
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        name: true,
        bio: true,
        languages: true,
        tags: true,
        supportsOnline: true,
        supportsInPerson: true,
        city: true,
        countryCode: true,
      } as any,
    });

    // ------- availability (optional) -------
    let busySet = new Set<string>();
    if (startAt && windowEnd && users.length > 0) {
      const ids = users.map((u: any) => u.id);
      const overlapping = await prisma.booking.findMany({
        where: { expertUserId: { in: ids }, startAt: { lt: windowEnd } },
        select: { expertUserId: true, startAt: true, durationMins: true },
      });
      for (const b of overlapping) {
        const s = new Date(b.startAt);
        const e = new Date(s.getTime() + (b.durationMins ?? 0) * 60_000);
        if (e > startAt && s < windowEnd && b.expertUserId)
          busySet.add(b.expertUserId);
      }
    }

    // ------- shape -------
    let items = (users as any[]).map((u) => ({
      id: u.id,
      name: u.name || "Unnamed",
      bio: u.bio ?? null,
      languages: (u.languages as string[] | null) ?? [],
      tags: (u.tags as string[] | null) ?? [],
      supportsOnline: u.supportsOnline ?? null,
      supportsInPerson: u.supportsInPerson ?? null,
      city: u.city ?? null,
      countryCode: u.countryCode ?? null,
      availability:
        startAt && windowEnd
          ? { status: busySet.has(u.id) ? "BUSY" : "AVAILABLE" }
          : { status: "UNKNOWN" },
    }));

    if (onlyAvailable && startAt && windowEnd) {
      items = items.filter((i) => i.availability.status === "AVAILABLE");
    }

    const nextCursor =
      users.length >= take
        ? (users as any[])[users.length - 1]?.id ?? null
        : null;

    return NextResponse.json(
      { items, count: items.length, total: null, nextCursor },
      { status: 200 }
    );
  } catch (err) {
    console.error("GET /api/experts/search error:", err);
    return NextResponse.json(
      {
        items: [],
        count: 0,
        total: null,
        nextCursor: null,
        error: "Failed to search experts.",
      },
      { status: 200 }
    );
  }
}
