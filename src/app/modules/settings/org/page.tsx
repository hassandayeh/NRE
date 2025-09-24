"use client";

/**
 * Organization Profile (Owner-only)
 * Route: /modules/settings/org
 * - Loads current org (name) from /api/org/profile
 * - Edit + Save with inline validation
 * - Green toast on success
 * - Friendly messages for 401/403
 */

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";

// Reuse shared UI (supports named/default exports)
import * as ButtonModule from "../../../../components/ui/Button";
const Button: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;
import * as AlertModule from "../../../../components/ui/Alert";
const Alert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/** Simple green toast */
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

export default function OrgProfilePage() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [forbidden, setForbidden] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [nameErr, setNameErr] = React.useState<string | null>(null);

  // Load current organization
  React.useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/org/profile", { cache: "no-store" });
        if (res.status === 401)
          throw new Error("Unauthorized. Please sign in.");
        if (res.status === 403) {
          setForbidden(true);
          throw new Error("Forbidden. Owners only.");
        }
        if (!res.ok) throw new Error("Failed to load organization.");
        const data = (await res.json()) as {
          org?: { id: string; name: string };
          error?: string;
        };
        if (!data.org) throw new Error(data.error || "Invalid response.");
        if (ignore) return;
        setName(data.org.name ?? "");
        setError(null);
      } catch (e: any) {
        if (!ignore) setError(e?.message || "Failed to load organization.");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  function validate(): boolean {
    const v = name.trim();
    if (!v) {
      setNameErr("Organization name is required.");
      return false;
    }
    if (v.length > 200) {
      setNameErr("Name is too long (max 200).");
      return false;
    }
    setNameErr(null);
    return true;
  }

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    if (!validate()) return;

    try {
      setSaving(true);
      setError(null);

      const res = await fetch("/api/org/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });

      const data = await res.json().catch(() => ({} as any));
      if (res.status === 401) throw new Error("Unauthorized. Please sign in.");
      if (res.status === 403) {
        setForbidden(true);
        throw new Error("Forbidden. Owners only.");
      }
      if (!res.ok) {
        throw new Error(
          (data?.error && (data.error.message || data.error)) ||
            "Failed to save organization."
        );
      }

      setToast("Saved!");
    } catch (e: any) {
      setError(e?.message || "Failed to save organization.");
    } finally {
      setSaving(false);
    }
  }

  // Auto-hide toast
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  const [portalReady, setPortalReady] = React.useState(false);
  React.useEffect(() => setPortalReady(true), []);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-2 text-2xl font-semibold">Organization settings</h1>
      <Link
        href="/modules/settings"
        className="text-sm text-blue-700 underline underline-offset-2"
      >
        ← Back to settings
      </Link>

      <section className="mt-6 rounded-2xl border p-5">
        <h2 className="mb-4 text-lg font-medium">Organization profile</h2>

        {loading ? (
          <div className="rounded-md bg-gray-100 p-4 text-sm">Loading…</div>
        ) : error ? (
          <Alert>{error}</Alert>
        ) : forbidden ? (
          <Alert>
            You don’t have permission to edit this organization. This page is
            visible to Owners only.
          </Alert>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <label className="block text-sm font-medium">
                Organization name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 outline-none ring-1 ring-inset ring-gray-200 focus:ring-2 focus:ring-gray-900 dark:bg-gray-900 dark:ring-gray-800"
                placeholder="e.g., Al-Hayat Newsroom"
              />
              {nameErr ? (
                <p className="mt-1 text-xs text-red-600">{nameErr}</p>
              ) : (
                <p className="mt-1 text-xs text-gray-500">
                  This name appears on bookings & invitations.
                </p>
              )}
            </div>

            <div className="pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Green toast */}
      {portalReady && toast
        ? createPortal(
            <ToastBox onClose={() => setToast(null)}>{toast}</ToastBox>,
            document.body
          )
        : null}
    </div>
  );
}
