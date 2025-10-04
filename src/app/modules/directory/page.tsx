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

  // Role info (set by API)
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
  | { ok: true; items: OrgDirectoryItem[]; [k: string]: any }
  | { ok: false; error: string }
  | { items?: OrgDirectoryItem[]; error?: string };

type ApiExperts =
  | { ok: true; items: GlobalExpert[]; [k: string]: any }
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

/** ------------------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------------- */
export default function DirectoryPage() {
  const qs = useSearchParams();

  // Tabs + search
  const [tab, setTab] = React.useState<"internal" | "global">("internal");
  const [q, setQ] = React.useState("");

  // Session (for org fallback)
  const [sessionObj, setSessionObj] = React.useState<any | null | undefined>(
    undefined
  ); // undefined=loading, null=failure, object=ok
  const sessionReady = sessionObj !== undefined;

  // Effective org: URL override first (client), else session orgId
  const overrideOrgId = qs.get("orgId");
  const sessionOrgId = sessionReady
    ? sessionObj?.orgId ?? sessionObj?.user?.orgId ?? null
    : null;
  const effectiveOrgId = overrideOrgId || sessionOrgId;

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

          let items: OrgDirectoryItem[] = ((json as any)?.items ??
            []) as OrgDirectoryItem[];

          // ✅ Show ONLY inviteable users (and never unlisted)
          items = items.filter(
            (x) =>
              getInviteableFlag(x) === true &&
              getListedInternalFlag(x) !== false
          );

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
          // GLOBAL tab
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
  }, [tab, debouncedQ, effectiveOrgId, sessionReady, withOrg]);

  // Banner when no org (either tab)
  const showNoOrgBanner = sessionReady && !effectiveOrgId;
  const internalCount = orgItems.length;
  const globalCount = globalItems.length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Directory</h1>
        {/* orgId removed from UI per request */}
      </header>

      {/* Tabs */}
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

        {/* Search */}
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
        <div className="mb-4 rounded-md border bg-amber-50 p-3 text-sm text-amber-900">
          No organization selected.{" "}
          <Link href="/modules/settings/org" className="underline">
            Choose org
          </Link>
        </div>
      )}

      {/* Loading / Error */}
      {loading && (
        <div className="rounded-md border p-6 text-sm text-neutral-700">
          Loading…
        </div>
      )}
      {error && (
        <div className="rounded-md border p-6 text-sm text-red-700">
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
          <div className="mt-4 rounded-md border border-dashed p-8 text-center text-sm text-neutral-600">
            No inviteable members to show.
            <div className="mt-1 text-xs">
              Toggle “Bookable Talent” in{" "}
              <Link href="/modules/settings/users" className="underline">
                Users &amp; Roles
              </Link>
              .
            </div>
          </div>
        )}
      {!loading &&
        !error &&
        tab === "global" &&
        effectiveOrgId &&
        globalItems.length === 0 && (
          <div className="mt-4 rounded-md border border-dashed p-8 text-center text-sm text-neutral-600">
            No public experts match your search.
          </div>
        )}
    </main>
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
          <li key={p.id} className="grid grid-cols-12 items-center gap-2 p-3">
            <div className="col-span-4">
              <div className="font-medium">{name}</div>
              <div className="mt-0.5 text-xs text-neutral-500">
                {p.email ?? p.id}
              </div>

              {/* Role & status badges */}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {p.roleLabel && (
                  <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-800">
                    {/* Hide role number; show label only */}
                    {p.roleLabel}
                  </span>
                )}
                {availability && (
                  <span
                    className={clsx(
                      "inline-flex rounded-md px-2 py-0.5 text-xs",
                      availBadge
                    )}
                  >
                    {availability}
                  </span>
                )}
              </div>
            </div>

            <div className="col-span-5 text-sm text-neutral-700">
              {p.city && <span className="mr-2">{p.city}</span>}
              {p.countryCode && (
                <span className="text-neutral-500">({p.countryCode})</span>
              )}
              {(p.tags || []).length > 0 && (
                <span className="ml-2 text-xs text-neutral-500">
                  {(p.tags || []).slice(0, 3).map((t) => (
                    <span key={t} className="mr-1">
                      #{t}
                    </span>
                  ))}
                </span>
              )}
            </div>

            <div className="col-span-3 flex items-center justify-end">
              {/* Invite button (now always enabled here; enforcement will be in booking picker) */}
              <button
                className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
                title="Invite"
              >
                Invite
              </button>
            </div>
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
        const name = displayName(e);
        const status = getAvailabilityStatus(e.availability);
        const availBadge =
          status === "AVAILABLE"
            ? "bg-green-100 text-green-800"
            : status === "BUSY"
            ? "bg-red-100 text-red-800"
            : "bg-gray-100 text-gray-700";

        return (
          <li key={e.id} className="grid grid-cols-12 items-center gap-2 p-3">
            <div className="col-span-7">
              <div className="font-medium">{name}</div>
              <div className="mt-0.5 text-xs text-neutral-500">
                Expert • {e.id}
              </div>
              {status && (
                <div className="mt-1">
                  <span
                    className={clsx(
                      "inline-flex rounded-md px-2 py-0.5 text-xs",
                      availBadge
                    )}
                  >
                    {status}
                  </span>
                </div>
              )}
            </div>

            <div className="col-span-5 text-sm text-neutral-700">
              {e.city && <span className="mr-2">{e.city}</span>}
              {e.countryCode && (
                <span className="text-neutral-500">({e.countryCode})</span>
              )}
              {(e.tags || []).length > 0 && (
                <span className="ml-2 text-xs text-neutral-500">
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
