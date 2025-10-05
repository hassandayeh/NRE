"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

type SlotOverride = { key: string; allowed: boolean };
type Slot = {
  slot: number;
  label: string;
  isActive: boolean;
  bookable: boolean;
  effective: string[];
  template: string[];
  overrides: SlotOverride[];
};
type RolesResponse = {
  ok: boolean;
  orgId: string;
  permissionKeys: string[];
  slots: Slot[];
  apiVersion?: string;
};

async function getJSON<T>(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}
async function patchJSON<T>(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText}${t ? ` — ${t}` : ""}`);
  }
  return (await r.json()) as T;
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">{children}</div>
  );
}

export default function RolesDebugPage() {
  const sp = useSearchParams();
  const [orgId, setOrgId] = React.useState<string | null>(
    sp.get("orgId") || null
  );

  const [data, setData] = React.useState<RolesResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [slot, setSlot] = React.useState<number>(6); // default to 6 like your screenshots
  const [permKey, setPermKey] = React.useState<string>("settings:manage");
  const [lastPatch, setLastPatch] = React.useState<any>(null);

  React.useEffect(() => {
    (async () => {
      try {
        if (!orgId) return;
        setLoading(true);
        setErr(null);
        const res = await getJSON<RolesResponse>(
          `/api/org/roles?orgId=${encodeURIComponent(orgId)}`
        );
        setData(res);
      } catch (e: any) {
        setErr(e?.message || "Failed to load.");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId]);

  const cur = React.useMemo(
    () => data?.slots.find((s) => s.slot === slot) || null,
    [data, slot]
  );

  async function doToggle(to: boolean) {
    if (!orgId) return;
    const payload = {
      orgId,
      updates: {
        [String(slot)]: {
          overrides: [{ key: permKey, allowed: to }],
        },
      },
    };
    setLastPatch(payload);
    const res = await patchJSON<RolesResponse>(`/api/org/roles`, payload);
    setData(res);
  }

  async function setBookable(to: boolean) {
    if (!orgId) return;
    const payload = {
      orgId,
      updates: {
        [String(slot)]: {
          // You can flip either via the alias, or explicitly set both keys.
          overrides: [
            { key: "booking:inviteable", allowed: to },
            { key: "directory:listed_internal", allowed: to },
          ],
          bookable: to,
        },
      },
    };
    setLastPatch(payload);
    const res = await patchJSON<RolesResponse>(`/api/org/roles`, payload);
    setData(res);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Roles Debugger</h1>

      <Box>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Org ID
            <input
              className="mt-1 h-9 w-96 rounded-md border px-3"
              value={orgId || ""}
              onChange={(e) => setOrgId(e.target.value.trim())}
              placeholder="cmg9…"
            />
          </label>

          <label className="text-sm">
            Slot
            <input
              className="mt-1 h-9 w-20 rounded-md border px-3"
              type="number"
              min={1}
              max={10}
              value={slot}
              onChange={(e) =>
                setSlot(Math.max(1, Math.min(10, Number(e.target.value) || 1)))
              }
            />
          </label>

          <label className="text-sm">
            Permission key
            <input
              className="mt-1 h-9 w-80 rounded-md border px-3"
              value={permKey}
              onChange={(e) => setPermKey(e.target.value)}
              list="keys"
            />
            <datalist id="keys">
              {(data?.permissionKeys || []).map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </label>

          <button
            onClick={() =>
              orgId &&
              getJSON<RolesResponse>(`/api/org/roles?orgId=${orgId}`).then(
                setData
              )
            }
            className="h-9 rounded-md border px-3 text-sm hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
        <div className="mt-2 text-sm text-gray-600">
          {loading ? (
            "Loading…"
          ) : err ? (
            <span className="text-red-600">{err}</span>
          ) : null}
          {data?.apiVersion ? (
            <span className="ml-2">API: {data.apiVersion}</span>
          ) : null}
        </div>
      </Box>

      <Box>
        <h2 className="mb-2 text-lg font-medium">Slot snapshot</h2>
        {!cur ? (
          <div className="text-sm text-gray-600">No slot data yet.</div>
        ) : (
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-mono">label:</span> {cur.label}{" "}
              &nbsp;|&nbsp; <span className="font-mono">isActive:</span>{" "}
              {String(cur.isActive)} &nbsp;|&nbsp;{" "}
              <span className="font-mono">bookable:</span>{" "}
              {String(cur.bookable)}
              <button
                onClick={() => setBookable(!cur.bookable)}
                className="ml-3 h-7 rounded-md border px-2 text-xs hover:bg-gray-50"
              >
                Toggle Bookable
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <div className="mb-1 font-medium">Effective</div>
                <pre className="max-h-56 overflow-auto rounded bg-gray-50 p-2">
                  {JSON.stringify(cur.effective, null, 2)}
                </pre>
              </div>
              <div>
                <div className="mb-1 font-medium">Template</div>
                <pre className="max-h-56 overflow-auto rounded bg-gray-50 p-2">
                  {JSON.stringify(cur.template, null, 2)}
                </pre>
              </div>
              <div>
                <div className="mb-1 font-medium">Overrides</div>
                <pre className="max-h-56 overflow-auto rounded bg-gray-50 p-2">
                  {JSON.stringify(cur.overrides, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </Box>

      <Box>
        <h2 className="mb-2 text-lg font-medium">Toggle one permission</h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-mono">{permKey}</span>
          <button
            onClick={() => doToggle(true)}
            disabled={!orgId}
            className="h-8 rounded-md border px-3 hover:bg-gray-50"
          >
            Allow
          </button>
          <button
            onClick={() => doToggle(false)}
            disabled={!orgId}
            className="h-8 rounded-md border px-3 hover:bg-gray-50"
          >
            Deny
          </button>
          <button
            onClick={() =>
              orgId &&
              getJSON<RolesResponse>(`/api/org/roles?orgId=${orgId}`).then(
                setData
              )
            }
            className="h-8 rounded-md border px-3 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-medium">Last PATCH payload</div>
            <pre className="max-h-56 overflow-auto rounded bg-gray-50 p-2 text-xs">
              {lastPatch ? JSON.stringify(lastPatch, null, 2) : "—"}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">
              Server snapshot after PATCH
            </div>
            <pre className="max-h-56 overflow-auto rounded bg-gray-50 p-2 text-xs">
              {data
                ? JSON.stringify(
                    data.slots.find((s) => s.slot === slot),
                    null,
                    2
                  )
                : "—"}
            </pre>
          </div>
        </div>
      </Box>

      <p className="text-xs text-gray-500">
        Tip: open <code>/api/org/roles?orgId=…</code> in a tab to see the raw
        JSON that the Settings page uses.
      </p>
    </div>
  );
}
