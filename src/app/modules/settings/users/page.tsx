"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Types for API responses (kept minimal and resilient to shape changes) */
type UserItem = {
  id: string;
  name: string;
  email: string;
  slot: number | null;
  roleLabel?: string | null;
  roleActive?: boolean | null;
};
type UsersResponse = {
  items: UserItem[];
  page: number;
  pageSize: number;
  total: number;
};

type RoleEntry = { slot: number; label: string; isActive?: boolean };

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Tiny toast (no deps) */
function useToast() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const [variant, setVariant] = React.useState<"ok" | "err">("ok");
  React.useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2500);
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
        className={classNames(
          "fixed bottom-4 left-4 z-50 rounded-md px-3 py-2 shadow",
          variant === "ok"
            ? "bg-emerald-600 text-white"
            : "bg-red-600 text-white"
        )}
        role="status"
        aria-live="polite"
      >
        {msg}
      </div>
    ) : null,
  };
}

/** Fetch helpers */
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

/** Try to normalize roles payload from /api/org/roles to [{slot,label,isActive}] */
async function fetchRoles(orgId: string): Promise<RoleEntry[]> {
  const url = `/api/org/roles?orgId=${encodeURIComponent(orgId)}`;
  try {
    const data = await getJSON<unknown>(url);
    const raw = (data as any)?.roles ?? data;
    if (Array.isArray(raw)) {
      const clean: RoleEntry[] = raw
        .map((r: any) => ({
          slot: Number(r?.slot),
          label:
            typeof r?.label === "string"
              ? r.label
              : `Role ${Number(r?.slot) || 0}`,
          isActive: typeof r?.isActive === "boolean" ? r.isActive : undefined,
        }))
        .filter((r) => Number.isFinite(r.slot) && r.slot >= 1 && r.slot <= 10);
      if (clean.length) return clean.sort((a, b) => a.slot - b.slot);
    }
  } catch {
    // fall through to defaults
  }
  return Array.from({ length: 10 }, (_, i) => ({
    slot: i + 1,
    label: `Role ${i + 1}`,
  }));
}

export default function UsersSettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  // Org context
  const orgId = (searchParams.get("orgId") || "").trim();

  // Filters (URL-driven state)
  const [q, setQ] = React.useState(searchParams.get("q") || "");
  const [slot, setSlot] = React.useState<string>(
    searchParams.get("slot") || ""
  );
  const [page, setPage] = React.useState<number>(
    Number(searchParams.get("page") || "1") || 1
  );
  const [pageSize, setPageSize] = React.useState<number>(
    Number(searchParams.get("pageSize") || "20") || 20
  );

  const debouncedQ = useDebouncedValue(q, 300);

  // Data state
  const [roles, setRoles] = React.useState<RoleEntry[] | null>(null);
  const [items, setItems] = React.useState<UserItem[] | null>(null);
  const [total, setTotal] = React.useState<number>(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Per-row pending operations
  const [pending, setPending] = React.useState<Record<string, boolean>>({});

  // Load roles once per org (abort-free, ignore stale)
  React.useEffect(() => {
    if (!orgId) return;
    let ignore = false;

    (async () => {
      const data = await fetchRoles(orgId).catch<null>(() => null);
      if (!ignore && data) setRoles(data);
      if (!ignore && !data)
        setRoles(
          Array.from({ length: 10 }, (_, i) => ({
            slot: i + 1,
            label: `Role ${i + 1}`,
          }))
        );
    })();

    return () => {
      ignore = true;
    };
  }, [orgId]);

  // Build URL from state
  const apiUrl = React.useMemo(() => {
    const sp = new URLSearchParams();
    if (orgId) sp.set("orgId", orgId);
    if (debouncedQ) sp.set("q", debouncedQ);
    if (slot) sp.set("slot", slot);
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    return `/api/org/users?${sp.toString()}`;
  }, [orgId, debouncedQ, slot, page, pageSize]);

  // Keep the browser address bar in sync
  React.useEffect(() => {
    const sp = new URLSearchParams();
    if (orgId) sp.set("orgId", orgId);
    if (q) sp.set("q", q);
    if (slot) sp.set("slot", slot);
    if (page !== 1) sp.set("page", String(page));
    if (pageSize !== 20) sp.set("pageSize", String(pageSize));
    const url = `/modules/settings/users?${sp.toString()}`;
    router.replace(url);
  }, [router, orgId, q, slot, page, pageSize]);

  // Fetch users whenever filters change (abort-free, ignore stale)
  React.useEffect(() => {
    if (!orgId) return;
    let ignore = false;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = await getJSON<UsersResponse>(apiUrl);
        if (ignore) return;
        setItems(data.items ?? []);
        setTotal(Number(data.total ?? 0));
      } catch (err: any) {
        if (ignore) return;
        const msg =
          err instanceof Error ? err.message : "Failed to load users.";
        setError(msg);
        setItems([]);
        setTotal(0);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [orgId, apiUrl]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const roleBySlot = React.useMemo(() => {
    const map = new Map<number, RoleEntry>();
    (roles ?? []).forEach((r) => map.set(r.slot, r));
    return map;
  }, [roles]);

  const getLabelForSlot = React.useCallback(
    (s: number | null | undefined) => {
      if (!s) return "—";
      const entry = roleBySlot.get(s);
      return entry?.label ?? `Role ${s}`;
    },
    [roleBySlot]
  );

  async function onChangeSlot(userId: string, newSlotStr: string) {
    if (!orgId) return;
    const newSlot = Number(newSlotStr) || 0;
    if (!Number.isInteger(newSlot) || newSlot < 1 || newSlot > 10) {
      toast.showErr("Invalid role slot.");
      return;
    }

    setPending((p) => ({ ...p, [userId]: true }));
    // optimistic update
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
    const ok = window.confirm(`Remove "${userName}" from this organization?`);
    if (!ok) return;

    setPending((p) => ({ ...p, [userId]: true }));
    // optimistic remove
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

  if (!orgId) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">Organization Members</h1>
        <p className="mt-2 text-sm text-gray-600">
          Missing <code>orgId</code>. Append <code>?orgId=&lt;ORG_ID&gt;</code>{" "}
          to the URL.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast.node}

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Organization Members</h1>
        <p className="text-sm text-gray-600">
          Use search and role filter. You can change a member’s role or remove
          them from this org.
        </p>
      </header>

      {/* Filters */}
      <section aria-label="Filters" className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col">
          <label htmlFor="search" className="text-sm font-medium">
            Search (name or email)
          </label>
          <input
            id="search"
            name="search"
            type="text"
            placeholder="e.g. alice or @demo.test"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            className="h-9 w-72 rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
            aria-describedby="search-hint"
          />
          <span id="search-hint" className="sr-only">
            Type to filter by name or email
          </span>
        </div>

        <div className="flex flex-col">
          <label htmlFor="slot" className="text-sm font-medium">
            Role slot
          </label>
          <select
            id="slot"
            name="slot"
            value={slot}
            onChange={(e) => {
              setPage(1);
              setSlot(e.target.value);
            }}
            className="h-9 w-56 rounded-md border border-gray-300 px-2 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All roles</option>
            {(
              roles ??
              Array.from({ length: 10 }, (_, i) => ({
                slot: i + 1,
                label: `Role ${i + 1}`,
              }))
            ).map((r) => (
              <option key={r.slot} value={String(r.slot)}>
                {r.label} (#{r.slot})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label htmlFor="pageSize" className="text-sm font-medium">
            Page size
          </label>
          <select
            id="pageSize"
            name="pageSize"
            value={String(pageSize)}
            onChange={(e) => {
              const v = Number(e.target.value) || 20;
              setPage(1);
              setPageSize(v);
            }}
            className="h-9 w-28 rounded-md border border-gray-300 px-2 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {[10, 20, 50].map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className="text-sm text-gray-500 ml-auto">
          {loading ? (
            "Loading…"
          ) : error ? (
            <span className="text-red-600">{error}</span>
          ) : (
            `${total} results`
          )}
        </div>
      </section>

      {/* Table */}
      <section aria-label="Members list" className="overflow-x-auto">
        <table className="min-w-full border border-gray-200 rounded-md overflow-hidden">
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="text-left text-sm font-semibold p-3 border-b"
              >
                Name
              </th>
              <th
                scope="col"
                className="text-left text-sm font-semibold p-3 border-b"
              >
                Email
              </th>
              <th
                scope="col"
                className="text-left text-sm font-semibold p-3 border-b"
              >
                Role
              </th>
              <th
                scope="col"
                className="text-right text-sm font-semibold p-3 border-b"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {!loading && !error && (items?.length ?? 0) === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="p-6 text-center text-sm text-gray-500"
                >
                  No members found. Try clearing filters.
                </td>
              </tr>
            )}

            {(items ?? []).map((r) => {
              const isBusy = !!pending[r.id];
              const currentSlot = r.slot ?? undefined;
              const label = r.roleLabel ?? getLabelForSlot(r.slot ?? undefined);
              const active =
                typeof r.roleActive === "boolean"
                  ? r.roleActive
                  : currentSlot
                  ? roleBySlot.get(currentSlot)?.isActive ?? true
                  : true;

              return (
                <tr key={r.id} className="even:bg-gray-50/40">
                  <td className="p-3 align-middle">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-gray-500">ID: {r.id}</div>
                  </td>
                  <td className="p-3 align-middle">
                    <a
                      href={`mailto:${r.email}`}
                      className="text-blue-600 hover:underline"
                    >
                      {r.email}
                    </a>
                  </td>
                  <td className="p-3 align-middle">
                    <div className="flex items-center gap-3">
                      <span
                        className={classNames(
                          "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm border",
                          active
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : "border-gray-300 bg-gray-50 text-gray-600"
                        )}
                        aria-label={`Role ${label}${
                          active ? " active" : " inactive"
                        }`}
                      >
                        <span className="font-medium">{label}</span>
                        {typeof r.slot === "number" && (
                          <span className="text-xs tabular-nums text-gray-500">
                            #{r.slot}
                          </span>
                        )}
                        <span
                          className={classNames(
                            "ml-1 inline-block h-2 w-2 rounded-full",
                            active ? "bg-emerald-500" : "bg-gray-400"
                          )}
                          aria-hidden
                        />
                      </span>

                      {/* Inline role changer */}
                      <label className="sr-only" htmlFor={`slot-${r.id}`}>
                        Change role
                      </label>
                      <select
                        id={`slot-${r.id}`}
                        disabled={isBusy}
                        value={currentSlot ? String(currentSlot) : ""}
                        onChange={(e) => onChangeSlot(r.id, e.target.value)}
                        className={classNames(
                          "h-9 w-40 rounded-md border border-gray-300 px-2 outline-none focus:ring-2 focus:ring-blue-500 bg-white",
                          isBusy && "opacity-50 cursor-not-allowed"
                        )}
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
                  </td>
                  <td className="p-3 align-middle">
                    <div className="flex justify-end">
                      <button
                        onClick={() => onRemove(r.id, r.name)}
                        disabled={isBusy}
                        className={classNames(
                          "h-9 px-3 rounded-md border text-sm",
                          isBusy
                            ? "opacity-50 cursor-not-allowed"
                            : "hover:bg-gray-50"
                        )}
                        aria-label={`Remove ${r.name} from org`}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Pagination */}
      <nav
        className="flex items-center justify-between"
        aria-label="Pagination"
      >
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1 || loading}
          className={classNames(
            "h-9 px-3 rounded-md border text-sm",
            page <= 1 || loading
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-gray-50"
          )}
        >
          Previous
        </button>
        <span className="text-sm text-gray-600">
          Page <span className="font-semibold">{page}</span> of{" "}
          <span className="font-semibold">{totalPages}</span>
        </span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages || loading}
          className={classNames(
            "h-9 px-3 rounded-md border text-sm",
            page >= totalPages || loading
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-gray-50"
          )}
        >
          Next
        </button>
      </nav>
    </div>
  );
}
