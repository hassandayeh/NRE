"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** ─────────────────────────────────────────────────────────────────────────────
 * Types (resilient to API shape)
 * ────────────────────────────────────────────────────────────────────────────*/
type UserItem = {
  id: string;
  name: string | null;
  email: string;
  slot: number | null;
  roleLabel?: string | null;
  roleActive?: boolean | null;
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
  overrides: { key: string; allowed: boolean }[];
};
type RolesResponse = {
  ok?: boolean;
  orgId: string;
  permissionKeys: readonly string[];
  slots: RoleSlot[];
};

type PermState = "inherit" | "allow" | "deny";
type RoleDraft = {
  slot: number;
  label: string;
  isActive: boolean;
  // permission key -> tri-state
  permState: Record<string, PermState>;
};

/** ─────────────────────────────────────────────────────────────────────────────
 * Utils
 * ────────────────────────────────────────────────────────────────────────────*/
function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced as T;
}

function CopyField(props: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="mt-2">
      <label className="block text-sm font-medium text-gray-700">
        {props.label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          readOnly
          value={props.value}
          className="h-9 flex-1 rounded-md border border-gray-300 px-3 font-mono text-xs text-gray-700"
        />
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(props.value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
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
        role="status"
        className={classNames(
          "fixed right-4 top-4 z-50 rounded-md px-3 py-2 text-sm shadow",
          variant === "ok" ? "bg-green-600 text-white" : "bg-red-600 text-white"
        )}
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

/** ── Robust orgId detection (org-only, no user ids) */
function looksLikeId(v: unknown) {
  return typeof v === "string" && v.length >= 18; // seeded ids look long (cmg…)
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
async function tryFetchJson(url: string) {
  try {
    return await getJSON<any>(url);
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
    const data = await tryFetchJson(url);
    const found = parseOrgFromPayload(data);
    if (found) {
      if (typeof window !== "undefined")
        window.localStorage.setItem("orgId", found);
      return found;
    }
  }
  const sess = await tryFetchJson("/api/auth/session");
  const fromSess =
    (sess?.user && parseOrgFromPayload(sess.user)) ||
    parseOrgFromPayload(sess) ||
    sess?.user?.orgId ||
    sess?.user?.org?.id;
  if (looksLikeId(fromSess)) {
    if (typeof window !== "undefined")
      window.localStorage.setItem("orgId", fromSess);
    return fromSess;
  }
  return null;
}

/** ─────────────────────────────────────────────────────────────────────────────
 * Page
 * ────────────────────────────────────────────────────────────────────────────*/
export default function UsersAndRolesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  // ── Org context
  const orgIdFromUrl = (searchParams.get("orgId") || "").trim() || null;
  const [orgId, setOrgId] = React.useState<string | null>(orgIdFromUrl);
  const [resolvingOrg, setResolvingOrg] = React.useState<boolean>(
    !orgIdFromUrl
  );

  // Resolve org automatically if not present in URL
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

  // ── Filters (URL-driven state)
  const [q, setQ] = React.useState(searchParams.get("q") || "");
  const [slot, setSlot] = React.useState(searchParams.get("slot") || "");
  const [page, setPage] = React.useState<number>(
    Number(searchParams.get("page") || "1") || 1
  );
  const [pageSize, setPageSize] = React.useState<number>(
    Number(searchParams.get("pageSize") || "20") || 20
  );
  const debouncedQ = useDebouncedValue(q, 300);

  // ── Users data state
  const [items, setItems] = React.useState<UserItem[] | null>(null);
  const [total, setTotal] = React.useState<number>(0);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Record<string, boolean>>({});

  // ── Roles data state (full)
  const [rolesRes, setRolesRes] = React.useState<RolesResponse | null>(null);
  const [permissionKeys, setPermissionKeys] = React.useState<
    readonly string[] | null
  >(null);
  const [roleDrafts, setRoleDrafts] = React.useState<Map<number, RoleDraft>>(
    new Map()
  );
  const [roleDirty, setRoleDirty] = React.useState<Record<number, boolean>>({});
  const [roleSaving, setRoleSaving] = React.useState<Record<number, boolean>>(
    {}
  );
  const [permOpen, setPermOpen] = React.useState<Record<number, boolean>>({});

  // Load roles once per org
  React.useEffect(() => {
    if (!orgId) return;
    let alive = true;
    (async () => {
      try {
        const data = await getJSON<RolesResponse>(
          `/api/org/roles?orgId=${encodeURIComponent(orgId)}`
        );
        if (!alive) return;
        setRolesRes(data);
        setPermissionKeys(data.permissionKeys);

        // seed drafts for tri-state
        const map = new Map<number, RoleDraft>();
        for (const s of data.slots) {
          const permState: Record<string, PermState> = {};
          for (const k of data.permissionKeys) permState[k] = "inherit";
          for (const o of s.overrides)
            permState[o.key] = o.allowed ? "allow" : "deny";
          map.set(s.slot, {
            slot: s.slot,
            label: s.label,
            isActive: s.isActive,
            permState,
          });
        }
        setRoleDrafts(map);
        setRoleDirty({});
      } catch {
        setRolesRes(null);
        setPermissionKeys(null);
        setRoleDrafts(new Map());
        setRoleDirty({});
      }
    })();
    return () => {
      alive = false;
    };
  }, [orgId]);

  // Build URL for users API
  const apiUrl = React.useMemo(() => {
    const sp = new URLSearchParams();
    if (orgId) sp.set("orgId", orgId);
    if (debouncedQ) sp.set("q", debouncedQ);
    if (slot) sp.set("slot", slot);
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    return `/api/org/users?${sp.toString()}`;
  }, [orgId, debouncedQ, slot, page, pageSize]);

  // Keep address bar in sync
  React.useEffect(() => {
    const sp = new URLSearchParams();
    if (orgId) sp.set("orgId", orgId);
    if (q) sp.set("q", q);
    if (slot) sp.set("slot", slot);
    if (page !== 1) sp.set("page", String(page));
    if (pageSize !== 20) sp.set("pageSize", String(pageSize));
    router.replace(`/modules/settings/users?${sp.toString()}`);
  }, [router, orgId, q, slot, page, pageSize]);

  // Fetch users when filters change
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

  // Pagination
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Helpers for label lookup
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

  // ── Users table actions
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

  // ── Invite
  const [showInvite, setShowInvite] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteName, setInviteName] = React.useState("");
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [inviting, setInviting] = React.useState(false);

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    if (!inviteEmail.trim()) {
      toast.showErr("Email is required.");
      return;
    }
    setInviting(true);
    setInviteLink(null);
    try {
      const resp = await postJSON<any>(
        `/api/org/users/invite?orgId=${encodeURIComponent(orgId)}`,
        { email: inviteEmail.trim(), name: inviteName.trim() || undefined }
      );
      const link: string =
        typeof resp?.link === "string"
          ? resp.link
          : typeof resp?.token === "string"
          ? `/auth/invite/accept?token=${resp.token}`
          : "";
      if (link) {
        setInviteLink(link);
        toast.showOk("Invite created.");
      } else {
        toast.showErr("Invite created, but no link was returned.");
      }
      setPage(1);
    } catch (err: any) {
      toast.showErr(err?.message || "Failed to create invite.");
    } finally {
      setInviting(false);
    }
  }

  // ── Roles: tri-state helpers
  function draftFor(slotNum: number): RoleDraft {
    const fallback: RoleDraft = {
      slot: slotNum,
      label: `Role ${slotNum}`,
      isActive: true,
      permState: Object.fromEntries(
        (permissionKeys ?? []).map((k) => [k, "inherit" as PermState])
      ),
    };
    return roleDrafts.get(slotNum) ?? fallback;
  }

  function originalFor(slotNum: number): RoleSlot | null {
    const found = rolesRes?.slots.find((s) => s.slot === slotNum) ?? null;
    return found;
  }

  // HIDE/IGNORE specific controls for role #1 (Admin)
  function isDirty(slotNum: number): boolean {
    const draft = draftFor(slotNum);
    const orig = originalFor(slotNum);
    if (!orig) return false;

    // For role #1: only the label is editable (always active, all permissions)
    if (slotNum === 1) {
      return draft.label.trim() !== orig.label;
    }

    if (draft.label.trim() !== orig.label) return true;
    if (draft.isActive !== orig.isActive) return true;

    const curOverrides = Object.entries(draft.permState)
      .filter(([, v]) => v !== "inherit")
      .map(([key, v]) => ({ key, allowed: v === "allow" }));
    const origMap = new Map(orig.overrides.map((o) => [o.key, o.allowed]));
    if (curOverrides.length !== orig.overrides.length) return true;
    for (const o of curOverrides) {
      if (origMap.get(o.key) !== o.allowed) return true;
    }
    return false;
  }

  async function saveRole(slotNum: number) {
    if (!orgId) return;
    const draft = draftFor(slotNum);
    const orig = originalFor(slotNum);
    if (!orig) return;

    // For role #1, only send label updates
    if (slotNum === 1) {
      const labelChanged = draft.label.trim() !== orig.label;
      if (!labelChanged) {
        toast.showOk("Already saved.");
        return;
      }
      setRoleSaving((s) => ({ ...s, [slotNum]: true }));
      try {
        await patchJSON(`/api/org/roles`, {
          orgId,
          updates: { [String(slotNum)]: { label: draft.label.trim() } },
        });
        toast.showOk("Role saved.");
        const data = await getJSON<RolesResponse>(
          `/api/org/roles?orgId=${encodeURIComponent(orgId)}`
        );
        setRolesRes(data);
        setPermissionKeys(data.permissionKeys);
        const map = new Map<number, RoleDraft>();
        for (const s of data.slots) {
          const permState: Record<string, PermState> = {};
          for (const k of data.permissionKeys) permState[k] = "inherit";
          for (const o of s.overrides)
            permState[o.key] = o.allowed ? "allow" : "deny";
          map.set(s.slot, {
            slot: s.slot,
            label: s.label,
            isActive: s.isActive,
            permState,
          });
        }
        setRoleDrafts(map);
        setRoleDirty((d) => ({ ...d, [slotNum]: false }));
      } catch (e: any) {
        toast.showErr(e?.message || "Failed to save role.");
      } finally {
        setRoleSaving((s) => ({ ...s, [slotNum]: false }));
      }
      return;
    }

    // Slots 2..10: full payload
    const overrides = Object.entries(draft.permState)
      .filter(([, v]) => v !== "inherit")
      .map(([key, v]) => ({ key, allowed: v === "allow" }));

    const update: {
      label?: string;
      isActive?: boolean;
      overrides?: { key: string; allowed: boolean }[];
    } = {};
    if (draft.label.trim() !== orig.label) update.label = draft.label.trim();
    if (draft.isActive !== orig.isActive) update.isActive = draft.isActive;

    const origMap = new Map(orig.overrides.map((o) => [o.key, o.allowed]));
    const changed =
      overrides.length !== orig.overrides.length ||
      overrides.some((o) => origMap.get(o.key) !== o.allowed);
    if (changed) update.overrides = overrides;

    if (!Object.keys(update).length) {
      toast.showOk("Already saved.");
      return;
    }

    setRoleSaving((s) => ({ ...s, [slotNum]: true }));
    try {
      await patchJSON(`/api/org/roles`, {
        orgId,
        updates: { [String(slotNum)]: update },
      });
      toast.showOk("Role saved.");

      // refresh roles to stay canonical
      const data = await getJSON<RolesResponse>(
        `/api/org/roles?orgId=${encodeURIComponent(orgId)}`
      );
      setRolesRes(data);
      setPermissionKeys(data.permissionKeys);

      const map = new Map<number, RoleDraft>();
      for (const s of data.slots) {
        const permState: Record<string, PermState> = {};
        for (const k of data.permissionKeys) permState[k] = "inherit";
        for (const o of s.overrides)
          permState[o.key] = o.allowed ? "allow" : "deny";
        map.set(s.slot, {
          slot: s.slot,
          label: s.label,
          isActive: s.isActive,
          permState,
        });
      }
      setRoleDrafts(map);
      setRoleDirty((d) => ({ ...d, [slotNum]: false }));
    } catch (e: any) {
      toast.showErr(e?.message || "Failed to save role.");
    } finally {
      setRoleSaving((s) => ({ ...s, [slotNum]: false }));
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────────
  if (!orgId) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-2 text-2xl font-semibold">Users &amp; Roles</h1>
        <p className="text-sm text-gray-600">
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
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      {toast.node}

      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users &amp; Roles</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (typeof window !== "undefined") {
                window.localStorage.removeItem("orgId");
              }
              location.reload();
            }}
            className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
            title="Clear cached org and re-detect"
          >
            Reset org
          </button>
          <button
            onClick={() => setShowInvite((v) => !v)}
            className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
          >
            {showInvite ? "Close" : "Create User"}
          </button>
        </div>
      </div>

      {/* Users section (collapsible open by default) */}
      <details open className="rounded-xl border bg-white">
        <summary className="cursor-pointer select-none rounded-xl px-4 py-3 text-lg font-medium">
          Users
        </summary>

        <div className="border-t px-4 py-4">
          {/* Invite panel */}
          {showInvite && (
            <form onSubmit={onInvite} className="mb-4 rounded-md border p-4">
              <h2 className="mb-2 text-base font-semibold">
                Invite a new user
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Name (optional)
                  </label>
                  <input
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={inviting}
                  className={classNames(
                    "h-9 rounded-md border px-3 text-sm",
                    inviting ? "opacity-50" : "hover:bg-gray-50"
                  )}
                >
                  {inviting ? "Creating…" : "Create invite"}
                </button>
              </div>

              {inviteLink && (
                <CopyField label="Invite link" value={inviteLink} />
              )}
            </form>
          )}

          {/* Filters */}
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="search"
                className="block text-sm font-medium text-gray-700"
              >
                Search (name or email)
              </label>
              <input
                id="search"
                value={q}
                onChange={(e) => {
                  setPage(1);
                  setQ(e.target.value);
                }}
                className="h-9 w-72 rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                aria-describedby="search-hint"
                placeholder="e.g. alice or @demo.test"
              />
              <div id="search-hint" className="mt-1 text-xs text-gray-500">
                Type to filter by name or email
              </div>
            </div>

            <div>
              <label
                htmlFor="slot"
                className="block text-sm font-medium text-gray-700"
              >
                Role slot
              </label>
              <select
                id="slot"
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
              <label
                htmlFor="pagesize"
                className="block text-sm font-medium text-gray-700"
              >
                Page size
              </label>
              <select
                id="pagesize"
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

            <div className="ml-auto text-sm text-gray-600">
              {loading ? (
                "Loading…"
              ) : error ? (
                <span className="text-red-600">{error}</span>
              ) : (
                `${total} results`
              )}
            </div>
          </div>

          {/* Table */}
          <div
            role="table"
            aria-label="Organization members"
            className="overflow-hidden rounded-md border"
          >
            <div
              role="row"
              className="grid grid-cols-12 gap-2 border-b bg-gray-50 px-3 py-2 text-sm font-medium"
            >
              <div role="columnheader" className="col-span-4">
                Name
              </div>
              <div role="columnheader" className="col-span-3">
                Email
              </div>
              <div role="columnheader" className="col-span-3">
                Role
              </div>
              <div role="columnheader" className="col-span-2 text-right">
                Actions
              </div>
            </div>

            {!loading && !error && (items?.length ?? 0) === 0 && (
              <div className="px-3 py-6 text-sm text-gray-600">
                No members found. Try clearing filters.
              </div>
            )}

            {(items ?? []).map((r) => {
              const isBusy = !!pending[r.id];
              const currentSlot = r.slot ?? undefined;
              const label = r.roleLabel ?? getLabelForSlot(r.slot ?? undefined);
              const active =
                typeof r.roleActive === "boolean"
                  ? r.roleActive
                  : currentSlot
                  ? roleLabelBySlot.get(currentSlot)?.isActive ?? true
                  : true;

              return (
                <div
                  key={r.id}
                  role="row"
                  className="grid grid-cols-12 items-center gap-2 border-t px-3 py-2 text-sm"
                >
                  <div role="cell" className="col-span-4">
                    <div className="font-medium text-gray-900">
                      {r.name || "—"}
                    </div>
                    <div className="text-xs text-gray-500">ID: {r.id}</div>
                  </div>

                  <div role="cell" className="col-span-3">
                    <a
                      href={`mailto:${r.email}`}
                      className="text-blue-600 underline"
                    >
                      {r.email}
                    </a>
                  </div>

                  <div role="cell" className="col-span-3">
                    <span
                      className={classNames(
                        "mr-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs",
                        active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-gray-100 text-gray-700"
                      )}
                    >
                      {label}{" "}
                      {typeof r.slot === "number" && (
                        <span className="ml-1 text-gray-500">#{r.slot}</span>
                      )}
                    </span>

                    <label className="sr-only" htmlFor={`slot-${r.id}`}>
                      Change role
                    </label>
                    <select
                      id={`slot-${r.id}`}
                      onChange={(e) => onChangeSlot(r.id, e.target.value)}
                      className={classNames(
                        "h-9 w-40 rounded-md border bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500",
                        isBusy && "cursor-not-allowed opacity-50"
                      )}
                      defaultValue=""
                    >
                      <option value="">Select role…</option>
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((s) => (
                        <option key={s} value={String(s)}>
                          {getLabelForSlot(s)} (#{s})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div role="cell" className="col-span-2 text-right">
                    <button
                      onClick={() => onRemove(r.id, r.name || r.email)}
                      disabled={isBusy}
                      className={classNames(
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

            {/* Pagination */}
            <div className="flex items-center justify-between border-t px-3 py-2 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className={classNames(
                  "h-9 rounded-md border px-3",
                  page <= 1 || loading
                    ? "cursor-not-allowed opacity-50"
                    : "hover:bg-gray-50"
                )}
              >
                Previous
              </button>
              <div>
                Page {page} of {totalPages}
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className={classNames(
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
        </div>
      </details>

      {/* Roles section with tri-state permissions (slot #1 hides Active + Edit permissions) */}
      <details className="mt-6 rounded-xl border bg-white">
        <summary className="cursor-pointer select-none rounded-xl px-4 py-3 text-lg font-medium">
          Roles management
        </summary>

        <div className="border-t px-4 py-4">
          {!rolesRes || !permissionKeys ? (
            <div className="text-sm text-gray-600">Loading roles…</div>
          ) : (
            <div className="space-y-2">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((slotNum) => {
                const orig = originalFor(slotNum) || {
                  slot: slotNum,
                  label: `Role ${slotNum}`,
                  isActive: true,
                  overrides: [],
                };
                const draft = draftFor(slotNum);
                const dirty = isDirty(slotNum);
                const busy = !!roleSaving[slotNum];
                const isAdmin = slotNum === 1;

                return (
                  <div key={slotNum} className="rounded-lg border p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      <div className="w-20 text-sm font-medium text-gray-700">
                        #{slotNum}
                      </div>

                      <div className="flex-1">
                        <label
                          className="sr-only"
                          htmlFor={`role-label-${slotNum}`}
                        >
                          Label for role #{slotNum}
                        </label>
                        <input
                          id={`role-label-${slotNum}`}
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
                      </div>

                      {/* For slot #1 (Admin), hide Active + Edit permissions */}
                      {!isAdmin && (
                        <>
                          <div className="flex items-center gap-2">
                            <label
                              htmlFor={`role-active-${slotNum}`}
                              className="text-sm text-gray-700"
                            >
                              Active
                            </label>
                            <input
                              id={`role-active-${slotNum}`}
                              type="checkbox"
                              checked={!!draft.isActive}
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
                          </div>

                          <button
                            type="button"
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
                        className={classNames(
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

                    {/* Permissions editor (hidden for Admin/slot #1) */}
                    {!isAdmin && permOpen[slotNum] && (
                      <div className="mt-3 rounded-md border p-3">
                        <p className="mb-2 text-xs text-gray-600">
                          Choose <strong>Allow</strong> to add a permission,{" "}
                          <strong>Deny</strong> to explicitly remove it.
                          <strong> Inherit</strong> uses the slot’s template.
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {permissionKeys.map((k) => {
                            const value = draft.permState[k] || "inherit";
                            const name = `perm-${slotNum}-${k}`;
                            return (
                              <div
                                key={k}
                                className="flex items-center justify-between gap-3 rounded border p-2"
                              >
                                <div className="text-sm">{k}</div>
                                <div className="flex items-center gap-3">
                                  {(["inherit", "allow", "deny"] as const).map(
                                    (opt) => (
                                      <label
                                        key={opt}
                                        className="flex items-center gap-1 text-xs"
                                      >
                                        <input
                                          type="radio"
                                          name={name}
                                          value={opt}
                                          checked={value === opt}
                                          onChange={() => {
                                            setRoleDrafts((m) =>
                                              new Map(m).set(slotNum, {
                                                ...draft,
                                                permState: {
                                                  ...draft.permState,
                                                  [k]: opt,
                                                },
                                              })
                                            );
                                            setRoleDirty((d) => ({
                                              ...d,
                                              [slotNum]: true,
                                            }));
                                          }}
                                        />
                                        {opt}
                                      </label>
                                    )
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-3 text-xs text-gray-500">
            Role #1 (Admin) is always active and has all permissions. You can
            rename it, but you can’t disable it or change its permissions.
            Changes to other roles take effect immediately after save.
          </p>
        </div>
      </details>
    </main>
  );
}
