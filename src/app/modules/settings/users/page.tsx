"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* =========================================================================
   Types
   ========================================================================= */
type UserItem = {
  id: string;
  name: string | null;
  email: string;
  slot: number | null;
};

type UsersResponse = {
  items: UserItem[];
  page: number;
  pageSize: number;
  total: number;
};

type SlotOverride = { key: string; allowed: boolean };
type RoleSlot = {
  slot: number;
  label: string;
  isActive: boolean;
  bookable: boolean;
  effective: string[];
  template: string[];
  overrides: SlotOverride[];
  /** local UI flag for permissions panel (not from server) */
  __open?: boolean;
};
type RolesResponse = {
  ok: boolean;
  orgId: string;
  permissionKeys: readonly string[];
  slots: RoleSlot[];
  apiVersion?: string;
};

type SlotUpdate = {
  label?: string;
  isActive?: boolean;
  bookable?: boolean;
  overrides?: { key: string; allowed: boolean }[];
};

/* =========================================================================
   Utils
   ========================================================================= */
const BOOKABLE_KEYS = [
  "directory:listed_internal",
  "booking:inviteable",
] as const;
const clsx = (...xs: any[]) => xs.filter(Boolean).join(" ");

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced as T;
}

/** SSR-safe persisted boolean (collapsible state) */
function useStoredBoolean(key: string, initial: boolean) {
  const [v, setV] = React.useState(initial);
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      setV(raw == null ? initial : raw === "1");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    try {
      window.localStorage.setItem(key, v ? "1" : "0");
    } catch {}
  }, [key, v]);
  return [v, setV] as const;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}
async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${t ? ` — ${t}` : ""}`);
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
    const t = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${t ? ` — ${t}` : ""}`);
  }
  return (await res.json()) as T;
}

function overrideFirstChecked(slot: RoleSlot, key: string) {
  const o = slot.overrides.find((x) => x.key === key);
  return o ? !!o.allowed : slot.template.includes(key);
}

function mutateSlotEffective(
  slot: RoleSlot,
  key: string,
  allowed: boolean
): RoleSlot {
  const next = { ...slot, overrides: [...slot.overrides] };
  const i = next.overrides.findIndex((o) => o.key === key);
  if (i >= 0) next.overrides[i] = { key, allowed };
  else next.overrides.push({ key, allowed });
  const eff = new Set<string>(slot.template);
  for (const o of next.overrides) {
    if (o.allowed) eff.add(o.key);
    else eff.delete(o.key);
  }
  next.effective = Array.from(eff);
  next.bookable = eff.has("booking:inviteable");
  return next;
}

/* =========================================================================
   Page
   ========================================================================= */
export default function UsersAndRolesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const orgId = (searchParams.get("orgId") || "").trim();

  // Collapsibles — persisted & SSR-safe
  const [usersOpen, setUsersOpen] = useStoredBoolean("usersSectionOpen", true);
  const [rolesOpen, setRolesOpen] = useStoredBoolean("rolesSectionOpen", true);

  // Filters (Users)
  const [q, setQ] = React.useState(searchParams.get("q") || "");
  const [slotFilter, setSlotFilter] = React.useState(
    searchParams.get("slot") || ""
  );
  const [page, setPage] = React.useState<number>(
    Number(searchParams.get("page") || "1") || 1
  );
  const [pageSize, setPageSize] = React.useState<number>(
    Number(searchParams.get("pageSize") || "20") || 20
  );
  const debouncedQ = useDebouncedValue(q, 250);

  // Users state
  const [usersRes, setUsersRes] = React.useState<UsersResponse | null>(null);
  const [usersErr, setUsersErr] = React.useState<string | null>(null);
  const [pendingUser, setPendingUser] = React.useState<Record<string, boolean>>(
    {}
  );

  // Roles (source of truth for UI)
  const [rolesRes, setRolesRes] = React.useState<RolesResponse | null>(null);
  const [rolesErr, setRolesErr] = React.useState<string | null>(null);

  // Per-slot save indicators
  const [saving, setSaving] = React.useState<Record<number, boolean>>({});
  const [savedAt, setSavedAt] = React.useState<Record<number, number>>({});
  const autosaveTimers = React.useRef<Record<number, any>>({});

  /* -------------------------- URL sync -------------------------- */
  React.useEffect(() => {
    const sp = new URLSearchParams();
    if (orgId) sp.set("orgId", orgId);
    if (q) sp.set("q", q);
    if (slotFilter) sp.set("slot", slotFilter);
    if (page !== 1) sp.set("page", String(page));
    if (pageSize !== 20) sp.set("pageSize", String(pageSize));
    router.replace(`/modules/settings/users?${sp.toString()}`);
  }, [router, orgId, q, slotFilter, page, pageSize]);

  /* ----------------------- Load roles/users ---------------------- */
  React.useEffect(() => {
    if (!orgId) return;
    let alive = true;
    (async () => {
      try {
        setRolesErr(null);
        const res = await getJSON<RolesResponse>(
          `/api/org/roles?orgId=${orgId}`
        );
        if (!alive) return;
        // Keep any UI __open flag when refreshing
        setRolesRes((prev) => {
          if (!prev) return res;
          const open = new Map(prev.slots.map((s) => [s.slot, !!s.__open]));
          return {
            ...res,
            slots: res.slots.map((s) => ({ ...s, __open: open.get(s.slot) })),
          };
        });
      } catch (e: any) {
        setRolesErr(e?.message || "Failed to load roles.");
        setRolesRes(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [orgId]);

  const usersUrl = React.useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("orgId", orgId);
    if (debouncedQ) sp.set("q", debouncedQ);
    if (slotFilter) sp.set("slot", slotFilter);
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    return `/api/org/users?${sp.toString()}`;
  }, [orgId, debouncedQ, slotFilter, page, pageSize]);

  React.useEffect(() => {
    if (!orgId) return;
    let alive = true;
    (async () => {
      try {
        setUsersErr(null);
        const res = await getJSON<UsersResponse>(usersUrl);
        if (!alive) return;
        setUsersRes(res);
      } catch (e: any) {
        setUsersErr(e?.message || "Failed to load users.");
        setUsersRes(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [orgId, usersUrl]);

  /* ----------------------- Users handlers ----------------------- */
  async function onChangeUserSlot(userId: string, newSlotStr: string) {
    const newSlot = Number(newSlotStr) || 0;
    if (!Number.isInteger(newSlot) || newSlot < 1 || newSlot > 10) return;
    setPendingUser((m) => ({ ...m, [userId]: true }));
    const prev = usersRes;
    setUsersRes((res) =>
      res
        ? {
            ...res,
            items: res.items.map((u) =>
              u.id === userId ? { ...u, slot: newSlot } : u
            ),
          }
        : res
    );
    try {
      await patchJSON(
        `/api/org/users/${encodeURIComponent(userId)}?orgId=${orgId}`,
        {
          slot: newSlot,
        }
      );
    } catch {
      setUsersRes(prev ?? null);
    } finally {
      setPendingUser((m) => ({ ...m, [userId]: false }));
    }
  }

  async function onRemoveUser(userId: string, display: string) {
    if (!window.confirm(`Remove "${display}" from this organization?`)) return;
    setPendingUser((m) => ({ ...m, [userId]: true }));
    const prev = usersRes;
    setUsersRes((res) =>
      res
        ? {
            ...res,
            items: res.items.filter((u) => u.id !== userId),
            total: res.total - 1,
          }
        : res
    );
    try {
      await patchJSON(
        `/api/org/users/${encodeURIComponent(userId)}?orgId=${orgId}`,
        { slot: null }
      );
    } catch {
      setUsersRes(prev ?? null);
    } finally {
      setPendingUser((m) => ({ ...m, [userId]: false }));
    }
  }

  /* ----------------------- Roles handlers ----------------------- */
  function scheduleAutosave(slot: number) {
    clearTimeout(autosaveTimers.current[slot]);
    autosaveTimers.current[slot] = setTimeout(() => flushSave(slot), 600);
  }

  async function patchSlot(slot: number, update: SlotUpdate) {
    if (!rolesRes) return;
    setSaving((m) => ({ ...m, [slot]: true }));
    try {
      const res = await patchJSON<RolesResponse>(`/api/org/roles`, {
        orgId,
        updates: { [String(slot)]: update },
      });
      // keep which panels are open
      setRolesRes((prev) => {
        const open = new Map(
          (prev?.slots ?? []).map((s) => [s.slot, !!s.__open])
        );
        return {
          ...res,
          slots: res.slots.map((s) => ({ ...s, __open: open.get(s.slot) })),
        };
      });
      setSavedAt((m) => ({ ...m, [slot]: Date.now() }));
      setTimeout(() => {
        setSavedAt((m) => {
          const c = { ...m };
          delete c[slot];
          return c;
        });
      }, 5000);
    } finally {
      setSaving((m) => ({ ...m, [slot]: false }));
    }
  }

  /** debounced “flush” after label/active/perm edits */
  function flushSave(slot: number) {
    // label/active are sent immediately as we edit; permissions send per click.
    // This function exists to keep the “Saving…” indicator consistent when typing.
  }

  function onRename(slot: number, label: string) {
    // optimistic UI
    setRolesRes((prev) => {
      if (!prev) return prev;
      const copy = { ...prev, slots: prev.slots.map((s) => ({ ...s })) };
      const s = copy.slots.find((x) => x.slot === slot);
      if (s) s.label = label;
      return copy;
    });
    scheduleAutosave(slot);
    void patchSlot(slot, { label: label.trim().slice(0, 80) });
  }

  function onToggleActive(slot: number, next: boolean) {
    setRolesRes((prev) => {
      if (!prev) return prev;
      const copy = { ...prev, slots: prev.slots.map((s) => ({ ...s })) };
      const s = copy.slots.find((x) => x.slot === slot);
      if (s) s.isActive = next;
      return copy;
    });
    scheduleAutosave(slot);
    void patchSlot(slot, { isActive: next });
  }

  function onToggleBookable(slot: number, next: boolean) {
    // optimistic: flip both keys locally
    setRolesRes((prev) => {
      if (!prev) return prev;
      const copy = { ...prev, slots: prev.slots.map((s) => ({ ...s })) };
      const i = copy.slots.findIndex((x) => x.slot === slot);
      if (i >= 0) {
        let cur = copy.slots[i];
        for (const k of BOOKABLE_KEYS) cur = mutateSlotEffective(cur, k, next);
        copy.slots[i] = cur;
      }
      return copy;
    });
    void patchSlot(slot, {
      bookable: next,
      overrides: BOOKABLE_KEYS.map((k) => ({ key: k, allowed: next })),
    });
  }

  function onTogglePerm(slotNum: number, key: string, next: boolean) {
    // optimistic
    setRolesRes((prev) => {
      if (!prev) return prev;
      const copy = { ...prev, slots: prev.slots.map((s) => ({ ...s })) };
      const i = copy.slots.findIndex((s) => s.slot === slotNum);
      if (i >= 0) copy.slots[i] = mutateSlotEffective(copy.slots[i], key, next);
      return copy;
    });
    void patchSlot(slotNum, { overrides: [{ key, allowed: next }] });
  }

  /* ------------------------- Rendering -------------------------- */
  const activeSlots = React.useMemo(
    () => (rolesRes?.slots ?? []).filter((s) => s.isActive),
    [rolesRes]
  );
  const totalPages =
    usersRes && usersRes.pageSize > 0
      ? Math.max(1, Math.ceil(usersRes.total / usersRes.pageSize))
      : 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users &amp; Roles</h1>
        {rolesRes?.apiVersion && (
          <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
            API {rolesRes.apiVersion}
          </span>
        )}
      </div>

      {/* ============================== Users ============================== */}
      <div className="rounded-xl border bg-white">
        <button
          onClick={() => setUsersOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 rounded-t-xl px-4 py-3 text-left"
          aria-expanded={usersOpen}
        >
          <span className="text-lg font-medium">Users</span>
          <span className="text-sm opacity-70">
            {usersOpen ? "Hide" : "Show"}
          </span>
        </button>

        {usersOpen && (
          <div className="space-y-4 px-4 pb-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="sr-only">Search</span>
                <input
                  value={q}
                  onChange={(e) => {
                    setPage(1);
                    setQ(e.target.value);
                  }}
                  className="h-9 w-72 rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Search name or email…"
                />
              </label>

              <label className="flex items-center gap-2 text-sm">
                Role
                <select
                  value={slotFilter}
                  onChange={(e) => {
                    setPage(1);
                    setSlotFilter(e.target.value);
                  }}
                  className="h-9 w-52 rounded-md border bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All</option>
                  {activeSlots.map((s) => (
                    <option key={s.slot} value={s.slot}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ml-auto flex items-center gap-2 text-sm">
                Page size
                <select
                  value={String(pageSize)}
                  onChange={(e) => {
                    setPage(1);
                    setPageSize(Number(e.target.value) || 20);
                  }}
                  className="h-9 w-32 rounded-md border bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {[10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Invite */}
            {!!rolesRes && (
              <InviteForm
                orgId={rolesRes.orgId}
                activeSlots={activeSlots}
                onCreated={async () => {
                  // refresh users list after invite
                  try {
                    const res = await getJSON<UsersResponse>(usersUrl);
                    setUsersRes(res);
                  } catch {}
                }}
              />
            )}

            {/* Users list */}
            {!usersRes && !usersErr ? (
              <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                Loading…
              </div>
            ) : usersErr ? (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                {usersErr}
              </div>
            ) : usersRes!.items.length === 0 ? (
              <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                No members found. Try adjusting filters.
              </div>
            ) : (
              <>
                <div className="text-sm">{usersRes!.total} users</div>
                <div className="space-y-3">
                  {usersRes!.items.map((u) => {
                    const isBusy = !!pendingUser[u.id];
                    return (
                      <div
                        key={u.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {u.name || "—"}
                          </div>
                          <div className="truncate text-sm text-gray-700">
                            {u.email}
                          </div>
                        </div>

                        {/* One dropdown showing current role (only active roles; no numeric prefixes) */}
                        <select
                          aria-label="Change role"
                          disabled={isBusy}
                          className={clsx(
                            "h-9 w-52 rounded-md border bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-blue-500",
                            isBusy && "cursor-not-allowed opacity-60"
                          )}
                          value={u.slot ? String(u.slot) : ""}
                          onChange={(e) =>
                            onChangeUserSlot(u.id, e.target.value)
                          }
                        >
                          <option value="">Select role</option>
                          {activeSlots.map((s) => (
                            <option key={s.slot} value={s.slot}>
                              {s.label}
                            </option>
                          ))}
                        </select>

                        <button
                          onClick={() => onRemoveUser(u.id, u.name || u.email)}
                          disabled={isBusy}
                          className={clsx(
                            "h-9 rounded-md border px-3 text-sm",
                            isBusy
                              ? "cursor-not-allowed opacity-60"
                              : "hover:bg-gray-50"
                          )}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {usersRes!.items.length > 0 && (
                  <div className="flex items-center justify-center gap-4 pt-2 text-sm">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className={clsx(
                        "h-9 rounded-md border px-3",
                        page <= 1
                          ? "cursor-not-allowed opacity-50"
                          : "hover:bg-gray-50"
                      )}
                    >
                      Previous
                    </button>
                    <span>
                      Page {page} of {totalPages}
                    </span>
                    <button
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={page >= totalPages}
                      className={clsx(
                        "h-9 rounded-md border px-3",
                        page >= totalPages
                          ? "cursor-not-allowed opacity-50"
                          : "hover:bg-gray-50"
                      )}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ============================= Roles ============================= */}
      <div className="mt-6 rounded-xl border bg-white">
        <button
          onClick={() => setRolesOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 rounded-t-xl px-4 py-3 text-left"
          aria-expanded={rolesOpen}
        >
          <span className="text-lg font-medium">Roles management</span>
          <span className="text-sm opacity-70">
            {rolesOpen ? "Hide" : "Show"}
          </span>
        </button>

        {rolesOpen && (
          <div className="space-y-4 px-4 pb-4">
            {!rolesRes && !rolesErr ? (
              <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                Loading…
              </div>
            ) : rolesErr ? (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                {rolesErr}
              </div>
            ) : (
              <>
                {rolesRes!.slots.map((slot) => {
                  const isAdmin = slot.slot === 1;
                  const savingNow = !!saving[slot.slot];
                  const savedRecently = !!savedAt[slot.slot];

                  return (
                    <div key={slot.slot} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="w-28 shrink-0 text-sm text-gray-600">{`Role ${slot.slot}`}</div>

                        <input
                          value={slot.label}
                          onChange={(e) => onRename(slot.slot, e.target.value)}
                          className="h-9 w-full rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                          aria-label="Role label"
                        />

                        {!isAdmin && (
                          <>
                            <label className="ml-auto flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="h-5 w-5"
                                checked={slot.isActive}
                                onChange={(e) =>
                                  onToggleActive(slot.slot, e.target.checked)
                                }
                              />
                              Active
                            </label>

                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="h-5 w-5"
                                checked={slot.bookable}
                                onChange={(e) =>
                                  onToggleBookable(slot.slot, e.target.checked)
                                }
                              />
                              Bookable
                            </label>

                            <button
                              onClick={() =>
                                setRolesRes((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        slots: prev.slots.map((s) =>
                                          s.slot === slot.slot
                                            ? { ...s, __open: !s.__open }
                                            : s
                                        ),
                                      }
                                    : prev
                                )
                              }
                              className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
                            >
                              Permissions
                            </button>
                          </>
                        )}

                        <div className="ml-2 text-sm text-gray-600">
                          {savingNow ? "Saving…" : savedRecently ? "Saved" : ""}
                        </div>
                      </div>

                      {!isAdmin && slot.__open && (
                        <div className="mt-3 rounded-md border bg-gray-50 p-3">
                          <p className="mb-2 text-sm text-gray-700">
                            Toggle ON (Allow) or OFF (Deny). Changes auto-save.
                          </p>
                          <div className="grid grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-3">
                            {rolesRes!.permissionKeys.map((k) => {
                              const checked = overrideFirstChecked(slot, k);
                              return (
                                <label
                                  key={k}
                                  className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-gray-200"
                                >
                                  <span className="mr-3 truncate">{k}</span>
                                  <input
                                    type="checkbox"
                                    className="h-5 w-5"
                                    checked={checked}
                                    onChange={(e) =>
                                      onTogglePerm(
                                        slot.slot,
                                        k,
                                        e.target.checked
                                      )
                                    }
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

                <p className="pt-1 text-xs text-gray-500">
                  Role #1 (Admin) is always active and has all permissions. You
                  can rename it, but you can’t disable it or edit its
                  permissions.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   Invite form (restored)
   ========================================================================= */
function InviteForm({
  orgId,
  activeSlots,
  onCreated,
}: {
  orgId: string;
  activeSlots: RoleSlot[];
  onCreated: () => Promise<void> | void;
}) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [slot, setSlot] = React.useState<string>(() => {
    const first = activeSlots.find((s) => s.slot !== 1);
    return String(first?.slot ?? activeSlots[0]?.slot ?? 2);
  });
  React.useEffect(() => {
    const first = activeSlots.find((s) => s.slot !== 1);
    setSlot(String(first?.slot ?? activeSlots[0]?.slot ?? 2));
  }, [activeSlots]);

  const [busy, setBusy] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);

  function deepFindInviteLink(obj: any): string | null {
    if (!obj) return null;
    const q: any[] = [obj];
    while (q.length) {
      const cur = q.shift();
      if (
        typeof cur === "string" &&
        /^https?:\/\//i.test(cur) &&
        /invite|accept|join|signup/i.test(cur)
      ) {
        return cur;
      }
      if (cur && typeof cur === "object") {
        for (const [k, v] of Object.entries(cur)) {
          if (
            typeof v === "string" &&
            /^https?:\/\//i.test(v) &&
            /invite|accept|join|signup/i.test(v)
          ) {
            return v;
          }
          if (v && typeof v === "object") q.push(v);
        }
      }
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) return;
    setBusy(true);
    setInviteLink(null);
    try {
      const res: any = await postJSON(`/api/org/users?orgId=${orgId}`, {
        email: email.trim().toLowerCase(),
        name: name.trim() || undefined,
        slot: Number(slot) || 2,
      });
      const link =
        deepFindInviteLink(res) ||
        deepFindInviteLink(res?.item) ||
        res?.inviteUrl ||
        res?.inviteLink ||
        res?.url ||
        null;
      if (link) setInviteLink(link);
      setEmail("");
      setName("");
      await onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <label className="text-sm">
        Email*
        <input
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 h-9 w-full rounded-md border px-3 outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="alex@company.com"
        />
      </label>
      <label className="text-sm">
        Name (optional)
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 h-9 w-full rounded-md border px-3 outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Alex Example"
        />
      </label>
      <label className="text-sm">
        Role
        <select
          value={slot}
          onChange={(e) => setSlot(e.target.value)}
          className="mt-1 h-9 w-full rounded-md border bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500"
        >
          {activeSlots.map((s) => (
            <option key={s.slot} value={s.slot}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end">
        <button
          disabled={busy}
          className={clsx(
            "h-9 w-full rounded-md border px-3 text-sm",
            busy ? "cursor-not-allowed opacity-50" : "hover:bg-gray-50"
          )}
        >
          {busy ? "Creating…" : "Create user"}
        </button>
      </div>

      {inviteLink && (
        <div className="col-span-full flex items-center gap-2">
          <a
            className="truncate text-blue-700 underline"
            href={inviteLink}
            target="_blank"
          >
            {inviteLink}
          </a>
          <button
            type="button"
            className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(inviteLink);
              } catch {}
            }}
          >
            Copy
          </button>
        </div>
      )}
    </form>
  );
}
