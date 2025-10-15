"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* ─────────────────────────────────────────────────────────────────────────────
 * Types (aligned with current API)
 * ────────────────────────────────────────────────────────────────────────────*/
type UserItem = {
  id: string;
  name: string | null;
  email: string;
  slot: number | null;
  roleLabel?: string | null;
  roleActive?: boolean | null;
  /** legacy/new flags that mean "not yet accepted the invite" */
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
  overrides: { key: string; allowed: boolean }[];
};

type RolesResponse = {
  ok?: boolean;
  orgId: string;
  permissionKeys: readonly string[];
  slots: RoleSlot[];
};

/** Invite API may vary across routes; normalize defensively */
type InviteApiResponse = {
  // newest
  inviteUrl?: string;
  // legacy / alternates
  acceptUrl?: string;
  invitePath?: string;
  url?: string;
  path?: string;
  link?: string;
  token?: string;
  status?: "ok" | "already_member" | string;
  member?: UserItem;
  [k: string]: unknown;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Utilities
 * ────────────────────────────────────────────────────────────────────────────*/
function cx(...parts: Array<string | false | null | undefined>) {
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

/** Copyable, single-line, truncated field */
function CopyField(props: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex w-full items-center gap-3">
      <div className="min-w-24 shrink-0 text-sm text-neutral-600">
        {props.label}
      </div>
      {/* ensure the row itself doesn’t overflow */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {/* make the value take full width and truncate */}
        <div
          title={props.value}
          className="w-full max-w-full truncate rounded-md border px-3 py-1 text-sm"
        >
          {props.value}
        </div>
        <button
          onClick={async (e) => {
            e.preventDefault();
            try {
              await navigator.clipboard.writeText(props.value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch {}
          }}
          className="h-9 shrink-0 rounded-md border px-3 text-sm hover:bg-gray-50"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

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
        className={cx(
          "fixed right-4 top-4 z-50 rounded-md px-3 py-2 text-sm shadow",
          variant === "ok"
            ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
            : "bg-rose-50 text-rose-800 ring-1 ring-rose-200"
        )}
      >
        {msg}
      </div>
    ) : null,
  };
}

/* Fetch helpers */
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

/* Robust orgId detection */
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
async function tryFetchJson<T>(url: string) {
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
    const data = await tryFetchJson<any>(url);
    const found = parseOrgFromPayload(data);
    if (found) {
      if (typeof window !== "undefined")
        window.localStorage.setItem("orgId", found);
      return found;
    }
  }
  const sess = await tryFetchJson<any>("/api/auth/session");
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Page state
 * ────────────────────────────────────────────────────────────────────────────*/

const BOOKABLE_KEYS = [
  "directory:listed_internal",
  "booking:inviteable",
] as const;
/** Widened to string to avoid TS error when checking arbitrary permission keys */
const HIDDEN_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  BOOKABLE_KEYS as readonly string[]
);

export default function UsersAndRolesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  // org
  const orgIdFromUrl = (searchParams.get("orgId") || "").trim() || null;
  const [orgId, setOrgId] = React.useState<string | null>(orgIdFromUrl);
  const [resolvingOrg, setResolvingOrg] = React.useState(!orgIdFromUrl);
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
  const debouncedQ = useDebouncedValue(q, 300);

  // users
  const [items, setItems] = React.useState<UserItem[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Record<string, boolean>>({});

  // roles
  const [rolesRes, setRolesRes] = React.useState<RolesResponse | null>(null);
  // === UI permission guards (based on session email → my slot from `items`)
  const [meEmail, setMeEmail] = React.useState<string | null>(null);
  React.useEffect(() => {
    (async () => {
      try {
        const s = await fetch("/api/auth/session", { cache: "no-store" }).then(
          (r) => r.json()
        );
        setMeEmail(
          (s?.user?.email as string | undefined) ||
            (s?.email as string | undefined) ||
            null
        );
      } catch {
        setMeEmail(null);
      }
    })();
  }, []);

  const mySlot: number | null = React.useMemo(() => {
    if (!meEmail) return null;
    const me = (items ?? []).find(
      (u) => (u.email || "").toLowerCase() === meEmail.toLowerCase()
    );
    return typeof me?.slot === "number" ? (me!.slot as number) : null;
  }, [items, meEmail]);

  function normalizePermKey(k: string): string {
    const map: Record<string, string> = {
      staffcreate: "staff:create",
      staffdelete: "staff:delete",
      rolesmanage: "roles:manage",
      billingmanage: "billing:manage",
      settingsmanage: "settings:manage",
    };
    const kk = (k || "").trim().toLowerCase();
    return map[kk] ?? kk;
  }

  function canAny(keys: string[]): boolean {
    // Admin (slot 1) has full access
    if (mySlot === 1) return true;
    if (!rolesRes || !mySlot) return false;
    const slot = rolesRes.slots?.find((s) => s.slot === mySlot);
    if (!slot) return false;

    const normKeys = keys.map(normalizePermKey);
    return normKeys.some((k) =>
      slot.overrides?.some((o) => normalizePermKey(o.key) === k && o.allowed)
    );
  }

  const canCreate = canAny(["staff:create"]);
  const canDelete = canAny(["staff:delete"]);
  const canRolesManage = canAny(["roles:manage"]);

  // Read-only hints
  const readOnlyUsers = !canCreate && !canDelete;
  const readOnlyRoles = !canRolesManage;

  // Admin helpers for UI policy: only Admin (Role 1) can promote/demote/remove Role 1
  const viewerIsAdmin = mySlot === 1;
  const isRowAdmin = (u: UserItem) => (u.slot ?? 0) === 1;

  // === end guards ===

  const [permissionKeys, setPermissionKeys] = React.useState<
    readonly string[] | null
  >(null);

  // draft per slot: label, isActive, simple allow/deny map
  type RoleDraft = {
    slot: number;
    label: string;
    isActive: boolean;
    allow: Record<string, boolean>;
  };
  const [roleDrafts, setRoleDrafts] = React.useState<Map<number, RoleDraft>>(
    new Map()
  );
  const [roleDirty, setRoleDirty] = React.useState<Record<number, boolean>>();
  const [roleSaving, setRoleSaving] = React.useState<Record<number, boolean>>(
    {}
  );
  const [permOpen, setPermOpen] = React.useState<Record<number, boolean>>({});

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
        // seed drafts: default deny, apply overrides
        const map = new Map<number, RoleDraft>();
        for (const s of data.slots) {
          const allow: Record<string, boolean> = {};
          for (const k of data.permissionKeys) allow[k] = false;
          for (const o of s.overrides) allow[o.key] = !!o.allowed;
          map.set(s.slot, {
            slot: s.slot,
            label: s.label,
            isActive: s.isActive,
            allow,
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

  // users API url & syncing
  const apiUrl = React.useMemo(() => {
    const sp = new URLSearchParams();
    if (orgId) sp.set("orgId", orgId);
    if (debouncedQ) sp.set("q", debouncedQ);
    if (slot) sp.set("slot", slot);
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    return `/api/org/users?${sp.toString()}`;
  }, [orgId, debouncedQ, slot, page, pageSize]);

  React.useEffect(() => {
    const sp = new URLSearchParams();
    if (orgId) sp.set("orgId", orgId);
    if (q) sp.set("q", q);
    if (slot) sp.set("slot", slot);
    if (page !== 1) sp.set("page", String(page));
    if (pageSize !== 20) sp.set("pageSize", String(pageSize));
    router.replace(`/modules/settings/users?${sp.toString()}`);
  }, [router, orgId, q, slot, page, pageSize]);

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
    refreshUsers();
  }, [orgId, apiUrl, refreshUsers]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // convenient role label lookup
  const roleMeta = React.useMemo(() => {
    const m = new Map<number, { label: string; isActive: boolean }>();
    (rolesRes?.slots ?? []).forEach((r) =>
      m.set(r.slot, { label: r.label, isActive: r.isActive })
    );
    return m;
  }, [rolesRes]);

  // user ops
  async function onChangeSlot(userId: string, newSlotStr: string) {
    if (!orgId) return;
    const newSlot = Number(newSlotStr) || 0;

    // UI policy guard: only Admin can assign/demote Role 1
    if (mySlot !== 1) {
      const target = (items ?? []).find((x) => x.id === userId);
      if (newSlot === 1) {
        toast.showErr("Only Admin can assign Role 1.");
        return;
      }
      if ((target?.slot ?? 0) === 1) {
        toast.showErr("Only Admin can change a Role 1 member's role.");
        return;
      }
    }

    if (!Number.isInteger(newSlot) || newSlot < 1 || newSlot > 10) {
      toast.showErr("Invalid role slot.");
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
    // UI policy guard: only Admin can remove Role 1
    if (mySlot !== 1) {
      const target = (items ?? []).find((x) => x.id === userId);
      if ((target?.slot ?? 0) === 1) {
        toast.showErr("Only Admin can remove a Role 1 member.");
        return;
      }
    }
    const ok = window.confirm(`Remove "${userName}" from this organization?`);

    if (!ok) return;
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

  // invite card (create new user)
  const [showInvite, setShowInvite] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteName, setInviteName] = React.useState("");
  const [inviteSlot, setInviteSlot] = React.useState(() => {
    const maybeFromFilter = Number(searchParams.get("slot") || "");
    return Number.isInteger(maybeFromFilter) &&
      maybeFromFilter >= 1 &&
      maybeFromFilter <= 10
      ? maybeFromFilter
      : 6; // server default
  });
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [inviting, setInviting] = React.useState(false);

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    if (!inviteEmail.trim()) {
      toast.showErr("Email is required.");
      return;
    }
    if (!viewerIsAdmin && inviteSlot === 1) {
      toast.showErr("Only Admin can assign Role 1.");
      return;
    }
    setInviting(true);

    setInviteLink(null);

    const body = {
      email: inviteEmail.trim(),
      name: inviteName.trim() || undefined,
      slot: inviteSlot,
    };

    const orgIdStrict = orgId as string; // guaranteed by: if (!orgId) return; above
    async function postInvite(): Promise<InviteApiResponse> {
      const baseQs = `?orgId=${encodeURIComponent(orgIdStrict)}`;
      try {
        return await postJSON<InviteApiResponse>(
          `/api/org/users/invite${baseQs}`,
          body
        );
      } catch {
        return await postJSON<InviteApiResponse>(
          `/api/org/users${baseQs}`,
          body
        );
      }
    }

    try {
      const resp = await postInvite();
      const status = resp?.status;

      // pick a link if available
      const candidates = [
        resp?.inviteUrl,
        resp?.invitePath,
        resp?.acceptUrl,
        resp?.url,
        resp?.path,
        resp?.link,
      ].filter((v): v is string => typeof v === "string" && v.length > 0);
      const tokenLink =
        typeof resp?.token === "string" && resp.token.length > 0
          ? `/auth/invite/accept?token=${resp.token}`
          : "";
      const link = candidates[0] || tokenLink;

      // optimistic insert using returned member (preferred)
      const returnedMember: UserItem | null =
        (resp as any)?.member && typeof (resp as any).member === "object"
          ? ((resp as any).member as UserItem)
          : null;
      if (returnedMember) {
        setItems((list) => {
          const exists = (list ?? []).some((u) => u.id === returnedMember.id);
          const next = exists
            ? (list ?? []).map((u) =>
                u.id === returnedMember.id ? returnedMember : u
              )
            : [returnedMember, ...(list ?? [])];
          return next;
        });
        setTotal((t) => t + (returnedMember ? 1 : 0));
      } else {
        // fallback optimistic row (rare)
        setItems((list) => [
          {
            id: `temp-${Date.now()}`,
            name: inviteName || inviteEmail,
            email: inviteEmail,
            slot: inviteSlot,
            isInvited: true,
          },
          ...(list ?? []),
        ]);
        setTotal((t) => t + 1);
      }

      if (status === "already_member") {
        setInviteLink(null);
        toast.showOk("This user is already in your org.");
      } else if (link) {
        setInviteLink(link);
        toast.showOk("Invite created.");
      } else {
        toast.showErr("Invite created, but no link was returned.");
      }

      // keep UI on first page where the new row appears
      setPage(1);
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.startsWith("409")) {
        toast.showErr("User already exists.");
      } else {
        toast.showErr(msg || "Failed to create invite.");
      }
    } finally {
      setInviting(false);
    }
  }

  // roles helpers
  function draftFor(slotNum: number): RoleDraft {
    const pk = permissionKeys ?? [];
    const fallbackAllow: Record<string, boolean> = Object.fromEntries(
      pk.map((k) => [k, false])
    );
    return (
      roleDrafts.get(slotNum) ?? {
        slot: slotNum,
        label: `Role ${slotNum}`,
        isActive: true,
        allow: fallbackAllow,
      }
    );
  }
  function originalFor(slotNum: number): RoleSlot | null {
    return rolesRes?.slots.find((s) => s.slot === slotNum) ?? null;
  }
  function isBookable(slotNum: number): boolean {
    const d = draftFor(slotNum);
    return BOOKABLE_KEYS.every((k) => d.allow[k] === true);
  }
  function setBookable(slotNum: number, value: boolean) {
    const d = draftFor(slotNum);
    const next: RoleDraft = {
      ...d,
      allow: {
        ...d.allow,
        [BOOKABLE_KEYS[0]]: value,
        [BOOKABLE_KEYS[1]]: value,
      },
    };
    setRoleDrafts((m) => new Map(m).set(slotNum, next));
    setRoleDirty((dd) => ({ ...(dd || {}), [slotNum]: true }));
  }
  function isDirty(slotNum: number): boolean {
    const d = draftFor(slotNum);
    const o = originalFor(slotNum);
    if (!o) return false;
    if (slotNum === 1) return d.label.trim() !== o.label;
    if (d.label.trim() !== o.label) return true;
    if (d.isActive !== o.isActive) return true;
    // Compare sets of allowed keys (deny = false)
    const origAllowed = new Set(
      o.overrides.filter((x) => x.allowed).map((x) => x.key)
    );
    const draftAllowed = new Set(
      Object.entries(d.allow)
        .filter(([, v]) => v)
        .map(([k]) => k)
    );
    if (origAllowed.size !== draftAllowed.size) return true;
    for (const k of draftAllowed) if (!origAllowed.has(k)) return true;
    return false;
  }
  async function saveRole(slotNum: number) {
    if (!orgId) return;
    const d = draftFor(slotNum);
    const o = originalFor(slotNum);
    if (!o) return;

    // slot 1: label only
    if (slotNum === 1) {
      const changed = d.label.trim() !== o.label;
      if (!changed) {
        toast.showOk("Already saved.");
        return;
      }
      setRoleSaving((s) => ({ ...s, [slotNum]: true }));
      try {
        await patchJSON(`/api/org/roles`, {
          orgId,
          updates: { [String(slotNum)]: { label: d.label.trim() } },
        });
        toast.showOk("Role saved.");
        // refresh
        const data = await getJSON<RolesResponse>(
          `/api/org/roles?orgId=${encodeURIComponent(orgId)}`
        );
        setRolesRes(data);
        setPermissionKeys(data.permissionKeys);
        const map = new Map<number, RoleDraft>();
        for (const s of data.slots) {
          const allow: Record<string, boolean> = {};
          for (const k of data.permissionKeys) allow[k] = false;
          for (const ov of s.overrides) allow[ov.key] = !!ov.allowed;
          map.set(s.slot, {
            slot: s.slot,
            label: s.label,
            isActive: s.isActive,
            allow,
          });
        }
        setRoleDrafts(map);
        setRoleDirty((d0) => ({ ...(d0 || {}), [slotNum]: false }));
      } catch (e: any) {
        toast.showErr(e?.message || "Failed to save role.");
      } finally {
        setRoleSaving((s) => ({ ...s, [slotNum]: false }));
      }
      return;
    }

    // Build overrides as DIFFS (send allowed:true AND allowed:false where changed)
    const update: {
      label?: string;
      isActive?: boolean;
      overrides?: { key: string; allowed: boolean }[];
    } = {};
    if (d.label.trim() !== o.label) update.label = d.label.trim();
    if (d.isActive !== o.isActive) update.isActive = d.isActive;
    const origAllowed = new Set(
      o.overrides.filter((x) => x.allowed).map((x) => x.key)
    );
    const changedOverrides: { key: string; allowed: boolean }[] = [];
    for (const k of permissionKeys ?? []) {
      const nextAllowed = !!d.allow[k]; // checkbox state now
      const prevAllowed = origAllowed.has(k); // server state before
      if (nextAllowed !== prevAllowed) {
        changedOverrides.push({ key: k, allowed: nextAllowed });
      }
    }
    if (changedOverrides.length) {
      update.overrides = changedOverrides;
    }
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
      // refresh
      const data = await getJSON<RolesResponse>(
        `/api/org/roles?orgId=${encodeURIComponent(orgId)}`
      );
      setRolesRes(data);
      setPermissionKeys(data.permissionKeys);
      const map = new Map<number, RoleDraft>();
      for (const s of data.slots) {
        const allow: Record<string, boolean> = {};
        for (const k of data.permissionKeys) allow[k] = false;
        for (const ov of s.overrides) allow[ov.key] = !!ov.allowed;
        map.set(s.slot, {
          slot: s.slot,
          label: s.label,
          isActive: s.isActive,
          allow,
        });
      }
      setRoleDrafts(map);
      setRoleDirty((d0) => ({ ...(d0 || {}), [slotNum]: false }));
    } catch (e: any) {
      toast.showErr(e?.message || "Failed to save role.");
    } finally {
      setRoleSaving((s) => ({ ...s, [slotNum]: false }));
    }
  }

  // profile modal (kept minimal and unchanged logic)
  const [viewing, setViewing] = React.useState<UserItem | null>(null);

  // NEW: per-row freshly generated invite links
  const [rowInviteLinks, setRowInviteLinks] = React.useState<
    Record<string, string>
  >({});

  async function onReinvite(user: UserItem) {
    if (!orgId) return;
    setPending((p) => ({ ...p, [user.id]: true }));
    try {
      const body = {
        email: user.email,
        name: user.name ?? undefined,
        slot: user.slot ?? 6,
      };
      const base = `?orgId=${encodeURIComponent(orgId)}`;
      let resp: InviteApiResponse;
      try {
        resp = await postJSON<InviteApiResponse>(
          `/api/org/users/invite${base}`,
          body
        );
      } catch {
        resp = await postJSON<InviteApiResponse>(`/api/org/users${base}`, body);
      }
      const candidates = [
        resp?.inviteUrl,
        resp?.invitePath,
        resp?.acceptUrl,
        resp?.url,
        resp?.path,
        resp?.link,
      ].filter((v): v is string => typeof v === "string" && v.length > 0);
      const tokenLink =
        typeof resp?.token === "string" && resp.token.length > 0
          ? `/auth/invite/accept?token=${resp.token}`
          : "";
      const link = candidates[0] || tokenLink;

      if (link) {
        setRowInviteLinks((m) => ({ ...m, [user.id]: link }));
        toast.showOk("Invite regenerated.");
      } else {
        toast.showErr("Invite created, but no link was returned.");
      }

      // best-effort refresh (invited flag might flip if user accepts quickly)
    } catch (e: any) {
      toast.showErr(e?.message || "Failed to re-invite.");
    } finally {
      setPending((p) => ({ ...p, [user.id]: false }));
    }
  }

  /* ───────────────────────────────────────────────────────────────────────────
   * Render
   * ───────────────────────────────────────────────────────────────────────────*/
  if (!orgId) {
    return (
      <>
        {toast.node}
        <main className="mx-auto max-w-5xl px-4 py-8">
          <h1 className="text-2xl font-semibold tracking-tight">
            Users &amp; Roles
          </h1>
          <p className="mt-2 text-neutral-600">
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
      </>
    );
  }

  return (
    <>
      {toast.node}
      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* Header */}
        <header className="mb-8 flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            Users &amp; Roles
          </h1>
          <div aria-live="polite" className="mt-1 text-xs text-gray-500">
            Signed in as {orgId ? "Staff" : "Guest"}
          </div>
          {canCreate && (
            <button
              onClick={() => setShowInvite((v) => !v)}
              className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
            >
              {showInvite ? "Close" : "Create user"}
            </button>
          )}
        </header>

        {/* Users */}
        <section aria-labelledby="users" className="mb-10">
          <h2 id="users" className="mb-4 text-lg font-semibold">
            Users
          </h2>
          {readOnlyUsers && (
            <p
              role="status"
              aria-live="polite"
              className="mt-1 text-sm text-gray-600"
            >
              You can view users, but you don’t have permission to invite or
              remove. Contact your org admin if you need access.
            </p>
          )}

          {/* Create user (collapsible, above filters) */}
          {canCreate && showInvite && (
            <form
              onSubmit={onInvite}
              className="mb-6 rounded-xl border p-4 shadow-sm ring-1 ring-black/5"
            >
              <h3 className="mb-3 text-base font-medium">Invite a new user</h3>
              <label className="block text-sm">
                Email*
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="alex@company.com"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="mt-3 block text-sm">
                Name (optional)
                <input
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Alex Example"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="mt-3 block text-sm">
                Role
                <select
                  value={inviteSlot}
                  onChange={(e) => setInviteSlot(Number(e.target.value))}
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1)
                    .filter((n) => roleMeta.get(n)?.isActive ?? true) // active only
                    .filter((n) => viewerIsAdmin || n !== 1) // non-admins: no Role 1
                    .map((n) => {
                      const label = roleMeta.get(n)?.label ?? `Role ${n}`;
                      return (
                        <option key={n} value={n}>
                          {label}
                        </option>
                      );
                    })}
                </select>
              </label>

              {/* Footer: button on first line; invite link wraps to its own full-width line */}
              {canCreate && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={inviting}
                    className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    {inviting ? "Creating…" : "Create user"}
                  </button>

                  {inviteLink ? (
                    <div className="basis-full overflow-hidden">
                      <CopyField label="Invite link" value={inviteLink} />
                    </div>
                  ) : null}
                </div>
              )}
            </form>
          )}

          {/* Filters */}
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Search (name or email)
              <input
                value={q}
                onChange={(e) => {
                  setPage(1);
                  setQ(e.target.value);
                }}
                className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                aria-describedby="search-hint"
                placeholder="e.g. alex"
              />
              <span
                id="search-hint"
                className="mt-1 block text-xs text-neutral-500"
              >
                Press Enter to search; list updates automatically.
              </span>
            </label>

            <label className="block text-sm">
              Filter by role
              <select
                value={slot}
                onChange={(e) => {
                  setPage(1);
                  setSlot(e.target.value);
                }}
                className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                {Array.from({ length: 10 }, (_, i) => i + 1)
                  .filter((n) => roleMeta.get(n)?.isActive ?? true) // active only
                  .map((n) => {
                    const label = roleMeta.get(n)?.label ?? `Role ${n}`;
                    return (
                      <option key={n} value={String(n)}>
                        {label}
                      </option>
                    );
                  })}
              </select>
            </label>
          </div>

          {/* List */}
          <div className="overflow-hidden rounded-xl border ring-1 ring-black/5">
            <div className="grid grid-cols-12 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-600">
              <div className="col-span-5">Member</div>
              <div className="col-span-2">Role</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-3 text-right">Actions</div>
            </div>

            {loading ? (
              <div className="px-4 py-6 text-sm text-neutral-500">Loading…</div>
            ) : error ? (
              <div className="px-4 py-6 text-sm text-rose-700">{error}</div>
            ) : (items ?? []).length === 0 ? (
              <div className="px-4 py-6 text-sm text-neutral-500">
                No users found.
              </div>
            ) : (
              (items ?? []).map((u) => {
                const role = u.slot ?? 0;
                const roleLabel =
                  roleMeta.get(role)?.label ?? (role ? `Role ${role}` : "—");
                const isPending = !!(u.isInvited ?? u.invited);
                return (
                  <div key={u.id} className="border-t px-4 py-3">
                    <div className="grid grid-cols-12 items-center gap-3">
                      {/* Member */}
                      <div className="col-span-5 min-w-0">
                        <div className="truncate font-medium">
                          {u.name || u.email}
                        </div>
                        <div className="truncate text-sm text-neutral-600">
                          {u.email}
                        </div>
                      </div>

                      {/* Role */}
                      <div className="col-span-2">
                        <select
                          disabled={
                            pending[u.id] || (!viewerIsAdmin && isRowAdmin(u))
                          }
                          value={String(u.slot ?? "")}
                          onChange={(e) => onChangeSlot(u.id, e.target.value)}
                          className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        >
                          <option value="">—</option>
                          {(viewerIsAdmin
                            ? Array.from(
                                { length: 10 },
                                (_, i) => i + 1
                              ).filter((n) => roleMeta.get(n)?.isActive ?? true) // Admin: active only
                            : isRowAdmin(u)
                            ? [1] // Non-admin viewing an Admin row: keep Role 1 visible
                            : Array.from({ length: 10 }, (_, i) => i + 1)
                                .filter((n) => n !== 1)
                                .filter(
                                  (n) => roleMeta.get(n)?.isActive ?? true
                                )
                          ) // Non-admin: active only
                            .map((n) => (
                              <option key={n} value={String(n)}>
                                {roleMeta.get(n)?.label ?? `Role ${n}`}
                              </option>
                            ))}
                        </select>
                      </div>

                      {/* Status */}
                      <div className="col-span-2">
                        {isPending ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                            Pending
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                            Active
                          </span>
                        )}
                      </div>

                      {/* Actions (incl. NEW: Re-invite when pending) */}
                      <div className="col-span-3 flex items-center justify-end gap-2">
                        {isPending ? (
                          <button
                            disabled={pending[u.id]}
                            onClick={() => onReinvite(u)}
                            className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                            title="Generate a new invite link"
                          >
                            Re-invite
                          </button>
                        ) : (
                          <button
                            onClick={() => setViewing(u)}
                            className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
                          >
                            View
                          </button>
                        )}
                        {canDelete && (viewerIsAdmin || !isRowAdmin(u)) && (
                          <button
                            disabled={pending[u.id]}
                            onClick={() => onRemove(u.id, u.name || u.email)}
                            className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline invite link (NEW; appears only after clicking Re-invite) */}
                    {rowInviteLinks[u.id] ? (
                      <div className="mt-3">
                        <CopyField
                          label="Invite link"
                          value={rowInviteLinks[u.id]}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}

            {/* Pagination */}
            <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
              <div>
                Page {page} of {totalPages} • {total} total
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 rounded-md border px-2 disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-8 rounded-md border px-2 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Roles management */}
        <section aria-labelledby="roles-heading" className="mb-16">
          <h2 id="roles-heading" className="mb-3 text-lg font-medium">
            Roles management
          </h2>

          {readOnlyRoles && (
            <p
              role="status"
              aria-live="polite"
              className="mb-2 text-sm text-gray-600"
            >
              You can view roles, but you can’t edit them. Ask an admin for
              “roles:manage”.
            </p>
          )}

          {!rolesRes || !permissionKeys ? (
            <div className="rounded-md border p-6 text-sm text-neutral-600">
              Loading roles…
            </div>
          ) : (
            <div className="space-y-3">
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
                const bookable = isBookable(slotNum);

                return (
                  <div
                    key={slotNum}
                    className="rounded-md border p-4"
                    role="group"
                    aria-label={`Role ${slotNum}`}
                  >
                    {/* Header row */}
                    {/* Header row */}
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="text-sm font-medium">Role {slotNum}</div>

                      <input
                        value={draft.label}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRoleDrafts((m) =>
                            new Map(m).set(slotNum, { ...draft, label: v })
                          );
                          setRoleDirty((d) => ({
                            ...(d || {}),
                            [slotNum]: true,
                          }));
                        }}
                        disabled={!canRolesManage}
                        className="h-9 w-full min-w-[240px] max-w-[360px] flex-1 rounded-md border border-gray-300 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label={`Label for role #${slotNum}`}
                        placeholder={`Role ${slotNum}`}
                      />

                      {!isAdmin && (
                        <>
                          <label className="ml-2 inline-flex items-center gap-2 text-sm">
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
                                  ...(d || {}),
                                  [slotNum]: true,
                                }));
                              }}
                              disabled={!canRolesManage}
                              className="h-5 w-5"
                            />
                            Active
                          </label>

                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={bookable}
                              onChange={(e) =>
                                setBookable(slotNum, e.target.checked)
                              }
                              disabled={!canRolesManage}
                              className="h-5 w-5"
                            />
                            Bookable
                          </label>

                          {canRolesManage && (
                            <button
                              onClick={() =>
                                setPermOpen((o) => ({
                                  ...o,
                                  [slotNum]: !o[slotNum],
                                }))
                              }
                              className="ml-2 h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
                            >
                              {permOpen[slotNum]
                                ? "Hide permissions"
                                : "Permissions"}
                            </button>
                          )}
                        </>
                      )}

                      {(busy || dirty) && (
                        <span
                          className={cx(
                            "ml-auto rounded-full border px-2 py-0.5 text-xs",
                            busy
                              ? "border-neutral-300 bg-neutral-50 text-neutral-600"
                              : "border-amber-300 bg-amber-50 text-amber-700"
                          )}
                        >
                          {busy ? "Saving…" : "Unsaved"}
                        </span>
                      )}

                      {canRolesManage && (
                        <button
                          onClick={() => saveRole(slotNum)}
                          disabled={busy || !dirty}
                          className={cx(
                            busy || dirty ? "" : "ml-auto",
                            "h-9 rounded-md border px-3 text-sm",
                            busy || !dirty
                              ? "cursor-not-allowed opacity-50"
                              : "hover:bg-gray-50"
                          )}
                          aria-disabled={busy || !dirty}
                        >
                          Save
                        </button>
                      )}
                    </div>

                    {/* Permissions: single checkbox per key (no inherit) */}
                    {!isAdmin && permOpen[slotNum] && canRolesManage && (
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {permissionKeys
                          .filter((k) => !HIDDEN_PERMISSION_KEYS.has(k))
                          .map((k) => {
                            // Enforce: org:domains:manage ⇒ org:domains:read (checked + disabled)
                            const READ_KEY = "org:domains:read";
                            const MANAGE_KEY = "org:domains:manage";
                            const manageOn = !!draft.allow[MANAGE_KEY];
                            const isReadKey = k === READ_KEY;
                            const isManageKey = k === MANAGE_KEY;

                            const checked =
                              isReadKey && manageOn ? true : !!draft.allow[k];

                            return (
                              <label
                                key={k}
                                className="flex items-center gap-2 text-sm"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={isReadKey && manageOn}
                                  onChange={(e) => {
                                    const v = e.target.checked;
                                    setRoleDrafts((m) => {
                                      const next = {
                                        ...draft,
                                        allow: { ...draft.allow, [k]: v },
                                      };
                                      // If turning manage ON, force read ON and lock it (disabled above)
                                      if (isManageKey && v) {
                                        next.allow[READ_KEY] = true;
                                      }
                                      return new Map(m).set(slotNum, next);
                                    });
                                    setRoleDirty((d) => ({
                                      ...(d || {}),
                                      [slotNum]: true,
                                    }));
                                  }}
                                  className="h-5 w-5"
                                />
                                {k}
                              </label>
                            );
                          })}
                      </div>
                    )}
                  </div>
                );
              })}

              <p className="text-xs text-neutral-600">
                Role #1 (Admin) is always active and has all permissions. You
                can rename it, but you can’t disable it or change its
                permissions.
              </p>
            </div>
          )}
        </section>

        {/* Profile viewer modal (basics only) */}
        {viewing && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4"
            onClick={() => setViewing(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-md bg-white p-4 shadow"
            >
              <h3 className="mb-2 text-base font-medium">User profile</h3>
              <div className="mb-4 grid gap-2 text-sm">
                <div>
                  <div className="text-neutral-700">Name</div>
                  <div className="text-neutral-900">{viewing.name || "—"}</div>
                </div>
                <div>
                  <div className="text-neutral-700">Email</div>
                  <div className="text-neutral-900">{viewing.email}</div>
                </div>
                <div>
                  <div className="text-neutral-700">Role</div>
                  <div className="text-neutral-900">
                    {typeof viewing.slot === "number"
                      ? roleMeta.get(viewing.slot)?.label ??
                        `Role ${viewing.slot}`
                      : "—"}
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => setViewing(null)}
                  className="h-8 rounded-md border px-2 text-sm hover:bg-gray-50"
                  aria-label="Close profile"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
