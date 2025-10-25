// src/app/modules/directory/v2/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import {
  AppearanceTypeLiterals,
  TravelReadinessLiterals,
  CEFRLiterals,
} from "../../../../lib/profile/guestSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Directory V2 (search-first, LinkedIn-style cards)
 * - Renders EMPTY by default
 * - User selects filters, then clicks Search
 * - Results are lean cards with photo, name, headline, and badges
 *
 * This UI calls `/api/directory/search?v=2` (API is already wired).
 */

// ---------- Suggestions (can move to a taxonomy module later) ----------
const REGION_SUGGESTIONS = [
  "MENA",
  "Europe",
  "North America",
  "Latin America",
  "Sub-Saharan Africa",
  "South Asia",
  "East Asia",
  "Southeast Asia",
  "Oceania",
  "Global",
];

const TOPIC_SUGGESTIONS = [
  "Elections",
  "Energy",
  "Finance",
  "Climate",
  "Tech",
  "Health",
  "Conflict",
  "Migration",
  "Education",
  "Sports",
  "Culture",
];

const LANGUAGE_CODE_SUGGESTIONS = [
  "en",
  "ar",
  "fr",
  "de",
  "es",
  "it",
  "ru",
  "zh",
  "ja",
  "tr",
];

const COUNTRY_CODE_SUGGESTIONS = [
  "EG",
  "US",
  "GB",
  "AE",
  "SA",
  "QA",
  "BH",
  "KW",
  "JO",
  "LB",
  "FR",
  "DE",
  "ES",
  "IT",
  "TR",
];

const TZ_SUGGESTIONS = [
  "UTC",
  "Africa/Cairo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Beirut",
  "America/New_York",
  "America/Los_Angeles",
];

// ---------- Types ----------
type LangFilter = { code: string; minLevel: string };
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

type ApiOk = { ok: true; items: SearchItem[]; nextCursor?: string | null };
type ApiErr = { ok: false; message?: string };
type ApiRes = ApiOk | ApiErr;

// ---------- Small UI pieces ----------
function Badge({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-block rounded-full border px-2 py-0.5 text-xs leading-5 text-gray-700 bg-white"
    >
      {children}
    </span>
  );
}

function Avatar({ src, alt }: { src?: string | null; alt: string }) {
  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200">
      {src ? (
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-full w-full items-center justify-center text-sm text-gray-400"
        >
          ?
        </div>
      )}
    </div>
  );
}

// Generic "token input" for multi-value comboboxes
function TokenInput({
  label,
  placeholder,
  value,
  setValue,
  tokens,
  setTokens,
  suggestions,
  datalistId,
}: {
  label: string;
  placeholder: string;
  value: string;
  setValue: (v: string) => void;
  tokens: string[];
  setTokens: (v: string[]) => void;
  suggestions?: string[];
  datalistId?: string;
}) {
  function addToken() {
    const t = value.trim();
    if (!t) return;
    if (!tokens.includes(t)) setTokens([...tokens, t]);
    setValue("");
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addToken();
    }
  }
  function removeToken(t: string) {
    setTokens(tokens.filter((x) => x !== t));
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          list={datalistId}
          className="min-w-[14rem] flex-1 rounded-lg border px-3 py-2 outline-none focus:ring"
        />
        <button
          type="button"
          onClick={addToken}
          className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring"
        >
          Add
        </button>
      </div>
      {suggestions && datalistId ? (
        <datalist id={datalistId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
      {tokens.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {tokens.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-xs"
            >
              {t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                onClick={() => removeToken(t)}
                className="rounded px-1 text-gray-500 hover:bg-gray-100"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </label>
  );
}

export default function DirectoryV2Page() {
  // ---- Filters (controlled) ----
  const [q, setQ] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [city, setCity] = React.useState("");

  // Topics (multi)
  const [topicInput, setTopicInput] = React.useState("");
  const [topics, setTopics] = React.useState<string[]>([]);

  // Regions (multi)
  const [regionInput, setRegionInput] = React.useState("");
  const [regions, setRegions] = React.useState<string[]>([]);

  // Languages (multi: code + min CEFR)
  const [langCodeInput, setLangCodeInput] = React.useState("");
  const [langMinLevelInput, setLangMinLevelInput] =
    React.useState<string>("B2");
  const [languages, setLanguages] = React.useState<LangFilter[]>([]);

  // Appearance types (multi)
  const [appearance, setAppearance] = React.useState<string[]>([]);

  // Travel readiness (single)
  const [travel, setTravel] = React.useState<string>("");

  // Scope & inviteable
  const [scope, setScope] = React.useState<"global" | "internal">("global");

  // IMPORTANT: by default, internal = inviteable-only (bookable). Global ignores this flag.
  const [inviteableOnly, setInviteableOnly] = React.useState<boolean>(false);
  React.useEffect(() => {
    // Set sane defaults whenever scope changes:
    // - internal → inviteable-only ON (default behavior on the API)
    // - global   → inviteableOnly irrelevant (keep OFF / disabled)
    setInviteableOnly(scope === "internal");
  }, [scope]);

  // Availability (pass-through only now)
  const [availDate, setAvailDate] = React.useState(""); // yyyy-mm-dd
  const [availTime, setAvailTime] = React.useState(""); // HH:mm (24h)
  const [slotMin, setSlotMin] = React.useState<number>(30);
  const [tz, setTz] = React.useState<string>(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );

  // ---- Search state ----
  const [hasSearched, setHasSearched] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<SearchItem[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);

  // helpers
  const toggleAppearance = (value: string) =>
    setAppearance((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );

  function addLanguage() {
    const code = langCodeInput.trim().toLowerCase();
    if (!code) return;
    setLanguages((prev) => {
      const exists = prev.find((l) => l.code === code);
      if (exists) {
        return prev.map((l) =>
          l.code === code ? { code, minLevel: langMinLevelInput } : l
        );
      }
      return [...prev, { code, minLevel: langMinLevelInput }];
    });
    setLangCodeInput("");
    setLangMinLevelInput("B2");
  }

  function removeLanguage(code: string) {
    setLanguages((prev) => prev.filter((l) => l.code !== code));
  }

  // Build querystring from current filters
  function buildQuery(cursor?: string) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (country.trim()) params.set("country", country.trim().toUpperCase());
    if (city.trim()) params.set("city", city.trim());

    // topics / regions
    topics.forEach((t) => params.append("topic", t));
    regions.forEach((r) => params.append("region", r));

    // appearances
    if (appearance.length)
      appearance.forEach((a) => params.append("appearance", a));

    // travel
    if (travel) params.set("travel", travel);

    // scope / inviteable
    params.set("scope", scope);

    // ✅ Key change:
    // Internal defaults to inviteable-only (bookable). To RELAX it, explicitly send inviteable=false.
    if (scope === "internal" && !inviteableOnly) {
      params.set("inviteable", "false");
    }
    // Note: when inviteableOnly is true, we omit the param and let the API's default (inviteable=true) apply.

    // languages: send pairs as lang=en:B2
    languages.forEach((l) => params.append("lang", `${l.code}:${l.minLevel}`));

    // availability: if date + time filled, pass ISO + slot + tz
    if (availDate && availTime) {
      // create a local Date, then ISO — API will also read tz
      const local = new Date(`${availDate}T${availTime}:00`);
      params.set("availableAt", local.toISOString());
      params.set("slotMin", String(slotMin));
      params.set("tz", tz);
    }

    params.set("v", "2");
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }

  async function runSearch(cursor?: string) {
    setHasSearched(true);
    setLoading(true);
    setError(null);

    try {
      const qs = buildQuery(cursor);
      const res = await fetch(`/api/directory/search?${qs}`, {
        cache: "no-store",
      });

      // Allow graceful UI if API isn’t there yet
      if (res.status === 404) {
        setItems([]);
        setNextCursor(null);
        setError(
          "Search API v2 isn’t available yet. UI is ready; we’ll wire the endpoint next."
        );
        return;
      }

      const data: ApiRes = await res.json();
      if (!res.ok || !("ok" in data) || !data.ok) {
        const msg = ("message" in data && data.message) || "Search failed.";
        throw new Error(msg);
      }

      if (cursor) setItems((prev) => [...prev, ...data.items]);
      else setItems(data.items);

      setNextCursor(data.nextCursor ?? null);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function handleTextEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void runSearch();
    }
  }

  // ---- UI ----
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Directory (V2)
        </h1>
        <div className="text-sm text-gray-500">
          Search first. No auto-listing for speed & privacy.
        </div>
      </header>

      {/* Filters */}
      <section
        aria-label="Directory filters"
        className="mb-4 rounded-2xl border bg-white p-4 shadow-sm"
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Text */}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Text</span>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={handleTextEnter}
              placeholder="Name or headline…"
              className="rounded-lg border px-3 py-2 outline-none focus:ring"
            />
          </label>

          {/* Country (combobox of ISO codes) */}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Country (ISO-3166-1)</span>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="EG, US, GB…"
              list="country-codes"
              className="rounded-lg border px-3 py-2 outline-none focus:ring"
            />
            <datalist id="country-codes">
              {COUNTRY_CODE_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          {/* City */}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">City</span>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Cairo, London…"
              className="rounded-lg border px-3 py-2 outline-none focus:ring"
            />
          </label>

          {/* Topics (multi, combobox) */}
          <TokenInput
            label="Topics"
            placeholder="Finance, Elections…"
            value={topicInput}
            setValue={setTopicInput}
            tokens={topics}
            setTokens={setTopics}
            suggestions={TOPIC_SUGGESTIONS}
            datalistId="topic-suggestions"
          />

          {/* Regions (multi, combobox) */}
          <TokenInput
            label="Regions"
            placeholder="MENA, Europe…"
            value={regionInput}
            setValue={setRegionInput}
            tokens={regions}
            setTokens={setRegions}
            suggestions={REGION_SUGGESTIONS}
            datalistId="region-suggestions"
          />

          {/* Languages (multi: code + min CEFR) */}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              Languages (code + min CEFR)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={langCodeInput}
                onChange={(e) => setLangCodeInput(e.target.value)}
                placeholder="en, ar, fr…"
                list="language-codes"
                aria-label="Language code (ISO-639-1)"
                className="w-28 rounded-lg border px-3 py-2 outline-none focus:ring"
              />
              <datalist id="language-codes">
                {LANGUAGE_CODE_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <select
                value={langMinLevelInput}
                onChange={(e) => setLangMinLevelInput(e.target.value)}
                aria-label="Minimum CEFR level"
                className="rounded-lg border px-3 py-2 outline-none focus:ring"
              >
                {CEFRLiterals.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addLanguage}
                className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring"
              >
                Add
              </button>
            </div>
            {languages.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {languages.map((l) => (
                  <span
                    key={l.code}
                    className="inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-xs"
                  >
                    {l.code.toUpperCase()} {l.minLevel}
                    <button
                      type="button"
                      aria-label={`Remove ${l.code}`}
                      onClick={() => removeLanguage(l.code)}
                      className="rounded px-1 text-gray-500 hover:bg-gray-100"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {/* Travel readiness */}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Travel readiness</span>
            <select
              value={travel}
              onChange={(e) => setTravel(e.target.value)}
              className="rounded-lg border px-3 py-2 outline-none focus:ring"
            >
              <option value="">Any</option>
              {TravelReadinessLiterals.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          {/* Appearance types (formats) */}
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Formats</legend>
            <div className="flex flex-wrap gap-3">
              {AppearanceTypeLiterals.map((a) => {
                const id = `ap-${a}`;
                const checked = appearance.includes(a);
                return (
                  <label
                    key={a}
                    htmlFor={id}
                    className="flex items-center gap-2"
                  >
                    <input
                      id={id}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAppearance(a)}
                      className="h-4 w-4 rounded border"
                    />
                    <span className="text-sm">{a}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* Scope (Global vs Internal) */}
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Scope</legend>
            <div className="flex gap-4">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="scope"
                  value="global"
                  checked={scope === "global"}
                  onChange={() => setScope("global")}
                />
                <span className="text-sm">Global</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="scope"
                  value="internal"
                  checked={scope === "internal"}
                  onChange={() => setScope("internal")}
                />
                <span className="text-sm">Internal</span>
              </label>
            </div>
          </fieldset>

          {/* Inviteable only */}
          <label
            className="flex items-center gap-2"
            title={
              scope === "internal"
                ? "Default is ON (inviteable/bookable only). Turn OFF to include all active staff."
                : "Only applies to Internal scope."
            }
          >
            <input
              type="checkbox"
              checked={inviteableOnly}
              onChange={(e) => setInviteableOnly(e.target.checked)}
              className="h-4 w-4 rounded border disabled:cursor-not-allowed disabled:opacity-50"
              disabled={scope !== "internal"}
            />
            <span className="text-sm">
              Inviteable only{" "}
              <span className="text-gray-500">(Internal scope)</span>
            </span>
          </label>

          {/* Availability (date, time, slot length, timezone) */}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Availability window</span>
            <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-4">
              <input
                type="date"
                value={availDate}
                onChange={(e) => setAvailDate(e.target.value)}
                className="rounded-lg border px-3 py-2 outline-none focus:ring"
                aria-label="Date"
              />
              <input
                type="time"
                value={availTime}
                onChange={(e) => setAvailTime(e.target.value)}
                className="rounded-lg border px-3 py-2 outline-none focus:ring"
                aria-label="Start time"
              />
              <select
                value={slotMin}
                onChange={(e) => setSlotMin(parseInt(e.target.value, 10))}
                className="rounded-lg border px-3 py-2 outline-none focus:ring"
                aria-label="Slot length (minutes)"
              >
                {[15, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
              <select
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                className="rounded-lg border px-3 py-2 outline-none focus:ring"
                aria-label="Timezone"
              >
                {TZ_SUGGESTIONS.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-500">
              These fields are passed to the API now; matching logic and the
              availability badge will ship later.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => runSearch()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 focus:outline-none focus:ring"
          >
            Search
          </button>
        </div>
      </section>

      {/* Results */}
      <section aria-label="Search results" className="space-y-3">
        {!hasSearched && (
          <div className="rounded-2xl border border-dashed bg-gray-50 p-6 text-center text-sm text-gray-600">
            Use filters above, then click{" "}
            <span className="font-medium">Search</span>.
          </div>
        )}

        {hasSearched && loading && (
          <div className="rounded-2xl border bg-white p-6 text-center text-sm text-gray-600">
            Searching…
          </div>
        )}

        {hasSearched && !loading && error && (
          <div className="rounded-2xl border bg-white p-4 text-sm text-red-600">
            {error}
          </div>
        )}

        {hasSearched && !loading && !error && items.length === 0 && (
          <div className="rounded-2xl border bg-white p-6 text-center text-sm text-gray-600">
            No results yet.
          </div>
        )}

        {items.map((it) => (
          <article
            key={it.id}
            className="flex items-center justify-between gap-4 rounded-2xl border bg-white p-4 shadow-sm hover:shadow"
          >
            <div className="flex items-center gap-4">
              <Avatar
                src={it.avatarUrl || undefined}
                alt={`${it.displayName} headshot`}
              />
              <div>
                <div className="text-base font-semibold leading-6">
                  {it.displayName}
                </div>
                {it.headline ? (
                  <div className="text-sm text-gray-600">{it.headline}</div>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-2">
                  {it.city || it.countryCode ? (
                    <Badge title="Location">
                      {(it.city ? `${it.city}, ` : "") + (it.countryCode ?? "")}
                    </Badge>
                  ) : null}
                  {(it.languages ?? []).slice(0, 2).map((l) => (
                    <Badge key={`${it.id}-${l.code}`} title="Language">
                      {l.code.toUpperCase()} {l.level}
                    </Badge>
                  ))}
                  {(it.topics ?? []).slice(0, 2).map((t) => (
                    <Badge key={`${it.id}-t-${t}`} title="Topic">
                      {t}
                    </Badge>
                  ))}
                  {(it.regions ?? []).slice(0, 2).map((r) => (
                    <Badge key={`${it.id}-r-${r}`} title="Region">
                      {r}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <div className="shrink-0">
              <Link
                href={`/modules/profile/public/${it.id}`}
                className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring"
              >
                View
              </Link>
            </div>
          </article>
        ))}

        {hasSearched && !loading && !error && nextCursor && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={() => runSearch(nextCursor ?? undefined)}
              className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring"
            >
              Load more
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
