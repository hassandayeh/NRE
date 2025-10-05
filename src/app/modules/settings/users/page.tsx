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
  invited?: boolean | null; // legacy
  isInvited?: boolean | null; // newer
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
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-sm text-neutral-600">{props.label}</span>
      <code className="flex-1 truncate rounded-md border bg-neutral-50 px-2 py-1 text-xs">
        {props.value}
      </code>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(props.value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="h-9 shrink-0 rounded-md border px-3 text-sm hover:bg-gray-50"
      >
        {copied ? "Copied" : "Copy"}
      </button>
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
          "fixed right-4 top-4 z-50 rounded-md border px-3 py-2 text-sm shadow",
          variant === "ok"
            ? "border-green-300 bg-green-50"
            : "border-red-300 bg-red-50"
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
const HIDDEN_PERMISSION_KEYS = new Set<string>(BOOKABLE_KEYS);

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
  const debouncedQ = useDebouncedValue(q, 300);

  // users
  const [items, setItems] = React.useState<UserItem[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Record<string, boolean>>({});

  // roles
  const [rolesRes, setRolesRes] = React.useState<RolesResponse | null>(null);
  const [permissionKeys, setPermissionKeys] = React.useState<
    readonly string[] | null
  >(null);

  // draft per slot: label, isActive, simple allow/deny map
  type RoleDraft = {
    slot: number;
    label: string;
    isActive: boolean;
    allow: Record<string, boolean>; // true=allow, false=deny
  };
  const [roleDrafts, setRoleDrafts] = React.useState<Map<number, RoleDraft>>(
    new Map()
  );
  const [roleDirty, setRoleDirty] = React.useState<Record<number, boolean>>({});
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

  // invite card
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
      const status: string | undefined = resp?.status;
      const link: string =
        typeof resp?.invitePath === "string"
          ? resp.invitePath
          : typeof resp?.path === "string"
          ? resp.path
          : typeof resp?.link === "string"
          ? resp.link
          : typeof resp?.token === "string"
          ? `/auth/invite/accept?token=${resp.token}`
          : "";
      if (status === "already_member") {
        setInviteLink(null);
        toast.showOk("This user is already in your org.");
      } else if (link) {
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
    setRoleDirty((dd) => ({ ...dd, [slotNum]: true }));
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
        setRoleDirty((d0) => ({ ...d0, [slotNum]: false }));
      } catch (e: any) {
        toast.showErr(e?.message || "Failed to save role.");
      } finally {
        setRoleSaving((s) => ({ ...s, [slotNum]: false }));
      }
      return;
    }

    // Build overrides with only "allowed = true" keys (deny is implicit)
    const allowedKeys = Object.entries(d.allow)
      .filter(([k, v]) => v === true)
      .map(([k]) => k);

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
    const changedAllowed =
      allowedKeys.length !== origAllowed.size ||
      allowedKeys.some((k) => !origAllowed.has(k)) ||
      Array.from(origAllowed).some((k) => !allowedKeys.includes(k));

    if (changedAllowed) {
      update.overrides = allowedKeys.map((k) => ({ key: k, allowed: true }));
      // keep Bookable keys in sync (already included if true)
      for (const k of BOOKABLE_KEYS) {
        if (d.allow[k] && !allowedKeys.includes(k)) {
          update.overrides.push({ key: k, allowed: true });
        }
      }
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
      setRoleDirty((d0) => ({ ...d0, [slotNum]: false }));
    } catch (e: any) {
      toast.showErr(e?.message || "Failed to save role.");
    } finally {
      setRoleSaving((s) => ({ ...s, [slotNum]: false }));
    }
  }

  // profile modal
  const [viewing, setViewing] = React.useState<UserItem | null>(null);

  /* ───────────────────────────────────────────────────────────────────────────
   * Render
   * ───────────────────────────────────────────────────────────────────────────*/
  if (!orgId) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        {toast.node}
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            Users &amp; Roles
          </h1>
        </header>
        <div className="rounded-md border p-4 text-sm">
          {resolvingOrg
            ? "Resolving your organization…"
            : "We couldn’t determine your organization automatically."}
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
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {toast.node}

      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Users &amp; Roles
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInvite((v) => !v)}
            className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
          >
            {showInvite ? "Close" : "Create user"}
          </button>
        </div>
      </header>

      {/* Users */}
      <section className="mb-10 rounded-lg border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-medium">Users</h2>
        </div>

        {/* Create user (collapsible, above filters) */}
        {showInvite && (
          <div className="mx-4 mt-4 rounded-md border border-dashed bg-neutral-50 p-4">
            <h3 className="mb-3 text-sm font-medium">Invite a new user</h3>
            <form
              onSubmit={onInvite}
              className="grid grid-cols-1 gap-3 md:grid-cols-3"
            >
              <label className="text-sm">
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
              <label className="text-sm">
                Name (optional)
                <input
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Alex Example"
                  className="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <div className="flex items-end gap-2">
                <button
                  type="submit"
                  disabled={inviting}
                  className={cx(
                    "h-9 rounded-md border px-3 text-sm",
                    inviting
                      ? "cursor-not-allowed opacity-50"
                      : "hover:bg-gray-50"
                  )}
                >
                  {inviting ? "Creating…" : "Create user"}
                </button>
              </div>

              {inviteLink && (
                <div className="col-span-full mt-2 min-w-0">
                  <CopyField label="Invite link:" value={inviteLink} />
                </div>
              )}
            </form>
          </div>
        )}

        {/* Filters */}
        <div className="mt-4 grid grid-cols-1 gap-3 px-4 pb-3 sm:grid-cols-2 md:grid-cols-[1fr_auto_auto] md:items-center">
          <div className="flex flex-col">
            <label className="text-sm">Search (name or email)</label>
            <input
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
              className="h-9 w-full rounded-md border border-gray-300 px-3 outline-none focus:ring-2 focus:ring-blue-500"
              aria-describedby="search-hint"
              placeholder="e.g. alex or @demo.test"
            />
            <span id="search-hint" className="mt-1 text-xs text-neutral-500">
              Type to filter by name or email
            </span>
          </div>

          <label className="flex flex-col text-sm md:justify-self-end">
            Role
            <select
              value={slot}
              onChange={(e) => {
                setPage(1);
                setSlot(e.target.value);
              }}
              className="h-9 w-56 rounded-md border border-gray-300 bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                const label = roleMeta.get(n)?.label ?? `Role ${n}`;
                return (
                  <option key={n} value={String(n)}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="flex flex-col text-sm md:justify-self-end">
            Page size
            <select
              value={pageSize}
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
          </label>
        </div>

        {/* Meta */}
        <div className="flex items-center justify-between px-4 pb-3 text-sm text-neutral-600">
          {loading ? (
            <span>Loading…</span>
          ) : error ? (
            <span className="text-red-600">{error}</span>
          ) : (
            <span>{total} results</span>
          )}
        </div>

        {/* Table */}
        <div className="px-4 pb-4">
          {!loading && !error && (items?.length ?? 0) === 0 && (
            <div className="rounded-md border p-4 text-sm text-neutral-600">
              No members found. Try clearing filters.
            </div>
          )}

          <div className="space-y-3">
            {(items ?? []).map((r) => {
              const isBusy = !!pending[r.id];
              const selectValue =
                typeof r.slot === "number" ? String(r.slot) : "";

              return (
                <div
                  key={r.id}
                  className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-[1fr_18rem_auto]"
                >
                  {/* Name + email (clean — no invited badge, no ID) */}
                  <div>
                    <div className="font-medium">{r.name || "—"}</div>
                    <div className="text-sm text-neutral-600">
                      <a href={`mailto:${r.email}`} className="underline">
                        {r.email}
                      </a>
                    </div>
                  </div>

                  {/* Role (aligned; option text = label only) */}
                  <div className="min-w-0 md:justify-self-start">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-sm text-neutral-600">
                        Role
                      </span>
                      <select
                        value={selectValue}
                        onChange={(e) => onChangeSlot(r.id, e.target.value)}
                        className={cx(
                          "h-9 w-full rounded-md border bg-white px-2 outline-none focus:ring-2 focus:ring-blue-500",
                          isBusy && "cursor-not-allowed opacity-50"
                        )}
                        disabled={isBusy}
                      >
                        <option value="" disabled>
                          Select role…
                        </option>
                        {Array.from({ length: 10 }, (_, i) => i + 1).map(
                          (s) => {
                            const label = roleMeta.get(s)?.label ?? `Role ${s}`;
                            return (
                              <option key={s} value={String(s)}>
                                {label}
                              </option>
                            );
                          }
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Actions (View + Remove only) */}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setViewing(r)}
                      className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
                    >
                      View
                    </button>
                    <button
                      onClick={() => onRemove(r.id, r.name || r.email)}
                      disabled={isBusy}
                      className={cx(
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
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className={cx(
                "h-9 rounded-md border px-3",
                page <= 1 || loading
                  ? "cursor-not-allowed opacity-50"
                  : "hover:bg-gray-50"
              )}
            >
              Previous
            </button>
            <div className="text-sm text-neutral-600">
              Page {page} of {totalPages}
            </div>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className={cx(
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
      </section>

      {/* Roles management */}
      <section className="rounded-lg border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-medium">Roles management</h2>
        </div>

        {!rolesRes || !permissionKeys ? (
          <div className="p-4 text-sm text-neutral-600">Loading roles…</div>
        ) : (
          <div className="divide-y">
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
                <div key={slotNum} className="p-4">
                  {/* Header row */}
                  <div className="flex items-center gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="w-20 shrink-0 text-sm text-neutral-600">
                        Role {slotNum}
                      </div>
                      <label className="flex-1 text-sm">
                        <span className="sr-only">
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

                      {/* Status indicator on LEFT */}
                      <span
                        className={cx(
                          "text-xs",
                          busy
                            ? "text-blue-600"
                            : dirty
                            ? "text-amber-600"
                            : "text-neutral-500"
                        )}
                        aria-live="polite"
                      >
                        {busy ? "Saving…" : dirty ? "Unsaved" : "Saved"}
                      </span>
                    </div>

                    {/* Right-side controls */}
                    {!isAdmin && (
                      <>
                        <label className="inline-flex items-center gap-2 text-sm">
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
                              setRoleDirty((d) => ({ ...d, [slotNum]: true }));
                            }}
                            className="h-5 w-5"
                          />
                          Active
                        </label>

                        <label className="ml-2 inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={bookable}
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
                          className="ml-2 h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
                        >
                          {permOpen[slotNum]
                            ? "Hide permissions"
                            : "Permissions"}
                        </button>
                      </>
                    )}

                    {/* Constant Save button (no shifting) */}
                    <button
                      onClick={() => saveRole(slotNum)}
                      disabled={busy || !dirty}
                      className={cx(
                        "ml-auto h-9 rounded-md border px-3 text-sm",
                        busy || !dirty
                          ? "cursor-not-allowed opacity-50"
                          : "hover:bg-gray-50"
                      )}
                      aria-disabled={busy || !dirty}
                    >
                      Save
                    </button>
                  </div>

                  {/* Permissions: single checkbox per key (no inherit) */}
                  {!isAdmin && permOpen[slotNum] && (
                    <div className="mt-3 rounded-md border bg-neutral-50 p-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {permissionKeys
                          .filter((k) => !HIDDEN_PERMISSION_KEYS.has(k))
                          .map((k) => {
                            const checked = !!draft.allow[k];
                            return (
                              <label
                                key={k}
                                className="flex items-center justify-between rounded-md border bg-white px-3 py-2 text-sm"
                              >
                                <span className="mr-3 truncate">{k}</span>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const v = e.target.checked;
                                    setRoleDrafts((m) =>
                                      new Map(m).set(slotNum, {
                                        ...draft,
                                        allow: { ...draft.allow, [k]: v },
                                      })
                                    );
                                    setRoleDirty((d) => ({
                                      ...d,
                                      [slotNum]: true,
                                    }));
                                  }}
                                  className="h-5 w-5"
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

            <div className="px-4 pb-4 text-xs text-neutral-600">
              Role #1 (Admin) is always active and has all permissions. You can
              rename it, but you can’t disable it or change its permissions.
            </div>
          </div>
        )}
      </section>

      {/* Profile viewer modal (basics only: no invited, no ID) */}
      {viewing && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setViewing(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-4 shadow"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">User profile</h3>
              <button
                onClick={() => setViewing(null)}
                className="h-8 rounded-md border px-2 text-sm hover:bg-gray-50"
                aria-label="Close profile"
              >
                Close
              </button>
            </div>

            <div className="space-y-2 text-sm">
              <div>
                <span className="block text-neutral-500">Name</span>
                <span className="font-medium">{viewing.name || "—"}</span>
              </div>
              <div>
                <span className="block text-neutral-500">Email</span>
                <a
                  className="font-medium underline"
                  href={`mailto:${viewing.email}`}
                >
                  {viewing.email}
                </a>
              </div>
              <div>
                <span className="block text-neutral-500">Role</span>
                <span className="font-medium">
                  {typeof viewing.slot === "number"
                    ? roleMeta.get(viewing.slot)?.label ??
                      `Role ${viewing.slot}`
                    : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
