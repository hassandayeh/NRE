// src/components/profile/GuestProfileRenderer.tsx
"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import type { GuestProfileV2DTO } from "../../lib/profile/guestSchema";
import {
  initialsFromName,
  formatMonthYear,
  safeLink,
} from "../../lib/profile/view-format";

/** Small UI chip used in a few sections */
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

export type GuestProfileRendererProps = {
  profile: GuestProfileV2DTO;

  /** Show the "Edit Profile" button (enabled only on the private "me" view). Defaults to false. */
  canEdit?: boolean;

  /** Extensibility slots */
  beforeSummarySlot?: React.ReactNode;
  afterSummarySlot?: React.ReactNode;
  sidebarSlot?: React.ReactNode;
  footerSlot?: React.ReactNode;
};

/**
 * GuestProfileRenderer
 * Shared presentational renderer for BOTH:
 * - Internal view page
 * - Public profile page
 *
 * Notes:
 * - Client component to preserve headshot error fallback behavior.
 * - Imports ONLY formatting helpers from src/lib/profile/view-format.ts
 * - Mirrors the presentational JSX from /modules/profile/view-v2/guest/page.tsx
 *   (no data fetching, no API calls).
 */
export default function GuestProfileRenderer({
  profile,
  canEdit = false,
  beforeSummarySlot,
  afterSummarySlot,
  sidebarSlot,
  footerSlot,
}: GuestProfileRendererProps) {
  const p = profile as any;

  // --- Derived — mirrors original page logic ---------------------------------
  const headshotRaw = (p?.headshotUrl ||
    p?.photoUrl ||
    p?.photo?.url ||
    "") as string;
  const headshotUrl = headshotRaw;

  const [imgOk, setImgOk] = React.useState(true);
  React.useEffect(() => setImgOk(true), [headshotUrl]);

  const displayName: string = p?.displayName || p?.name || "";
  const headline: string = p?.headline || "";
  const shortBio: string = p?.shortBio || "";
  const fullBio: string = p?.fullBio || "";

  const displayLocation = React.useMemo(() => {
    const country = p?.countryCode || "";
    const city = p?.city || "";
    const tz = p?.timezone || "";
    const loc = [city, country].filter(Boolean).join(", ");
    return [loc, tz].filter(Boolean).join(" • ");
  }, [p?.countryCode, p?.city, p?.timezone]);

  // --- Render helpers (ported from the old page) ------------------------------
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
          const from = formatMonthYear((r as any)?.from, { fallback: "" });
          const to = (r as any)?.isCurrent
            ? "Present"
            : formatMonthYear((r as any)?.to, { fallback: "" });
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
          const from = formatMonthYear((r as any)?.from, { fallback: "" });
          const to = formatMonthYear((r as any)?.to, { fallback: "" });
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
          const url = safeLink((r as any)?.url || "");
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
          const date = formatMonthYear((r as any)?.date, { fallback: "" });
          const url = safeLink((r as any)?.url || "");
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

  // --- Presentational JSX (moved from the page) ------------------------------
  return (
    <main className="mx-auto max-w-4xl px-4 py-8" aria-labelledby="page-title">
      {/* Header bar with Edit link (kept to preserve 1:1 parity) */}
      <div className="mb-6 flex items-center justify-between">
        <h1 id="page-title" className="text-xl font-semibold">
          Guest Profile
        </h1>
        {canEdit && (
          <Link
            href="/modules/profile/edit-v2/guest"
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-black"
          >
            Edit Profile
          </Link>
        )}
      </div>

      {/* Optional slot content above summary */}
      {beforeSummarySlot ? (
        <div className="mb-4">{beforeSummarySlot}</div>
      ) : null}

      {/* Main grid allows a sidebar slot for public overlays later */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column — identical sections */}
        <section className="space-y-8">
          {/* Header / Identity */}
          <div className="flex gap-5">
            {/* Headshot */}
            <div className="h-28 w-28 shrink-0 overflow-hidden rounded-full ring-1 ring-gray-200">
              {headshotUrl && imgOk ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={headshotUrl}
                  alt={`${displayName || "Profile"} headshot`}
                  className="h-full w-full object-cover"
                  onError={() => setImgOk(false)}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gray-100 text-lg font-semibold text-gray-500">
                  {initialsFromName(displayName)}
                </div>
              )}
            </div>

            {/* Name block */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="truncate text-lg font-semibold">
                  {p?.honorific ? `${p.honorific} ` : ""}
                  {displayName || "—"}
                </h2>
                {p?.pronouns ? (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
                    {p.pronouns}
                  </span>
                ) : null}
              </div>
              {p?.nativeName ? (
                <div className="mt-0.5 text-sm text-gray-600">
                  {p.nativeName}
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
                {typeof p?.inviteable === "boolean" ? (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset ${
                      p.inviteable
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-gray-50 text-gray-600 ring-gray-200"
                    }`}
                  >
                    {p.inviteable ? "Inviteable" : "Not inviteable"}
                  </span>
                ) : null}
                {typeof p?.listedPublic === "boolean" ? (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
                    {p.listedPublic ? "Public profile" : "Private profile"}
                  </span>
                ) : null}
                {p?.travelReadiness ? (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
                    {p.travelReadiness}
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
                {renderLanguages(p?.languages)}
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Regions
                </div>
                {renderRegions(p?.regionCodes)}
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
                {renderTopics(p?.topicKeys)}
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Formats
                </div>
                {renderAppearanceTypes(p?.appearanceTypes)}
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
            {renderExperience(p?.experience)}
          </div>

          {/* Education & Certifications */}
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              Education & Certifications
            </h3>
            {renderEducation(p?.education)}
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
                {renderPublications(p?.publications)}
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Media appearances
                </div>
                {renderMedia(p?.media)}
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
                  {renderAdditionalEmails(p?.additionalEmails)}
                </dd>
              </div>

              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Contact methods
                </dt>
                <dd className="mt-1 text-sm text-gray-800">
                  {renderContacts(p?.contacts)}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Sidebar */}
        <aside className="md:pl-2">{sidebarSlot ?? null}</aside>
      </div>

      {/* Optional slot content after main content */}
      {afterSummarySlot ? <div className="mt-8">{afterSummarySlot}</div> : null}

      {/* Footer slot */}
      {footerSlot ? (
        <footer className="mt-10 border-t pt-6 text-sm text-gray-600">
          {footerSlot}
        </footer>
      ) : null}
    </main>
  );
}
