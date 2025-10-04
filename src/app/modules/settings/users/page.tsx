"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** ------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------- */
type UserItem = {
  id: string;
  name: string | null;
  email: string;
  slot: number | null;
  roleLabel?: string | null;
  roleActive?: boolean | null;
  invited?: boolean | null;
  isInvited?: boolean | null;
};

type UsersResponse = {
  items: UserItem[];
  page: number;
  pageSize: number;
  total: number;
};

type RoleSlot = {
  slot: number;
  label: string;
  isActive: boolean;
  /** effective permissions = template + overrides */
  effective: string[];
  /** template keys (informational) */
  template: string[];
  /** org overrides (not used for UI state anymore, we show effective) */
  overrides: { key: string; allowed: boolean }[];
};

type RolesResponse = {
  ok?: boolean;
  orgId: string;
  permissionKeys: readonly string[];
  slots: RoleSlot[];
};

type RoleDraft = {
  slot: number;
  label: string;
  isActive: boolean;
  /** explicit allow/deny per key (no inherit) */
  perm: Record<string, boolean>;
};

const BOOKABLE_KEYS = [
  "directory:listed_internal",
  "booking:inviteable",
] as const;

/** ------------------------------------------------------------------------
 * Utils
 * ---------------------------------------------------------------------- */
const clsx = (...xs: any[]) => xs.filter(Boolean).join(" ");

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced as T;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`
    );
  }
  return (await res.json()) as T;
}
async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`
    );
  }
  return (await res.json()) as T;
}
async function patchJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`
    );
  }
  return (await res.json()) as T;
}

/** org detection helpers */
function looksLikeId(v: unknown) {
  return typeof v === "string" && v.length >= 18;
}
function parseOrgFromPayload(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (looksLikeId(obj.orgId)) return obj.orgId as string;
  if (looksLikeId(obj.organizationId)) return obj.organizationId as string;
  if (looksLikeId(obj?.org?.id)) return obj.org.id as string;
  if (looksLikeId(obj?.organization?.id)) return obj.organization.id as string;
  if (looksLikeId(obj?.data?.org?.id)) return obj.data.org.id as string;
  if (looksLikeId(obj?.item?.org?.id)) return obj.item.org.id as string;
  return null;
}
async function tryGet<T>(url: string) {
  try {
    return await getJSON<T>(url);
  } catch {
    return null;
  }
}
async function detectOrgId(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const cached = window.localStorage.getItem("orgId");
    if (cached && looksLikeId(cached)) return cached;
  }
  const candidates = [
    "/api/directory/org?mine=1",
    "/api/directory/org?self=1",
    "/api/directory/org",
    "/api/org/current",
    "/api/org/me",
  ];
  for (const url of candidates) {
    const data = await tryGet<any>(url);
    const found = parseOrgFromPayload(data);
    if (found) {
      if (typeof window !== "undefined")
        window.localStorage.setItem("orgId", found);
      return found;
    }
  }
  const sess = await tryGet<any>("/api/auth/session");
  const fromSess =
    (sess?.user && parseOrgFromPayload(sess.user)) ||
    parseOrgFromPayload(sess) ||
    (sess?.user?.orgId as string | undefined) ||
    (sess?.user?.org?.id as string | undefined);
  if (looksLikeId(fromSess)) {
    if (typeof window !== "undefined")
      window.localStorage.setItem("orgId", fromSess!);
    return fromSess!;
  }
  return null;
}

/** Simple toast */
function useToast() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const [variant, setVariant] = React.useState<"ok" | "err">("ok");
  React.useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(t);
  }, [msg]);
  return {
    showOk: (m: string) => {
      setVariant("ok");
      setMsg(m);
    },
    showErr: (m: string) => {
      setVariant("err");
      setMsg(m);
    },
    node: msg ? (
      <div
        role="status"
        className={clsx(
          "fixed right-4 top-4 z-50 rounded-md px-3 py-2 text-sm shadow",
          variant === "ok"
            ? "bg-emerald-50 text-emerald-800"
            : "bg-red-50 text-red-800"
        )}
      >
        {msg}
      </div>
    ) : null,
  };
}

/** ------------------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------------- */
export default function UsersAndRolesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  // org
  const orgIdFromUrl = (searchParams.get("orgId") || "").trim() || null;
  const [orgId, setOrgId] = React.useState<string | null>(orgIdFromUrl);
  const [resolvingOrg, setResolvingOrg] = React.useState<boolean>(
    !orgIdFromUrl
  );

  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (orgId) return;
      setResolvingOrg(true);
      const detected = await detectOrgId();
      if (!alive) return;
      if (detected) {
        setOrgId(detected);
        const sp = new URLSearchParams(searchParams.toString());
        sp.set("orgId", detected);
        router.replace(`/modules/settings/users?${sp.toString()}`);
      } else {
        setResolvingOrg(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // filters
  const [q, setQ] = React.useState(searchParams.get("q") || "");
  const [slot, setSlot] = React.useState(searchParams.get("slot") || "");
  const [page, setPage] = React.useState<number>(
    Number(searchParams.get("page") || "1") || 1
  );
  const [pageSize, setPageSize] = React.useState<number>(
    Number(searchParams.get("pageSize") || "20") || 20
  );
  const debouncedQ = useDebouncedValue(q, 250);

  // users data
  const [items, setItems] = React.useState<UserItem[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Record<string, boolean>>({});

  // roles data
  const [rolesRes, setRolesRes] = React.useState<RolesResponse | null>(null);
  const [permissionKeys, setPermissionKeys] = React.useState<
    readonly string[] | null
  >(null);
  const [rolesError, setRolesError] = React.useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = React.useState<Map<number, RoleDraft>>(
    new Map()
  );
  const [roleDirty, setRoleDirty] = React.useState<Record<number, boolean>>({});
  const [roleSaving, setRoleSaving] = React.useState<Record<number, boolean>>(
    {}
  );
  const [permOpen, setPermOpen] = React.useState<Record<number, boolean>>({});

  // load roles
  React.useEffect(() => {
    if (!orgId) return;
    let alive = true;
    (async () => {
      try {
        setRolesError(null);
        const data = await getJSON<RolesResponse>(
          `/api/org/roles?orgId=${encodeURIComponent(orgId)}`
        );
        if (!alive) return;
        setRolesRes(data);
        setPermissionKeys(data.permissionKeys);

        const map = new Map<number, RoleDraft>();
        for (const s of data.slots) {
          // toggles are initialized from EFFECTIVE permissions
          const perm: Record<string, boolean> = {};
          for (const k of data.permissionKeys) {
            perm[k] = s.effective.includes(k);
          }
          map.set(s.slot, {
            slot: s.slot,
            label: s.label,
            isActive: s.isActive,
            perm,
          });
        }
        setRoleDrafts(map);
        setRoleDirty({});
      } catch (e: any) {
        setRolesRes(null);
        setPermissionKeys(null);
        setRoleDrafts(new Map());
        setRoleDirty({});
        setRolesError(
          String(e?.message || "")
            .replace(/^[0-9]+\s+/, "")
            .trim() || "You don’t have permission to view roles."
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [orgId]);

  // users url
  const apiUrl = React.useMemo(() => {
    const sp = new URLSearchParams();
    if (orgId) sp.set("orgId", orgId);
    if (debouncedQ) sp.set("q", debouncedQ);
    if (slot) sp.set("slot", slot);
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    return `/api/org/users?${sp.toString()}`;
  }, [orgId, debouncedQ, slot, page, pageSize]);

  // keep URL in sync
  React.useEffect(() => {
    const sp = new URLSearchParams();
    if (orgId) sp.set("orgId", orgId);
    if (q) sp.set("q", q);
    if (slot) sp.set("slot", slot);
    if (page !== 1) sp.set("page", String(page));
    if (pageSize !== 20) sp.set("pageSize", String(pageSize));
    router.replace(`/modules/settings/users?${sp.toString()}`);
  }, [router, orgId, q, slot, page, pageSize]);

  // fetch users
  const retried403 = React.useRef(false);
  React.useEffect(() => {
    if (!orgId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await getJSON<UsersResponse>(apiUrl);
        if (!alive) return;
        setItems(data.items ?? []);
        setTotal(Number(data.total ?? 0));
      } catch (err: any) {
        if (!alive) return;
        const msg =
          err instanceof Error ? err.message : "Failed to load users.";
        if (
          !retried403.current &&
          (msg.startsWith("403") || msg.startsWith("401"))
        ) {
          retried403.current = true;
          if (typeof window !== "undefined")
            window.localStorage.removeItem("orgId");
          const re = await detectOrgId();
          if (re && re !== orgId) {
            setOrgId(re);
            return;
          }
        }
        setError(msg);
        setItems([]);
        setTotal(0);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [orgId, apiUrl]);

  // helpers
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const roleLabelBySlot = React.useMemo(() => {
    const map = new Map<number, { label: string; isActive: boolean }>();
    (rolesRes?.slots ?? []).forEach((r) =>
      map.set(r.slot, { label: r.label, isActive: r.isActive })
    );
    return map;
  }, [rolesRes]);

  const getLabelForSlot = React.useCallback(
    (s: number | null | undefined) => {
      if (!s) return "—";
      const entry = roleLabelBySlot.get(s);
      return entry?.label ?? `Role ${s}`;
    },
    [roleLabelBySlot]
  );

  function draftFor(slotNum: number): RoleDraft {
    const fallback: RoleDraft = {
      slot: slotNum,
      label: `Role ${slotNum}`,
      isActive: true,
      perm: Object.fromEntries((permissionKeys ?? []).map((k) => [k, false])),
    };
    return roleDrafts.get(slotNum) ?? fallback;
  }

  function originalFor(slotNum: number): RoleSlot | null {
    return rolesRes?.slots.find((s) => s.slot === slotNum) ?? null;
  }

  function isBookable(d: RoleDraft): boolean {
    return BOOKABLE_KEYS.every((k) => d.perm[k] === true);
  }
  function setBookable(slotNum: number, on: boolean) {
    const d = draftFor(slotNum);
    const next = { ...d.perm };
    for (const k of BOOKABLE_KEYS) next[k] = on;
    setRoleDrafts((m) => new Map(m).set(slotNum, { ...d, perm: next }));
    setRoleDirty((x) => ({ ...x, [slotNum]: true }));
  }

  function isDirty(slotNum: number): boolean {
    const d = draftFor(slotNum);
    const o = originalFor(slotNum);
    if (!o) return false;
    if (d.label.trim() !== o.label) return true;
    if (d.isActive !== o.isActive) return true;
    // compare against EFFECTIVE (since UI uses effective as source of truth)
    const eff = new Set(o.effective);
    for (const k of permissionKeys ?? []) {
      const now = !!d.perm[k];
      const was = eff.has(k);
      if (now !== was) return true;
    }
    return false;
  }

  async function saveRole(slotNum: number) {
    if (!orgId) return;
    const d = draftFor(slotNum);
    const o = originalFor(slotNum);
    if (!o) return;

    setRoleSaving((s) => ({ ...s, [slotNum]: true }));
    try {
      // Build full explicit override set from toggles
      const overrides = (permissionKeys ?? []).map((k) => ({
        key: k,
        allowed: !!d.perm[k],
      }));

      const update: {
        label?: string;
        isActive?: boolean;
        overrides?: { key: string; allowed: boolean }[];
      } = {};
      if (d.label.trim() !== o.label) update.label = d.label.trim();
      if (slotNum !== 1 && d.isActive !== o.isActive)
        update.isActive = d.isActive;
      update.overrides = overrides;

      await patchJSON(`/api/org/roles`, {
        orgId,
        updates: { [String(slotNum)]: update },
      });

      toast.showOk("Role saved.");
      // refresh roles from server
      const data = await getJSON<RolesResponse>(
        `/api/org/roles?orgId=${encodeURIComponent(orgId)}`
      );
      setRolesRes(data);
      setPermissionKeys(data.permissionKeys);
      const map = new Map<number, RoleDraft>();
      for (const s of data.slots) {
        const perm: Record<string, boolean> = {};
        for (const k of data.permissionKeys) perm[k] = s.effective.includes(k);
        map.set(s.slot, {
          slot: s.slot,
          label: s.label,
          isActive: s.isActive,
          perm,
        });
      }
      setRoleDrafts(map);
      setRoleDirty((d0) => ({ ...d0, [slotNum]: false }));
    } catch (e: any) {
      toast.showErr(e?.message || "Failed to save role.");
    } finally {
      setRoleSaving((s) => ({ ...s, [slotNum]: false }));
    }
  }

  async function onChangeSlot(userId: string, newSlotStr: string) {
    if (!orgId) return;
    const newSlot = Number(newSlotStr) || 0;
    if (!Number.isInteger(newSlot) || newSlot < 1 || newSlot > 10) {
      toast.showErr("Invalid role slot.");
      return;
    }
    setPending((p) => ({ ...p, [userId]: true }));
    const prev = items ?? [];
    setItems((list) =>
      (list ?? []).map((x) =>
        x.id === userId
          ? { ...x, slot: newSlot, roleLabel: getLabelForSlot(newSlot) }
          : x
      )
    );
    try {
      await patchJSON<{ item: UserItem }>(
        `/api/org/users/${encodeURIComponent(
          userId
        )}?orgId=${encodeURIComponent(orgId)}`,
        { slot: newSlot }
      );
      toast.showOk("Role updated.");
    } catch (e: any) {
      setItems(prev);
      toast.showErr(e?.message || "Failed to update role.");
    } finally {
      setPending((p) => ({ ...p, [userId]: false }));
    }
  }

  async function onRemove(userId: string, userName: string) {
    if (!orgId) return;
    if (!window.confirm(`Remove "${userName}" from this organization?`)) return;
    setPending((p) => ({ ...p, [userId]: true }));
    const prevItems = items ?? [];
    const nextItems = prevItems.filter((x) => x.id !== userId);
    const prevTotal = total;
    setItems(nextItems);
    setTotal(Math.max(0, prevTotal - 1));
    try {
      await patchJSON<{ removed: true }>(
        `/api/org/users/${encodeURIComponent(
          userId
        )}?orgId=${encodeURIComponent(orgId)}`,
        { slot: null }
      );
      toast.showOk("Member removed.");
      if (nextItems.length === 0 && page > 1) setPage(page - 1);
    } catch (e: any) {
      setItems(prevItems);
      setTotal(prevTotal);
      toast.showErr(e?.message || "Failed to remove member.");
    } finally {
      setPending((p) => ({ ...p, [userId]: false }));
    }
  }

  // --------------------------------------------------------------------------
  // Render (single return)
  // --------------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {toast.node}

      {/* Header */}
      <header className="mb-8 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Users & Roles</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (typeof window !== "undefined")
                window.localStorage.removeItem("orgId");
              location.reload();
            }}
            className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
            title="Clear cached org and re-detect"
          >
            Reset org
          </button>

          {/* create user toggled inline later (same as before) */}
        </div>
      </header>

      {/* If no org resolved yet */}
      {!orgId ? (
        <>
          <p className="text-sm text-neutral-700">
            {resolvingOrg
              ? "Resolving your organization…"
              : "We couldn’t determine your organization automatically."}
          </p>
          {!resolvingOrg && (
            <button
              onClick={async () => {
                setResolvingOrg(true);
                if (typeof window !== "undefined")
                  window.localStorage.removeItem("orgId");
                const detected = await detectOrgId();
                setResolvingOrg(false);
                if (detected) {
                  setOrgId(detected);
                  const sp = new URLSearchParams(searchParams.toString());
                  sp.set("orgId", detected);
                  router.replace(`/modules/settings/users?${sp.toString()}`);
                }
              }}
              className="mt-3 h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
            >
              Try again
            </button>
          )}
        </>
      ) : (
        <>
          {/* Users */}
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-medium">Users</h2>

            {/* Filters */}
            <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm">
                  Search (name or email)
                </label>
                <input
                  value={q}
                  onChange={(e) => {
                    setPage(1);
                    setQ(e.target.value);
                  }}
                  className="h-9 w-72 rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                  aria-describedby="search-hint"
                  placeholder="e.g. alice or @demo.test"
                />
                <div id="search-hint" className="mt-1 text-xs text-neutral-500">
                  Type to filter by name or email
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm">Role slot</label>
                <select
                  value={slot}
                  onChange={(e) => {
                    setPage(1);
                    setSlot(e.target.value);
                  }}
                  className="h-9 w-56 rounded-md border border-gray-300 bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All roles</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                    const label = roleLabelBySlot.get(n)?.label ?? `Role ${n}`;
                    return (
                      <option key={n} value={String(n)}>
                        {label} (#{n})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm">Page size</label>
                <select
                  value={String(pageSize)}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 20;
                    setPage(1);
                    setPageSize(v);
                  }}
                  className="h-9 w-28 rounded-md border border-gray-300 bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {[10, 20, 50].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mb-3 text-sm">
              {loading ? (
                <span>Loading…</span>
              ) : error ? (
                <span className="text-red-700">{error}</span>
              ) : (
                <span>{total} results</span>
              )}
            </div>

            {!loading && !error && (items?.length ?? 0) === 0 && (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-neutral-600">
                No members found. Try clearing filters.
              </div>
            )}

            <div className="divide-y rounded-md border">
              {(items ?? []).map((r) => {
                const isBusy = !!pending[r.id];
                const label =
                  r.roleLabel ?? getLabelForSlot(r.slot ?? undefined);
                const invited = (r.isInvited ?? r.invited) === true;

                return (
                  <div
                    key={r.id}
                    className="grid grid-cols-12 items-center gap-2 p-3"
                  >
                    <div className="col-span-3">
                      <div className="font-medium">{r.name || "—"}</div>
                      <div className="mt-0.5 text-xs text-neutral-500">
                        ID: {r.id}
                      </div>
                      {invited && (
                        <span className="mt-1 inline-flex items-center rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                          Invited
                        </span>
                      )}
                    </div>

                    <div className="col-span-3">
                      <a
                        href={`mailto:${r.email}`}
                        className="text-sm underline"
                      >
                        {r.email}
                      </a>
                    </div>

                    <div className="col-span-3">
                      <div className="text-sm">{label}</div>
                      <div className="mt-1">
                        <label className="sr-only" htmlFor={`role-${r.id}`}>
                          Change role
                        </label>
                        <select
                          id={`role-${r.id}`}
                          onChange={(e) => onChangeSlot(r.id, e.target.value)}
                          className={clsx(
                            "h-9 w-40 rounded-md border bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500",
                            isBusy && "cursor-not-allowed opacity-50"
                          )}
                          defaultValue=""
                          aria-label="Change role"
                        >
                          <option value="" disabled>
                            Select role…
                          </option>
                          {Array.from({ length: 10 }, (_, i) => i + 1).map(
                            (s) => (
                              <option key={s} value={String(s)}>
                                {getLabelForSlot(s)} (#{s})
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    </div>

                    <div className="col-span-3 flex items-center justify-end">
                      <button
                        onClick={() => onRemove(r.id, r.name || r.email)}
                        disabled={isBusy}
                        className={clsx(
                          "h-9 rounded-md border px-3 text-sm",
                          isBusy
                            ? "cursor-not-allowed opacity-50"
                            : "hover:bg-gray-50"
                        )}
                        aria-label={`Remove ${r.name || r.email} from org`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className={clsx(
                  "h-9 rounded-md border px-3",
                  page <= 1 || loading
                    ? "cursor-not-allowed opacity-50"
                    : "hover:bg-gray-50"
                )}
              >
                Previous
              </button>

              <div className="text-sm">
                Page {page} of {totalPages}
              </div>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className={clsx(
                  "h-9 rounded-md border px-3",
                  page >= totalPages || loading
                    ? "cursor-not-allowed opacity-50"
                    : "hover:bg-gray-50"
                )}
              >
                Next
              </button>
            </div>
          </section>

          {/* Roles */}
          <section aria-labelledby="roles-heading">
            <h2 id="roles-heading" className="mb-3 text-lg font-medium">
              Roles management
            </h2>

            {!rolesRes || !permissionKeys ? (
              <div className="rounded-md border p-4 text-sm">
                {rolesError ? (
                  <span className="text-red-700">{rolesError}</span>
                ) : (
                  <span className="text-neutral-600">Loading roles…</span>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((slotNum) => {
                  const orig = originalFor(slotNum) || {
                    slot: slotNum,
                    label: `Role ${slotNum}`,
                    isActive: true,
                    effective: [],
                    template: [],
                    overrides: [],
                  };
                  const draft = draftFor(slotNum);
                  const dirty = isDirty(slotNum);
                  const busy = !!roleSaving[slotNum];
                  const isAdmin = slotNum === 1;
                  const bookableOn = isBookable(draft);

                  return (
                    <div key={slotNum} className="rounded-md border p-4">
                      <div className="mb-3 flex items-center gap-3">
                        <div className="text-sm font-medium">#{slotNum}</div>
                        <label className="flex-1">
                          <span className="mb-1 block text-sm">
                            Label for role #{slotNum}
                          </span>
                          <input
                            value={draft.label}
                            onChange={(e) => {
                              const v = e.target.value;
                              setRoleDrafts((m) =>
                                new Map(m).set(slotNum, { ...draft, label: v })
                              );
                              setRoleDirty((d) => ({ ...d, [slotNum]: true }));
                            }}
                            className="h-9 w-full rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </label>

                        {!isAdmin && (
                          <>
                            <label className="inline-flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={draft.isActive}
                                onChange={(e) => {
                                  const v = e.target.checked;
                                  setRoleDrafts((m) =>
                                    new Map(m).set(slotNum, {
                                      ...draft,
                                      isActive: v,
                                    })
                                  );
                                  setRoleDirty((d) => ({
                                    ...d,
                                    [slotNum]: true,
                                  }));
                                }}
                                className="h-5 w-5"
                              />
                              <span className="text-sm">Active</span>
                            </label>

                            <label
                              className="inline-flex items-center gap-2"
                              title="When ON, this role is listed internally and inviteable to bookings."
                            >
                              <input
                                type="checkbox"
                                checked={bookableOn}
                                onChange={(e) =>
                                  setBookable(slotNum, e.target.checked)
                                }
                                className="h-5 w-5"
                              />
                              <span className="text-sm">Bookable Talent</span>
                            </label>

                            <button
                              onClick={() =>
                                setPermOpen((o) => ({
                                  ...o,
                                  [slotNum]: !o[slotNum],
                                }))
                              }
                              className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
                            >
                              {permOpen[slotNum]
                                ? "Hide permissions"
                                : "Edit permissions"}
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => saveRole(slotNum)}
                          disabled={busy || !dirty}
                          className={clsx(
                            "ml-auto h-9 rounded-md border px-3 text-sm",
                            busy
                              ? "cursor-not-allowed opacity-50"
                              : dirty
                              ? "hover:bg-gray-50"
                              : "opacity-50"
                          )}
                        >
                          {busy ? "Saving…" : dirty ? "Save" : "Saved"}
                        </button>
                      </div>

                      {/* Permissions grid (toggles) */}
                      {!isAdmin && permOpen[slotNum] && (
                        <div className="rounded-md border p-3">
                          <p className="mb-2 text-xs text-neutral-600">
                            Flip each permission <strong>ON (Allow)</strong> or{" "}
                            <strong>OFF (Deny)</strong>. Changes apply after
                            Save.
                          </p>

                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {permissionKeys.map((k) => {
                              const on = !!draft.perm[k];
                              return (
                                <label
                                  key={k}
                                  className="flex items-center justify-between gap-3"
                                >
                                  <span
                                    className="w-72 truncate text-sm"
                                    title={k}
                                  >
                                    {k}
                                  </span>
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={(e) => {
                                      const v = e.target.checked;
                                      const next = { ...draft.perm, [k]: v };
                                      setRoleDrafts((m) =>
                                        new Map(m).set(slotNum, {
                                          ...draft,
                                          perm: next,
                                        })
                                      );
                                      setRoleDirty((d) => ({
                                        ...d,
                                        [slotNum]: true,
                                      }));
                                    }}
                                    className="h-5 w-5"
                                    aria-label={`Allow ${k}`}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                <p className="text-xs text-neutral-600">
                  <strong>Role #1 (Admin)</strong> is always active and has all
                  permissions. You can rename it, but you can’t disable it or
                  edit its permissions.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
