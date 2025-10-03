// src/app/modules/directory/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** ------------------------------------------------------------------------
 * Types are intentionally loose to avoid regressions across API shapes.
 * ---------------------------------------------------------------------- */
type OrgDirectoryItem = {
  id: string;
  displayName?: string | null;
  name?: string | null;
  email?: string | null;
  kind?:
    | "EXPERT"
    | "REPORTER"
    | "EDITOR"
    | "PRODUCER"
    | "ADMIN"
    | string
    | null;
  city?: string | null;
  countryCode?: string | null;
  tags?: string[] | null;

  // Flags (will be derived from role later)
  inviteable?: boolean;
  listed_internal?: boolean;
  flags?: { inviteable?: boolean; listed_internal?: boolean } | null;

  // Availability (future)
  availability?:
    | { status?: "AVAILABLE" | "BUSY" | "UNKNOWN"; [k: string]: any }
    | "AVAILABLE"
    | "BUSY"
    | "UNKNOWN"
    | null;

  // New: role info from API (/api/directory/org)
  roleSlot?: number | null;
  roleLabel?: string | null;
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
};

type ApiOrgDirectory =
  | { ok: true; items: OrgDirectoryItem[] }
  | { ok: false; error: string }
  | { items?: OrgDirectoryItem[]; error?: string };

type ApiExperts =
  | { ok: true; items: GlobalExpert[] }
  | { ok: false; error: string }
  | { items?: GlobalExpert[]; error?: string };

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

/** Extract session roles robustly */
function normalizeRole(r: unknown): string | null {
  if (!r) return null;
  const s = String(r).trim();
  if (!s) return null;
  return s.toUpperCase().replace(/\s+/g, "_");
}
function extractRoles(s: any): Set<string> {
  const roles = new Set<string>();
  const push = (val: unknown) => {
    const nr = normalizeRole(val);
    if (nr) roles.add(nr);
  };
  push(s?.user?.role);
  (s?.user?.roles ?? []).forEach(push);
  push(s?.role);
  (s?.roles ?? []).forEach(push);
  const mems =
    s?.user?.orgMemberships ??
    s?.user?.memberships ??
    s?.orgMemberships ??
    s?.memberships ??
    [];
  if (Array.isArray(mems)) mems.forEach((m: any) => push(m?.role));
  return roles;
}

/** ------------------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------------- */
export default function DirectoryPage() {
  const qs = useSearchParams();

  // UI state
  const [tab, setTab] = React.useState<"internal" | "global">("internal");
  const [q, setQ] = React.useState<string>("");
  const [sessionObj, setSessionObj] = React.useState<any | undefined>(
    undefined
  );
  const sessionReady = sessionObj !== undefined;
  const roles = React.useMemo(
    () => (sessionReady ? extractRoles(sessionObj) : new Set<string>()),
    [sessionReady, sessionObj]
  );
  const isAdminLike =
    roles.has("OWNER") || roles.has("PRODUCER") || roles.has("ADMIN");
  const isDev = process.env.NODE_ENV !== "production";

  // Effective org: URL override first (client), else session orgId
  const overrideOrgId = qs.get("orgId");
  const sessionOrgId = sessionReady
    ? sessionObj?.orgId ?? sessionObj?.user?.orgId ?? null
    : null;
  const effectiveOrgId = overrideOrgId || sessionOrgId;

  // Loading / error / data
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [orgItems, setOrgItems] = React.useState<OrgDirectoryItem[]>([]);
  const [globalItems, setGlobalItems] = React.useState<GlobalExpert[]>([]);
  const [adminViewNotice, setAdminViewNotice] = React.useState(false);

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

  // Fetch data when tab/org/search changes — wait for session
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
      setAdminViewNotice(false);

      try {
        if (tab === "internal") {
          // INTERNAL needs org context; if missing, just stop and show banner
          if (!effectiveOrgId) {
            setOrgItems([]);
            setLoading(false);
            return;
          }

          const sp = new URLSearchParams();
          if (debouncedQ) sp.set("q", debouncedQ);
          const res = await fetch(
            withOrg(`/api/directory/org?${sp.toString()}`),
            {
              credentials: "include",
              cache: "no-store",
            }
          );
          const json = (await res.json()) as ApiOrgDirectory;
          if (!alive) return;

          if (!res.ok)
            throw new Error(
              (json as any)?.error || "Failed to load directory."
            );
          const raw =
            (((json as any)?.items ?? []) as OrgDirectoryItem[]) || [];

          let items: OrgDirectoryItem[] = raw;

          // For now, admins/devs see everyone; later we'll hide for non-admins when flags are wired
          if (isAdminLike || isDev) setAdminViewNotice(true);

          // Client-side search (backup if server ignores q)
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
          // GLOBAL
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

          if (!res.ok)
            throw new Error((json as any)?.error || "Failed to load experts.");
          setGlobalItems(((json as any)?.items ?? []) as GlobalExpert[]);
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
  }, [
    tab,
    debouncedQ,
    effectiveOrgId,
    sessionReady,
    withOrg,
    isAdminLike,
    isDev,
  ]);

  // Banner when no org (on either tab)
  const showNoOrgBanner = sessionReady && !effectiveOrgId;

  const internalCount = orgItems.length;
  const globalCount = globalItems.length;

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Directory</h1>
        <div className="text-sm text-gray-600">
          {tab === "internal" ? (
            effectiveOrgId ? (
              <span className="rounded-md border px-2 py-1">
                Org: <code className="text-gray-800">{effectiveOrgId}</code>
              </span>
            ) : (
              <span className="rounded-md border px-2 py-1">
                No org selected
              </span>
            )
          ) : (
            <span className="rounded-md border px-2 py-1">Global Experts</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
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
          type="button"
          onClick={() => setTab("global")}
          className={clsx(
            "rounded-md border px-3 py-1.5 text-sm",
            tab === "global" ? "bg-black text-white" : "hover:bg-gray-50"
          )}
          aria-pressed={tab === "global"}
        >
          Global {globalCount ? `(${globalCount})` : ""}
        </button>

        {/* Search */}
        <div className="ml-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
            placeholder={
              tab === "internal" ? "Search your org…" : "Search global experts…"
            }
            className="w-[260px] rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* No-org banner (both tabs) */}
      {showNoOrgBanner && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <div className="flex items-center justify-between gap-3">
            <span>No organization selected.</span>
            <Link
              href="/modules/settings"
              className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
            >
              Choose org
            </Link>
          </div>
        </div>
      )}

      {/* Admin/Dev notice */}
      {adminViewNotice && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
          Showing all org members (admin view). Once{" "}
          <code>directory:listed_internal</code> is wired, non-listed members
          will be hidden for non-admins.
        </div>
      )}

      {/* Loading / Error */}
      {loading && (
        <div className="text-sm text-gray-600" role="status">
          Loading…
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
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
        orgItems.length === 0 && (
          <div className="rounded-lg border bg-white px-4 py-8 text-center text-sm text-gray-600">
            <p className="mb-2">No internal profiles to show.</p>
            <p className="text-xs text-gray-500">
              This tab will hide non-listed members for non-admins once listing
              is wired per user/role.
            </p>
          </div>
        )}
      {!loading &&
        !error &&
        tab === "global" &&
        effectiveOrgId &&
        globalItems.length === 0 && (
          <div className="rounded-lg border bg-white px-4 py-8 text-center text-sm text-gray-600">
            <p>No public experts match your search.</p>
          </div>
        )}
    </>
  );
}

/** ------------------------------------------------------------------------
 * Lists
 * ---------------------------------------------------------------------- */
function DirectoryListInternal({ items }: { items: OrgDirectoryItem[] }) {
  return (
    <ul className="grid gap-3">
      {items.map((p) => {
        const name = displayName(p);
        const inviteable = getInviteableFlag(p);
        const listed = getListedInternalFlag(p);
        const availability = getAvailabilityStatus(p.availability);
        const roleBadgeClass = "bg-gray-100 text-gray-800";
        const availBadge =
          availability === "AVAILABLE"
            ? "bg-green-100 text-green-800"
            : availability === "BUSY"
            ? "bg-red-100 text-red-800"
            : "bg-gray-100 text-gray-700";

        return (
          <li key={p.id} className="rounded-xl border bg-white p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{name}</div>
                <div className="text-xs text-gray-500">{p.email ?? p.id}</div>
              </div>
              <div className="shrink-0 space-x-1">
                {/* NEW: role label badge */}
                {p.roleLabel && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${roleBadgeClass}`}
                  >
                    {p.roleLabel}
                    {typeof p.roleSlot === "number" ? ` #${p.roleSlot}` : ""}
                  </span>
                )}
                {availability && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${availBadge}`}
                  >
                    {availability}
                  </span>
                )}
                {listed === false && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
                    Hidden
                  </span>
                )}
                {inviteable === true ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                    Inviteable
                  </span>
                ) : inviteable === false ? (
                  <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-800">
                    Not inviteable
                  </span>
                ) : null}
              </div>
            </div>

            <div className="text-xs text-gray-600">
              {p.city && <span className="mr-1">{p.city}</span>}
              {p.countryCode && <span>({p.countryCode})</span>}
              {(p.tags || []).length > 0 && (
                <span className="ml-2">
                  {(p.tags || []).slice(0, 3).map((t) => (
                    <span key={t} className="mr-1">
                      #{t}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DirectoryListGlobal({ items }: { items: GlobalExpert[] }) {
  return (
    <ul className="grid gap-3">
      {items.map((e) => {
        const name = displayName(e);
        const status = getAvailabilityStatus(e.availability);
        const availBadge =
          status === "AVAILABLE"
            ? "bg-green-100 text-green-800"
            : status === "BUSY"
            ? "bg-red-100 text-red-800"
            : "bg-gray-100 text-gray-700";

        return (
          <li key={e.id} className="rounded-xl border bg-white p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{name}</div>
                <div className="text-xs text-gray-500">Expert • {e.id}</div>
              </div>
              <div className="shrink-0">
                {status && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${availBadge}`}
                  >
                    {status}
                  </span>
                )}
              </div>
            </div>

            <div className="text-xs text-gray-600">
              {e.city && <span className="mr-1">{e.city}</span>}
              {e.countryCode && <span>({e.countryCode})</span>}
              {(e.tags || []).length > 0 && (
                <span className="ml-2">
                  {(e.tags || []).slice(0, 3).map((t) => (
                    <span key={t} className="mr-1">
                      #{t}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
