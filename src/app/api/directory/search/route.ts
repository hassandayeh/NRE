import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import prisma from "../../../../lib/prisma";
import { Prisma as PrismaNS } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------- Types (match Directory V2 UI) ----------
type SearchItem = {
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

type Ok = { ok: true; items: SearchItem[]; nextCursor?: string | null };
type Err = { ok: false; message: string };

function json(status: number, body: Ok | Err) {
  return NextResponse.json(body, { status });
}

/* ------------------------ Prisma meta helpers ------------------------ */

type DmmfField = { name: string; kind: string; type: string; isList?: boolean };
type DmmfModel = { name: string; fields: DmmfField[] };

function getModels(): DmmfModel[] {
  return ((PrismaNS as any).dmmf?.datamodel?.models ?? []) as DmmfModel[];
}
function getModel(name: string): DmmfModel | undefined {
  return getModels().find((m) => m.name === name);
}
function toDelegateName(modelName: string) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}
function getDelegate(db: any, modelName: string) {
  const camel = toDelegateName(modelName);
  const direct = db?.[camel];
  if (direct && typeof direct.findMany === "function") return direct;
  const key = Object.keys(db || {}).find(
    (k) => k.toLowerCase() === camel.toLowerCase()
  );
  const alt = key ? db[key] : null;
  return alt && typeof alt.findMany === "function" ? alt : null;
}

function findGuestModelName(): string | null {
  const models = getModels();
  const mustHaveAnyOf = [
    ["displayName", "fullName", "name"],
    ["headline", "title"],
    ["topics", "topicTags"],
    ["regions", "regionTags"],
    ["city"],
    ["countryCode", "country"],
  ];
  function score(m: DmmfModel) {
    const f = new Set(m.fields.map((x) => x.name));
    let s = 0;
    for (const group of mustHaveAnyOf) if (group.some((g) => f.has(g))) s++;
    return s;
  }
  const ranked = models
    .map((m) => ({ name: m.name, score: score(m) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return best && best.score > 0 ? best.name : null;
}

function pickField(modelName: string, candidates: string[]): string | null {
  const meta = getModel(modelName);
  if (!meta) return null;
  const names = new Set(meta.fields.map((f) => f.name));
  return candidates.find((c) => names.has(c)) ?? null;
}

function findLanguageRelation(modelName: string): {
  fieldName: string | null;
  targetModel: string | null;
  codeField: string | null;
  levelField: string | null;
} {
  const meta = getModel(modelName);
  if (!meta)
    return {
      fieldName: null,
      targetModel: null,
      codeField: null,
      levelField: null,
    };

  // Likeliest relation field names first
  const relField =
    meta.fields.find(
      (f) =>
        f.kind === "object" &&
        ["languages", "profileLanguages", "spokenLanguages"].includes(f.name)
    ) ??
    meta.fields.find(
      (f) => f.kind === "object" && f.isList && /lang/u.test(f.name)
    );

  if (!relField)
    return {
      fieldName: null,
      targetModel: null,
      codeField: null,
      levelField: null,
    };

  const target = getModel(relField.type);
  if (!target)
    return {
      fieldName: relField.name,
      targetModel: relField.type,
      codeField: null,
      levelField: null,
    };

  const targetFields = new Set(target.fields.map((t) => t.name));
  const codeField =
    ["code", "isoCode", "langCode", "languageCode"].find((n) =>
      targetFields.has(n)
    ) ?? null;
  const levelField =
    ["level", "cefr", "cefrLevel", "proficiency", "fluency"].find((n) =>
      targetFields.has(n)
    ) ?? null;

  return {
    fieldName: relField.name,
    targetModel: relField.type,
    codeField,
    levelField,
  };
}

/* --------------------------------- GET --------------------------------- */

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const role: string =
      ((session as any)?.user?.role as string | undefined) ?? "guest";

    // Parse query
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim() || "";
    const country = sp.get("country")?.trim().toUpperCase() || "";
    const city = sp.get("city")?.trim() || "";
    const scope = sp.get("scope") === "internal" ? "internal" : "global";
    const inviteable = sp.get("inviteable") === "true";
    const topics = sp.getAll("topic").filter(Boolean);
    const regions = sp.getAll("region").filter(Boolean);
    const appearances = sp.getAll("appearance").filter(Boolean);
    const travel = sp.get("travel") || "";
    const languages = sp
      .getAll("lang")
      .map((s) => {
        const [codeRaw, levelRaw] = s.split(":");
        const code = (codeRaw || "").trim().toLowerCase();
        const level = (levelRaw || "").trim().toUpperCase();
        if (!code || !level) return null;
        return { code, level };
      })
      .filter(Boolean) as Array<{ code: string; level: string }>;
    const availableAt = sp.get("availableAt") || "";
    const slotMin = Number(sp.get("slotMin") || "0") || null;
    const tz = sp.get("tz") || "";

    const cursor = sp.get("cursor") || null;
    const limit = Math.min(Math.max(Number(sp.get("limit") || 20), 1), 50);
    let take = limit;
    let skip = 0;
    if (cursor) {
      const n = Number(cursor);
      if (!Number.isNaN(n) && n >= 0) skip = n;
    }

    const effectiveScope =
      scope === "internal" && (role === "staff" || role === "admin")
        ? "internal"
        : "global";

    // Discover model + fields
    const modelName = findGuestModelName();
    const delegate = modelName ? getDelegate(prisma as any, modelName) : null;

    if (process.env.NODE_ENV !== "production") {
      console.log("[dirV2] model:", {
        modelName,
        delegateName: modelName ? toDelegateName(modelName) : null,
      });
    }

    if (!delegate) {
      return json(200, { ok: true, items: [], nextCursor: null });
    }

    const fDisplayName = pickField(modelName!, [
      "displayName",
      "fullName",
      "name",
    ]);
    const fFullName = pickField(modelName!, ["fullName"]);
    const fHeadline = pickField(modelName!, ["headline", "title"]);
    const fCity = pickField(modelName!, ["city", "locationCity"]);
    const fCountry = pickField(modelName!, ["countryCode", "country"]);
    const fAvatar = pickField(modelName!, [
      "avatarUrl",
      "photoUrl",
      "profilePhotoUrl",
      "headshotUrl",
    ]);
    const fTopics = pickField(modelName!, ["topics", "topicTags"]);
    const fRegions = pickField(modelName!, ["regions", "regionTags"]);
    const fAppear = pickField(modelName!, [
      "appearanceTypes",
      "formats",
      "appearance",
    ]);
    const fTravel = pickField(modelName!, ["travelReadiness", "travelScope"]);
    const fIsPublic = pickField(modelName!, [
      "isPublic",
      "publicProfile",
      "isPublicProfile",
    ]);
    const fInviteable = pickField(modelName!, [
      "isInviteable",
      "inviteable",
      "inviteAble",
    ]);
    const fUpdatedAt = pickField(modelName!, [
      "updatedAt",
      "modifiedAt",
      "updated_at",
    ]);

    // Language relation introspection
    const langRel = findLanguageRelation(modelName!);
    const hasLangRel = !!langRel.fieldName;

    // WHERE
    const where: any = {};

    if (effectiveScope === "global" && fIsPublic) where[fIsPublic] = true;
    if (inviteable && fInviteable) where[fInviteable] = true;

    if (q) {
      // Build unique bigrams, e.g. "galeth" -> ["ga","al","le","et","th"]
      const cleaned = q.toLowerCase().replace(/\s+/g, " ").trim();
      const grams: string[] = [];
      for (let i = 0; i < cleaned.length - 1; i++) {
        const g = cleaned.slice(i, i + 2);
        if (!/\s/.test(g) && !grams.includes(g)) grams.push(g);
      }
      // limit to first 6 grams to cap query size
      const top = grams.slice(0, 6);

      // Generate ALL 2-gram combinations so we match any two grams on a field
      const pairs: [string, string][] = [];
      for (let i = 0; i < top.length; i++) {
        for (let j = i + 1; j < top.length; j++) {
          pairs.push([top[i], top[j]]);
        }
      }
      // safety cap (max ~10 combos)
      const pairList = pairs.slice(0, 10);

      const fieldOr = (field: string) => {
        const or: any[] = [];
        // direct contains
        or.push({ [field]: { contains: q, mode: "insensitive" as const } });
        // fuzzy: any two bigrams present
        for (const [a, b] of pairList) {
          or.push({
            AND: [
              { [field]: { contains: a, mode: "insensitive" as const } },
              { [field]: { contains: b, mode: "insensitive" as const } },
            ],
          });
        }
        return or;
      };

      const or: any[] = [];
      if (fDisplayName) or.push(...fieldOr(fDisplayName));
      if (fFullName && fFullName !== fDisplayName)
        or.push(...fieldOr(fFullName));
      if (fHeadline) or.push(...fieldOr(fHeadline));

      if (or.length) where.OR = or;
    }

    if (country && fCountry) where[fCountry] = country;
    if (city && fCity) where[fCity] = { contains: city, mode: "insensitive" };

    if (topics.length && fTopics) where[fTopics] = { hasSome: topics };
    if (regions.length && fRegions) where[fRegions] = { hasSome: regions };
    if (appearances.length && fAppear)
      where[fAppear] = { hasSome: appearances };
    if (travel && fTravel) where[fTravel] = travel;

    // Languages: adapt to relation fields
    if (languages.length && hasLangRel) {
      if (langRel.codeField && langRel.levelField) {
        // Both code + level exist
        where[langRel.fieldName!] = {
          some: {
            OR: languages.map((l) => ({
              AND: [
                { [langRel.codeField!]: l.code },
                { [langRel.levelField!]: l.level },
              ],
            })),
          },
        };
      } else if (langRel.codeField) {
        // Only code (e.g., isoCode) — ignore level in filter
        const codes = Array.from(new Set(languages.map((l) => l.code)));
        where[langRel.fieldName!] = {
          some: { [langRel.codeField]: { in: codes } },
        };
      }
    }

    if (availableAt && slotMin && tz) {
      const fHasAvail = pickField(modelName!, [
        "hasAvailability",
        "available",
        "isAvailable",
      ]);
      if (fHasAvail) where[fHasAvail] = true;
    }

    // SELECT
    const select: any = { id: true };
    if (fDisplayName) select[fDisplayName] = true;
    if (fFullName) select[fFullName] = true;
    if (fHeadline) select[fHeadline] = true;
    if (fCity) select[fCity] = true;
    if (fCountry) select[fCountry] = true;
    if (fAvatar) select[fAvatar] = true;
    if (fTopics) select[fTopics] = true;
    if (fRegions) select[fRegions] = true;
    if (hasLangRel) {
      // Select only fields that exist on the related model
      const langSelect: any = {};
      if (langRel.codeField) langSelect[langRel.codeField] = true;
      if (langRel.levelField) langSelect[langRel.levelField] = true;
      select[langRel.fieldName!] = { select: langSelect };
    }

    const orderBy: any[] = [];
    if (fUpdatedAt) orderBy.push({ [fUpdatedAt]: "desc" as const });
    if (fDisplayName) orderBy.push({ [fDisplayName]: "asc" as const });

    if (process.env.NODE_ENV !== "production") {
      console.log("[dirV2] where/select", {
        where,
        select,
        orderBy,
        skip,
        take,
        langRel,
      });
    }

    // Query
    let rows: any[] = [];
    try {
      rows = await delegate.findMany({
        where,
        select,
        orderBy: orderBy.length ? orderBy : undefined,
        take,
        skip,
      });
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[dirV2] findMany error:", e);
      }
      return json(200, { ok: true, items: [], nextCursor: null });
    }

    // Map to SearchItem
    const items: SearchItem[] = rows.map((r: any) => {
      const name =
        (fDisplayName ? r[fDisplayName] : undefined) ||
        (fFullName ? r[fFullName] : undefined) ||
        "Unknown";

      let langs: Array<{ code: string; level: string }> = [];
      if (hasLangRel && Array.isArray(r[langRel.fieldName!])) {
        langs = r[langRel.fieldName!].map((x: any) => ({
          code: String(
            (langRel.codeField ? x[langRel.codeField] : "") ?? ""
          ).toLowerCase(),
          level: String(
            (langRel.levelField ? x[langRel.levelField] : "") ?? ""
          ).toUpperCase(), // may be empty if schema has no level
        }));
      }

      const topicsOut =
        fTopics && Array.isArray(r[fTopics]) ? (r[fTopics] as string[]) : [];
      const regionsOut =
        fRegions && Array.isArray(r[fRegions]) ? (r[fRegions] as string[]) : [];

      return {
        id: String(r.id),
        displayName: name,
        headline: fHeadline ? r[fHeadline] ?? null : null,
        city: fCity ? r[fCity] ?? null : null,
        countryCode: fCountry ? r[fCountry] ?? null : null,
        avatarUrl: fAvatar ? r[fAvatar] ?? null : null,
        languages: langs,
        topics: topicsOut,
        regions: regionsOut,
      };
    });

    const nextCursor = items.length === take ? String(skip + take) : null;
    return json(200, { ok: true, items, nextCursor });
  } catch (err: any) {
    return json(500, {
      ok: false,
      message: err?.message || "Unexpected error",
    });
  }
}
