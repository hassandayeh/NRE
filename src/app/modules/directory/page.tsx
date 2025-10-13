// src/app/modules/directory/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** ------------------------------------------------------------------------
 * Types (kept loose to avoid regressions across API shapes)
 * ---------------------------------------------------------------------- */
type OrgDirectoryItem = {
  id: string;
  displayName?: string | null;
  name?: string | null;
  email?: string | null;
  city?: string | null;
  countryCode?: string | null;
  tags?: string[] | null;

  // Derived flags from role (set by API; we also tolerate nested flags)
  inviteable?: boolean;
  listed_internal?: boolean;
  flags?: { inviteable?: boolean; listed_internal?: boolean } | null;

  // Optional availability (if provided)
  availability?:
    | { status?: "AVAILABLE" | "BUSY" | "UNKNOWN"; [k: string]: any }
    | "AVAILABLE"
    | "BUSY"
    | "UNKNOWN"
    | null;

  // Optional role info
  roleSlot?: number | null;
  roleLabel?: string | null;

  // Other fields may exist; we keep types lenient on purpose
  [k: string]: any;
};

type GlobalExpert = {
  id: string;
  name?: string | null;
  city?: string | null;
  countryCode?: string | null;
  tags?: string[] | null;
  availability?:
    | { status?: "AVAILABLE" | "BUSY" | "UNKNOWN"; [k: string]: any }
    | "AVAILABLE"
    | "BUSY"
    | "UNKNOWN"
    | null;

  [k: string]: any;
};

type ApiOrgDirectory =
  | { ok: true; items: OrgDirectoryItem[]; [k: string]: any }
  | { ok: false; error: string }
  | { items?: OrgDirectoryItem[]; error?: string };

type ApiExperts =
  | { ok: true; items: GlobalExpert[]; [k: string]: any }
  | { ok: false; error: string }
  | { items?: GlobalExpert[]; error?: string };

type ApiOrgUsers =
  | { ok?: boolean; items?: any[]; users?: any[]; error?: string }
  | { [k: string]: any };

/** ------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */
const clsx = (...xs: any[]) => xs.filter(Boolean).join(" ");

function getInviteableFlag(x: OrgDirectoryItem): boolean | null {
  if (typeof x.inviteable === "boolean") return x.inviteable;
  if (x.flags && typeof x.flags.inviteable === "boolean")
    return x.flags.inviteable;
  return null;
}
function getListedInternalFlag(x: OrgDirectoryItem): boolean | null {
  if (typeof x.listed_internal === "boolean") return x.listed_internal;
  if (x.flags && typeof x.flags.listed_internal === "boolean")
    return x.flags.listed_internal;
  return null;
}
function getAvailabilityStatus(
  a: OrgDirectoryItem["availability"] | GlobalExpert["availability"]
): string | null {
  if (!a) return null;
  if (typeof a === "string") return a;
  if (typeof a === "object" && typeof (a as any).status === "string")
    return (a as any).status;
  return null;
}
function displayName(x: OrgDirectoryItem | GlobalExpert): string {
  return (
    ((x as OrgDirectoryItem).displayName as string) ||
    ((x as any).name as string) ||
    (x as any).email ||
    String((x as any).id)
  );
}

/** Heuristics for “pending” on arbitrary shapes (client fallback only). */
function isPendingLike(p: any): boolean {
  const toLower = (v: any) => (v ?? "").toString().toLowerCase();

  // Common status-like fields
  const status = toLower(
    p?.status ??
      p?.state ??
      p?.roleStatus ??
      p?.membershipStatus ??
      p?.inviteStatus
  );
  if (status.includes("pending") || status.includes("invite")) return true;

  // Boolean-ish flags and nested flags
  if (p?.isPending === true || p?.pending === true || p?.invited === true)
    return true;
  if (p?.flags && (p.flags.pending === true || p.flags.invited === true))
    return true;

  // Invite lifecycle
  const invToken = p?.inviteToken ?? p?.token;
  const invitedAt = p?.invitedAt ?? p?.createdByInviteAt;
  const acceptedAt = p?.acceptedAt ?? p?.accepted_at ?? p?.activatedAt;
  if ((invToken || invitedAt) && !acceptedAt) return true;

  // Placeholder password marker used in some flows
  const hp = p?.hashedPassword;
  if (typeof hp === "string" && hp.startsWith("invited:")) return true;

  return false;
}

/** Consider a “Users” row active if it’s not pending/invited/removed (shape-agnostic). */
function isActiveStaff(u: any): boolean {
  const toLower = (v: any) => (v ?? "").toString().toLowerCase();

  // Obvious negatives first
  if (u?.removed === true || u?.removedAt) return false;
  if (u?.disabled === true) return false;
  if (u?.suspended === true) return false;

  // Status-like fields
  const status = toLower(
    u?.status ??
      u?.state ??
      u?.roleStatus ??
      u?.membershipStatus ??
      u?.inviteStatus
  );
  if (status.includes("pending") || status.includes("invite")) return false;

  // Pending flags
  if (u?.isPending === true || u?.pending === true || u?.invited === true)
    return false;
  if (u?.flags && (u.flags.pending === true || u.flags.invited === true))
    return false;

  // Invite lifecycle
  const invitedAt = u?.invitedAt ?? u?.createdByInviteAt;
  const acceptedAt = u?.acceptedAt ?? u?.accepted_at ?? u?.activatedAt;
  if (invitedAt && !acceptedAt) return false;

  // Placeholder password marker used in some flows
  const hp = u?.hashedPassword;
  if (typeof hp === "string" && hp.startsWith("invited:")) return false;

  return true;
}

/** ------------------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------------- */
export default function DirectoryPage() {
  const qs = useSearchParams();

  // Tabs + search
  const [tab, setTab] = React.useState<"internal" | "global">("internal");
  const [q, setQ] = React.useState("");

  // Session (for org fallback)
  const [sessionObj, setSessionObj] = React.useState<
    { orgId?: string; user?: { orgId?: string } } | null | undefined
  >(undefined); // undefined=loading, null=failure, object=ok
  const sessionReady = sessionObj !== undefined;

  // Effective org: URL override first (client), else session orgId
  const overrideOrgId = qs.get("orgId");
  const sessionOrgId = sessionReady
    ? sessionObj?.orgId ?? sessionObj?.user?.orgId ?? null
    : null;
  const effectiveOrgId = overrideOrgId || sessionOrgId || null;

  // Data state
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [orgItems, setOrgItems] = React.useState<OrgDirectoryItem[]>([]);
  const [globalItems, setGlobalItems] = React.useState<GlobalExpert[]>([]);

  // Fetch session once
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        if (!alive) return;
        if (!r.ok) {
          setSessionObj(null);
          return;
        }
        setSessionObj(await r.json());
      } catch {
        if (alive) setSessionObj(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Helper to append orgId when present
  const withOrg = React.useCallback(
    (url: string) =>
      effectiveOrgId
        ? `${url}${url.includes("?") ? "&" : "?"}orgId=${encodeURIComponent(
            effectiveOrgId
          )}`
        : url,
    [effectiveOrgId]
  );

  // Debounce search
  const [debouncedQ, setDebouncedQ] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Fetch when tab/org/search/session changes
  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!sessionReady) {
        setLoading(true);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (tab === "internal") {
          // INTERNAL tab needs an org context
          if (!effectiveOrgId) {
            setOrgItems([]);
            setLoading(false);
            return;
          }
          const sp = new URLSearchParams();
          if (debouncedQ) sp.set("q", debouncedQ);

          // 1) Base directory list (bookable + listed filtering happens client-side below)
          const res = await fetch(
            withOrg(`/api/directory/org?${sp.toString()}`),
            {
              credentials: "include",
              cache: "no-store",
            }
          );
          const json = (await res.json()) as ApiOrgDirectory;
          if (!alive) return;
          if (!res.ok) {
            throw new Error(
              (json as any)?.error || "Failed to load directory."
            );
          }

          let items: OrgDirectoryItem[] =
            (((json as any)?.items ?? []) as OrgDirectoryItem[]) || [];

          // ✅ Keep only inviteable and not explicitly unlisted (as before)
          items = items.filter(
            (x) =>
              getInviteableFlag(x) === true &&
              getListedInternalFlag(x) !== false
          );

          // 2) Attempt a **strong** exclusion using the Users endpoint (source of truth for status)
          //    We build a set of ACTIVE emails and intersect with directory items.
          let activeEmailSet: Set<string> | null = null;
          try {
            const usersRes = await fetch(withOrg(`/api/org/users?take=500`), {
              credentials: "include",
              cache: "no-store",
            });
            if (usersRes.ok) {
              const uj = (await usersRes.json()) as ApiOrgUsers;
              const rows: any[] = (uj.items ?? uj.users ?? []) as any[];
              const activeEmails = rows
                .filter(isActiveStaff)
                .map((u) =>
                  (u?.email ?? u?.user?.email ?? u?.member?.email ?? "")
                    .toString()
                    .toLowerCase()
                )
                .filter(Boolean);
              activeEmailSet = new Set(activeEmails);
            }
          } catch {
            // ignore; we’ll fall back to heuristic
            activeEmailSet = null;
          }

          if (activeEmailSet && activeEmailSet.size > 0) {
            items = items.filter((x) =>
              activeEmailSet!.has((x.email ?? "").toString().toLowerCase())
            );
          } else {
            // 3) Fallback: local heuristic (covers dev/staging shapes)
            items = items.filter((x) => !isPendingLike(x));
          }

          // Backup client-side search if server ignored q
          const needle = debouncedQ.trim().toLowerCase();
          if (needle) {
            items = items.filter((x) =>
              [
                x.displayName,
                x.name,
                x.email,
                x.id,
                x.city,
                x.countryCode,
                x.roleLabel,
              ]
                .filter(Boolean)
                .some((s) => String(s).toLowerCase().includes(needle))
            );
          }

          setOrgItems(items);
        } else {
          // GLOBAL tab (requires an org context per current product rules)
          if (!effectiveOrgId) {
            setGlobalItems([]);
            setLoading(false);
            return;
          }

          const sp = new URLSearchParams({ visibility: "public", take: "30" });
          if (debouncedQ) sp.set("q", debouncedQ);

          const res = await fetch(
            withOrg(`/api/experts/search?${sp.toString()}`),
            {
              credentials: "include",
              cache: "no-store",
            }
          );
          const json = (await res.json()) as ApiExperts;
          if (!alive) return;
          if (!res.ok) {
            throw new Error((json as any)?.error || "Failed to load experts.");
          }

          const rawExperts = ((json as any)?.items ?? []) as GlobalExpert[];
          setGlobalItems(
            rawExperts.filter(
              (e) => typeof e?.name === "string" && e.name.trim().length > 0
            )
          );
        }

        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load.");
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tab, debouncedQ, effectiveOrgId, sessionReady, withOrg]);

  // Banner when no org (either tab)
  const showNoOrgBanner = sessionReady && !effectiveOrgId;

  // Use filtered items for counts/empty-states so UI matches rendered list
  const internalCount = orgItems.length;
  const globalCount = globalItems.length;

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Directory</h1>
        <p className="mt-1 text-sm text-gray-600">
          Signed in as {effectiveOrgId ? "Staff" : "Guest"}
        </p>
      </div>

      {/* Tabs + Search */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setTab("internal")}
          className={clsx(
            "rounded-md border px-3 py-1.5 text-sm",
            tab === "internal" ? "bg-black text-white" : "hover:bg-gray-50"
          )}
          aria-pressed={tab === "internal"}
        >
          Internal {internalCount ? `(${internalCount})` : ""}
        </button>
        <button
          onClick={() => setTab("global")}
          className={clsx(
            "rounded-md border px-3 py-1.5 text-sm",
            tab === "global" ? "bg-black text-white" : "hover:bg-gray-50"
          )}
          aria-pressed={tab === "global"}
        >
          Global {globalCount ? `(${globalCount})` : ""}
        </button>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          placeholder={
            tab === "internal" ? "Search your org…" : "Search global experts…"
          }
          className="ml-auto w-[260px] rounded-md border px-3 py-2 text-sm"
          aria-label="Search directory"
        />
      </div>

      {/* No-org banner (both tabs) */}
      {showNoOrgBanner && (
        <div className="mb-4 rounded-md border bg-yellow-50 p-3 text-sm text-yellow-900">
          No organization selected.{" "}
          <Link
            href="/modules/settings?tab=org"
            className="underline underline-offset-2 hover:no-underline"
          >
            Choose org
          </Link>
          .
        </div>
      )}

      {/* Loading / Error */}
      {loading && (
        <div className="mt-8 text-sm text-gray-600" role="status">
          Loading…
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Internal tab */}
      {!loading && !error && tab === "internal" && effectiveOrgId && (
        <DirectoryListInternal items={orgItems} />
      )}

      {/* Global tab */}
      {!loading && !error && tab === "global" && effectiveOrgId && (
        <DirectoryListGlobal items={globalItems} />
      )}

      {/* Empty states */}
      {!loading &&
        !error &&
        tab === "internal" &&
        effectiveOrgId &&
        internalCount === 0 && (
          <div className="mt-8 rounded-md border p-6 text-center text-sm text-gray-600">
            <p className="font-medium">No inviteable members to show.</p>
            <p className="mt-1">
              Toggle “Bookable Talent” in{" "}
              <Link
                href="/modules/settings/users"
                className="underline underline-offset-2 hover:no-underline"
              >
                Users &amp; Roles
              </Link>
              .
            </p>
          </div>
        )}
      {!loading &&
        !error &&
        tab === "global" &&
        effectiveOrgId &&
        globalCount === 0 && (
          <div className="mt-8 rounded-md border p-6 text-center text-sm text-gray-600">
            <p className="font-medium">No public experts match your search.</p>
          </div>
        )}
    </div>
  );
}

/** ------------------------------------------------------------------------
 * Lists
 * ---------------------------------------------------------------------- */

function DirectoryListInternal({ items }: { items: OrgDirectoryItem[] }) {
  return (
    <ul className="divide-y rounded-md border">
      {items.map((p) => {
        const name = displayName(p);
        const availability = getAvailabilityStatus(p.availability);
        const availBadge =
          availability === "AVAILABLE"
            ? "bg-green-100 text-green-800"
            : availability === "BUSY"
            ? "bg-red-100 text-red-800"
            : "bg-gray-100 text-gray-700";

        return (
          <li key={p.id} className="flex items-center gap-4 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-gray-500">
                  {p.email ?? p.id}
                </span>
              </div>

              {/* Role & status badges */}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                {p.roleLabel && (
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-800">
                    {p.roleLabel}
                  </span>
                )}
                {availability && (
                  <span className={clsx("rounded px-2 py-0.5", availBadge)}>
                    {availability}
                  </span>
                )}
                {p.city && <span className="text-gray-500">{p.city}</span>}
                {p.countryCode && (
                  <span className="text-gray-400">({p.countryCode})</span>
                )}
                {(p.tags || []).slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="rounded bg-gray-50 px-1.5 py-0.5 text-gray-600"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </div>

            {/* Invite button (always enabled here; booking picker enforces rules) */}
            <Link
              href="#"
              className="whitespace-nowrap rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Invite
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DirectoryListGlobal({ items }: { items: GlobalExpert[] }) {
  return (
    <ul className="divide-y rounded-md border">
      {items.map((e) => {
        const name =
          typeof e.name === "string" && e.name.trim() ? e.name : null;
        if (!name) return null;

        const status = getAvailabilityStatus(e.availability);
        const availBadge =
          status === "AVAILABLE"
            ? "bg-green-100 text-green-800"
            : status === "BUSY"
            ? "bg-red-100 text-red-800"
            : "bg-gray-100 text-gray-700";

        return (
          <li
            key={e.id}
            className="flex items-center justify-between gap-4 p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-gray-500">
                  {/* id hidden by design (display-name only) */}
                </span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                {status && (
                  <span className={clsx("rounded px-2 py-0.5", availBadge)}>
                    {status}
                  </span>
                )}
                {e.city && <span className="text-gray-500">{e.city}</span>}
                {e.countryCode && (
                  <span className="text-gray-400">({e.countryCode})</span>
                )}
                {(e.tags || []).slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="rounded bg-gray-50 px-1.5 py-0.5 text-gray-600"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
