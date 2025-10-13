// src/app/modules/profile/edit/page.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type Profile = {
  id: string;
  email: string;
  displayName: string;
  listedPublic: boolean;
};

export default function ProfileEditPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [displayName, setDisplayName] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      setOk(null);
      try {
        const res = await fetch("/api/guest/profile", { cache: "no-store" });
        const j = await safeJson(res);
        if (!res.ok || !j?.ok) {
          throw new Error(
            j?.error ||
              (res.status === 403
                ? "This page is for guest accounts. You appear to be signed in as staff."
                : "Unable to load profile.")
          );
        }
        if (alive) {
          const p = j.profile as any;
          setProfile({
            id: p.id,
            email: p.email,
            displayName: p.displayName ?? "",
            listedPublic: !!p.listedPublic,
          });
          setDisplayName(p.displayName ?? "");
          setLoading(false);
        }
      } catch (e: any) {
        if (alive) {
          setError(e?.message || "Failed to load profile.");
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/guest/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      const j = await safeJson(res);
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Failed to save.");
      setOk("Saved.");
      setProfile((prev) =>
        prev ? { ...prev, displayName: j.profile.displayName ?? "" } : prev
      );
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Edit profile</h1>

      {loading && <p className="mt-4 text-sm text-gray-500">Loading…</p>}

      {!loading && error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          {error}
        </div>
      )}

      {!loading && profile && (
        <>
          <p className="mt-1 text-sm text-gray-500">
            Signed in as <span className="font-medium">{profile.email}</span>
          </p>

          {ok && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
              {ok}
            </div>
          )}

          <form onSubmit={onSave} className="mt-6 space-y-6">
            {/* Display name (public-facing) */}
            <div>
              <label
                htmlFor="displayName"
                className="block text-sm font-medium"
              >
                Display name
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How should we show you publicly?"
                className="mt-1 w-full rounded-lg border border-gray-300 p-2 outline-none ring-0 focus:border-gray-400"
                maxLength={200}
                aria-describedby="displayName-help"
              />
              <p id="displayName-help" className="mt-1 text-xs text-gray-500">
                This appears on your public profile and in the Global directory.
              </p>
            </div>

            {/* Future fields (headline, bio, links, etc.) will go here */}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>

              <a
                href={`/e/${profile.id}`}
                className="text-sm underline underline-offset-2"
              >
                {profile.listedPublic
                  ? "View public profile"
                  : "View public profile (private preview)"}
              </a>

              <a
                href="/modules/settings/privacy"
                className="text-sm underline underline-offset-2"
              >
                Privacy settings
              </a>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
