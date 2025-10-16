// src/app/modules/profile/view-v2/guest/page.tsx
"use client";

import * as React from "react";

type ProfileDTO = {
  displayName: string;
  localName: string;
  pronouns: string;
  languages: string[];
  timezone: string;
  city: string;
  countryCode: string;
  regions: string[];
  bio: string;
  topics: string[];
  formats: { tv: boolean; radio: boolean; online: boolean; phone: boolean };
  links: string[];
  additionalEmails: string[];
  phone: string;
  feeNote: string;
  visibility: "PUBLIC" | "PRIVATE";
  inviteable: boolean;
};

export default function GuestProfileView() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [p, setP] = React.useState<ProfileDTO | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/profile/guest/me", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load profile");
        const json = await res.json();
        if (!cancelled) setP(json?.profile || null);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-gray-500">
          Profile · Guest · View
        </p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Guest Profile</h1>
          <a
            href="/modules/profile/edit-v2/guest"
            className="rounded-2xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Edit Profile
          </a>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Read-only view of your profile. Visibility controls affect directory
          discoverability, not this private view.
        </p>
      </header>

      {loading && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          Loading profile…
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}

      {!loading && !error && !p && (
        <div className="rounded-lg border p-4 text-sm text-gray-600">
          No profile found.
        </div>
      )}

      {!loading && !error && p && (
        <div className="space-y-8">
          {/* Header card */}
          <section className="rounded-2xl border p-4">
            <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
              <div>
                <h2 className="text-xl font-medium">{p.displayName}</h2>
                {p.localName ? (
                  <p className="text-sm text-gray-600">{p.localName}</p>
                ) : null}
                {p.pronouns ? (
                  <p className="text-xs text-gray-500">{p.pronouns}</p>
                ) : null}
              </div>
              <div className="text-right text-xs text-gray-500">
                <div>
                  Visibility:{" "}
                  <span className="font-medium">{p.visibility}</span>
                </div>
                <div>
                  Inviteable:{" "}
                  <span className="font-medium">
                    {p.inviteable ? "Yes" : "No"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 text-sm text-gray-700">
              <span className="mr-3">
                {p.city ? `${p.city}, ` : ""}
                {p.countryCode}
              </span>
              <span className="text-gray-500">•</span>
              <span className="ml-3">{p.timezone}</span>
            </div>
          </section>

          {/* Languages & Regions */}
          <section className="rounded-2xl border p-4">
            <h3 className="text-lg font-medium">Languages & Regions</h3>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase text-gray-500">Languages</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {p.languages.length ? (
                    p.languages.map((l) => (
                      <span
                        key={l}
                        className="rounded-full border px-2 py-1 text-xs"
                      >
                        {l}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-500">—</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Regions</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {p.regions.length ? (
                    p.regions.map((r) => (
                      <span
                        key={r}
                        className="rounded-full border px-2 py-1 text-xs"
                      >
                        {r}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-500">—</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Topics & Formats */}
          <section className="rounded-2xl border p-4">
            <h3 className="text-lg font-medium">Topics & Formats</h3>
            <div className="mt-3">
              <div className="text-xs uppercase text-gray-500">Topics</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {p.topics.length ? (
                  p.topics.map((t, i) => (
                    <span
                      key={t + i}
                      className="rounded-full border px-2 py-1 text-xs"
                    >
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-gray-500">—</span>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              {[
                ["TV", p.formats.tv],
                ["Radio", p.formats.radio],
                ["Online", p.formats.online],
                ["Phone", p.formats.phone],
              ].map(([label, on]) => (
                <div key={label as string} className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      on ? "bg-green-500" : "bg-gray-300"
                    }`}
                  />
                  <span>{label as string}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Bio & Links */}
          <section className="rounded-2xl border p-4">
            <h3 className="text-lg font-medium">Bio & Links</h3>
            <div className="mt-2 text-sm">
              {p.bio ? (
                <p className="whitespace-pre-wrap leading-6">{p.bio}</p>
              ) : (
                <span className="text-gray-500">—</span>
              )}
            </div>

            <div className="mt-4">
              <div className="text-xs uppercase text-gray-500">Links</div>
              <ul className="mt-2 list-disc pl-6 text-sm">
                {p.links.length ? (
                  p.links.map((url, i) => (
                    <li key={url + i}>
                      <a
                        href={url}
                        className="underline hover:no-underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {url}
                      </a>
                    </li>
                  ))
                ) : (
                  <li className="text-gray-500">—</li>
                )}
              </ul>
            </div>
          </section>

          {/* Private details (only you) */}
          <section className="rounded-2xl border p-4">
            <h3 className="text-lg font-medium">Private Details</h3>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase text-gray-500">
                  Additional emails
                </div>
                <div className="mt-1 text-sm">
                  {p.additionalEmails.length ? (
                    <ul className="list-disc pl-6">
                      {p.additionalEmails.map((e, i) => (
                        <li key={e + i}>{e}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-gray-500">—</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Phone</div>
                <div className="mt-1 text-sm">{p.phone || "—"}</div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs uppercase text-gray-500">Fee note</div>
                <div className="mt-1 text-sm">{p.feeNote || "—"}</div>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
