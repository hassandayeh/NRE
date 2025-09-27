"use client";

/**
 * Edit Booking — multi-host + reporters in org directory.
 * This revision fixes host availability badges in AddHostPicker.
 */

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import { z } from "zod";

/* ---------- small UI helpers ---------- */
import * as ButtonModule from "../../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/* ---------- flags ---------- */
const PHONE_ENABLED =
  (process.env.NEXT_PUBLIC_APPEARANCE_PHONE ?? "true") !== "false";
const MULTI_HOSTS_ENABLED =
  (process.env.NEXT_PUBLIC_FEATURE_MULTI_HOSTS ?? "false") === "true";

/* ---------- utils ---------- */
const clsx = (...xs: any[]) => xs.filter(Boolean).join(" ");
const pad = (n: number) => String(n).padStart(2, "0");
const toDatetimeLocalValue = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};
function useDebounce<T>(v: T, delay = 250) {
  const [s, setS] = React.useState(v);
  React.useEffect(() => {
    const t = setTimeout(() => setS(v), delay);
    return () => clearTimeout(t);
  }, [v, delay]);
  return s;
}

/* ---------- types ---------- */
type TAppearance = "ONLINE" | "IN_PERSON" | "PHONE";
type TScope = "UNIFIED" | "PER_GUEST";
type TProvisioning = "SHARED" | "PER_GUEST";

type THostScope = "UNIFIED" | "PER_HOST";
type THostProvisioning = "SHARED" | "PER_HOST";

type TKind = "EXPERT" | "REPORTER";

type ParticipantRow = {
  id: string;
  name: string | null;
  kind: TKind;
  city?: string | null;
  countryCode?: string | null;
  tags?: string[] | null;
  availability?: { status: "AVAILABLE" | "BUSY" | "UNKNOWN" } | null;
};

type GuestRow = {
  id?: string;
  userId: string | null;
  name: string;
  kind: TKind;
  order: number;
  appearanceType: TAppearance;
  joinUrl: string | null;
  venueName: string | null;
  venueAddress: string | null;
  dialInfo: string | null;
};

type HostRow = {
  id?: string;
  userId: string | null;
  name: string;
  order: number;
  appearanceType: TAppearance;
  joinUrl: string | null;
  venueName: string | null;
  venueAddress: string | null;
  dialInfo: string | null;
};

type BookingDto = {
  id: string;
  orgId?: string | null;

  subject: string;
  newsroomName: string;
  programName?: string | null;
  talkingPoints?: string | null;

  startAt: string; // ISO
  durationMins: number;

  appearanceScope: TScope;
  accessProvisioning: TProvisioning;
  appearanceType: TAppearance | null;

  locationUrl?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  dialInfo?: string | null;

  hostAppearanceScope: THostScope;
  hostAccessProvisioning: THostProvisioning;
  hostAppearanceType: TAppearance | null;

  hostLocationUrl?: string | null;
  hostLocationName?: string | null;
  hostLocationAddress?: string | null;
  hostDialInfo?: string | null;

  expertUserId?: string | null;
  expertName: string;
  hostUserId?: string | null;
  hostName?: string | null;

  guests: GuestRow[];
  hosts?: HostRow[];
};

/* =======================================================================
   Guest picker (reporters + experts from org; public experts too)
======================================================================= */
function AddGuestPicker(props: {
  startAtISO: string;
  durationMins: number;
  onPick: (row: { id: string; name: string; kind: TKind }) => void;
  existingIds: string[];
}) {
  const { startAtISO, durationMins, onPick, existingIds } = props;

  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [visibility, setVisibility] = React.useState<"org" | "public" | "all">(
    "org"
  );
  const [onlyAvailable, setOnlyAvailable] = React.useState(false);

  const [items, setItems] = React.useState<ParticipantRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const haveWindow = !!(startAtISO && durationMins > 0);
  const debouncedQ = useDebounce(q, 250);

  React.useEffect(() => {
    if (!open) return;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debouncedQ, visibility, onlyAvailable, startAtISO, durationMins]);

  function normalizeOrgRows(dirItems: any[]): ParticipantRow[] {
    let rows = dirItems
      .filter((u: any) => u?.kind === "REPORTER" || u?.kind === "EXPERT")
      .map((u: any) => ({
        id: String(u.id),
        name: (u.displayName as string) ?? null,
        kind: (u.kind as TKind) ?? "EXPERT",
        city: u.city ?? null,
        countryCode: u.countryCode ?? null,
        tags: u.tags ?? [],
        availability:
          u.availability === "AVAILABLE" || u.availability === "BUSY"
            ? { status: u.availability }
            : { status: "UNKNOWN" as const },
      })) as ParticipantRow[];

    if (onlyAvailable && haveWindow) {
      rows = rows.filter((r) => r.availability?.status === "AVAILABLE");
    }
    return rows;
  }

  async function fetchOrgRows(): Promise<ParticipantRow[]> {
    const sp = new URLSearchParams();
    if (debouncedQ) sp.set("q", debouncedQ);
    if (haveWindow) {
      const start = new Date(startAtISO);
      const end = new Date(start.getTime() + durationMins * 60_000);
      sp.set("start", start.toISOString());
      sp.set("end", end.toISOString());
    }
    const res = await fetch(`/api/directory/org?${sp.toString()}`, {
      credentials: "include",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(j?.error || `Directory failed (${res.status})`);
    const dirItems = Array.isArray(j.items) ? j.items : [];
    return normalizeOrgRows(dirItems);
  }

  async function fetchPublicRows(): Promise<ParticipantRow[]> {
    const sp = new URLSearchParams({ visibility: "public", take: "20" });
    if (debouncedQ) sp.set("q", debouncedQ);
    const res = await fetch(`/api/experts/search?${sp.toString()}`, {
      credentials: "include",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(j?.error || `Public search failed (${res.status})`);
    const items: any[] = Array.isArray(j.items) ? j.items : [];
    return items.map((e: any) => ({
      id: String(e.id),
      name: (e.name as string) ?? null,
      kind: "EXPERT" as const,
      city: e.city ?? null,
      countryCode: e.countryCode ?? null,
      tags: e.tags ?? [],
      availability: e.availability?.status
        ? { status: e.availability.status }
        : { status: "UNKNOWN" as const },
    }));
  }

  async function run() {
    try {
      setLoading(true);
      setError(null);

      if (visibility === "org") {
        setItems(await fetchOrgRows());
        return;
      }
      if (visibility === "public") {
        setItems(await fetchPublicRows());
        return;
      }
      let orgRows: ParticipantRow[] = [];
      let pubRows: ParticipantRow[] = [];
      try {
        orgRows = await fetchOrgRows();
      } catch {}
      try {
        pubRows = await fetchPublicRows();
      } catch {}
      const map = new Map<string, ParticipantRow>();
      [...orgRows, ...pubRows].forEach((r) => {
        if (!map.has(r.id)) map.set(r.id, r);
      });
      setItems([...map.values()]);
    } catch (e: any) {
      setError(e?.message || "Failed to load directory.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-2 py-1 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>
        <label className="text-sm text-gray-600">
          Add guest (expert/reporter)
        </label>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        placeholder={
          visibility === "org"
            ? "Search org directory…"
            : visibility === "public"
            ? "Search public experts…"
            : "Search everyone…"
        }
        className="min-w-[240px] w-full rounded-md border px-3 py-2"
      />

      <div className="flex flex-wrap items-center gap-2">
        {(["org", "public", "all"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVisibility(v)}
            className={clsx(
              "rounded-md border px-2 py-1 text-xs capitalize",
              visibility === v ? "bg-black text-white" : "hover:bg-gray-50"
            )}
          >
            {v === "all" ? "Both" : v}
          </button>
        ))}
        <label className="ml-2 inline-flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
          />
          Only available
        </label>
      </div>

      {open && (
        <div className="space-y-2">
          {loading && <div className="text-sm text-gray-500">Loading…</div>}
          {error && <UIAlert intent="error">{error}</UIAlert>}
          {!loading && !error && items.length === 0 && (
            <div className="rounded-md border px-3 py-2 text-sm text-gray-600">
              No matches.
            </div>
          )}

          {items.map((p) => {
            const disabled = existingIds.includes(p.id);
            const status = p.availability?.status;
            const badge =
              status === "AVAILABLE"
                ? "bg-green-100 text-green-800"
                : status === "BUSY"
                ? "bg-red-100 text-red-800"
                : "bg-gray-100 text-gray-700";
            const roleBadge =
              p.kind === "REPORTER"
                ? "bg-blue-100 text-blue-800"
                : "bg-purple-100 text-purple-800";
            return (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                onClick={() =>
                  onPick({
                    id: p.id,
                    name:
                      p.name || (p.kind === "REPORTER" ? "Reporter" : "Expert"),
                    kind: p.kind,
                  })
                }
                className={clsx(
                  "w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50",
                  disabled && "opacity-50"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name || "Unnamed"}</span>
                    <span
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[10px]",
                        roleBadge
                      )}
                    >
                      {p.kind}
                    </span>
                  </div>
                  <span className={clsx("rounded px-2 py-0.5 text-xs", badge)}>
                    {status ?? "UNKNOWN"}
                  </span>
                </div>
                <div className="text-xs text-gray-600">
                  {p.city && <span>{p.city}</span>}{" "}
                  {p.countryCode && <span>({p.countryCode})</span>}{" "}
                  {(p.tags || []).slice(0, 2).map((t) => (
                    <span key={t} className="ml-1">
                      #{t}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* =======================================================================
   Host picker — FIXED availability badge
======================================================================= */

type HostDirectoryRow = { id: string; name: string | null };

function AddHostPicker(props: {
  onPick: (row: HostDirectoryRow) => void;
  existingIds: string[];
  startAtISO: string;
  durationMins: number;
}) {
  const { onPick, existingIds, startAtISO, durationMins } = props;

  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const debouncedQ = useDebounce(q, 250);

  const haveWindow = !!(startAtISO && durationMins > 0);
  const windowStart = React.useMemo(
    () => (haveWindow ? new Date(startAtISO) : null),
    [haveWindow, startAtISO]
  );
  const windowEnd = React.useMemo(
    () =>
      haveWindow && windowStart
        ? new Date(windowStart.getTime() + durationMins * 60_000)
        : null,
    [haveWindow, windowStart, durationMins]
  );

  React.useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const sp = new URLSearchParams();
        if (debouncedQ) sp.set("q", debouncedQ);

        // Send BOTH shapes so we don't rely on guesses.
        if (haveWindow && windowStart && windowEnd) {
          sp.set("start", windowStart.toISOString());
          sp.set("end", windowEnd.toISOString());
          sp.set("startAt", windowStart.toISOString());
          sp.set("durationMins", String(durationMins));
        }

        const res = await fetch(`/api/hosts/search?${sp.toString()}`, {
          credentials: "include",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || "Failed to load hosts");
        setItems(Array.isArray(j.items) ? j.items : []);
      } catch (e: any) {
        setError(e?.message || "Failed to load hosts");
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debouncedQ, startAtISO, durationMins]);

  function overlaps(a0: Date, a1: Date, b0: any, b1: any) {
    const s = b0 ?? (Array.isArray(b0) ? b0[0] : undefined);
    const e = b1 ?? (Array.isArray(b1) ? b1[1] : undefined);
    if (!s || !e) return false;
    const bs = new Date(typeof s === "string" ? s : String(s));
    const be = new Date(typeof e === "string" ? e : String(e));
    return bs < a1 && be > a0;
  }

  function hostStatus(it: any): "AVAILABLE" | "BUSY" | "UNKNOWN" {
    if (!it) return "UNKNOWN";

    // 1) Explicit signals
    const a = it.availability;
    if (a && typeof a === "object") {
      const s = (a.status ?? a.state) as string | undefined;
      if (s === "AVAILABLE" || s === "BUSY") return s;
      if (typeof a.isAvailable === "boolean")
        return a.isAvailable ? "AVAILABLE" : "BUSY";
      if (typeof a.available === "boolean")
        return a.available ? "AVAILABLE" : "BUSY";
      if (Array.isArray(a.busy) && windowStart && windowEnd) {
        const hit = a.busy.some((w: any) =>
          overlaps(windowStart, windowEnd, w?.start ?? w?.s, w?.end ?? w?.e)
        );
        return hit ? "BUSY" : "AVAILABLE";
      }
    }
    if (typeof a === "string")
      return a === "AVAILABLE" || a === "BUSY" ? a : "UNKNOWN";

    if (typeof it.status === "string") {
      const s = it.status.toUpperCase();
      if (s === "AVAILABLE" || s === "BUSY") return s as any;
    }
    if (typeof it.isAvailable === "boolean")
      return it.isAvailable ? "AVAILABLE" : "BUSY";
    if (typeof it.available === "boolean")
      return it.available ? "AVAILABLE" : "BUSY";
    if (typeof it.busy === "boolean") return it.busy ? "BUSY" : "AVAILABLE";

    // 2) Derive from busy windows arrays
    const arrays = [
      it.busy,
      it.busyWindows,
      it.calendarBusy,
      it.blocks,
      it.availability?.busy,
      it.calendar?.busy,
    ].filter(Boolean);

    if (arrays.length && windowStart && windowEnd) {
      let sawAny = false;
      for (const arr of arrays) {
        if (!Array.isArray(arr)) continue;
        sawAny = true;
        for (const w of arr) {
          const s = w?.start ?? w?.s ?? w?.[0];
          const e = w?.end ?? w?.e ?? w?.[1];
          if (s && e && overlaps(windowStart, windowEnd, s, e)) return "BUSY";
        }
      }
      if (sawAny) return "AVAILABLE";
    }

    return "UNKNOWN";
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-2 py-1 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>
        <label className="text-sm text-gray-600">Add host</label>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        className="w-full rounded-md border px-3 py-2"
        placeholder="Search hosts…"
      />

      {open && (
        <div className="space-y-2">
          {loading && (
            <div className="text-sm text-gray-500">Loading hosts…</div>
          )}
          {error && <UIAlert intent="error">{error}</UIAlert>}
          {!loading && !error && items.length === 0 && (
            <div className="rounded-md border px-3 py-2 text-sm text-gray-600">
              No host directory available.
            </div>
          )}
          {items.map((h: any) => {
            const disabled = existingIds.includes(h.id);
            const status = hostStatus(h);
            const badge =
              status === "AVAILABLE"
                ? "bg-green-100 text-green-800"
                : status === "BUSY"
                ? "bg-red-100 text-red-800"
                : "bg-gray-100 text-gray-700";
            return (
              <button
                key={h.id}
                type="button"
                disabled={disabled}
                onClick={() => onPick({ id: h.id, name: h.name || "Host" })}
                className={clsx(
                  "w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50",
                  disabled && "opacity-50"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{h.name || "Unnamed"}</div>
                    <div className="text-[11px] text-gray-500">{h.id}</div>
                  </div>
                  <span className={clsx("rounded px-2 py-0.5 text-xs", badge)}>
                    {status}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* =======================================================================
   Legacy single-host combobox (kept intact; hidden when multi-hosts enabled)
======================================================================= */
function HostCombobox(props: {
  value: { id: string; name: string | null } | null;
  onChange: (next: { id: string; name: string | null } | null) => void;
}) {
  const { value, onChange } = props;
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const debouncedQ = useDebounce(q, 250);

  React.useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const sp = new URLSearchParams();
        if (debouncedQ) sp.set("q", debouncedQ);
        const res = await fetch(`/api/hosts/search?${sp.toString()}`, {
          credentials: "include",
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Failed to load hosts");
        setItems(Array.isArray(j.items) ? j.items : []);
      } catch (e: any) {
        setError(e?.message || "Failed to load hosts");
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, debouncedQ]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>

        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-md border px-3 py-2 text-sm text-red-700 hover:bg-red-50"
            title="Remove host"
          >
            Remove
          </button>
        )}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        className="w-full rounded-md border px-3 py-2"
        placeholder="Search hosts…"
      />

      {open && (
        <div className="space-y-2">
          {loading && <div>Loading hosts…</div>}
          {error && <UIAlert intent="error">{error}</UIAlert>}
          {!loading && !error && items.length === 0 && (
            <div className="rounded-md border px-3 py-2 text-sm text-gray-600">
              No host directory available.
            </div>
          )}
          {items.map((h: any) => (
            <button
              key={h.id}
              type="button"
              onClick={() => {
                onChange({ id: h.id, name: h.name || "Unknown" });
                setOpen(false);
              }}
              className="w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50"
            >
              <div className="font-medium">{h.name || "Unnamed"}</div>
              <div className="text-[11px] text-gray-500">{h.id}</div>
            </button>
          ))}
        </div>
      )}

      <div className="text-sm text-gray-700">
        Selected host: {value ? <b>{value.name}</b> : <i>none</i>}
      </div>
    </div>
  );
}

/* =======================================================================
   Page
======================================================================= */

type FieldErrors = { locationName?: string; locationAddress?: string };
type HostDefaultsErrors = {
  hostLocationUrl?: string;
  hostLocationName?: string;
  hostLocationAddress?: string;
  hostDialInfo?: string;
};
type GuestFieldErrors = {
  joinUrl?: string;
  venueName?: string;
  venueAddress?: string;
  dialInfo?: string;
};
type HostFieldErrors = GuestFieldErrors;

export default function EditBookingPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const rawId = (params as any)?.id;
  const id =
    typeof rawId === "string"
      ? rawId
      : Array.isArray(rawId)
      ? rawId[0]
      : undefined;

  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [form, setForm] = React.useState<BookingDto | null>(null);

  // Legacy single-host (flag off)
  const [hostPick, setHostPick] = React.useState<{
    id: string;
    name: string | null;
  } | null>(null);

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [hostDefaultsErrors, setHostDefaultsErrors] =
    React.useState<HostDefaultsErrors>({});
  const [guestErrors, setGuestErrors] = React.useState<GuestFieldErrors[]>([]);
  const [hostErrors, setHostErrors] = React.useState<HostFieldErrors[]>([]);

  const deletedGuestIdsRef = React.useRef<string[]>([]);

  React.useEffect(() => {
    let alive = true;
    if (!id) return;

    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        setSaveError(null);

        const res = await fetch(`/api/bookings/${id}`, {
          credentials: "include",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || "Failed to load booking");

        const b = (j?.booking ?? j) as any;

        const dto: BookingDto = {
          id: b.id,
          orgId: b.orgId ?? null,
          subject: b.subject,
          newsroomName: b.newsroomName,
          programName: b.programName ?? null,
          talkingPoints: b.talkingPoints ?? null,
          startAt: b.startAt,
          durationMins: b.durationMins,

          appearanceScope: (b.appearanceScope ?? "UNIFIED") as TScope,
          accessProvisioning: (b.accessProvisioning ??
            "SHARED") as TProvisioning,
          appearanceType: (b.appearanceType ?? null) as TAppearance | null,

          locationUrl: b.locationUrl ?? null,
          locationName: b.locationName ?? null,
          locationAddress: b.locationAddress ?? null,
          dialInfo: b.dialInfo ?? null,

          hostAppearanceScope: (b.hostAppearanceScope ??
            "UNIFIED") as THostScope,
          hostAccessProvisioning: (b.hostAccessProvisioning ??
            "SHARED") as THostProvisioning,
          hostAppearanceType: (b.hostAppearanceType ??
            b.appearanceType ??
            "ONLINE") as TAppearance | null,

          hostLocationUrl: b.hostLocationUrl ?? b.locationUrl ?? null,
          hostLocationName: b.hostLocationName ?? b.locationName ?? null,
          hostLocationAddress:
            b.hostLocationAddress ?? b.locationAddress ?? null,
          hostDialInfo: b.hostDialInfo ?? b.dialInfo ?? null,

          expertUserId: b.expertUserId ?? null,
          expertName: b.expertName ?? "",

          hostUserId: b.hostUserId ?? null,
          hostName: b.hostName ?? null,

          guests: [],
          hosts: [],
        };

        dto.guests = (b.guests || [])
          .slice()
          .sort((a: any, b2: any) => (a.order ?? 0) - (b2.order ?? 0))
          .map((g: any, i: number) => ({
            id: g.id,
            userId: g.userId ?? null,
            name: g.name ?? "Guest",
            kind: (g.kind as any) === "REPORTER" ? "REPORTER" : "EXPERT",
            order: Number.isFinite(g.order) ? g.order : i,
            appearanceType: (g.appearanceType as any) ?? "ONLINE",
            joinUrl: g.joinUrl ?? null,
            venueName: g.venueName ?? null,
            venueAddress: g.venueAddress ?? null,
            dialInfo: g.dialInfo ?? null,
          }));

        const apiHosts: HostRow[] =
          (b.hosts || [])
            .slice()
            .sort((a: any, b2: any) => (a.order ?? 0) - (b2.order ?? 0))
            .map((h: any, i: number) => ({
              id: h.id,
              userId: h.userId ?? null,
              name: h.name ?? "Host",
              order: Number.isFinite(h.order) ? h.order : i,
              appearanceType: (h.appearanceType as any) ?? "ONLINE",
              joinUrl: h.joinUrl ?? null,
              venueName: h.venueName ?? null,
              venueAddress: h.venueAddress ?? null,
              dialInfo: h.dialInfo ?? null,
            })) || [];

        if (MULTI_HOSTS_ENABLED) {
          if (
            (!apiHosts || apiHosts.length === 0) &&
            (dto.hostUserId || dto.hostName)
          ) {
            dto.hosts = [
              {
                userId: dto.hostUserId ?? null,
                name: dto.hostName ?? "Host",
                order: 0,
                appearanceType:
                  dto.hostAppearanceScope === "UNIFIED"
                    ? dto.hostAppearanceType ?? "ONLINE"
                    : "ONLINE",
                joinUrl: null,
                venueName: null,
                venueAddress: null,
                dialInfo: null,
              },
            ];
          } else {
            dto.hosts = apiHosts;
          }
        }

        if (!PHONE_ENABLED && dto.appearanceType === "PHONE")
          dto.appearanceType = "ONLINE";
        if (!PHONE_ENABLED && dto.hostAppearanceType === "PHONE")
          dto.hostAppearanceType = "ONLINE";

        if (alive) {
          setForm(dto);
          setHostPick(
            dto.hostUserId
              ? { id: dto.hostUserId, name: dto.hostName ?? null }
              : null
          );
          setGuestErrors(new Array((dto.guests || []).length).fill({}));
          setHostErrors(new Array((dto.hosts || []).length).fill({}));
        }
      } catch (e: any) {
        if (alive) setLoadError(e?.message || "Failed to load booking");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  /* ---------- patch helpers ---------- */
  function patch(p: Partial<BookingDto>) {
    setSaveError(null);
    setFieldErrors({});
    setHostDefaultsErrors({});
    setForm((f) => (f ? { ...f, ...p } : f));
  }
  function patchGuest(idx: number, p: Partial<GuestRow>) {
    setSaveError(null);
    setGuestErrors((errs) => {
      const next = errs.slice();
      next[idx] = {};
      return next;
    });
    setForm((f) => {
      if (!f) return f;
      const list = (f.guests || []).slice();
      list[idx] = { ...list[idx], ...p };
      return { ...f, guests: list };
    });
  }
  function patchHost(idx: number, p: Partial<HostRow>) {
    setSaveError(null);
    setHostErrors((errs) => {
      const next = errs.slice();
      next[idx] = {};
      return next;
    });
    setForm((f) => {
      if (!f) return f;
      const list = (f.hosts || []).slice();
      list[idx] = { ...list[idx], ...p };
      return { ...f, hosts: list };
    });
  }

  const BaseSchema = React.useMemo(
    () =>
      z.object({
        subject: z.string().min(2),
        newsroomName: z.string().min(2),
        startAt: z.preprocess(
          (v) => (typeof v === "string" ? new Date(v) : v),
          z.date()
        ),
        durationMins: z.number().min(5).max(600),
        appearanceScope: z.enum(["UNIFIED", "PER_GUEST"]),
        accessProvisioning: z.enum(["SHARED", "PER_GUEST"]),
        hostAppearanceScope: z.enum(["UNIFIED", "PER_HOST"]),
        hostAccessProvisioning: z.enum(["SHARED", "PER_HOST"]),
      }),
    []
  );

  /* ---------- client validation (unchanged) ---------- */
  function validateClient(f: BookingDto) {
    const errs: FieldErrors = {};
    const hostDefErrs: HostDefaultsErrors = {};
    const gErrs: GuestFieldErrors[] = [];
    const hErrs: HostFieldErrors[] = [];

    if (
      f.accessProvisioning === "SHARED" &&
      f.appearanceScope === "UNIFIED" &&
      (f.appearanceType ?? "ONLINE") === "IN_PERSON"
    ) {
      const ln = (f.locationName ?? "").trim();
      const la = (f.locationAddress ?? "").trim();
      if (!ln && !la) {
        const m =
          "Provide venue name or address for unified in-person bookings.";
        errs.locationName = m;
        errs.locationAddress = m;
      }
    }

    const perGuestProvisioned = f.accessProvisioning === "PER_GUEST";

    (f.guests || []).forEach((g, i) => {
      const ge: GuestFieldErrors = {};
      if (perGuestProvisioned) {
        if (f.appearanceScope === "UNIFIED") {
          const t = (f.appearanceType ?? "ONLINE") as TAppearance;
          if (t === "ONLINE") {
            if (!String(g.joinUrl ?? "").trim())
              ge.joinUrl = "Join URL is required (per-guest access).";
          } else if (t === "IN_PERSON") {
            const vn = String(g.venueName ?? "").trim();
            const va = String(g.venueAddress ?? "").trim();
            if (!vn && !va)
              ge.venueName = ge.venueAddress =
                "Venue name or address is required (per-guest access).";
          } else if (t === "PHONE") {
            if (!String(g.dialInfo ?? "").trim())
              ge.dialInfo = "Dial info is required (per-guest access).";
          }
        } else {
          if (g.appearanceType === "ONLINE") {
            if (!String(g.joinUrl ?? "").trim())
              ge.joinUrl = "Join URL is required (per-guest access).";
          } else if (g.appearanceType === "IN_PERSON") {
            const vn = String(g.venueName ?? "").trim();
            const va = String(g.venueAddress ?? "").trim();
            if (!vn && !va)
              ge.venueName = ge.venueAddress =
                "Venue name or address is required (per-guest access).";
          } else if (g.appearanceType === "PHONE" && PHONE_ENABLED) {
            if (!String(g.dialInfo ?? "").trim())
              ge.dialInfo = "Dial info is required (per-guest access).";
          }
        }
      }
      gErrs[i] = ge;
    });

    if (MULTI_HOSTS_ENABLED) {
      const hScope = f.hostAppearanceScope;
      const hProv = f.hostAccessProvisioning;
      const hUnifiedType = (f.hostAppearanceType ?? "ONLINE") as TAppearance;

      if (hScope === "UNIFIED") {
        if (!f.hostAppearanceType) {
          hostDefErrs.hostLocationUrl = "Host appearance type is required.";
        }
        if (hProv === "SHARED") {
          if (hUnifiedType === "ONLINE") {
            if (!String(f.hostLocationUrl ?? "").trim())
              hostDefErrs.hostLocationUrl =
                "Host default meeting link is required.";
          } else if (hUnifiedType === "IN_PERSON") {
            const vn = String(f.hostLocationName ?? "").trim();
            const va = String(f.hostLocationAddress ?? "").trim();
            if (!vn && !va) {
              const m = "Provide host venue name or address (host defaults).";
              hostDefErrs.hostLocationName = m;
              hostDefErrs.hostLocationAddress = m;
            }
          } else if (hUnifiedType === "PHONE" && PHONE_ENABLED) {
            if (!String(f.hostDialInfo ?? "").trim())
              hostDefErrs.hostDialInfo = "Host default dial info is required.";
          }
        } else {
          (f.hosts || []).forEach((h, i) => {
            const he: HostFieldErrors = {};
            if (hUnifiedType === "ONLINE") {
              if (!String(h.joinUrl ?? "").trim())
                he.joinUrl = "Join URL is required (per-host access).";
            } else if (hUnifiedType === "IN_PERSON") {
              const vn = String(h.venueName ?? "").trim();
              const va = String(h.venueAddress ?? "").trim();
              if (!vn && !va)
                he.venueName = he.venueAddress =
                  "Venue name or address is required (per-host access).";
            } else if (hUnifiedType === "PHONE" && PHONE_ENABLED) {
              if (!String(h.dialInfo ?? "").trim())
                he.dialInfo = "Dial info is required (per-host access).";
            }
            hErrs[i] = he;
          });
        }
      } else {
        if (hProv !== "PER_HOST") {
          hostDefErrs.hostLocationUrl =
            "When host scope is PER_HOST, provisioning must be PER_HOST.";
        }
        (f.hosts || []).forEach((h, i) => {
          const he: HostFieldErrors = {};
          if (h.appearanceType === "ONLINE") {
            if (!String(h.joinUrl ?? "").trim())
              he.joinUrl = "Join URL is required (per-host access).";
          } else if (h.appearanceType === "IN_PERSON") {
            const vn = String(h.venueName ?? "").trim();
            const va = String(h.venueAddress ?? "").trim();
            if (!vn && !va)
              he.venueName = he.venueAddress =
                "Venue name or address is required (per-host access).";
          } else if (h.appearanceType === "PHONE" && PHONE_ENABLED) {
            if (!String(h.dialInfo ?? "").trim())
              he.dialInfo = "Dial info is required (per-host access).";
          }
          hErrs[i] = he;
        });
      }
    }

    const hasGuestIssues = gErrs.some((o) => Object.keys(o || {}).length > 0);
    const hasHostIssues = hErrs.some((o) => Object.keys(o || {}).length > 0);
    const hasHostDefaultIssues = Object.keys(hostDefErrs).length > 0;
    const ok =
      Object.keys(errs).length === 0 &&
      !hasGuestIssues &&
      !hasHostIssues &&
      !hasHostDefaultIssues;

    let banner: string | null = null;
    if (!ok) {
      const parts: string[] = [];
      if (errs.locationName || errs.locationAddress)
        parts.push("Guest defaults (venue name or address)");
      if (hasHostDefaultIssues) {
        if (hostDefErrs.hostLocationUrl)
          parts.push("Host defaults (meeting link)");
        if (hostDefErrs.hostLocationName || hostDefErrs.hostLocationAddress)
          parts.push("Host defaults (venue name/address)");
        if (hostDefErrs.hostDialInfo) parts.push("Host defaults (dial info)");
      }
      gErrs.forEach((ge, i) => {
        if (Object.keys(ge).length) {
          const needs = ge.joinUrl
            ? "join URL"
            : ge.dialInfo
            ? "dial info"
            : "venue name or address";
          parts.push(`Guest #${i + 1} (${needs})`);
        }
      });
      (MULTI_HOSTS_ENABLED ? hErrs : []).forEach((he, i) => {
        if (Object.keys(he).length) {
          const needs = he.joinUrl
            ? "join URL"
            : he.dialInfo
            ? "dial info"
            : "venue name or address";
          parts.push(`Host #${i + 1} (${needs})`);
        }
      });
      banner = `Fix ${parts.length} item${
        parts.length > 1 ? "s" : ""
      }: ${parts.join("; ")}.`;
    }

    return {
      ok,
      fieldErrs: errs,
      hostDefErrs: hostDefErrs,
      guestErrs: gErrs,
      hostErrs: hErrs,
      banner,
    };
  }

  /* ---------- list ops ---------- */
  function removeGuest(idx: number) {
    setForm((f) => {
      if (!f) return f;
      const list = (f.guests || []).slice();
      const [removed] = list.splice(idx, 1);
      if (removed?.id)
        deletedGuestIdsRef.current = [
          ...deletedGuestIdsRef.current,
          removed.id,
        ];
      list.forEach((g, i) => (g.order = i));
      setGuestErrors((old) => {
        const next = old.slice();
        next.splice(idx, 1);
        return next;
      });
      return { ...f, guests: list };
    });
  }
  function moveHost(idx: number, dir: -1 | 1) {
    setForm((f) => {
      if (!f) return f;
      const list = (f.hosts || []).slice();
      const j = idx + dir;
      if (j < 0 || j >= list.length) return f;
      const tmp = list[idx];
      list[idx] = list[j];
      list[j] = tmp;
      list.forEach((h, i) => (h.order = i));
      return { ...f, hosts: list };
    });
  }
  function removeHost(idx: number) {
    setForm((f) => {
      if (!f) return f;
      const list = (f.hosts || []).slice();
      list.splice(idx, 1);
      list.forEach((h, i) => (h.order = i));
      setHostErrors((old) => {
        const next = old.slice();
        next.splice(idx, 1);
        return next;
      });
      return { ...f, hosts: list };
    });
  }

  function addPerson(row: { id: string; name: string; kind: TKind }) {
    setForm((f) => {
      if (!f) return f;
      if ((f.guests || []).some((g) => g.userId === row.id)) return f;
      const next: GuestRow = {
        userId: row.id,
        name: row.name || (row.kind === "REPORTER" ? "Reporter" : "Expert"),
        kind: row.kind,
        order: f.guests?.length ?? 0,
        appearanceType: "ONLINE",
        joinUrl: null,
        venueName: null,
        venueAddress: null,
        dialInfo: null,
      };
      setGuestErrors((errs) => [...errs, {} as GuestFieldErrors]);
      return { ...f, guests: [...(f.guests || []), next] };
    });
  }

  function addHost(row: { id: string; name: string | null }) {
    setForm((f) => {
      if (!f) return f;
      if ((f.hosts || []).some((h) => h.userId === row.id)) return f;
      const type: TAppearance =
        f.hostAppearanceScope === "UNIFIED"
          ? f.hostAppearanceType ?? "ONLINE"
          : "ONLINE";
      const next: HostRow = {
        userId: row.id,
        name: row.name || "Host",
        order: f.hosts?.length ?? 0,
        appearanceType: type,
        joinUrl: null,
        venueName: null,
        venueAddress: null,
        dialInfo: null,
      };
      setHostErrors((errs) => [...errs, {} as HostFieldErrors]);
      return { ...f, hosts: [...(f.hosts || []), next] };
    });
  }

  /* ---------- submit ---------- */
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setOk(null);
    setSaveError(null);

    try {
      BaseSchema.parse({
        subject: form.subject,
        newsroomName: form.newsroomName,
        startAt: form.startAt,
        durationMins: form.durationMins,
        appearanceScope: form.appearanceScope,
        accessProvisioning: form.accessProvisioning,
        hostAppearanceScope: form.hostAppearanceScope,
        hostAccessProvisioning: form.hostAccessProvisioning,
      });
    } catch (err: any) {
      setSaveError(err?.errors?.[0]?.message ?? "Please check your inputs.");
      return;
    }

    const v = validateClient(form);
    if (!v.ok) {
      setFieldErrors(v.fieldErrs);
      setHostDefaultsErrors(v.hostDefErrs);
      setGuestErrors(v.guestErrs);
      setHostErrors(v.hostErrs);
      setSaveError(v.banner || "Fix the highlighted fields.");
      return;
    }

    setFieldErrors({});
    setHostDefaultsErrors({});
    setGuestErrors([]);
    setHostErrors([]);

    const payload: any = {
      subject: form.subject,
      newsroomName: form.newsroomName,
      startAt: new Date(form.startAt).toISOString(),
      durationMins: Number(form.durationMins),
      appearanceScope: form.appearanceScope,
      accessProvisioning:
        form.appearanceScope === "PER_GUEST"
          ? "PER_GUEST"
          : form.accessProvisioning,
      appearanceType:
        form.appearanceScope === "UNIFIED"
          ? form.appearanceType ?? "ONLINE"
          : null,
      locationUrl: form.locationUrl || null,
      locationName: form.locationName || null,
      locationAddress: form.locationAddress || null,
      dialInfo: form.dialInfo || null,
      programName: form.programName || null,
      talkingPoints: form.talkingPoints || null,

      hostAppearanceScope: form.hostAppearanceScope,
      hostAccessProvisioning:
        form.hostAppearanceScope === "PER_HOST"
          ? "PER_HOST"
          : form.hostAccessProvisioning,
      hostAppearanceType:
        form.hostAppearanceScope === "UNIFIED"
          ? form.hostAppearanceType ?? "ONLINE"
          : null,
      hostLocationUrl:
        form.hostAppearanceScope === "UNIFIED" &&
        form.hostAccessProvisioning === "SHARED"
          ? form.hostLocationUrl || null
          : null,
      hostLocationName:
        form.hostAppearanceScope === "UNIFIED" &&
        form.hostAccessProvisioning === "SHARED"
          ? form.hostLocationName || null
          : null,
      hostLocationAddress:
        form.hostAppearanceScope === "UNIFIED" &&
        form.hostAccessProvisioning === "SHARED"
          ? form.hostLocationAddress || null
          : null,
      hostDialInfo:
        form.hostAppearanceScope === "UNIFIED" &&
        form.hostAccessProvisioning === "SHARED"
          ? form.hostDialInfo || null
          : null,
    };

    if (form.appearanceScope === "PER_GUEST") {
      payload.guests = (form.guests || []).map((g, i) => {
        const t = g.appearanceType;
        return {
          id: g.id,
          userId: g.userId ?? null,
          name: g.name,
          kind: g.kind,
          order: Number.isFinite(g.order) ? g.order : i,
          appearanceType: t,
          joinUrl: t === "ONLINE" ? g.joinUrl || null : null,
          venueName: t === "IN_PERSON" ? g.venueName || null : null,
          venueAddress: t === "IN_PERSON" ? g.venueAddress || null : null,
          dialInfo: t === "PHONE" ? g.dialInfo || null : null,
        };
      });
    } else {
      const unifiedType: TAppearance = form.appearanceType ?? "ONLINE";
      payload.guests = (form.guests || []).map((g, i) => ({
        id: g.id,
        userId: g.userId ?? null,
        name: g.name,
        kind: g.kind,
        order: Number.isFinite(g.order) ? g.order : i,
        appearanceType: unifiedType,
        joinUrl:
          form.accessProvisioning === "PER_GUEST" && unifiedType === "ONLINE"
            ? g.joinUrl || null
            : null,
        venueName:
          form.accessProvisioning === "PER_GUEST" && unifiedType === "IN_PERSON"
            ? g.venueName || null
            : null,
        venueAddress:
          form.accessProvisioning === "PER_GUEST" && unifiedType === "IN_PERSON"
            ? g.venueAddress || null
            : null,
        dialInfo:
          form.accessProvisioning === "PER_GUEST" && unifiedType === "PHONE"
            ? g.dialInfo || null
            : null,
      }));
    }

    if (!MULTI_HOSTS_ENABLED) {
      payload.hostUserId = hostPick ? hostPick.id : null;
      payload.hostName = hostPick ? hostPick.name || null : null;
    } else {
      if (form.hostAppearanceScope === "PER_HOST") {
        payload.hosts = (form.hosts || []).map((h, i) => {
          const t = h.appearanceType;
          return {
            id: h.id,
            userId: h.userId ?? null,
            name: h.name,
            order: Number.isFinite(h.order) ? h.order : i,
            appearanceType: t,
            joinUrl: t === "ONLINE" ? h.joinUrl || null : null,
            venueName: t === "IN_PERSON" ? h.venueName || null : null,
            venueAddress: t === "IN_PERSON" ? h.venueAddress || null : null,
            dialInfo: t === "PHONE" ? h.dialInfo || null : null,
          };
        });
      } else {
        const unifiedType: TAppearance = form.hostAppearanceType ?? "ONLINE";
        payload.hosts = (form.hosts || []).map((h, i) => ({
          id: h.id,
          userId: h.userId ?? null,
          name: h.name,
          order: Number.isFinite(h.order) ? h.order : i,
          appearanceType: unifiedType,
          joinUrl:
            form.hostAccessProvisioning === "PER_HOST" &&
            unifiedType === "ONLINE"
              ? h.joinUrl || null
              : null,
          venueName:
            form.hostAccessProvisioning === "PER_HOST" &&
            unifiedType === "IN_PERSON"
              ? h.venueName || null
              : null,
          venueAddress:
            form.hostAccessProvisioning === "PER_HOST" &&
            unifiedType === "IN_PERSON"
              ? h.venueAddress || null
              : null,
          dialInfo:
            form.hostAccessProvisioning === "PER_HOST" &&
            unifiedType === "PHONE"
              ? h.dialInfo || null
              : null,
        }));
      }
    }

    if (deletedGuestIdsRef.current.length) {
      payload.deletedGuestIds = deletedGuestIdsRef.current.slice();
    }

    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(j?.error || "Save failed");
        return;
      }
      setOk("Saved.");
      router.push(`/modules/booking/${id}`);
    } catch (err: any) {
      setSaveError(err?.message || "Save failed");
    }
  }

  /* ---------- render ---------- */
  if (loading)
    return (
      <div className="p-6">
        <div className="text-sm text-gray-600">Loading…</div>
      </div>
    );

  if (!form) {
    return (
      <div className="p-6">
        <UIAlert intent="error">{loadError || "Not found"}</UIAlert>
      </div>
    );
  }

  const existingGuestUserIds = (form.guests || [])
    .filter((g) => g.userId)
    .map((g) => g.userId as string);

  const guestsSharedProvisioned = form.accessProvisioning === "SHARED";
  const guestsUnified = form.appearanceScope === "UNIFIED";

  const hostsUnified = form.hostAppearanceScope === "UNIFIED";
  const hostsShared = form.hostAccessProvisioning === "SHARED";
  const hostUnifiedType = (form.hostAppearanceType ?? "ONLINE") as TAppearance;

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Edit booking</h1>

      {saveError && <UIAlert intent="error">{saveError}</UIAlert>}
      {ok && <UIAlert intent="success">{ok}</UIAlert>}

      {/* Basic */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm">Subject</span>
          <input
            value={form.subject}
            onChange={(e) => patch({ subject: e.target.value })}
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm">Newsroom name</span>
          <input
            value={form.newsroomName}
            onChange={(e) => patch({ newsroomName: e.target.value })}
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm">Start at</span>
          <input
            type="datetime-local"
            value={toDatetimeLocalValue(form.startAt)}
            onChange={(e) =>
              patch({ startAt: new Date(e.target.value).toISOString() })
            }
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm">Duration (mins)</span>
          <input
            type="number"
            min={5}
            max={600}
            value={form.durationMins}
            onChange={(e) => patch({ durationMins: Number(e.target.value) })}
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>
      </div>

      {/* Guests controls */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="space-y-1 md:col-span-1">
          <span className="text-sm">Appearance scope (guests)</span>
          <select
            value={form.appearanceScope}
            onChange={(e) => {
              const next = e.target.value as TScope;
              if (next === "PER_GUEST") {
                patch({
                  appearanceScope: next,
                  accessProvisioning: "PER_GUEST",
                });
              } else {
                patch({ appearanceScope: next });
              }
            }}
            className="w-full rounded-md border px-3 py-2"
          >
            <option value="UNIFIED">UNIFIED (single)</option>
            <option value="PER_GUEST">PER_GUEST</option>
          </select>
        </label>

        {form.appearanceScope === "UNIFIED" ? (
          <>
            <label className="space-y-1">
              <span className="text-sm">Access provisioning (guests)</span>
              <select
                value={form.accessProvisioning}
                onChange={(e) =>
                  patch({ accessProvisioning: e.target.value as TProvisioning })
                }
                className="w-full rounded-md border px-3 py-2"
              >
                <option value="SHARED">SHARED</option>
                <option value="PER_GUEST">PER_GUEST</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-sm">Unified type (guests)</span>
              <select
                value={form.appearanceType ?? "ONLINE"}
                onChange={(e) =>
                  patch({ appearanceType: e.target.value as TAppearance })
                }
                className="w-full rounded-md border px-3 py-2"
              >
                <option value="ONLINE">ONLINE</option>
                <option value="IN_PERSON">IN_PERSON</option>
                {PHONE_ENABLED && <option value="PHONE">PHONE</option>}
              </select>
            </label>
          </>
        ) : (
          <div className="md:col-span-2">
            <div className="rounded-md border px-3 py-2 text-sm text-gray-700">
              Each guest selects their own appearance and access. Provisioning
              is per guest.
            </div>
          </div>
        )}
      </div>

      {/* Guest defaults (UNIFIED + SHARED) */}
      {guestsSharedProvisioned && guestsUnified && (
        <div className="space-y-3">
          <div className="font-medium">Guest defaults</div>

          {(form.appearanceType ?? "ONLINE") === "ONLINE" && (
            <label className="space-y-1">
              <span className="text-sm">Default meeting link (guests)</span>
              <input
                value={form.locationUrl ?? ""}
                onChange={(e) => patch({ locationUrl: e.target.value })}
                className="w-full rounded-md border px-3 py-2"
                placeholder="https://…"
              />
            </label>
          )}

          {(form.appearanceType ?? "ONLINE") === "IN_PERSON" && (
            <>
              <label className="space-y-1">
                <span className="text-sm">Default venue name (guests)</span>
                <input
                  value={form.locationName ?? ""}
                  onChange={(e) => patch({ locationName: e.target.value })}
                  className={clsx(
                    "w-full rounded-md border px-3 py-2",
                    fieldErrors.locationName && "border-red-500"
                  )}
                  placeholder="Studio A"
                />
                {fieldErrors.locationName && (
                  <div className="text-xs text-red-600">
                    {fieldErrors.locationName}
                  </div>
                )}
              </label>

              <label className="space-y-1">
                <span className="text-sm">Default address (guests)</span>
                <input
                  value={form.locationAddress ?? ""}
                  onChange={(e) => patch({ locationAddress: e.target.value })}
                  className={clsx(
                    "w-full rounded-md border px-3 py-2",
                    fieldErrors.locationAddress && "border-red-500"
                  )}
                  placeholder="123 Example St…"
                />
                {fieldErrors.locationAddress && (
                  <div className="text-xs text-red-600">
                    {fieldErrors.locationAddress}
                  </div>
                )}
              </label>
            </>
          )}

          {(form.appearanceType ?? "ONLINE") === "PHONE" && PHONE_ENABLED && (
            <label className="space-y-1">
              <span className="text-sm">Default dial info (guests)</span>
              <input
                value={form.dialInfo ?? ""}
                onChange={(e) => patch({ dialInfo: e.target.value })}
                className="w-full rounded-md border px-3 py-2"
                placeholder="e.g., +1 555 123 4567 PIN 0000"
              />
            </label>
          )}
        </div>
      )}

      {/* Guests list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">Guests</div>
          <div className="text-xs text-gray-600">
            {form.guests?.length ?? 0} selected
          </div>
        </div>

        {(form.guests || []).length === 0 && (
          <div className="rounded-md border px-3 py-2 text-sm text-gray-600">
            No guests yet. Use “Add guest” below to append experts or reporters.
          </div>
        )}

        {form.guests?.map((g, idx) => {
          const ge = guestErrors[idx] || {};
          const unifiedType = (form.appearanceType ?? "ONLINE") as TAppearance;
          return (
            <div key={idx} className="rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  #{idx + 1} {g.name}{" "}
                  <span className="text-xs text-gray-500">({g.kind})</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeGuest(idx)}
                  className="rounded-md border px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  title="Remove guest"
                >
                  Remove
                </button>
              </div>

              {g.userId && (
                <div className="mt-1 text-[11px] text-gray-500">{g.userId}</div>
              )}

              {form.appearanceScope === "UNIFIED" ? (
                <>
                  {form.accessProvisioning === "SHARED" ? (
                    <div className="mt-2 text-sm text-gray-700">
                      Using unified settings ({form.appearanceType ?? "ONLINE"}
                      ). No per-guest access fields.
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {unifiedType === "ONLINE" && (
                        <label className="space-y-1">
                          <span className="text-sm">Join URL</span>
                          <input
                            value={g.joinUrl ?? ""}
                            onChange={(ev) =>
                              patchGuest(idx, { joinUrl: ev.target.value })
                            }
                            className={clsx(
                              "w-full rounded-md border px-3 py-2",
                              ge.joinUrl && "border-red-500"
                            )}
                            placeholder="https://…"
                          />
                          {ge.joinUrl && (
                            <div className="text-xs text-red-600">
                              {ge.joinUrl}
                            </div>
                          )}
                        </label>
                      )}

                      {unifiedType === "IN_PERSON" && (
                        <>
                          <label className="space-y-1">
                            <span className="text-sm">Venue name</span>
                            <input
                              value={g.venueName ?? ""}
                              onChange={(ev) =>
                                patchGuest(idx, { venueName: ev.target.value })
                              }
                              className={clsx(
                                "w-full rounded-md border px-3 py-2",
                                ge.venueName && "border-red-500"
                              )}
                              placeholder="Studio A"
                            />
                            {ge.venueName && (
                              <div className="text-xs text-red-600">
                                {ge.venueName}
                              </div>
                            )}
                          </label>

                          <label className="space-y-1">
                            <span className="text-sm">Venue address</span>
                            <input
                              value={g.venueAddress ?? ""}
                              onChange={(ev) =>
                                patchGuest(idx, {
                                  venueAddress: ev.target.value,
                                })
                              }
                              className={clsx(
                                "w-full rounded-md border px-3 py-2",
                                ge.venueAddress && "border-red-500"
                              )}
                              placeholder="123 Example St…"
                            />
                            {ge.venueAddress && (
                              <div className="text-xs text-red-600">
                                {ge.venueAddress}
                              </div>
                            )}
                          </label>
                        </>
                      )}

                      {unifiedType === "PHONE" && PHONE_ENABLED && (
                        <label className="space-y-1">
                          <span className="text-sm">Dial info</span>
                          <input
                            value={g.dialInfo ?? ""}
                            onChange={(ev) =>
                              patchGuest(idx, { dialInfo: ev.target.value })
                            }
                            className={clsx(
                              "w-full rounded-md border px-3 py-2",
                              ge.dialInfo && "border-red-500"
                            )}
                            placeholder="e.g., +1 555 123 4567 PIN 0000"
                          />
                          {ge.dialInfo && (
                            <div className="text-xs text-red-600">
                              {ge.dialInfo}
                            </div>
                          )}
                        </label>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-2 space-y-2">
                  <label className="space-y-1">
                    <span className="text-sm">Appearance</span>
                    <select
                      value={g.appearanceType}
                      onChange={(ev) =>
                        patchGuest(idx, {
                          appearanceType: ev.target.value as TAppearance,
                          joinUrl: null,
                          venueName: null,
                          venueAddress: null,
                          dialInfo: null,
                        })
                      }
                      className="w-full rounded-md border px-3 py-2"
                    >
                      <option value="ONLINE">ONLINE</option>
                      <option value="IN_PERSON">IN_PERSON</option>
                      {PHONE_ENABLED && <option value="PHONE">PHONE</option>}
                    </select>
                  </label>

                  {g.appearanceType === "ONLINE" && (
                    <label className="space-y-1">
                      <span className="text-sm">Join URL</span>
                      <input
                        value={g.joinUrl ?? ""}
                        onChange={(ev) =>
                          patchGuest(idx, { joinUrl: ev.target.value })
                        }
                        className={clsx(
                          "w-full rounded-md border px-3 py-2",
                          ge.joinUrl && "border-red-500"
                        )}
                        placeholder="https://…"
                      />
                      {ge.joinUrl && (
                        <div className="text-xs text-red-600">{ge.joinUrl}</div>
                      )}
                    </label>
                  )}

                  {g.appearanceType === "IN_PERSON" && (
                    <>
                      <label className="space-y-1">
                        <span className="text-sm">Venue name</span>
                        <input
                          value={g.venueName ?? ""}
                          onChange={(ev) =>
                            patchGuest(idx, { venueName: ev.target.value })
                          }
                          className={clsx(
                            "w-full rounded-md border px-3 py-2",
                            ge.venueName && "border-red-500"
                          )}
                          placeholder="Studio A"
                        />
                        {ge.venueName && (
                          <div className="text-xs text-red-600">
                            {ge.venueName}
                          </div>
                        )}
                      </label>

                      <label className="space-y-1">
                        <span className="text-sm">Venue address</span>
                        <input
                          value={g.venueAddress ?? ""}
                          onChange={(ev) =>
                            patchGuest(idx, { venueAddress: ev.target.value })
                          }
                          className={clsx(
                            "w-full rounded-md border px-3 py-2",
                            ge.venueAddress && "border-red-500"
                          )}
                          placeholder="123 Example St…"
                        />
                        {ge.venueAddress && (
                          <div className="text-xs text-red-600">
                            {ge.venueAddress}
                          </div>
                        )}
                      </label>
                    </>
                  )}

                  {g.appearanceType === "PHONE" && PHONE_ENABLED && (
                    <label className="space-y-1">
                      <span className="text-sm">Dial info</span>
                      <input
                        value={g.dialInfo ?? ""}
                        onChange={(ev) =>
                          patchGuest(idx, { dialInfo: ev.target.value })
                        }
                        className={clsx(
                          "w-full rounded-md border px-3 py-2",
                          ge.dialInfo && "border-red-500"
                        )}
                        placeholder="e.g., +1 555 123 4567 PIN 0000"
                      />
                      {g.dialInfo && (
                        <div className="text-xs text-red-600">{g.dialInfo}</div>
                      )}
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <AddGuestPicker
          startAtISO={form.startAt}
          durationMins={form.durationMins}
          onPick={(row) => addPerson(row)}
          existingIds={existingGuestUserIds}
        />
      </div>

      {/* Hosts UI */}
      {!MULTI_HOSTS_ENABLED ? (
        <div className="space-y-2">
          <div className="font-medium">Host</div>
          <HostCombobox value={hostPick} onChange={(h) => setHostPick(h)} />
        </div>
      ) : (
        <>
          {/* Host model controls */}
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="space-y-1 md:col-span-1">
                <span className="text-sm">Appearance scope (hosts)</span>
                <select
                  value={form.hostAppearanceScope}
                  onChange={(e) => {
                    const next = e.target.value as THostScope;
                    if (next === "PER_HOST") {
                      patch({
                        hostAppearanceScope: next,
                        hostAccessProvisioning: "PER_HOST",
                      });
                    } else {
                      patch({ hostAppearanceScope: next });
                    }
                  }}
                  className="w-full rounded-md border px-3 py-2"
                >
                  <option value="UNIFIED">UNIFIED (single)</option>
                  <option value="PER_HOST">PER_HOST</option>
                </select>
              </label>

              {form.hostAppearanceScope === "UNIFIED" ? (
                <>
                  <label className="space-y-1">
                    <span className="text-sm">Access provisioning (hosts)</span>
                    <select
                      value={form.hostAccessProvisioning}
                      onChange={(e) =>
                        patch({
                          hostAccessProvisioning: e.target
                            .value as THostProvisioning,
                        })
                      }
                      className="w-full rounded-md border px-3 py-2"
                    >
                      <option value="SHARED">SHARED</option>
                      <option value="PER_HOST">PER_HOST</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-sm">Unified type (hosts)</span>
                    <select
                      value={form.hostAppearanceType ?? "ONLINE"}
                      onChange={(e) =>
                        patch({
                          hostAppearanceType: e.target.value as TAppearance,
                        })
                      }
                      className="w-full rounded-md border px-3 py-2"
                    >
                      <option value="ONLINE">ONLINE</option>
                      <option value="IN_PERSON">IN_PERSON</option>
                      {PHONE_ENABLED && <option value="PHONE">PHONE</option>}
                    </select>
                  </label>
                </>
              ) : (
                <div className="md:col-span-2">
                  <div className="rounded-md border px-3 py-2 text-sm text-gray-700">
                    Each host selects their own appearance and access.
                    Provisioning is per host.
                  </div>
                </div>
              )}
            </div>

            {/* Host defaults (only UNIFIED + SHARED) */}
            {form.hostAppearanceScope === "UNIFIED" &&
              form.hostAccessProvisioning === "SHARED" && (
                <div className="space-y-3">
                  <div className="font-medium">Host defaults</div>

                  {hostUnifiedType === "ONLINE" && (
                    <label className="space-y-1">
                      <span className="text-sm">
                        Default meeting link (hosts)
                      </span>
                      <input
                        value={form.hostLocationUrl ?? ""}
                        onChange={(e) =>
                          patch({ hostLocationUrl: e.target.value })
                        }
                        className={clsx(
                          "w-full rounded-md border px-3 py-2",
                          hostDefaultsErrors.hostLocationUrl && "border-red-500"
                        )}
                        placeholder="https://…"
                      />
                      {hostDefaultsErrors.hostLocationUrl && (
                        <div className="text-xs text-red-600">
                          {hostDefaultsErrors.hostLocationUrl}
                        </div>
                      )}
                    </label>
                  )}

                  {hostUnifiedType === "IN_PERSON" && (
                    <>
                      <label className="space-y-1">
                        <span className="text-sm">Default host venue name</span>
                        <input
                          value={form.hostLocationName ?? ""}
                          onChange={(e) =>
                            patch({ hostLocationName: e.target.value })
                          }
                          className={clsx(
                            "w-full rounded-md border px-3 py-2",
                            hostDefaultsErrors.hostLocationName &&
                              "border-red-500"
                          )}
                          placeholder="Studio A"
                        />
                        {hostDefaultsErrors.hostLocationName && (
                          <div className="text-xs text-red-600">
                            {hostDefaultsErrors.hostLocationName}
                          </div>
                        )}
                      </label>

                      <label className="space-y-1">
                        <span className="text-sm">Default host address</span>
                        <input
                          value={form.hostLocationAddress ?? ""}
                          onChange={(e) =>
                            patch({ hostLocationAddress: e.target.value })
                          }
                          className={clsx(
                            "w-full rounded-md border px-3 py-2",
                            hostDefaultsErrors.hostLocationAddress &&
                              "border-red-500"
                          )}
                          placeholder="123 Example St…"
                        />
                        {hostDefaultsErrors.hostLocationAddress && (
                          <div className="text-xs text-red-600">
                            {hostDefaultsErrors.hostLocationAddress}
                          </div>
                        )}
                      </label>
                    </>
                  )}

                  {hostUnifiedType === "PHONE" && PHONE_ENABLED && (
                    <label className="space-y-1">
                      <span className="text-sm">Default host dial info</span>
                      <input
                        value={form.hostDialInfo ?? ""}
                        onChange={(e) =>
                          patch({ hostDialInfo: e.target.value })
                        }
                        className={clsx(
                          "w-full rounded-md border px-3 py-2",
                          hostDefaultsErrors.hostDialInfo && "border-red-500"
                        )}
                        placeholder="e.g., +1 555 123 4567 PIN 0000"
                      />
                      {hostDefaultsErrors.hostDialInfo && (
                        <div className="text-xs text-red-600">
                          {hostDefaultsErrors.hostDialInfo}
                        </div>
                      )}
                    </label>
                  )}
                </div>
              )}
          </div>

          {/* Hosts list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">Hosts</div>
              <div className="text-xs text-gray-600">
                {form.hosts?.length ?? 0} selected
              </div>
            </div>

            {(form.hosts || []).length === 0 && (
              <div className="rounded-md border px-3 py-2 text-sm text-gray-600">
                No hosts yet. Use “Add host” to append hosts.
              </div>
            )}

            {form.hosts?.map((h, idx) => {
              const he = hostErrors[idx] || {};
              return (
                <div key={idx} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      #{idx + 1} {h.name}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => moveHost(idx, -1)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                        title="Move up"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveHost(idx, +1)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                        title="Move down"
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() => removeHost(idx)}
                        className="rounded-md border px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        title="Remove host"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {h.userId && (
                    <div className="mt-1 text-[11px] text-gray-500">
                      {h.userId}
                    </div>
                  )}

                  {/* Host access fields */}
                  {form.hostAppearanceScope === "UNIFIED" ? (
                    <>
                      {form.hostAccessProvisioning === "SHARED" ? (
                        <div className="mt-2 text-sm text-gray-700">
                          Using host defaults (
                          {form.hostAppearanceType ?? "ONLINE"}).
                        </div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {hostUnifiedType === "ONLINE" && (
                            <label className="space-y-1">
                              <span className="text-sm">Join URL</span>
                              <input
                                value={h.joinUrl ?? ""}
                                onChange={(ev) =>
                                  patchHost(idx, { joinUrl: ev.target.value })
                                }
                                className={clsx(
                                  "w-full rounded-md border px-3 py-2",
                                  he.joinUrl && "border-red-500"
                                )}
                                placeholder="https://…"
                              />
                              {he.joinUrl && (
                                <div className="text-xs text-red-600">
                                  {he.joinUrl}
                                </div>
                              )}
                            </label>
                          )}

                          {hostUnifiedType === "IN_PERSON" && (
                            <>
                              <label className="space-y-1">
                                <span className="text-sm">Venue name</span>
                                <input
                                  value={h.venueName ?? ""}
                                  onChange={(ev) =>
                                    patchHost(idx, {
                                      venueName: ev.target.value,
                                    })
                                  }
                                  className={clsx(
                                    "w-full rounded-md border px-3 py-2",
                                    he.venueName && "border-red-500"
                                  )}
                                  placeholder="Studio A"
                                />
                                {he.venueName && (
                                  <div className="text-xs text-red-600">
                                    {he.venueName}
                                  </div>
                                )}
                              </label>

                              <label className="space-y-1">
                                <span className="text-sm">Venue address</span>
                                <input
                                  value={h.venueAddress ?? ""}
                                  onChange={(ev) =>
                                    patchHost(idx, {
                                      venueAddress: ev.target.value,
                                    })
                                  }
                                  className={clsx(
                                    "w-full rounded-md border px-3 py-2",
                                    he.venueAddress && "border-red-500"
                                  )}
                                  placeholder="123 Example St…"
                                />
                                {he.venueAddress && (
                                  <div className="text-xs text-red-600">
                                    {he.venueAddress}
                                  </div>
                                )}
                              </label>
                            </>
                          )}

                          {hostUnifiedType === "PHONE" && PHONE_ENABLED && (
                            <label className="space-y-1">
                              <span className="text-sm">Dial info</span>
                              <input
                                value={h.dialInfo ?? ""}
                                onChange={(ev) =>
                                  patchHost(idx, { dialInfo: ev.target.value })
                                }
                                className={clsx(
                                  "w-full rounded-md border px-3 py-2",
                                  he.dialInfo && "border-red-500"
                                )}
                                placeholder="e.g., +1 555 123 4567 PIN 0000"
                              />
                              {he.dialInfo && (
                                <div className="text-xs text-red-600">
                                  {he.dialInfo}
                                </div>
                              )}
                            </label>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <label className="space-y-1">
                        <span className="text-sm">Appearance</span>
                        <select
                          value={h.appearanceType}
                          onChange={(ev) =>
                            patchHost(idx, {
                              appearanceType: ev.target.value as TAppearance,
                              joinUrl: null,
                              venueName: null,
                              venueAddress: null,
                              dialInfo: null,
                            })
                          }
                          className="w-full rounded-md border px-3 py-2"
                        >
                          <option value="ONLINE">ONLINE</option>
                          <option value="IN_PERSON">IN_PERSON</option>
                          {PHONE_ENABLED && (
                            <option value="PHONE">PHONE</option>
                          )}
                        </select>
                      </label>

                      {h.appearanceType === "ONLINE" && (
                        <label className="space-y-1">
                          <span className="text-sm">Join URL</span>
                          <input
                            value={h.joinUrl ?? ""}
                            onChange={(ev) =>
                              patchHost(idx, { joinUrl: ev.target.value })
                            }
                            className={clsx(
                              "w-full rounded-md border px-3 py-2",
                              he.joinUrl && "border-red-500"
                            )}
                            placeholder="https://…"
                          />
                          {he.joinUrl && (
                            <div className="text-xs text-red-600">
                              {he.joinUrl}
                            </div>
                          )}
                        </label>
                      )}

                      {h.appearanceType === "IN_PERSON" && (
                        <>
                          <label className="space-y-1">
                            <span className="text-sm">Venue name</span>
                            <input
                              value={h.venueName ?? ""}
                              onChange={(ev) =>
                                patchHost(idx, { venueName: ev.target.value })
                              }
                              className={clsx(
                                "w-full rounded-md border px-3 py-2",
                                he.venueName && "border-red-500"
                              )}
                              placeholder="Studio A"
                            />
                            {he.venueName && (
                              <div className="text-xs text-red-600">
                                {he.venueName}
                              </div>
                            )}
                          </label>

                          <label className="space-y-1">
                            <span className="text-sm">Venue address</span>
                            <input
                              value={h.venueAddress ?? ""}
                              onChange={(ev) =>
                                patchHost(idx, {
                                  venueAddress: ev.target.value,
                                })
                              }
                              className={clsx(
                                "w-full rounded-md border px-3 py-2",
                                he.venueAddress && "border-red-500"
                              )}
                              placeholder="123 Example St…"
                            />
                            {he.venueAddress && (
                              <div className="text-xs text-red-600">
                                {he.venueAddress}
                              </div>
                            )}
                          </label>
                        </>
                      )}

                      {h.appearanceType === "PHONE" && PHONE_ENABLED && (
                        <label className="space-y-1">
                          <span className="text-sm">Dial info</span>
                          <input
                            value={h.dialInfo ?? ""}
                            onChange={(ev) =>
                              patchHost(idx, { dialInfo: ev.target.value })
                            }
                            className={clsx(
                              "w-full rounded-md border px-3 py-2",
                              he.dialInfo && "border-red-500"
                            )}
                            placeholder="e.g., +1 555 123 4567 PIN 0000"
                          />
                          {h.dialInfo && (
                            <div className="text-xs text-red-600">
                              {h.dialInfo}
                            </div>
                          )}
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <AddHostPicker
              onPick={(row) => addHost(row)}
              existingIds={(form.hosts || [])
                .filter((h) => h.userId)
                .map((h) => h.userId as string)}
              startAtISO={form.startAt}
              durationMins={form.durationMins}
            />
          </div>
        </>
      )}

      {/* Optionals */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm">Program name</span>
          <input
            value={form.programName ?? ""}
            onChange={(e) => patch({ programName: e.target.value })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Program"
          />
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-sm">Talking points</span>
          <textarea
            value={form.talkingPoints ?? ""}
            onChange={(e) => patch({ talkingPoints: e.target.value })}
            className="min-h-[120px] w-full rounded-md border px-3 py-2"
            placeholder="Any internal notes for the team…"
          />
        </label>
      </div>

      {saveError && <UIAlert intent="error">{saveError}</UIAlert>}

      <div className="flex items-center gap-3">
        <UIButton type="submit">Save</UIButton>
        <a
          href={`/modules/booking/${id ?? ""}`}
          className="text-sm text-gray-600 underline"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
