// src/app/modules/profile/view-v2/guest/page.tsx
"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import type { GuestProfileV2DTO } from "../../../../../lib/profile/guestSchema";

type ApiOk = { ok: true; profile: GuestProfileV2DTO };
type ApiErr = { ok: false; message?: string };
type ApiRes = ApiOk | ApiErr;

// --- helpers ---------------------------------------------------------------

function cleanUrl(u?: string | null): string {
  if (!u) return "";
  try {
    const url = new URL(u);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return String(u).split("?")[0];
  }
}

function initials(name?: string): string {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("");
}

/** Format ISO/YYYY/YYY-MM to "MMM YYYY" (fallback to raw) */
function fmtMonthish(s?: string | null): string {
  if (!s) return "";
  // accept YYYY or YYYY-MM or ISO
  let candidate = String(s).trim();
  if (/^\d{4}$/.test(candidate)) candidate = `${candidate}-01-01`;
  else if (/^\d{4}-\d{2}$/.test(candidate)) candidate = `${candidate}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) candidate += "T00:00:00Z";
  const d = new Date(candidate);
  return isNaN(d.getTime())
    ? String(s)
    : d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

function Chip({
  active,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs leading-5 ring-1 ring-inset ${
        active
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "text-gray-400 ring-gray-200"
      }`}
    >
      {children}
    </span>
  );
}

// --- page ------------------------------------------------------------------

export default function GuestProfileView() {
  const [status, setStatus] = React.useState<
    { kind: "loading" } | { kind: "ready" } | { kind: "error"; msg: string }
  >({ kind: "loading" });
  const [p, setP] = React.useState<GuestProfileV2DTO | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile/guest/me", { cache: "no-store" });
        const json: ApiRes = await res.json();
        if (!res.ok || !("ok" in json) || !json.ok) {
          throw new Error(("message" in json && json.message) || "Load failed");
        }
        if (!cancelled) {
          setP(json.profile);
          setStatus({ kind: "ready" });
        }
      } catch (e: any) {
        if (!cancelled)
          setStatus({
            kind: "error",
            msg: e?.message || "Failed to load profile",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // derived
  const headshotUrl = cleanUrl((p as any)?.headshotUrl);
  const [imgOk, setImgOk] = React.useState(true);
  React.useEffect(() => setImgOk(true), [headshotUrl]);

  const headline = (p as any)?.headline || "";
  const shortBio = (p as any)?.shortBio || "";
  const fullBio = (p as any)?.fullBio || "";

  const displayLocation = React.useMemo(() => {
    if (!p) return "";
    const country = (p as any).countryCode || "";
    const city = (p as any).city || "";
    const tz = (p as any).timezone || "";
    const loc = [city, country].filter(Boolean).join(", ");
    return [loc, tz].filter(Boolean).join(" • ");
  }, [p]);

  // render fns (mirror editor data model)
  function renderLanguages(list: GuestProfileV2DTO["languages"] | unknown) {
    const arr = Array.isArray(list) ? (list as any[]) : [];
    if (!arr.length) return <span className="text-gray-500">—</span>;
    return (
      <ul className="mt-1 flex flex-wrap gap-2">
        {arr.map((l, i) => {
          const code = String(
            (l as any)?.isoCode || (l as any)?.code || ""
          ).toUpperCase();
          const level = (l as any)?.level;
          return (
            <li
              key={i}
              className="rounded-full border px-3 py-1 text-xs leading-5 text-gray-700"
            >
              {[code, level].filter(Boolean).join(" ")}
            </li>
          );
        })}
      </ul>
    );
  }

  function renderRegions(regionCodes: string[] | unknown) {
    const arr = Array.isArray(regionCodes) ? (regionCodes as any[]) : [];
    if (!arr.length) return <span className="text-gray-500">—</span>;
    return (
      <ul className="mt-1 flex flex-wrap gap-2">
        {arr.map((r, i) => (
          <li
            key={i}
            className="rounded-full border px-3 py-1 text-xs leading-5 text-gray-700"
          >
            {String(r)}
          </li>
        ))}
      </ul>
    );
  }

  function renderTopics(topicKeys: string[] | unknown) {
    const arr = Array.isArray(topicKeys) ? (topicKeys as any[]) : [];
    if (!arr.length) return <span className="text-gray-500">—</span>;
    return (
      <ul className="mt-1 flex flex-wrap gap-2">
        {arr.map((t, i) => (
          <li
            key={i}
            className="rounded-full border px-3 py-1 text-xs leading-5 text-gray-700"
          >
            {String(t)}
          </li>
        ))}
      </ul>
    );
  }

  function renderAppearanceTypes(
    appearanceTypes: GuestProfileV2DTO["appearanceTypes"] | unknown
  ) {
    const set = new Set(
      Array.isArray(appearanceTypes) ? (appearanceTypes as string[]) : []
    );
    const items: Array<[keyof any, string]> = [
      ["IN_PERSON", "In person"],
      ["ONLINE", "Online"],
      ["PHONE", "Phone"],
    ];
    return (
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map(([key, label]) => (
          <li key={String(key)}>
            <Chip active={set.has(String(key))}>{label}</Chip>
          </li>
        ))}
      </ul>
    );
  }

  function renderExperience(list: GuestProfileV2DTO["experience"] | unknown) {
    const arr = Array.isArray(list) ? (list as any[]) : [];
    if (!arr.length) return <p className="text-sm text-gray-500">—</p>;
    return (
      <ul className="mt-2 space-y-3">
        {arr.map((r, i) => {
          const org = (r as any)?.orgName || "";
          const role = (r as any)?.roleTitle || "";
          const from = fmtMonthish((r as any)?.from);
          const to = (r as any)?.isCurrent
            ? "Present"
            : fmtMonthish((r as any)?.to);
          return (
            <li
              key={i}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="truncate text-sm font-medium text-gray-900">
                {org || "—"}
                {role ? " — " : ""}
                {role}
              </div>
              {(from || to) && (
                <div className="mt-0.5 text-xs text-gray-600">
                  {[from, to].filter(Boolean).join(" – ")}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  function renderEducation(list: GuestProfileV2DTO["education"] | unknown) {
    const arr = Array.isArray(list) ? (list as any[]) : [];
    if (!arr.length) return <p className="text-sm text-gray-500">—</p>;
    return (
      <ul className="mt-2 space-y-3">
        {arr.map((r, i) => {
          const inst = (r as any)?.institution || "";
          const cred = (r as any)?.credential || "";
          const from = fmtMonthish((r as any)?.from);
          const to = fmtMonthish((r as any)?.to);
          return (
            <li
              key={i}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="truncate text-sm font-medium text-gray-900">
                {inst || "—"}
                {cred ? " — " : ""}
                {cred}
              </div>
              {(from || to) && (
                <div className="mt-0.5 text-xs text-gray-600">
                  {[from, to].filter(Boolean).join(" – ")}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  function renderPublications(
    list: GuestProfileV2DTO["publications"] | unknown
  ) {
    const arr = Array.isArray(list) ? (list as any[]) : [];
    if (!arr.length) return <p className="text-sm text-gray-500">—</p>;
    return (
      <ul className="mt-2 space-y-2">
        {arr.map((r, i) => {
          const title = (r as any)?.title || "Untitled";
          const outlet = (r as any)?.outlet || "";
          const year = (r as any)?.year;
          const url = (r as any)?.url || "";
          return (
            <li key={i} className="text-sm text-gray-800">
              <span className="font-medium">{title}</span>
              {outlet ? (
                <span className="text-gray-500"> — {outlet}</span>
              ) : null}
              {year ? <span className="text-gray-500"> • {year}</span> : null}{" "}
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-gray-300 underline-offset-4 hover:decoration-gray-500"
                >
                  Link
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  function renderMedia(list: GuestProfileV2DTO["media"] | unknown) {
    const arr = Array.isArray(list) ? (list as any[]) : [];
    if (!arr.length)
      return <p className="text-sm text-gray-500">No media appearances yet.</p>;
    return (
      <ul className="mt-2 space-y-2">
        {arr.map((r, i) => {
          const title = (r as any)?.title || "Appearance";
          const outlet = (r as any)?.outlet || "";
          const date = fmtMonthish((r as any)?.date);
          const url = (r as any)?.url || "";
          return (
            <li key={i} className="text-sm text-gray-800">
              <span className="font-medium">{title}</span>
              {outlet ? (
                <span className="text-gray-500"> — {outlet}</span>
              ) : null}
              {date ? <span className="text-gray-500"> • {date}</span> : null}{" "}
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-gray-300 underline-offset-4 hover:decoration-gray-500"
                >
                  Link
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  function renderAdditionalEmails(
    list: GuestProfileV2DTO["additionalEmails"] | unknown
  ) {
    const arr = Array.isArray(list) ? (list as any[]) : [];
    if (!arr.length) return <span className="text-gray-500">—</span>;
    return (
      <ul className="space-y-1">
        {arr.map((e, i) => {
          const email = (e as any)?.email || "";
          const visibility = (e as any)?.visibility;
          const verified = (e as any)?.verified;
          return (
            <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-gray-800">{email || "—"}</span>
              {visibility ? (
                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {String(visibility)}
                </span>
              ) : null}
              {typeof verified === "boolean" ? (
                <span
                  className={`rounded-md px-2 py-0.5 text-xs ${
                    verified
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-gray-50 text-gray-600"
                  }`}
                >
                  {verified ? "Verified" : "Unverified"}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  function renderContacts(list: GuestProfileV2DTO["contacts"] | unknown) {
    const arr = Array.isArray(list) ? (list as any[]) : [];
    if (!arr.length) return <span className="text-gray-500">—</span>;
    return (
      <ul className="space-y-1">
        {arr.map((c, i) => {
          const type = (c as any)?.type || "";
          const value = (c as any)?.value || "";
          const vis = (c as any)?.visibility || "";
          return (
            <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-gray-800">{type}</span>
              <span className="text-gray-800">{value || "—"}</span>
              {vis ? (
                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {String(vis)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  // --- render ---------------------------------------------------------------

  return (
    <main className="mx-auto max-w-4xl px-4 py-8" aria-labelledby="page-title">
      <div className="mb-6 flex items-center justify-between">
        <h1 id="page-title" className="text-xl font-semibold">
          Guest Profile
        </h1>
        <Link
          href="/modules/profile/edit-v2/guest"
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-black"
        >
          Edit Profile
        </Link>
      </div>

      {status.kind === "loading" && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Loading profile…
        </div>
      )}
      {status.kind === "error" && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {status.msg}
        </div>
      )}
      {status.kind === "ready" && p && (
        <section className="space-y-8">
          {/* Header / Identity */}
          <div className="flex gap-5">
            {/* Headshot */}
            <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-full ring-1 ring-gray-200">
              {headshotUrl && imgOk ? (
                <Image
                  src={headshotUrl}
                  alt={`${(p as any).displayName || "Profile"} headshot`}
                  fill
                  sizes="7rem"
                  className="object-cover"
                  unoptimized
                  onError={() => setImgOk(false)}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gray-100 text-lg font-semibold text-gray-500">
                  {initials((p as any).displayName)}
                </div>
              )}
            </div>

            {/* Name block */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="truncate text-lg font-semibold">
                  {(p as any).honorific ? `${(p as any).honorific} ` : ""}
                  {(p as any).displayName || "—"}
                </h2>
                {(p as any).pronouns ? (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
                    {(p as any).pronouns}
                  </span>
                ) : null}
              </div>
              {(p as any).nativeName ? (
                <div className="mt-0.5 text-sm text-gray-600">
                  {(p as any).nativeName}
                </div>
              ) : null}

              {headline ? (
                <div className="mt-2 text-sm text-gray-900">{headline}</div>
              ) : null}
              {shortBio ? (
                <div className="mt-1 text-sm text-gray-700">{shortBio}</div>
              ) : null}

              {displayLocation ? (
                <div className="mt-2 text-sm text-gray-600">
                  {displayLocation}
                </div>
              ) : null}

              {/* Flags */}
              <div className="mt-3 flex flex-wrap gap-2">
                {typeof (p as any).inviteable === "boolean" ? (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset ${
                      (p as any).inviteable
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-gray-50 text-gray-600 ring-gray-200"
                    }`}
                  >
                    {(p as any).inviteable ? "Inviteable" : "Not inviteable"}
                  </span>
                ) : null}
                {typeof (p as any).listedPublic === "boolean" ? (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
                    {(p as any).listedPublic
                      ? "Public profile"
                      : "Private profile"}
                  </span>
                ) : null}
                {(p as any).travelReadiness ? (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
                    {(p as any).travelReadiness}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Languages & Regions */}
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              Languages & Regions
            </h3>
            <div className="mt-3 grid gap-6 md:grid-cols-2">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Languages
                </div>
                {renderLanguages((p as any).languages)}
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Regions
                </div>
                {renderRegions((p as any).regionCodes)}
              </div>
            </div>
          </div>

          {/* Topics & Formats (appearance types) */}
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              Topics & Formats
            </h3>
            <div className="mt-3 grid gap-6 md:grid-cols-2">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Topics
                </div>
                {renderTopics((p as any).topicKeys)}
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Formats
                </div>
                {renderAppearanceTypes((p as any).appearanceTypes)}
              </div>
            </div>
          </div>

          {/* Bio */}
          <div>
            <h3 className="text-sm font-medium text-gray-900">Bio</h3>
            {fullBio ? (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-800">
                {fullBio}
              </p>
            ) : (
              <p className="mt-2 text-sm text-gray-500">—</p>
            )}
          </div>

          {/* Experience */}
          <div>
            <h3 className="text-sm font-medium text-gray-900">Experience</h3>
            {renderExperience((p as any).experience)}
          </div>

          {/* Education & Certifications */}
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              Education & Certifications
            </h3>
            {renderEducation((p as any).education)}
          </div>

          {/* Publications & media */}
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              Publications & media
            </h3>
            <div className="mt-3 grid gap-6 md:grid-cols-2">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Publications
                </div>
                {renderPublications((p as any).publications)}
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Media appearances
                </div>
                {renderMedia((p as any).media)}
              </div>
            </div>
          </div>

          {/* Private details */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-sm font-medium text-gray-900">
              Private details
            </h3>
            <dl className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Additional emails
                </dt>
                <dd className="mt-1 text-sm text-gray-800">
                  {renderAdditionalEmails((p as any).additionalEmails)}
                </dd>
              </div>

              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Contact methods
                </dt>
                <dd className="mt-1 text-sm text-gray-800">
                  {renderContacts((p as any).contacts)}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      )}
    </main>
  );
}
