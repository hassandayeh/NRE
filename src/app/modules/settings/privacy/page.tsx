// src/app/modules/settings/profile/page.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type Profile = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  inviteable: boolean;
  listedPublic: boolean;
  updatedAt: string;
};

export default function GuestProfileSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [displayName, setDisplayName] = React.useState("");
  const [listedPublic, setListedPublic] = React.useState(false);

  React.useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setError(null);
      setOk(null);
      try {
        const res = await fetch("/api/guest/profile", { cache: "no-store" });
        if (!res.ok) {
          // 401 = not signed in, 403 = staff cannot use this endpoint
          const j = await safeJson(res);
          const msg =
            j?.error ||
            (res.status === 403
              ? "This page is for guest accounts. You appear to be signed in as staff."
              : "Unable to load guest profile.");
          if (!cancel) {
            setError(msg);
            setLoading(false);
          }
          return;
        }
        const j = await res.json();
        const p: Profile = j.profile;
        if (!cancel) {
          setProfile(p);
          setDisplayName(p.displayName || "");
          setListedPublic(!!p.listedPublic);
          setLoading(false);
        }
      } catch (e: any) {
        if (!cancel) {
          setError(e?.message || "Failed to load profile.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/guest/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listedPublic }),
      });
      const j = await safeJson(res);
      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || "Failed to save profile.");
      }
      setOk("Saved.");
      // Refresh any server components that might read from session/DB
      router.refresh();
      // Keep local state in sync with server response
      if (j?.profile) {
        setProfile(j.profile);
        setDisplayName(j.profile.displayName || "");
        setListedPublic(!!j.profile.listedPublic);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Privacy</h1>

        <p className="mt-4 text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Privacy</h1>

        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Profile &amp; Privacy</h1>
      <p className="mt-1 text-sm text-gray-500">
        Signed in as <span className="font-medium">{profile?.email}</span>
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          {error}
        </div>
      )}
      {ok && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
          {ok}
        </div>
      )}

      <form onSubmit={onSave} className="mt-6 space-y-6">
        {/* Profile editing (display name, etc.) lives in /modules/profile/edit */}

        {/* Public listing toggle */}
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">
                Appear in Global directory
              </div>
              <div className="text-xs text-gray-500">
                If on, other orgs can discover and invite you.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={listedPublic}
              onClick={() => setListedPublic((v) => !v)}
              className={[
                "relative inline-flex h-6 w-11 items-center rounded-full transition",
                listedPublic ? "bg-black" : "bg-gray-300",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-block h-4 w-4 transform rounded-full bg-white transition",
                  listedPublic ? "translate-x-6" : "translate-x-1",
                ].join(" ")}
              />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>

          {/* Public profile link is always available to the owner.
    When not listed, it opens a private preview. */}
          <a
            href={`/e/${profile?.id}`}
            className="text-sm underline underline-offset-2"
            aria-label={
              listedPublic
                ? "View public profile"
                : "View public profile (private preview)"
            }
          >
            {listedPublic
              ? "View public profile"
              : "View public profile (private preview)"}
          </a>
          <a
            href="/modules/profile/edit"
            className="text-sm underline underline-offset-2"
          >
            Edit profile
          </a>
        </div>
      </form>
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
