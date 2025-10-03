"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

/** ---------- types ---------- */
type RoleSlot = {
  slot: number;
  label: string;
  isActive: boolean;
  template: string[];
  effective: string[];
  overrides: { key: string; allowed: boolean }[];
};

type RolesResponse = {
  ok: boolean;
  orgId: string;
  permissionKeys: readonly string[];
  slots: RoleSlot[];
  error?: string; // present on error responses
};

type SlotEdit = {
  label: string;
  isActive: boolean;
  // "inherit" uses template; "allow" adds; "deny" removes
  permState: Record<string, "inherit" | "allow" | "deny">;
};

type Member = {
  id: string;
  name: string;
  email: string;
  slot: number;
  roleLabel: string;
  roleActive: boolean;
};
type MembersResponse = {
  items: Member[];
  page: number;
  pageSize: number;
  total: number;
};

/** ---------- helpers ---------- */
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || `HTTP ${res.status}`);
    }
    return json as T;
  } catch (err) {
    if (text && text.trim().startsWith("<")) {
      throw new Error(`Unexpected HTML response (are you signed in?)`);
    }
    throw err;
  }
}

function createSlotEdit(slot: RoleSlot, allKeys: readonly string[]): SlotEdit {
  const state: SlotEdit = {
    label: slot.label,
    isActive: slot.isActive,
    permState: {},
  };
  for (const k of allKeys) state.permState[k] = "inherit";
  for (const o of slot.overrides)
    state.permState[o.key] = o.allowed ? "allow" : "deny";
  return state;
}

function diffForPatch(original: RoleSlot[], current: Record<number, SlotEdit>) {
  const updates: Record<
    string,
    {
      label?: string;
      isActive?: boolean;
      overrides?: { key: string; allowed: boolean }[];
    }
  > = {};
  for (const orig of original) {
    const cur = current[orig.slot];
    if (!cur) continue;

    const slotUpdate: {
      label?: string;
      isActive?: boolean;
      overrides?: { key: string; allowed: boolean }[];
    } = {};
    if (cur.label.trim() !== orig.label) slotUpdate.label = cur.label.trim();
    if (cur.isActive !== orig.isActive) slotUpdate.isActive = cur.isActive;

    const overrides: { key: string; allowed: boolean }[] = [];
    for (const [key, st] of Object.entries(cur.permState)) {
      if (st !== "inherit") overrides.push({ key, allowed: st === "allow" });
    }
    const origMap = new Map(orig.overrides.map((o) => [o.key, o.allowed]));
    const changed =
      overrides.length !== orig.overrides.length ||
      overrides.some((o) => origMap.get(o.key) !== o.allowed);
    if (changed) slotUpdate.overrides = overrides;

    if (Object.keys(slotUpdate).length) updates[String(orig.slot)] = slotUpdate;
  }
  return updates;
}

/** ---------- small UI bits ---------- */
function Badge({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
        ok ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
      }`}
    >
      {children}
    </span>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-lg border bg-white p-4 shadow-sm">
      {children}
    </div>
  );
}

function RadioTri({
  name,
  value,
  onChange,
}: {
  name: string;
  value: "inherit" | "allow" | "deny";
  onChange: (v: "inherit" | "allow" | "deny") => void;
}) {
  return (
    <div className="flex gap-3 text-xs">
      {(["inherit", "allow", "deny"] as const).map((opt) => (
        <label key={opt} className="inline-flex items-center gap-1">
          <input
            type="radio"
            name={name}
            value={opt}
            checked={value === opt}
            onChange={() => onChange(opt)}
          />
          {opt}
        </label>
      ))}
    </div>
  );
}

function PermRow({
  k,
  state,
  setState,
}: {
  k: string;
  state: "inherit" | "allow" | "deny";
  setState: (v: "inherit" | "allow" | "deny") => void;
}) {
  return (
    <div className="flex items-center justify-between border-t py-2 text-sm">
      <div className="font-mono">{k}</div>
      <RadioTri name={`perm-${k}`} value={state} onChange={setState} />
    </div>
  );
}

/** ---------- Slot editor ---------- */
function SlotEditor({
  slot,
  allKeys,
  data,
  onChange,
}: {
  slot: number;
  allKeys: readonly string[];
  data: SlotEdit;
  onChange: (slot: number, next: SlotEdit) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SectionCard>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Slot {slot} / Role</h3>
        <Badge ok={data.isActive}>
          {data.isActive ? "Active" : "Inactive"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-600">Label:</span>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            value={data.label}
            onChange={(e) => onChange(slot, { ...data, label: e.target.value })}
          />
        </label>

        <label className="mt-1 inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={data.isActive}
            onChange={(e) =>
              onChange(slot, { ...data, isActive: e.target.checked })
            }
          />
          Active
        </label>
      </div>

      <div className="mt-3">
        <button
          onClick={() => setOpen((v) => !v)}
          type="button"
          className="rounded-lg border bg-white px-3 py-1.5 text-xs shadow-sm"
        >
          {open ? "Hide permissions" : "Edit permissions"}
        </button>
      </div>

      {open && (
        <div className="mt-4 rounded-md border p-3">
          <p className="mb-2 text-xs text-gray-600">
            Choose <strong>Allow</strong> to add a permission or{" "}
            <strong>Deny</strong> to explicitly remove it.{" "}
            <strong>Inherited</strong> uses the slot’s template.
          </p>
          <div className="divide-y">
            {allKeys.map((k) => (
              <PermRow
                key={k}
                k={k}
                state={data.permState[k]}
                setState={(v) =>
                  onChange(slot, {
                    ...data,
                    permState: { ...data.permState, [k]: v },
                  })
                }
              />
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/** ---------- Page (client) ---------- */
export default function OrgAccessPage() {
  const params = useSearchParams();
  const orgIdFromURL = params.get("orgId") || "";

  // existing state (roles editor)
  const [orgId, setOrgId] = useState(orgIdFromURL);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionKeys, setPermissionKeys] = useState<readonly string[]>([]);
  const [originalSlots, setOriginalSlots] = useState<RoleSlot[]>([]);
  const [editing, setEditing] = useState<Record<number, SlotEdit>>({});

  // Add staff member (Slice 1 UI)
  const [addEmail, setAddEmail] = useState("");
  const [addSlot, setAddSlot] = useState<number>(6);
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);

  // NEW — Members list
  const [members, setMembers] = useState<Member[]>([]);
  const [membersTotal, setMembersTotal] = useState(0);
  const [membersPage, setMembersPage] = useState(1);
  const [membersPageSize] = useState(10);
  const [membersQ, setMembersQ] = useState("");
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersErr, setMembersErr] = useState<string | null>(null);

  // track per-row saves
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  function setSavingFor(id: string, on: boolean) {
    setSavingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const canSave = useMemo(() => {
    if (!originalSlots.length) return false;
    const updates = diffForPatch(originalSlots, editing);
    return Object.keys(updates).length > 0 && !saving;
  }, [originalSlots, editing, saving]);

  async function load() {
    setError(null);
    setStatus("Loading...");
    setLoading(true);
    try {
      const json = await fetchJSON<RolesResponse>(
        `/api/org/roles?orgId=${encodeURIComponent(orgId)}`
      );
      setPermissionKeys(json.permissionKeys);
      setOriginalSlots(json.slots);
      const nextEditing: Record<number, SlotEdit> = {};
      for (const s of json.slots)
        nextEditing[s.slot] = createSlotEdit(s, json.permissionKeys);
      setEditing(nextEditing);
      setStatus(`Loaded ${json.slots.length} slots`);
      // also load members
      await loadMembers(1, membersQ);
    } catch (e: any) {
      setError(e?.message || "Failed to load roles");
      setOriginalSlots([]);
      setEditing({});
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadMembers(page = membersPage, q = membersQ) {
    if (!orgId) return;
    setMembersErr(null);
    setMembersLoading(true);
    try {
      const data = await fetchJSON<MembersResponse>(
        `/api/org/users?orgId=${encodeURIComponent(
          orgId
        )}&page=${page}&pageSize=${membersPageSize}${
          q ? `&q=${encodeURIComponent(q)}` : ""
        }`
      );
      setMembers(data.items);
      setMembersTotal(data.total);
      setMembersPage(data.page);
    } catch (e: any) {
      setMembersErr(e?.message || "Failed to load members");
      setMembers([]);
      setMembersTotal(0);
    } finally {
      setMembersLoading(false);
    }
  }

  async function save() {
    setError(null);
    setStatus("Saving...");
    setSaving(true);
    try {
      const updates = diffForPatch(originalSlots, editing);
      if (!Object.keys(updates).length) {
        setStatus("Nothing to save");
        return;
      }
      const json = await fetchJSON<RolesResponse>(`/api/org/roles`, {
        method: "PATCH",
        body: JSON.stringify({ orgId, updates }),
      });
      setPermissionKeys(json.permissionKeys);
      setOriginalSlots(json.slots);
      const nextEditing: Record<number, SlotEdit> = {};
      for (const s of json.slots)
        nextEditing[s.slot] = createSlotEdit(s, json.permissionKeys);
      setEditing(nextEditing);
      setStatus("Saved");
      // refresh members to reflect new effective labels
      await loadMembers(1, membersQ);
    } catch (e: any) {
      setError(e?.message || "Failed to save changes");
      setStatus(null);
    } finally {
      setSaving(false);
    }
  }

  // Add staff member using POST /api/org/users
  async function addMember() {
    if (!orgId || !addEmail) return;
    setAddErr(null);
    setAddMsg(null);
    setAdding(true);
    try {
      const res = await fetch(
        `/api/org/users?orgId=${encodeURIComponent(orgId)}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            email: addEmail.trim(),
            orgRoleKey: `role${addSlot}`,
          }),
        }
      );

      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setAddErr(body?.error || `Request failed (${res.status})`);
        return;
      }
      const verb = res.status === 201 ? "added" : "already a member";
      setAddMsg(
        `✅ ${body?.member?.email || addEmail} ${verb} in Role ${addSlot}.`
      );
      setAddEmail("");
      setAddSlot(6);
      await loadMembers(1, membersQ);
    } catch (e: any) {
      setAddErr(e?.message || "Failed to add member");
    } finally {
      setAdding(false);
    }
  }

  // Change role (slot) for a member
  async function changeMemberSlot(userId: string, newSlot: number) {
    if (!orgId) return;
    setSavingFor(userId, true);
    try {
      const res = await fetch(
        `/api/org/users/${encodeURIComponent(
          userId
        )}?orgId=${encodeURIComponent(orgId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot: newSlot }),
        }
      );
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        alert(body?.error || `Failed to update (HTTP ${res.status})`);
        // revert UI
        await loadMembers(membersPage, membersQ);
        return;
      }
      // optimistic local update
      setMembers((prev) =>
        prev.map((m) =>
          m.id === userId
            ? {
                ...m,
                slot: newSlot,
                roleLabel: body?.item?.roleLabel ?? `Role ${newSlot}`,
                roleActive: body?.item?.roleActive ?? true,
              }
            : m
        )
      );
    } finally {
      setSavingFor(userId, false);
    }
  }

  // Remove member (handles confirm + rails responses)
  async function removeMember(userId: string) {
    if (!orgId) return;
    setSavingFor(userId, true);
    try {
      let res = await fetch(
        `/api/org/users/${encodeURIComponent(
          userId
        )}?orgId=${encodeURIComponent(orgId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot: null }),
        }
      );
      let body = await res.json().catch(() => ({} as any));

      if (res.status === 400 && body?.code === "CONFIRM_REQUIRED") {
        const ok = window.confirm(
          "You’re removing this membership. This may remove access. Are you sure?"
        );
        if (!ok) return;
        res = await fetch(
          `/api/org/users/${encodeURIComponent(
            userId
          )}?orgId=${encodeURIComponent(orgId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slot: null, confirm: true }),
          }
        );
        body = await res.json().catch(() => ({} as any));
      }

      if (!res.ok) {
        alert(body?.error || `Failed to remove (HTTP ${res.status})`);
        return;
      }
      // success → refresh current page (adjust if empty)
      const after = Math.max(
        1,
        Math.min(membersPage, Math.ceil((membersTotal - 1) / membersPageSize))
      );
      await loadMembers(after, membersQ);
    } finally {
      setSavingFor(userId, false);
    }
  }

  useEffect(() => {
    if (orgIdFromURL && orgIdFromURL === orgId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = Math.max(1, Math.ceil(membersTotal / membersPageSize));

  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="text-xl font-semibold">Org Access</h1>
      <p className="mt-1 text-sm text-gray-600">
        Manage labels, activation, and permission overrides for slots 1–10.
        Enter an <code>orgId</code> to load.
      </p>

      {/* orgId input + actions */}
      <SectionCard>
        <label className="text-sm block">
          <span className="mb-1 block text-xs text-gray-600">
            Organization ID
          </span>
          <input
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="cmg910ga2000sknfwsn627v38"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            aria-label="Organization ID"
          />
        </label>

        {(status || error) && (
          <div className="mt-3 text-sm">
            {status && <div className="text-gray-700">{status}</div>}
            {error && <div className="text-red-600">{error}</div>}
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => void load()}
            disabled={!orgId || loading}
            className="rounded-lg border bg-white px-4 py-2 text-sm shadow-sm disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load"}
          </button>
          <button
            onClick={() => void save()}
            disabled={!canSave}
            className="rounded-lg bg-black px-4 py-2 text-sm text-white shadow-sm disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </SectionCard>

      {/* Add staff member */}
      <SectionCard>
        <h2 className="text-sm font-semibold">Add staff member</h2>
        <p className="mt-1 text-xs text-gray-600">
          Add an existing user as <strong>staff</strong> in this org. Experts
          must use the exclusivity invitation flow.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-600">Email</span>
            <input
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="person@org.com"
              className="w-full rounded border px-3 py-2 text-sm"
              aria-label="Staff email"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-600">Role slot</span>
            <select
              value={addSlot}
              onChange={(e) => setAddSlot(Number(e.target.value))}
              className="w-full rounded border px-3 py-2 text-sm"
              aria-label="Role slot"
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Role {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void addMember()}
            disabled={!orgId || !addEmail || adding}
            className="rounded-lg bg-black px-4 py-2 text-sm text-white shadow-sm disabled:opacity-50"
          >
            {adding ? "Adding..." : "Add member"}
          </button>

          {/* Invite link lives on Settings index → we kept it there for simplicity */}
        </div>

        {(addMsg || addErr) && (
          <div className="mt-3 text-sm">
            {addMsg && <div className="text-green-700">{addMsg}</div>}
            {addErr && <div className="text-red-600">{addErr}</div>}
          </div>
        )}
      </SectionCard>

      {/* NEW — Members list */}
      <SectionCard>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Members</h2>
          <div className="flex items-center gap-2">
            <input
              value={membersQ}
              onChange={(e) => setMembersQ(e.target.value)}
              placeholder="Search name or email…"
              className="w-56 rounded border px-3 py-1.5 text-sm"
              aria-label="Search members"
            />
            <button
              onClick={() => void loadMembers(1, membersQ)}
              disabled={!orgId || membersLoading}
              className="rounded-lg border bg-white px-3 py-1.5 text-sm shadow-sm disabled:opacity-50"
            >
              {membersLoading ? "Searching…" : "Search"}
            </button>
            <button
              onClick={() => void loadMembers(membersPage, membersQ)}
              disabled={!orgId || membersLoading}
              className="rounded-lg border bg-white px-3 py-1.5 text-sm shadow-sm disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {membersErr && (
          <div className="mt-3 text-sm text-red-600">{membersErr}</div>
        )}

        <div className="mt-3">
          {membersLoading ? (
            <div className="text-sm text-gray-600">Loading members…</div>
          ) : members.length === 0 ? (
            <div className="text-sm text-gray-600">No members found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const busy = savingIds.has(m.id);
                    return (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="py-2 pr-3">{m.name}</td>
                        <td className="py-2 pr-3 text-gray-700">{m.email}</td>
                        <td className="py-2 pr-3">
                          <select
                            value={m.slot}
                            onChange={(e) =>
                              void changeMemberSlot(
                                m.id,
                                Number(e.target.value)
                              )
                            }
                            disabled={busy}
                            className="rounded border px-2 py-1"
                            aria-label={`Change role for ${m.email}`}
                          >
                            {Array.from({ length: 10 }, (_, i) => i + 1).map(
                              (n) => (
                                <option key={n} value={n}>
                                  Role {n}
                                </option>
                              )
                            )}
                          </select>
                          <span className="ml-2 text-xs text-gray-500">
                            ({m.roleLabel})
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge ok={m.roleActive}>
                            {m.roleActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="py-2">
                          <button
                            onClick={() => void removeMember(m.id)}
                            disabled={busy}
                            className="rounded-lg border bg-white px-3 py-1.5 text-xs shadow-sm"
                          >
                            {busy ? "Working…" : "Remove"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
          <div>
            Showing {(membersPage - 1) * membersPageSize + 1}–
            {Math.min(membersPage * membersPageSize, membersTotal)} of{" "}
            {membersTotal}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                void loadMembers(Math.max(1, membersPage - 1), membersQ)
              }
              disabled={membersPage <= 1 || membersLoading}
              className="rounded-lg border bg-white px-2 py-1 shadow-sm disabled:opacity-50"
            >
              Prev
            </button>
            <span>
              Page {membersPage} / {totalPages}
            </span>
            <button
              onClick={() =>
                void loadMembers(
                  Math.min(totalPages, membersPage + 1),
                  membersQ
                )
              }
              disabled={membersPage >= totalPages || membersLoading}
              className="rounded-lg border bg-white px-2 py-1 shadow-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Roles editor */}
      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error} (need <code>roles:manage</code> in this org)
        </div>
      )}

      {originalSlots.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs text-gray-600">
            Editing <code>{orgId}</code>
          </div>
          <div className="grid gap-4">
            {originalSlots.map((s) => (
              <SlotEditor
                key={s.slot}
                slot={s.slot}
                allKeys={permissionKeys}
                data={editing[s.slot]}
                onChange={(slot, next) =>
                  setEditing((prev) => ({ ...prev, [slot]: next }))
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
