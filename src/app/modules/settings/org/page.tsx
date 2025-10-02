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

/** ---------- helpers ---------- */
async function fetchJSON<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin", // ensure cookies (NextAuth) are sent
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });

  const text = await res.text();
  try {
    const json = JSON.parse(text);
    // @ts-ignore allow json.error for error cases
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
        ok
          ? "bg-green-100 text-green-700 ring-1 ring-green-200"
          : "bg-gray-100 text-gray-700 ring-1 ring-gray-200"
      }`}
    >
      {children}
    </span>
  );
}
function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="p-4">{children}</div>
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
    <div className="flex gap-2 text-xs">
      {(["inherit", "allow", "deny"] as const).map((opt) => (
        <label
          key={opt}
          className="inline-flex items-center gap-1 rounded border px-2 py-1"
        >
          <input
            type="radio"
            name={name}
            checked={value === opt}
            onChange={() => onChange(opt)}
          />
          <span
            className={
              opt === "allow"
                ? "text-green-700"
                : opt === "deny"
                ? "text-red-700"
                : "text-gray-700"
            }
          >
            {opt}
          </span>
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
    <div className="grid grid-cols-2 md:grid-cols-4 items-center gap-3 py-1 border-b last:border-none">
      <div className="font-mono text-xs md:col-span-2">{k}</div>
      <div className="md:col-span-2">
        <RadioTri name={`perm-${k}`} value={state} onChange={setState} />
      </div>
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
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">
              Slot {slot} <span className="text-gray-400">/ Role</span>
            </h3>
            <Badge ok={data.isActive}>
              {data.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span>Label:</span>
            <input
              className="rounded border px-2 py-1 text-sm"
              value={data.label}
              onChange={(e) =>
                onChange(slot, { ...data, label: e.target.value })
              }
            />
            <label className="inline-flex items-center gap-2 ml-2">
              <input
                type="checkbox"
                checked={data.isActive}
                onChange={(e) =>
                  onChange(slot, { ...data, isActive: e.target.checked })
                }
              />
              <span>Active</span>
            </label>
          </div>
        </div>

        <button
          className="text-sm underline underline-offset-4"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          {open ? "Hide permissions" : "Edit permissions"}
        </button>
      </div>

      {open && (
        <div className="mt-4">
          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-xs mb-2 text-gray-600">
              Choose <strong>Allow</strong> to add a permission or{" "}
              <strong>Deny</strong> to explicitly remove it.{" "}
              <strong>Inherited</strong> uses the slot’s template.
            </div>
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
        </div>
      )}
    </SectionCard>
  );
}

/** ---------- Page (client) ---------- */
export default function OrgAccessPage() {
  const params = useSearchParams();
  const orgIdFromURL = params.get("orgId") || "";

  const [orgId, setOrgId] = useState(orgIdFromURL);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [permissionKeys, setPermissionKeys] = useState<readonly string[]>([]);
  const [originalSlots, setOriginalSlots] = useState<RoleSlot[]>([]);
  const [editing, setEditing] = useState<Record<number, SlotEdit>>({});

  const canSave = useMemo(() => {
    if (!originalSlots.length) return false;
    const updates = diffForPatch(originalSlots, editing);
    return Object.keys(updates).length > 0 && !saving;
  }, [originalSlots, editing, saving]);

  async function load() {
    console.log("Load clicked with orgId:", orgId);
    setError(null);
    setStatus("Loading...");
    setLoading(true);
    try {
      const json = await fetchJSON<RolesResponse>(
        `/api/org/roles?orgId=${encodeURIComponent(orgId)}`
      );
      console.log("Load response:", json);
      setPermissionKeys(json.permissionKeys);
      setOriginalSlots(json.slots);
      const nextEditing: Record<number, SlotEdit> = {};
      for (const s of json.slots)
        nextEditing[s.slot] = createSlotEdit(s, json.permissionKeys);
      setEditing(nextEditing);
      setStatus(`Loaded ${json.slots.length} slots`);
    } catch (e: any) {
      console.error("Load roles failed:", e);
      setError(e?.message || "Failed to load roles");
      setOriginalSlots([]);
      setEditing({});
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    console.log("Save clicked");
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
    } catch (e: any) {
      console.error("Save roles failed:", e);
      setError(e?.message || "Failed to save changes");
      setStatus(null);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (orgIdFromURL && orgIdFromURL === orgId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <h1 className="text-2xl font-semibold">Org Access</h1>
      <p className="text-sm text-gray-600">
        Manage labels, activation, and permission overrides for slots 1–10.
        Enter an <code className="px-1 rounded bg-gray-100">orgId</code> to
        load.
      </p>

      <SectionCard>
        <div className="flex flex-col md:flex-row items-start md:items-end gap-3">
          <div className="grow">
            <label className="block text-sm font-medium">Organization ID</label>
            <input
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="cmg910ga2000sknfwsn627v38"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
            {(status || error) && (
              <div className="mt-2 text-xs">
                {status && <span className="text-gray-600">{status}</span>}
                {error && <span className="text-red-600 ml-2">{error}</span>}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={!orgId || loading}
              className="rounded-lg border bg-white px-4 py-2 text-sm shadow-sm disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load"}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              className="rounded-lg bg-black px-4 py-2 text-sm text-white shadow-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-600">
            {error} (need <code>roles:manage</code> in this org)
          </p>
        )}
      </SectionCard>

      {originalSlots.length > 0 && (
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            Editing <code className="px-1 bg-gray-100 rounded">{orgId}</code>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
