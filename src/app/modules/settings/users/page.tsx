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
  isInvited?: boolean | null;
  invited?: boolean | null;
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
  effective: string[];
  template: string[];
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

/** mini toast */
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
        aria-live="polite"
        className={clsx(
          "fixed right-4 top-4 z-50 rounded-md px-3 py-2 text-sm shadow",
          variant === "ok"
            ? "bg-emerald-50 text-emerald-700"
            : "bg-rose-50 text-rose-700"
        )}
      >
        {msg}
      </div>
    ) : null,
  };
}

/** localStorage-backed boolean hook (SSR-safe) */
function useStoredBoolean(key: string, def: boolean) {
  // Use the server-rendered default for the first client render.
  const [v, setV] = React.useState<boolean>(def);

  // After mount, read from localStorage and then persist on changes.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      setV(raw == null ? def : raw === "1");
    } catch {
      // ignore read errors (private mode etc.)
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(key, v ? "1" : "0");
    } catch {
      // ignore write errors
    }
  }, [key, v]);

  return [v, setV] as const;
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

  // collapsibles
  const [usersOpen, setUsersOpen] = useStoredBoolean("usersSectionOpen", true);
  const [rolesOpen, setRolesOpen] = useStoredBoolean("rolesSectionOpen", false);

  // filters
  const [q, setQ] = React.useState<string>(searchParams.get("q") || "");
  const [slot, setSlot] = React.useState<string>(
    searchParams.get("slot") || ""
  );
  const [page, setPage] = React.useState<number>(
    Number(searchParams.get("page") || "1") || 1
  );
  const [pageSize, setPageSize] = React.useState<number>(
    Number(searchParams.get("pageSize") || "20") || 20
  );
  const debouncedQ = useDebouncedValue(q, 250);

  // users data
  const [items, setItems] = React.useState<UserItem[] | null>(null);
  const [total, setTotal] = React.useState<number>(0);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Record<string, boolean>>({});

  // roles data (also gate)
  const [rolesRes, setRolesRes] = React.useState<RolesResponse | null>(null);
  const [permissionKeys, setPermissionKeys] = React.useState<
    readonly string[] | null
  >(null);
  const [rolesError, setRolesError] = React.useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = React.useState<Map<number, RoleDraft>>(
    new Map()
  );
  const [permOpen, setPermOpen] = React.useState<Record<number, boolean>>({});
  const [savingMap, setSavingMap] = React.useState<Record<number, boolean>>({});
  const [savedAt, setSavedAt] = React.useState<Record<number, number>>({});
  const autosaveTimers = React.useRef<Record<number, any>>({});

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
          const perm: Record<string, boolean> = {};
          for (const k of data.permissionKeys)
            perm[k] = s.effective.includes(k);
          map.set(s.slot, {
            slot: s.slot,
            label: s.label,
            isActive: s.isActive,
            perm,
          });
        }
        setRoleDrafts(map);
      } catch (e: any) {
        setRolesRes(null);
        setPermissionKeys(null);
        setRoleDrafts(new Map());
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

  // API URL for users
  const apiUrl = React.useMemo(() => {
    const sp = new URLSearchParams();
    if (orgId) sp.set("orgId", orgId);
    if (debouncedQ) sp.set("q", debouncedQ);
    if (slot) sp.set("slot", slot);
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    return `/api/org/users?${sp.toString()}`;
  }, [orgId, debouncedQ, slot, page, pageSize]);

  // sync URL
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
  const refreshUsers = React.useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getJSON<UsersResponse>(apiUrl);
      setItems(data.items ?? []);
      setTotal(Number(data.total ?? 0));
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : "Failed to load users.";
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
      setLoading(false);
    }
  }, [apiUrl, orgId]);

  React.useEffect(() => {
    if (!orgId) return;
    let alive = true;
    (async () => {
      await refreshUsers();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [orgId, apiUrl, refreshUsers]);

  // helpers
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeSlots = React.useMemo(
    () => (rolesRes?.slots ?? []).filter((s) => s.isActive),
    [rolesRes]
  );
  const getLabelForSlot = React.useCallback(
    (s: number | null | undefined) => {
      if (!s) return "—";
      const entry = (rolesRes?.slots ?? []).find((x) => x.slot === s);
      return entry?.label ?? `Role ${s}`;
    },
    [rolesRes]
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
  function setBookable(slotNum: number, on: boolean) {
    const d = draftFor(slotNum);
    const next = { ...d.perm };
    for (const k of BOOKABLE_KEYS) next[k] = on;
    setRoleDrafts((m) => new Map(m).set(slotNum, { ...d, perm: next }));
    scheduleAutosave(slotNum);
  }
  function isBookable(d: RoleDraft): boolean {
    return BOOKABLE_KEYS.every((k) => d.perm[k] === true);
  }

  /** AUTOSAVE (debounced per slot) + Saved-after-5s logic */
  function scheduleAutosave(slotNum: number) {
    clearTimeout(autosaveTimers.current[slotNum]);
    autosaveTimers.current[slotNum] = setTimeout(() => saveRole(slotNum), 600);
  }
  async function saveRole(slotNum: number) {
    if (!orgId) return;
    const d = draftFor(slotNum);
    const o = originalFor(slotNum);
    if (!o) return;

    setSavingMap((s) => ({ ...s, [slotNum]: true }));
    try {
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

      // mark saved and clear after 5s
      setSavedAt((m) => ({ ...m, [slotNum]: Date.now() }));
      setTimeout(() => {
        setSavedAt((m) => {
          const copy = { ...m };
          if (copy[slotNum]) delete copy[slotNum];
          return copy;
        });
      }, 5000);
    } catch (e: any) {
      toast.showErr(e?.message || "Failed to save role.");
    } finally {
      setSavingMap((s) => ({ ...s, [slotNum]: false }));
    }
  }

  async function onChangeSlot(userId: string, newSlotStr: string) {
    if (!orgId) return;
    const newSlot = Number(newSlotStr) || 0;
    if (!Number.isInteger(newSlot) || newSlot < 1 || newSlot > 10) {
      toast.showErr("Invalid role.");
      return;
    }
    setPending((p) => ({ ...p, [userId]: true }));
    const prev = items ?? [];
    setItems((list) =>
      (list ?? []).map((x) => (x.id === userId ? { ...x, slot: newSlot } : x))
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

  /** ------------------------ Create user (invite) ------------------------ */
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteName, setInviteName] = React.useState("");
  const defaultInviteSlot = React.useMemo(() => {
    const firstActive = (rolesRes?.slots ?? []).find(
      (s) => s.slot !== 1 && s.isActive
    )?.slot;
    return String(firstActive ?? 2);
  }, [rolesRes]);
  const [inviteSlot, setInviteSlot] = React.useState<string>(defaultInviteSlot);
  React.useEffect(() => setInviteSlot(defaultInviteSlot), [defaultInviteSlot]);
  const [inviteBusy, setInviteBusy] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);

  // deep search for any invite-like link returned by backend
  function deepFindInviteLink(obj: any): string | null {
    if (!obj) return null;
    const queue: any[] = [obj];
    const keyHints = [
      "invite",
      "invitation",
      "magic",
      "join",
      "signup",
      "register",
      "accept",
      "link",
      "url",
    ];
    while (queue.length) {
      const cur = queue.shift();
      if (typeof cur === "string") {
        if (
          /^https?:\/\//i.test(cur) &&
          /invite|signup|join|magic|register|accept/i.test(cur)
        )
          return cur;
      } else if (cur && typeof cur === "object") {
        for (const [k, v] of Object.entries(cur)) {
          if (typeof v === "string") {
            if (
              /^https?:\/\//i.test(v) &&
              keyHints.some(
                (h) =>
                  k.toLowerCase().includes(h) || v.toLowerCase().includes(h)
              )
            ) {
              return v;
            }
          } else if (v && typeof v === "object") {
            queue.push(v);
          }
        }
      }
    }
    return null;
  }

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast.showErr("Please enter a valid email.");
      return;
    }
    const slotNum = Number(inviteSlot) || 0;
    if (!Number.isInteger(slotNum) || slotNum < 1 || slotNum > 10) {
      toast.showErr("Please choose a valid role.");
      return;
    }

    setInviteBusy(true);
    setInviteLink(null);
    try {
      const res: any = await postJSON(
        `/api/org/users?orgId=${encodeURIComponent(orgId)}`,
        {
          email,
          name: inviteName.trim() || undefined,
          slot: slotNum,
        }
      );
      const link =
        deepFindInviteLink(res) ||
        deepFindInviteLink(res?.item) ||
        res?.inviteUrl ||
        res?.inviteLink ||
        res?.joinUrl ||
        res?.url ||
        null;

      if (link) setInviteLink(link);

      toast.showOk("User created.");
      setInviteEmail("");
      setInviteName("");
      await refreshUsers();
      if (!link) {
        toast.showOk("No invite link returned by API.");
      }
    } catch (e: any) {
      toast.showErr(e?.message || "Failed to create user.");
    } finally {
      setInviteBusy(false);
    }
  }

  // common width so dropdowns line up everywhere
  const SELECT_W =
    "h-9 w-52 rounded-md border bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500";

  // ------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {toast.node}

      <header className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          Users &amp; Roles
        </h1>
      </header>

      {!orgId ? (
        <>
          <p className="text-sm text-gray-700">
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
          {/* ----------------------------- Users (collapsible) ----------------------------- */}
          <section className="mb-6 rounded-xl border">
            <button
              onClick={() => setUsersOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 rounded-t-xl px-4 py-3 text-left"
              aria-expanded={usersOpen}
            >
              <span className="text-xl font-semibold">Users</span>
              <span className="text-sm text-gray-500">
                {usersOpen ? "Hide" : "Show"}
              </span>
            </button>
            {usersOpen && (
              <div className="space-y-5 border-t p-4">
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2">
                    <span className="w-40 text-sm text-gray-600">
                      Search (name or email)
                    </span>
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
                  </label>
                  <div id="search-hint" className="sr-only">
                    Type to filter by name or email
                  </div>

                  <label className="flex items-center gap-2">
                    <span className="w-24 text-sm text-gray-600">
                      Page size
                    </span>
                    <select
                      value={String(pageSize)}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 20;
                        setPage(1);
                        setPageSize(v);
                      }}
                      className={SELECT_W}
                    >
                      {[10, 20, 50].map((n) => (
                        <option key={n} value={String(n)}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex items-center gap-2">
                    <span className="w-24 text-sm text-gray-600">
                      Role slot
                    </span>
                    <select
                      value={slot}
                      onChange={(e) => {
                        setPage(1);
                        setSlot(e.target.value);
                      }}
                      className={SELECT_W}
                    >
                      <option value="">All roles</option>
                      {activeSlots.map((s) => (
                        <option key={s.slot} value={String(s.slot)}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Create user (invite) — only when roles are readable (implies manage rights) */}
                {!!rolesRes && !!permissionKeys && (
                  <form
                    onSubmit={onInvite}
                    className="grid grid-cols-1 gap-3 rounded-xl border p-4 md:grid-cols-4"
                    aria-label="Create a user"
                  >
                    <div className="flex flex-col">
                      <label className="mb-1 text-sm text-gray-600">
                        Email*
                      </label>
                      <input
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="h-9 rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g. alex@company.com"
                      />
                    </div>

                    <div className="flex flex-col">
                      <label className="mb-1 text-sm text-gray-600">
                        Name (optional)
                      </label>
                      <input
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        className="h-9 rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Alex Example"
                      />
                    </div>

                    <div className="flex flex-col">
                      <label className="mb-1 text-sm text-gray-600">
                        Role slot
                      </label>
                      <select
                        value={inviteSlot}
                        onChange={(e) => setInviteSlot(e.target.value)}
                        className={SELECT_W}
                      >
                        {activeSlots.map((s) => (
                          <option key={s.slot} value={String(s.slot)}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={inviteBusy}
                        className={clsx(
                          "h-9 rounded-md border px-3 text-sm",
                          inviteBusy
                            ? "cursor-not-allowed opacity-50"
                            : "hover:bg-gray-50"
                        )}
                      >
                        {inviteBusy ? "Creating…" : "Create user"}
                      </button>
                    </div>

                    {/* Copyable invite link (if backend returns it) */}
                    {inviteLink && (
                      <div className="col-span-full -mt-1 flex items-center gap-2 text-sm">
                        <input
                          readOnly
                          value={inviteLink}
                          className="h-9 w-full rounded-md border border-gray-300 px-3"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(inviteLink);
                              toast.showOk("Invite link copied.");
                            } catch {
                              /* no-op */
                            }
                          }}
                          className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
                        >
                          Copy
                        </button>
                      </div>
                    )}
                  </form>
                )}

                {/* Summary / states */}
                <div className="text-sm text-gray-700">
                  {loading ? (
                    <span>Loading…</span>
                  ) : error ? (
                    <span className="text-rose-700">{error}</span>
                  ) : (
                    <span>{total} users</span>
                  )}
                </div>

                {!loading && !error && (items?.length ?? 0) === 0 && (
                  <div className="rounded-lg border p-4 text-sm text-gray-600">
                    No members found. Try clearing filters.
                  </div>
                )}

                {/* List */}
                <div className="space-y-3">
                  {(items ?? []).map((r) => {
                    const isBusy = !!pending[r.id];
                    const currentSlot = r.slot ?? undefined;

                    return (
                      <div
                        key={r.id}
                        className="grid grid-cols-1 gap-4 rounded-xl border p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {r.name || "—"}
                          </div>
                          <div className="truncate text-xs text-gray-500">
                            ID: {r.id}
                          </div>
                        </div>

                        <a
                          href={`mailto:${r.email}`}
                          className="truncate text-blue-600 hover:underline"
                          title={r.email}
                        >
                          {r.email}
                        </a>

                        {/* Single field: dropdown pre-selected to current role */}
                        <div className="flex items-center gap-3 justify-end">
                          <select
                            onChange={(e) => onChangeSlot(r.id, e.target.value)}
                            className={clsx(
                              SELECT_W,
                              isBusy && "cursor-not-allowed opacity-50"
                            )}
                            value={currentSlot ? String(currentSlot) : ""}
                            aria-label="Change role"
                            disabled={isBusy}
                          >
                            <option value="" disabled>
                              Select role
                            </option>
                            {activeSlots.map((s) => (
                              <option key={s.slot} value={String(s.slot)}>
                                {s.label}
                              </option>
                            ))}
                          </select>

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
                <div className="mt-2 flex items-center justify-between">
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

                  <div className="text-sm text-gray-600">
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
              </div>
            )}
          </section>

          {/* ----------------------------- Roles (collapsible) ----------------------------- */}
          <section className="rounded-xl border">
            <button
              onClick={() => setRolesOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 rounded-t-xl px-4 py-3 text-left"
              aria-expanded={rolesOpen}
            >
              <span className="text-xl font-semibold">Roles management</span>
              <span className="text-sm text-gray-500">
                {rolesOpen ? "Hide" : "Show"}
              </span>
            </button>

            {rolesOpen && (
              <div className="space-y-6 border-t p-4">
                {!rolesRes || !permissionKeys ? (
                  <div className="rounded-lg border p-4 text-sm">
                    {rolesError ? (
                      <span className="text-rose-700">{rolesError}</span>
                    ) : (
                      <span>Loading roles…</span>
                    )}
                  </div>
                ) : (
                  <>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map(
                      (slotNum) => {
                        const orig = originalFor(slotNum) || {
                          slot: slotNum,
                          label: `Role ${slotNum}`,
                          isActive: true,
                          effective: [],
                          template: [],
                          overrides: [],
                        };
                        const draft = draftFor(slotNum);
                        const isAdmin = slotNum === 1;
                        const bookableOn = isBookable(draft);
                        const saving = !!savingMap[slotNum];
                        const savedRecently = !!savedAt[slotNum];

                        return (
                          <div key={slotNum} className="rounded-xl border p-4">
                            <div className="mb-3 flex items-center gap-3">
                              <label className="flex w-full items-center gap-2">
                                <span className="w-20 text-sm text-gray-600">{`Role ${slotNum}`}</span>
                                <input
                                  value={draft.label}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setRoleDrafts((m) =>
                                      new Map(m).set(slotNum, {
                                        ...draft,
                                        label: v,
                                      })
                                    );
                                    scheduleAutosave(slotNum);
                                  }}
                                  className="h-9 w-full rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </label>

                              {!isAdmin && (
                                <>
                                  <label className="flex items-center gap-2 text-sm">
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
                                        scheduleAutosave(slotNum);
                                      }}
                                      className="h-5 w-5"
                                    />
                                    Active
                                  </label>

                                  <label className="flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={bookableOn}
                                      onChange={(e) =>
                                        setBookable(slotNum, e.target.checked)
                                      }
                                      className="h-5 w-5"
                                    />
                                    Bookable
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
                                    Permissions
                                  </button>
                                </>
                              )}

                              <span
                                className={clsx(
                                  "ml-auto text-xs",
                                  saving ? "text-amber-600" : "text-gray-500"
                                )}
                              >
                                {saving
                                  ? "Saving…"
                                  : savedRecently
                                  ? "Saved"
                                  : ""}
                              </span>
                            </div>

                            {/* Permissions grid (toggles) */}
                            {!isAdmin && permOpen[slotNum] && (
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                <p className="col-span-full mb-1 text-sm text-gray-600">
                                  Toggle ON (Allow) or OFF (Deny). Changes
                                  auto-save.
                                </p>
                                {permissionKeys.map((k) => {
                                  const on = !!draft.perm[k];
                                  return (
                                    <label
                                      key={k}
                                      className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                                    >
                                      <span className="truncate">{k}</span>
                                      <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={(e) => {
                                          const v = e.target.checked;
                                          const next = {
                                            ...draft.perm,
                                            [k]: v,
                                          };
                                          setRoleDrafts((m) =>
                                            new Map(m).set(slotNum, {
                                              ...draft,
                                              perm: next,
                                            })
                                          );
                                          scheduleAutosave(slotNum);
                                        }}
                                        className="h-5 w-5"
                                        aria-label={`Allow ${k}`}
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }
                    )}

                    <p className="text-sm text-gray-600">
                      Role #1 (Admin) is always active and has all permissions.
                      You can rename it, but you can’t disable it or edit its
                      permissions.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
