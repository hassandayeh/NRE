"use client";

/**
 * My Profile — MVP
 * - Loads current profile from /api/profile
 * - Edit + Save with client-side validation
 * - Friendly errors; green toast on success
 * - Languages editor accepts comma/Enter and shows chips
 */

import * as React from "react";
import Link from "next/link";

// Reuse shared UI (supports both named/default exports)
import * as ButtonModule from "../../../../components/ui/Button";
const Button: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;
import * as AlertModule from "../../../../components/ui/Alert";
const Alert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

type Profile = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  languages: string[];
  timeZone: string | null;
};

type FieldErrors = Partial<Record<keyof Omit<Profile, "id" | "email">, string>>;

function ToastBox(props: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-900 shadow-lg"
    >
      <span className="mr-3">{props.children}</span>
      {props.onClose && (
        <button
          onClick={props.onClose}
          className="ml-2 rounded-md px-2 py-1 text-sm hover:bg-black/5"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export default function MyProfilePage() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const [displayName, setDisplayName] = React.useState("");
  const [avatarUrl, setAvatarUrl] = React.useState("");
  const [bio, setBio] = React.useState("");
  const [languages, setLanguages] = React.useState<string[]>([]);
  const [timeZone, setTimeZone] = React.useState("");

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  // Load profile on mount
  React.useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (res.status === 401) {
          throw new Error("Unauthorized. Please sign in.");
        }
        if (!res.ok) throw new Error("Failed to load profile.");
        const data = (await res.json()) as {
          profile?: Profile;
          error?: string;
        };
        if (!data.profile) throw new Error(data.error || "Invalid response.");
        if (ignore) return;

        const p = data.profile;
        setDisplayName(p.displayName ?? "");
        setAvatarUrl(p.avatarUrl ?? "");
        setBio(p.bio ?? "");
        setLanguages(Array.isArray(p.languages) ? p.languages : []);
        setTimeZone(p.timeZone ?? "");
        setError(null);
      } catch (e: any) {
        if (!ignore) setError(e?.message || "Failed to load profile.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  // Simple client-side validation (mirrors API limits)
  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!displayName.trim()) errs.displayName = "Display name is required.";
    if (avatarUrl.trim()) {
      try {
        // eslint-disable-next-line no-new
        new URL(avatarUrl.trim());
      } catch {
        errs.avatarUrl = "Invalid URL.";
      }
    }
    if (bio.length > 2000) errs.bio = "Bio is too long (max 2000).";
    if (languages.length > 20) errs.languages = "Too many languages.";
    if (languages.some((l) => l.length > 20))
      errs.languages = "Language codes should be ≤ 20 chars.";
    if (timeZone && timeZone.length > 64)
      errs.timeZone = "Time zone is too long.";
    return errs;
  }

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    try {
      setSaving(true);
      setError(null);

      const payload = {
        displayName: displayName.trim(),
        avatarUrl: avatarUrl.trim() || undefined,
        bio: bio.trim() || undefined,
        languages: normalizedLanguages(languages),
        timeZone: timeZone.trim() || undefined,
      };

      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data?.error && (data.error.message || data.error)) ||
            "Failed to save profile."
        );
      }

      setToast("Profile saved!");
    } catch (e: any) {
      setError(e?.message || "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  // Languages input helpers
  function addLanguageFromInput(value: string) {
    const entries = value
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!entries.length) return;
    setLanguages((prev) => {
      const set = new Set(prev.map((s) => s.toLowerCase()));
      entries.forEach((e) => set.add(e));
      return Array.from(set);
    });
  }

  function removeLanguage(code: string) {
    setLanguages((prev) => prev.filter((l) => l !== code));
  }

  // Auto-hide green toast
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-2 text-2xl font-semibold">My Profile</h1>
      <Link
        href="/modules/booking"
        className="text-sm text-blue-700 underline underline-offset-2"
      >
        ← Back to bookings
      </Link>

      <section className="mt-6 rounded-2xl border p-5">
        <h2 className="mb-4 text-lg font-medium">Basic info</h2>

        {loading ? (
          <div className="rounded-md bg-gray-100 p-4 text-sm">Loading…</div>
        ) : error ? (
          <Alert>{error}</Alert>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            {/* Display name */}
            <div>
              <label className="block text-sm font-medium">
                Display name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 outline-none ring-1 ring-inset ring-gray-200 focus:ring-2 focus:ring-gray-900"
                placeholder="Your name as it appears publicly"
              />
              {fieldErrors.displayName && (
                <p className="mt-1 text-xs text-red-600">
                  {fieldErrors.displayName}
                </p>
              )}
            </div>

            {/* Avatar */}
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <label className="block text-sm font-medium">Avatar URL</label>
                <input
                  type="url"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 outline-none ring-1 ring-inset ring-gray-200 focus:ring-2 focus:ring-gray-900"
                  placeholder="https://…/photo.jpg (optional)"
                  inputMode="url"
                />
                {fieldErrors.avatarUrl && (
                  <p className="mt-1 text-xs text-red-600">
                    {fieldErrors.avatarUrl}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-center">
                <div className="size-16 overflow-hidden rounded-full ring-1 ring-gray-200">
                  <img
                    alt="Avatar preview"
                    src={
                      avatarUrl.trim()
                        ? avatarUrl.trim()
                        : "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%' height='100%' fill='%23f3f4f6'/><text x='50%' y='54%' font-size='10' text-anchor='middle' fill='%239ca3af'>No image</text></svg>"
                    }
                    className="block size-full object-cover"
                  />
                </div>
              </div>
            </div>

            {/* Bio */}
            <div>
              <label className="block text-sm font-medium">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-lg border px-3 py-2 outline-none ring-1 ring-inset ring-gray-200 focus:ring-2 focus:ring-gray-900"
                placeholder="Short intro (max 2000 chars)"
              />
              {fieldErrors.bio && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.bio}</p>
              )}
            </div>

            {/* Languages */}
            <div>
              <label className="block text-sm font-medium">Languages</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {languages.map((code) => (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-800 ring-1 ring-inset ring-gray-200"
                  >
                    {code}
                    <button
                      type="button"
                      onClick={() => removeLanguage(code)}
                      className="ml-1 rounded p-0.5 text-gray-500 hover:bg-gray-200"
                      aria-label={`Remove ${code}`}
                      title={`Remove ${code}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLanguageFromInput((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = "";
                  }
                }}
                onBlur={(e) => {
                  addLanguageFromInput(e.target.value);
                  e.target.value = "";
                }}
                className="mt-2 w-full rounded-lg border px-3 py-2 outline-none ring-1 ring-inset ring-gray-200 focus:ring-2 focus:ring-gray-900"
                placeholder="Type a code and press Enter, or separate by commas (e.g., en, ar)"
              />
              {fieldErrors.languages && (
                <p className="mt-1 text-xs text-red-600">
                  {fieldErrors.languages}
                </p>
              )}
            </div>

            {/* Time zone */}
            <div>
              <label className="block text-sm font-medium">Time zone</label>
              <input
                type="text"
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 outline-none ring-1 ring-inset ring-gray-200 focus:ring-2 focus:ring-gray-900"
                placeholder="e.g., Africa/Cairo"
              />
              {fieldErrors.timeZone && (
                <p className="mt-1 text-xs text-red-600">
                  {fieldErrors.timeZone}
                </p>
              )}
            </div>

            <div className="pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Toast */}
      {toast ? (
        <ToastBox onClose={() => setToast(null)}>{toast}</ToastBox>
      ) : null}
    </div>
  );
}

/** helpers */
function normalizedLanguages(list: string[]) {
  const set = new Set(
    list
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .map((s) => s.slice(0, 20))
  );
  return Array.from(set);
}
