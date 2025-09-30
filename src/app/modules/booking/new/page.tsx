"use client";

/**
 * New Booking — parity with existing UI plus post-create HOST participants batch
 *
 * What’s new (no regressions):
 * - After creating the booking, if hosts were selected and the flag is ON,
 *   POST them in one batch to /api/bookings/:id/participants as role=HOST.
 * - No “primary host” concept.
 * - We do NOT mirror any legacy single-host fields on create (no hostUserId/hostName).
 *
 * Flags:
 * - NEXT_PUBLIC_APPEARANCE_PHONE (default: true)
 * - NEXT_PUBLIC_FEATURE_MULTI_HOSTS (existing; controls host UI visibility)
 * - NEXT_PUBLIC_MULTI_PARTICIPANTS_ENABLED (default: true; controls post-create batch)
 */

import * as React from "react";
import { useRouter } from "next/navigation";

/* ---------- Small UI helpers ---------- */
import * as ButtonModule from "../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/* ---------- Flags ---------- */
const PHONE_ENABLED =
  (process.env.NEXT_PUBLIC_APPEARANCE_PHONE ?? "true") !== "false";
const MULTI_HOSTS_ENABLED =
  (process.env.NEXT_PUBLIC_FEATURE_MULTI_HOSTS ?? "false") === "true";
const MULTI_PARTICIPANTS_ENABLED =
  (process.env.NEXT_PUBLIC_MULTI_PARTICIPANTS_ENABLED ?? "true") !== "false";

/* ---------- Utils ---------- */
const clsx = (...xs: any[]) => xs.filter(Boolean).join(" ");
const pad = (n: number) => String(n).padStart(2, "0");
const toDatetimeLocalValue = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};
function nextFullHourLocalISO(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}
function useDebounce<T>(v: T, delay = 250): T {
  const [s, setS] = React.useState(v);
  React.useEffect(() => {
    const t = setTimeout(() => setS(v), delay);
    return () => clearTimeout(t);
  }, [v, delay]);
  return s;
}

/* ---------- Types ---------- */
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
  userId: string | null;
  name: string;
  order: number;
  appearanceType: TAppearance;
  joinUrl: string | null;
  venueName: string | null;
  venueAddress: string | null;
  dialInfo: string | null;
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
    let rows = (dirItems || [])
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
    // Send the booking window so the API can compute availability
    if (haveWindow) {
      const start = new Date(startAtISO);
      const end = new Date(start.getTime() + durationMins * 60_000);
      sp.set("start", start.toISOString());
      sp.set("end", end.toISOString());
      // also include the alternate shape for compatibility
      sp.set("startAt", start.toISOString());
      sp.set("durationMins", String(durationMins));
    }
    // Let server pre-filter, if supported
    if (onlyAvailable) sp.set("onlyAvailable", "true");

    const res = await fetch(`/api/experts/search?${sp.toString()}`, {
      credentials: "include",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(j?.error || `Public search failed (${res.status})`);

    const items: any[] = Array.isArray(j.items) ? j.items : [];
    return items.map((e: any) => {
      // accept both string and {status} shapes
      const avail = (e as any).availability;
      const status =
        typeof avail === "string"
          ? avail
          : avail?.status
          ? avail.status
          : "UNKNOWN";
      return {
        id: String(e.id),
        name: (e.name as string) ?? null,
        kind: "EXPERT" as const,
        city: e.city ?? null,
        countryCode: e.countryCode ?? null,
        tags: e.tags ?? [],
        availability: { status } as ParticipantRow["availability"],
      };
    });
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
      // both
      let orgRows: ParticipantRow[] = [];
      let pubRows: ParticipantRow[] = [];
      try {
        orgRows = await fetchOrgRows();
      } catch {}
      try {
        pubRows = await fetchPublicRows();
      } catch {}
      const map = new Map();
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-2 py-1 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}&nbsp; Add guest (expert/reporter)
        </button>
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
          className="min-w-[240px] flex-1 rounded-md border px-3 py-2"
        />
        {(["org", "public", "all"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVisibility(v)}
            className={clsx(
              "rounded-md border px-2 py-1 text-xs capitalize",
              visibility === v ? "bg-black text-white" : "hover:bg-gray-50"
            )}
            aria-pressed={visibility === v}
          >
            {v === "all" ? "Both" : v}
          </button>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
          />
          Only available
        </label>
      </div>

      {open && (
        <div className="rounded-md border p-2">
          {loading && <div className="text-sm text-gray-600">Loading…</div>}
          {error && <div className="text-sm text-red-700">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="text-sm text-gray-600">No matches.</div>
          )}
          <div className="flex flex-col gap-2">
            {items.map((p) => {
              const disabled = props.existingIds.includes(p.id);
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
                    !disabled &&
                    props.onPick({
                      id: p.id,
                      name:
                        p.name ||
                        (p.kind === "REPORTER" ? "Reporter" : "Expert"),
                      kind: p.kind,
                    })
                  }
                  className={clsx(
                    "w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50",
                    disabled && "opacity-50"
                  )}
                >
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
                    <span
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[10px]",
                        badge
                      )}
                    >
                      {status ?? "UNKNOWN"}
                    </span>
                    {p.city && (
                      <span className="text-[11px] text-gray-600">
                        {p.city}
                      </span>
                    )}
                    {p.countryCode && (
                      <span className="text-[11px] text-gray-600">
                        ({p.countryCode})
                      </span>
                    )}
                    {(p.tags || []).slice(0, 2).map((t) => (
                      <span
                        key={t}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-700"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* =======================================================================
   Host picker — availability-aware (sends both window shapes)
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
        // send BOTH shapes to be safe
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
    const a = it.availability;

    // explicit signals
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

    // derive from arrays
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-2 py-1 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}&nbsp; Add host
        </button>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          className="w-full rounded-md border px-3 py-2"
          placeholder="Search hosts…"
        />
      </div>

      {open && (
        <div className="rounded-md border p-2">
          {loading && (
            <div className="text-sm text-gray-600">Loading hosts…</div>
          )}
          {error && <div className="text-sm text-red-700">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="text-sm text-gray-600">
              No host directory available.
            </div>
          )}
          <div className="flex flex-col gap-2">
            {items.map((h: any) => {
              const disabled = props.existingIds.includes(h.id);
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
                  onClick={() =>
                    !disabled &&
                    props.onPick({
                      id: h.id,
                      name: h.name || "Host",
                    })
                  }
                  className={clsx(
                    "w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50",
                    disabled && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{h.name || "Unnamed"}</span>
                    <span
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[10px]",
                        badge
                      )}
                    >
                      {status ?? "UNKNOWN"}
                    </span>
                    <span className="text-[11px] text-gray-500">{h.id}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* =======================================================================
   Page
   ======================================================================= */
export default function NewBookingPage() {
  const router = useRouter();

  // Core booking fields
  const [form, setForm] = React.useState<{
    subject: string;
    newsroomName: string;
    programName: string;
    talkingPoints: string;
    startAt: string; // ISO
    durationMins: number;

    // Guests model
    appearanceScope: TScope;
    accessProvisioning: TProvisioning;
    appearanceType: TAppearance | null; // when UNIFIED

    // UNIFIED defaults (guests)
    locationUrl: string;
    locationName: string;
    locationAddress: string;
    dialInfo: string;

    // Hosts model (UNIFIED controls)
    hostAppearanceScope: THostScope;
    hostAccessProvisioning: THostProvisioning;
    hostAppearanceType: TAppearance | null;
    hostLocationUrl: string;
    hostLocationName: string;
    hostLocationAddress: string;
    hostDialInfo: string;
  }>({
    subject: "",
    newsroomName: "",
    programName: "",
    talkingPoints: "",
    startAt: nextFullHourLocalISO(),
    durationMins: 30,

    // guests model
    appearanceScope: "UNIFIED",
    accessProvisioning: "SHARED",
    appearanceType: "ONLINE",

    locationUrl: "",
    locationName: "",
    locationAddress: "",
    dialInfo: "",

    // hosts model defaults
    hostAppearanceScope: "UNIFIED",
    hostAccessProvisioning: "SHARED",
    hostAppearanceType: "ONLINE",
    hostLocationUrl: "",
    hostLocationName: "",
    hostLocationAddress: "",
    hostDialInfo: "",
  });

  // Guests & Hosts arrays
  const [guests, setGuests] = React.useState<GuestRow[]>([]);
  const [hosts, setHosts] = React.useState<HostRow[]>([]);

  // Derived helpers
  const guestsUnified = form.appearanceScope === "UNIFIED";
  const guestsSharedProvisioned = form.accessProvisioning === "SHARED";
  const hostUnified = form.hostAppearanceScope === "UNIFIED";
  const hostSharedProvisioned = form.hostAccessProvisioning === "SHARED";
  const hostUnifiedType = (form.hostAppearanceType ?? "ONLINE") as TAppearance;

  // Client-side inline validations (lightweight; mirrors Edit)
  const guestErrors = React.useMemo(() => {
    const errs: Array<Record<string, string>> = guests.map(() => ({}));
    if (guestsUnified) {
      if (!guestsSharedProvisioned) {
        // UNIFIED + PER_GUEST → each guest fills per unified type
        guests.forEach((g, idx) => {
          const type = (form.appearanceType ?? "ONLINE") as TAppearance;
          if (type === "ONLINE" && !g.joinUrl)
            errs[idx].joinUrl = "Link required.";
          if (type === "IN_PERSON") {
            if (!g.venueName) errs[idx].venueName = "Venue name required.";
            if (!g.venueAddress) errs[idx].venueAddress = "Address required.";
          }
          if (PHONE_ENABLED && type === "PHONE" && !g.dialInfo)
            errs[idx].dialInfo = "Dial info required.";
        });
      }
    } else {
      // PER_GUEST → each guest chooses appearance & access
      guests.forEach((g, idx) => {
        if (g.appearanceType === "ONLINE" && !g.joinUrl)
          errs[idx].joinUrl = "Link required.";
        if (g.appearanceType === "IN_PERSON") {
          if (!g.venueName) errs[idx].venueName = "Venue name required.";
          if (!g.venueAddress) errs[idx].venueAddress = "Address required.";
        }
        if (PHONE_ENABLED && g.appearanceType === "PHONE" && !g.dialInfo)
          errs[idx].dialInfo = "Dial info required.";
      });
    }
    return errs;
  }, [guests, guestsUnified, guestsSharedProvisioned, form.appearanceType]);

  const hostErrors = React.useMemo(() => {
    const errs: Array<Record<string, string>> = hosts.map(() => ({}));
    if (!MULTI_HOSTS_ENABLED) return errs;

    if (hostUnified) {
      if (!hostSharedProvisioned) {
        // UNIFIED + PER_HOST → each host provides access per unified type
        hosts.forEach((h, idx) => {
          if (hostUnifiedType === "ONLINE" && !h.joinUrl)
            errs[idx].joinUrl = "Link required.";
          if (hostUnifiedType === "IN_PERSON") {
            if (!h.venueName) errs[idx].venueName = "Venue name required.";
            if (!h.venueAddress) errs[idx].venueAddress = "Address required.";
          }
          if (PHONE_ENABLED && hostUnifiedType === "PHONE" && !h.dialInfo)
            errs[idx].dialInfo = "Dial info required.";
        });
      }
    } else {
      // PER_HOST → each host chooses their own type and access
      hosts.forEach((h, idx) => {
        if (h.appearanceType === "ONLINE" && !h.joinUrl)
          errs[idx].joinUrl = "Link required.";
        if (h.appearanceType === "IN_PERSON") {
          if (!h.venueName) errs[idx].venueName = "Venue name required.";
          if (!h.venueAddress) errs[idx].venueAddress = "Address required.";
        }
        if (PHONE_ENABLED && h.appearanceType === "PHONE" && !h.dialInfo)
          errs[idx].dialInfo = "Dial info required.";
      });
    }
    return errs;
  }, [hosts, hostUnified, hostSharedProvisioned, hostUnifiedType]);

  // Add/remove/reorder helpers
  function addPerson(row: { id: string; name: string; kind: TKind }) {
    setGuests((xs) => [
      ...xs,
      {
        userId: row.id,
        name: row.name || (row.kind === "REPORTER" ? "Reporter" : "Expert"),
        kind: row.kind,
        order: xs.length,
        appearanceType: (form.appearanceType ?? "ONLINE") as TAppearance,
        joinUrl: null,
        venueName: null,
        venueAddress: null,
        dialInfo: null,
      },
    ]);
  }
  function removeGuest(idx: number) {
    setGuests((xs) =>
      xs.filter((_, i) => i !== idx).map((g, i) => ({ ...g, order: i }))
    );
  }
  function patchGuest(idx: number, patch: Partial<GuestRow>) {
    setGuests((xs) => xs.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  }

  function addHost(row: { id: string; name: string | null }) {
    setHosts((xs) => [
      ...xs,
      {
        userId: row.id,
        name: row.name || "Host",
        order: xs.length,
        appearanceType: (form.hostAppearanceType ?? "ONLINE") as TAppearance,
        joinUrl: null,
        venueName: null,
        venueAddress: null,
        dialInfo: null,
      },
    ]);
  }
  function removeHost(idx: number) {
    setHosts((xs) =>
      xs.filter((_, i) => i !== idx).map((h, i) => ({ ...h, order: i }))
    );
  }
  function moveHost(idx: number, dir: -1 | 1) {
    setHosts((xs) => {
      const next = xs.slice();
      const j = idx + dir;
      if (j < 0 || j >= next.length) return xs;
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next.map((h, i) => ({ ...h, order: i }));
    });
  }
  function patchHost(idx: number, patch: Partial<HostRow>) {
    setHosts((xs) => xs.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  }

  const existingGuestUserIds = guests
    .map((g) => g.userId)
    .filter(Boolean) as string[];
  const existingHostUserIds = hosts.map((h) => h.userId!).filter(Boolean);

  // Submit
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Build guests[] payload (order preserved)
    const guestsPayload =
      guests.length === 0
        ? []
        : guests.map((g, i) => {
            const unifiedType = (form.appearanceType ??
              "ONLINE") as TAppearance;
            const type =
              form.appearanceScope === "UNIFIED"
                ? unifiedType
                : g.appearanceType;
            return {
              userId: g.userId,
              name: g.name,
              kind: g.kind,
              order: i,
              appearanceType: type,
              joinUrl:
                form.appearanceScope === "UNIFIED"
                  ? form.accessProvisioning === "PER_GUEST" && type === "ONLINE"
                    ? g.joinUrl || null
                    : null
                  : type === "ONLINE"
                  ? g.joinUrl || null
                  : null,
              venueName:
                form.appearanceScope === "UNIFIED"
                  ? form.accessProvisioning === "PER_GUEST" &&
                    type === "IN_PERSON"
                    ? g.venueName || null
                    : null
                  : type === "IN_PERSON"
                  ? g.venueName || null
                  : null,
              venueAddress:
                form.appearanceScope === "UNIFIED"
                  ? form.accessProvisioning === "PER_GUEST" &&
                    type === "IN_PERSON"
                    ? g.venueAddress || null
                    : null
                  : type === "IN_PERSON"
                  ? g.venueAddress || null
                  : null,
              dialInfo: PHONE_ENABLED
                ? form.appearanceScope === "UNIFIED"
                  ? form.accessProvisioning === "PER_GUEST" && type === "PHONE"
                    ? g.dialInfo || null
                    : null
                  : type === "PHONE"
                  ? g.dialInfo || null
                  : null
                : null,
            };
          });

    // Create payload (NO legacy single-host mirrors)
    const payload: any = {
      subject: form.subject,
      newsroomName: form.newsroomName,
      programName: form.programName || undefined,
      talkingPoints: form.talkingPoints || undefined,
      startAt: new Date(form.startAt).toISOString(),
      durationMins: Number(form.durationMins),

      // Guests model
      appearanceScope: form.appearanceScope,
      accessProvisioning: form.accessProvisioning,
      appearanceType:
        form.appearanceScope === "UNIFIED" ? form.appearanceType : null,
      locationUrl: form.locationUrl || null,
      locationName: form.locationName || null,
      locationAddress: form.locationAddress || null,
      dialInfo: form.dialInfo || null,

      // guests[] (BOOKING_GUESTS_V2 path)
      guests: guestsPayload,

      // Hosts defaults for future edits / view (if your API accepts them on create)
      hostAppearanceScope: form.hostAppearanceScope,
      hostAccessProvisioning: form.hostAccessProvisioning,
      hostAppearanceType: form.hostAppearanceType,
      hostLocationUrl: form.hostLocationUrl || null,
      hostLocationName: form.hostLocationName || null,
      hostLocationAddress: form.hostLocationAddress || null,
      hostDialInfo: form.hostDialInfo || null,
      // NOTE: we intentionally do NOT send hosts[] here; persistence of hosts is via participants below.
    };

    try {
      setSubmitting(true);
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to create booking");

      const bookingId: string = j.booking?.id ?? j?.id;
      if (bookingId && MULTI_PARTICIPANTS_ENABLED && hosts.length > 0) {
        // Batch-add hosts as participants (role=HOST). Ignore soft errors.
        const toAdd = hosts
          .map((h) => String(h.userId ?? ""))
          .filter(Boolean)
          .map((userId) => ({ userId, roleInBooking: "HOST" as const }));

        if (toAdd.length) {
          try {
            await fetch(`/api/bookings/${bookingId}/participants`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ participants: toAdd }),
            });
          } catch {
            // swallow — creation should still succeed
          }
        }
      }

      // Navigate to View page
      router.push(`/modules/booking/${bookingId}`);
    } catch (err: any) {
      setError(err?.message || "Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="mx-auto flex max-w-4xl flex-col gap-6 p-4"
      onSubmit={onSubmit}
    >
      <h1 className="text-2xl font-semibold">New booking</h1>

      {error && <UIAlert intent="error">{error}</UIAlert>}

      {/* When */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Start at</span>
          <input
            type="datetime-local"
            value={toDatetimeLocalValue(form.startAt)}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                startAt: new Date(e.target.value).toISOString(),
              }))
            }
            required
            className="w-full rounded-md border px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Duration (mins)</span>
          <input
            inputMode="numeric"
            value={form.durationMins}
            onChange={(e) =>
              setForm((f) => ({ ...f, durationMins: Number(e.target.value) }))
            }
            required
            className="w-full rounded-md border px-3 py-2"
          />
        </label>
      </div>

      {/* What */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Subject</span>
          <input
            value={form.subject}
            onChange={(e) =>
              setForm((f) => ({ ...f, subject: e.target.value }))
            }
            required
            className="w-full rounded-md border px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Newsroom name</span>
          <input
            value={form.newsroomName}
            onChange={(e) =>
              setForm((f) => ({ ...f, newsroomName: e.target.value }))
            }
            required
            className="w-full rounded-md border px-3 py-2"
          />
        </label>
      </div>

      {/* Guests model controls */}
      <section className="rounded-md border p-3">
        <h2 className="mb-2 text-lg font-medium">Guests</h2>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm">Appearance scope (guests)</span>
            <select
              value={form.appearanceScope}
              onChange={(e) => {
                const next = e.target.value as TScope;
                if (next === "PER_GUEST") {
                  setForm((f) => ({
                    ...f,
                    appearanceScope: next,
                    accessProvisioning: "PER_GUEST",
                  }));
                } else {
                  setForm((f) => ({ ...f, appearanceScope: next }));
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
              <label className="flex flex-col gap-1">
                <span className="text-sm">Access provisioning (guests)</span>
                <select
                  value={form.accessProvisioning}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      accessProvisioning: e.target.value as TProvisioning,
                    }))
                  }
                  className="w-full rounded-md border px-3 py-2"
                >
                  <option value="SHARED">SHARED</option>
                  <option value="PER_GUEST">PER_GUEST</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm">Unified type (guests)</span>
                <select
                  value={form.appearanceType ?? "ONLINE"}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      appearanceType: e.target.value as TAppearance,
                    }))
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
            <div className="text-sm text-gray-700 md:col-span-2">
              Each guest selects their own appearance and access. Provisioning
              is per guest.
            </div>
          )}
        </div>

        {/* Guest defaults (UNIFIED + SHARED) */}
        {guestsUnified && guestsSharedProvisioned && (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {(form.appearanceType ?? "ONLINE") === "ONLINE" && (
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="text-sm">Default meeting link (guests)</span>
                <input
                  value={form.locationUrl}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, locationUrl: e.target.value }))
                  }
                  className="w-full rounded-md border px-3 py-2"
                  placeholder="https://…"
                />
              </label>
            )}

            {(form.appearanceType ?? "ONLINE") === "IN_PERSON" && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-sm">Default venue name (guests)</span>
                  <input
                    value={form.locationName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, locationName: e.target.value }))
                    }
                    className="w-full rounded-md border px-3 py-2"
                    placeholder="Studio A"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm">Default address (guests)</span>
                  <input
                    value={form.locationAddress}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        locationAddress: e.target.value,
                      }))
                    }
                    className="w-full rounded-md border px-3 py-2"
                    placeholder="123 Example St…"
                  />
                </label>
              </>
            )}

            {PHONE_ENABLED && (form.appearanceType ?? "ONLINE") === "PHONE" && (
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="text-sm">Default dial info (guests)</span>
                <input
                  value={form.dialInfo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, dialInfo: e.target.value }))
                  }
                  className="w-full rounded-md border px-3 py-2"
                  placeholder="e.g., +1 555 123 4567 PIN 0000"
                />
              </label>
            )}
          </div>
        )}
      </section>

      {/* Guests list */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">Guests</div>
          <div className="text-xs text-gray-500">{guests.length} selected</div>
        </div>

        {guests.length === 0 && (
          <div className="rounded-md border p-3 text-sm text-gray-600">
            No guests yet. Use “Add guest” below to append experts or reporters.
          </div>
        )}

        <div className="flex flex-col gap-3">
          {guests.map((g, idx) => {
            const ge = guestErrors[idx] || {};
            const unifiedType = (form.appearanceType ??
              "ONLINE") as TAppearance;
            return (
              <div key={`${g.userId}-${idx}`} className="rounded-md border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                    #{idx + 1}
                  </span>
                  <span className="font-medium">{g.name}</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
                    {g.kind}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGuest(idx)}
                    className="ml-auto rounded-md border px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    title="Remove guest"
                  >
                    Remove
                  </button>
                </div>

                {/* Per-guest fields based on scope/provisioning */}
                {form.appearanceScope === "UNIFIED" ? (
                  <>
                    {form.accessProvisioning === "SHARED" ? (
                      <div className="text-sm text-gray-700">
                        Using unified settings (
                        {form.appearanceType ?? "ONLINE"}). No per-guest access
                        fields.
                      </div>
                    ) : (
                      <>
                        {unifiedType === "ONLINE" && (
                          <label className="flex flex-col gap-1">
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
                          </label>
                        )}

                        {unifiedType === "IN_PERSON" && (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-sm">Venue name</span>
                              <input
                                value={g.venueName ?? ""}
                                onChange={(ev) =>
                                  patchGuest(idx, {
                                    venueName: ev.target.value,
                                  })
                                }
                                className={clsx(
                                  "w-full rounded-md border px-3 py-2",
                                  ge.venueName && "border-red-500"
                                )}
                                placeholder="Studio A"
                              />
                            </label>

                            <label className="flex flex-col gap-1">
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
                            </label>
                          </div>
                        )}

                        {PHONE_ENABLED && unifiedType === "PHONE" && (
                          <label className="flex flex-col gap-1">
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
                          </label>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <label className="flex flex-col gap-1">
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
                      <label className="flex flex-col gap-1">
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
                      </label>
                    )}

                    {g.appearanceType === "IN_PERSON" && (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="flex flex-col gap-1">
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
                        </label>

                        <label className="flex flex-col gap-1">
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
                        </label>
                      </div>
                    )}

                    {PHONE_ENABLED && g.appearanceType === "PHONE" && (
                      <label className="flex flex-col gap-1">
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
                      </label>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Add guest */}
        <AddGuestPicker
          onPick={(row) => addPerson(row)}
          existingIds={existingGuestUserIds}
          startAtISO={form.startAt}
          durationMins={form.durationMins}
        />
      </section>

      {/* Hosts (visible only if legacy multi-host UI is enabled) */}
      {MULTI_HOSTS_ENABLED && (
        <>
          <section className="rounded-md border p-3">
            <h2 className="mb-2 text-lg font-medium">Hosts</h2>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-sm">Appearance scope (hosts)</span>
                <select
                  value={form.hostAppearanceScope}
                  onChange={(e) => {
                    const next = e.target.value as THostScope;
                    if (next === "PER_HOST") {
                      setForm((f) => ({
                        ...f,
                        hostAppearanceScope: next,
                        hostAccessProvisioning: "PER_HOST",
                      }));
                    } else {
                      setForm((f) => ({ ...f, hostAppearanceScope: next }));
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
                  <label className="flex flex-col gap-1">
                    <span className="text-sm">Access provisioning (hosts)</span>
                    <select
                      value={form.hostAccessProvisioning}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          hostAccessProvisioning: e.target
                            .value as THostProvisioning,
                        }))
                      }
                      className="w-full rounded-md border px-3 py-2"
                    >
                      <option value="SHARED">SHARED</option>
                      <option value="PER_HOST">PER_HOST</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-sm">Unified type (hosts)</span>
                    <select
                      value={form.hostAppearanceType ?? "ONLINE"}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          hostAppearanceType: e.target.value as TAppearance,
                        }))
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
                <div className="text-sm text-gray-700 md:col-span-2">
                  Each host selects their own appearance and access.
                  Provisioning is per host.
                </div>
              )}
            </div>
          </section>

          {/* Hosts list */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">Selected hosts</div>
              <div className="text-xs text-gray-500">
                {hosts.length} selected
              </div>
            </div>

            {hosts.length === 0 && (
              <div className="rounded-md border p-3 text-sm text-gray-600">
                No hosts yet. Use “Add host” to append hosts.
              </div>
            )}

            <div className="flex flex-col gap-3">
              {hosts.map((h, idx) => {
                const he = hostErrors[idx] || {};
                return (
                  <div
                    key={`${h.userId}-${idx}`}
                    className="rounded-md border p-3"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                        #{idx + 1}
                      </span>
                      <span className="font-medium">{h.name || "Host"}</span>

                      <div className="ml-auto flex items-center gap-2">
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

                    {/* Host per-item access fields, same rules as Edit */}
                    {form.hostAppearanceScope === "UNIFIED" ? (
                      <>
                        {form.hostAccessProvisioning === "SHARED" ? (
                          <div className="text-sm text-gray-700">
                            Using host defaults (
                            {form.hostAppearanceType ?? "ONLINE"}).
                          </div>
                        ) : (
                          <>
                            {hostUnifiedType === "ONLINE" && (
                              <label className="flex flex-col gap-1">
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
                              </label>
                            )}

                            {hostUnifiedType === "IN_PERSON" && (
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <label className="flex flex-col gap-1">
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
                                </label>

                                <label className="flex flex-col gap-1">
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
                                </label>
                              </div>
                            )}

                            {PHONE_ENABLED && hostUnifiedType === "PHONE" && (
                              <label className="flex flex-col gap-1">
                                <span className="text-sm">Dial info</span>
                                <input
                                  value={h.dialInfo ?? ""}
                                  onChange={(ev) =>
                                    patchHost(idx, {
                                      dialInfo: ev.target.value,
                                    })
                                  }
                                  className={clsx(
                                    "w-full rounded-md border px-3 py-2",
                                    he.dialInfo && "border-red-500"
                                  )}
                                  placeholder="e.g., +1 555 123 4567 PIN 0000"
                                />
                              </label>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <label className="flex flex-col gap-1">
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
                          <label className="flex flex-col gap-1">
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
                          </label>
                        )}

                        {h.appearanceType === "IN_PERSON" && (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1">
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
                            </label>

                            <label className="flex flex-col gap-1">
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
                            </label>
                          </div>
                        )}

                        {PHONE_ENABLED && h.appearanceType === "PHONE" && (
                          <label className="flex flex-col gap-1">
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
                          </label>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add host */}
            <AddHostPicker
              onPick={(row) => addHost(row)}
              existingIds={existingHostUserIds}
              startAtISO={form.startAt}
              durationMins={form.durationMins}
            />
          </section>
        </>
      )}

      <div className="flex items-center gap-3">
        <UIButton type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create booking"}
        </UIButton>
        <a href="/modules/booking" className="text-sm text-gray-600 underline">
          Cancel
        </a>
      </div>
    </form>
  );
}
