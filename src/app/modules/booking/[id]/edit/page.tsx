"use client";

/**
 * Edit Booking — keep existing UI/logic intact (guests, scopes, validations),
 * and *add* a safe participants bridge for HOSTS only (no "primary" concept).
 *
 * - Hosts UI stays exactly the same (add/move/remove + defaults + validations).
 * - On Save:
 *    1) PATCH /api/bookings/:id  (unchanged payload for booking + guests)
 *    2) Sync hosts to /api/bookings/:id/participants (HOST only)
 *         • adds missing host participants
 *         • removes extra host participants
 *         • does NOT assign or use "primary host"
 * - Availability badges for hosts via /api/hosts/search?start&end (unchanged).
 *
 * Flags:
 * - NEXT_PUBLIC_APPEARANCE_PHONE (default: true)
 * - NEXT_PUBLIC_MULTI_PARTICIPANTS_ENABLED (default: true)
 */

import * as React from "react";
import { useRouter, useParams } from "next/navigation";

/* ---------- small UI helpers (match your components) ---------- */
import * as ButtonModule from "../../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/* ---------- flags ---------- */
const PHONE_ENABLED =
  (process.env.NEXT_PUBLIC_APPEARANCE_PHONE ?? "true") !== "false";
const MULTI_PARTICIPANTS_ENABLED =
  (process.env.NEXT_PUBLIC_MULTI_PARTICIPANTS_ENABLED ?? "true") !== "false";

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

/* ---------- types (aligned with your current DTOs) ---------- */
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
  id?: string; // client-local id
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

  // Guests model
  appearanceScope: TScope;
  accessProvisioning: TProvisioning;
  appearanceType: TAppearance | null;

  // Defaults for guests (UNIFIED + SHARED)
  locationUrl?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  dialInfo?: string | null;

  // Hosts model (UI parity maintained)
  hostAppearanceScope: THostScope;
  hostAccessProvisioning: THostProvisioning;
  hostAppearanceType: TAppearance | null;
  hostLocationUrl?: string | null;
  hostLocationName?: string | null;
  hostLocationAddress?: string | null;
  hostDialInfo?: string | null;

  // Legacy single-host fields may still exist in DB; we ignore them here
  expertUserId?: string | null;
  expertName?: string | null;
  hostUserId?: string | null;
  hostName?: string | null;

  guests: GuestRow[];
  hosts?: HostRow[];
};

/* -------------------- Participants (for sync; HOST only) ------------------- */
type Role = "HOST" | "EXPERT" | "REPORTER" | "INTERPRETER";
type ParticipantDTO = {
  id: string;
  userId: string | null;
  roleInBooking: Role; // from API
  notes?: string | null;
  user?: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null;
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
    // include window if present
    if (haveWindow) {
      const start = new Date(startAtISO);
      const end = new Date(start.getTime() + durationMins * 60_000);
      sp.set("start", start.toISOString());
      sp.set("end", end.toISOString());
      sp.set("startAt", start.toISOString());
      sp.set("durationMins", String(durationMins));
    }
    if (onlyAvailable) sp.set("onlyAvailable", "true");

    const res = await fetch(`/api/experts/search?${sp.toString()}`, {
      credentials: "include",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(j?.error || `Public search failed (${res.status})`);

    const items: any[] = Array.isArray(j.items) ? j.items : [];
    return items.map((e: any) => {
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-2 py-1 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}&nbsp;•&nbsp;Add guest (expert/reporter)
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
          className="min-w-[240px] w-full rounded-md border px-3 py-2"
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
              const disabled = existingIds.includes(p.id);
              const status = p.availability?.status ?? "UNKNOWN";
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
                      {status}
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
   Host picker — availability badge derived from /api/hosts/search window
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
        if (haveWindow && windowStart && windowEnd) {
          // support both shapes
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
          {open ? "Hide" : "Browse"}&nbsp;•&nbsp;Add host
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
                  onClick={() =>
                    onPick({
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
                    <span className="text-[11px] text-gray-500">{h.id}</span>
                    <span
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[10px]",
                        badge
                      )}
                    >
                      {status}
                    </span>
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
export default function BookingEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [form, setForm] = React.useState<BookingDto | null>(null);

  // granular error bags (parity with your page)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>(
    {}
  );
  const [guestErrors, setGuestErrors] = React.useState<Record<number, any>>({});
  const [hostErrors, setHostErrors] = React.useState<Record<number, any>>({});
  const [hostDefaultsErrors, setHostDefaultsErrors] = React.useState<
    Record<string, string>
  >({});

  // Participants cache (for host sync diff)
  const [participants, setParticipants] = React.useState<ParticipantDTO[]>([]);

  /* ---------- load booking (+ participants for diff) ---------- */
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setLoadError(null);

        const rb = await fetch(`/api/bookings/${id}`, {
          credentials: "include",
        });
        const bj = await rb.json().catch(() => ({}));
        if (!rb.ok) throw new Error(bj?.error || "Failed to load booking");
        const b: BookingDto = bj?.booking ?? bj;

        // normalize & order
        b.guests = (b.guests || [])
          .slice()
          .sort((a, z) => (a.order ?? 0) - (z.order ?? 0));
        b.hosts = (b.hosts || [])
          .slice()
          .sort((a, z) => (a.order ?? 0) - (z.order ?? 0));

        if (!PHONE_ENABLED && b.appearanceType === "PHONE")
          b.appearanceType = "ONLINE";
        if (!PHONE_ENABLED && b.hostAppearanceType === "PHONE")
          b.hostAppearanceType = "ONLINE";

        if (alive) setForm(b);

        if (MULTI_PARTICIPANTS_ENABLED) {
          const rp = await fetch(`/api/bookings/${id}/participants`, {
            credentials: "include",
            cache: "no-store",
          });
          const pj = await rp.json().catch(() => ({}));
          if (rp.ok && Array.isArray(pj?.participants)) {
            if (alive) setParticipants(pj.participants as ParticipantDTO[]);
          }
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

  /* ---------- mutators (unchanged UI behavior) ---------- */
  function patch(next: Partial<BookingDto>) {
    setForm((f) => (f ? { ...f, ...next } : f));
  }
  function patchGuest(index: number, next: Partial<GuestRow>) {
    setForm((f) => {
      if (!f) return f;
      const guests = (f.guests || []).slice();
      guests[index] = { ...guests[index], ...next };
      return { ...f, guests };
    });
  }
  function removeGuest(index: number) {
    setForm((f) => {
      if (!f) return f;
      const guests = (f.guests || []).slice();
      guests.splice(index, 1);
      return { ...f, guests };
    });
  }
  function addPerson(row: { id: string; name: string; kind: TKind }) {
    setForm((f) => {
      if (!f) return f;
      const guests = (f.guests || []).slice();
      guests.push({
        id: Math.random().toString(36).slice(2),
        userId: row.id,
        name: row.name,
        kind: row.kind,
        order: guests.length,
        appearanceType: (f.appearanceType ?? "ONLINE") as TAppearance,
        joinUrl: null,
        venueName: null,
        venueAddress: null,
        dialInfo: null,
      });
      return { ...f, guests };
    });
  }

  function addHost(row: { id: string; name: string | null }) {
    setForm((f) => {
      if (!f) return f;
      const hosts = (f.hosts || []).slice();
      hosts.push({
        id: Math.random().toString(36).slice(2),
        userId: row.id,
        name: row.name ?? "Host",
        order: hosts.length,
        appearanceType: (f.hostAppearanceType ?? "ONLINE") as TAppearance,
        joinUrl: null,
        venueName: null,
        venueAddress: null,
        dialInfo: null,
      });
      return { ...f, hosts };
    });
  }
  function removeHost(index: number) {
    setForm((f) => {
      if (!f) return f;
      const hosts = (f.hosts || []).slice();
      hosts.splice(index, 1);
      hosts.forEach((h, i) => (h.order = i));
      return { ...f, hosts };
    });
  }
  function moveHost(index: number, delta: number) {
    setForm((f) => {
      if (!f) return f;
      const hosts = (f.hosts || []).slice();
      const j = index + delta;
      if (j < 0 || j >= hosts.length) return f;
      const tmp = hosts[index];
      hosts[index] = hosts[j];
      hosts[j] = tmp;
      hosts.forEach((h, i) => (h.order = i));
      return { ...f, hosts };
    });
  }
  function patchHost(index: number, next: Partial<HostRow>) {
    setForm((f) => {
      if (!f) return f;
      const hosts = (f.hosts || []).slice();
      hosts[index] = { ...hosts[index], ...next };
      return { ...f, hosts };
    });
  }

  /* ---------- validations (same rules you had) ---------- */
  function validateBeforeSave(b: BookingDto) {
    const fe: Record<string, string> = {};
    const gErrors: Record<number, any> = {};
    const hErrors: Record<number, any> = {};
    const hdErrors: Record<string, string> = {};

    // Guests UNIFIED + IN_PERSON + SHARED => need venue name or address
    if (
      b.appearanceScope === "UNIFIED" &&
      (b.appearanceType ?? "ONLINE") === "IN_PERSON" &&
      b.accessProvisioning === "SHARED"
    ) {
      if (
        !((b.locationName || "").trim() || (b.locationAddress || "").trim())
      ) {
        fe.locationName =
          "Provide a venue name or address when guests are IN_PERSON with SHARED access.";
        fe.locationAddress = fe.locationName;
      }
    }

    // Hosts UNIFIED + IN_PERSON + SHARED => need venue name or address
    if (
      b.hostAppearanceScope === "UNIFIED" &&
      (b.hostAppearanceType ?? "ONLINE") === "IN_PERSON" &&
      b.hostAccessProvisioning === "SHARED"
    ) {
      if (
        !(
          (b.hostLocationName || "").trim() ||
          (b.hostLocationAddress || "").trim()
        )
      ) {
        hdErrors.hostLocationName =
          "Provide a venue name or address for hosts (UNIFIED + SHARED, IN_PERSON).";
        hdErrors.hostLocationAddress = hdErrors.hostLocationName;
      }
    }

    setFieldErrors(fe);
    setGuestErrors(gErrors);
    setHostErrors(hErrors);
    setHostDefaultsErrors(hdErrors);

    if (Object.keys(fe).length) return false;
    return true;
  }

  /* ---------- participants sync (HOST only, no primary) ---------- */
  async function syncHostsToParticipants(bookingId: string, hosts: HostRow[]) {
    if (!MULTI_PARTICIPANTS_ENABLED) return;

    // Current participants (from cache loaded on mount)
    const existingHosts = participants.filter(
      (p) => p.roleInBooking === "HOST"
    );
    const existingByUserId = new Map(
      existingHosts.map((p) => [String(p.userId ?? ""), p])
    );

    const desiredUserIds = hosts
      .map((h) => String(h.userId ?? ""))
      .filter(Boolean);

    // plan removes
    const toRemove = existingHosts.filter(
      (p) => !desiredUserIds.includes(String(p.userId ?? ""))
    );

    // plan adds
    const toAdd = hosts
      .map((h) => String(h.userId ?? ""))
      .filter((uid) => uid && !existingByUserId.has(uid))
      .map((userId) => ({ userId, roleInBooking: "HOST" as const }));

    // Apply DELETEs first, then POST adds
    for (const p of toRemove) {
      try {
        await fetch(
          `/api/bookings/${bookingId}/participants?id=${encodeURIComponent(
            p.id
          )}`,
          { method: "DELETE", credentials: "include" }
        );
      } catch {
        /* ignore */
      }
    }
    if (toAdd.length) {
      try {
        await fetch(`/api/bookings/${bookingId}/participants`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participants: toAdd }),
        });
      } catch {
        /* ignore */
      }
    }

    // Refresh cache for future edits
    try {
      const rp = await fetch(`/api/bookings/${bookingId}/participants`, {
        credentials: "include",
        cache: "no-store",
      });
      const pj = await rp.json().catch(() => ({}));
      if (rp.ok && Array.isArray(pj?.participants)) {
        setParticipants(pj.participants as ParticipantDTO[]);
      }
    } catch {
      /* ignore */
    }
  }

  /* ---------- submit ---------- */
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form) return;

    setSaveError(null);
    setOk(null);

    if (!validateBeforeSave(form)) {
      setSaveError("Please fix the highlighted fields.");
      return;
    }

    // Build payload exactly like before (no legacy mirroring)
    const payload: Partial<BookingDto> = {
      subject: form.subject,
      newsroomName: form.newsroomName,
      programName: form.programName ?? null,
      talkingPoints: form.talkingPoints ?? null,

      // guests model
      appearanceScope: form.appearanceScope,
      accessProvisioning: form.accessProvisioning,
      appearanceType: form.appearanceType ?? null,
      locationUrl: form.locationUrl ?? null,
      locationName: form.locationName ?? null,
      locationAddress: form.locationAddress ?? null,
      dialInfo: PHONE_ENABLED ? form.dialInfo ?? null : null,

      // hosts defaults (UI parity)
      hostAppearanceScope: form.hostAppearanceScope,
      hostAccessProvisioning: form.hostAccessProvisioning,
      hostAppearanceType: form.hostAppearanceType ?? null,
      hostLocationUrl: form.hostLocationUrl ?? null,
      hostLocationName: form.hostLocationName ?? null,
      hostLocationAddress: form.hostLocationAddress ?? null,
      hostDialInfo: PHONE_ENABLED ? form.hostDialInfo ?? null : null,

      // guests array (unchanged persistence path)
      guests: (form.guests || []).map((g) => ({
        id: g.id,
        userId: g.userId,
        name: g.name,
        kind: g.kind,
        order: g.order,
        appearanceType: g.appearanceType,
        joinUrl: g.joinUrl ?? null,
        venueName: g.venueName ?? null,
        venueAddress: g.venueAddress ?? null,
        dialInfo: PHONE_ENABLED ? g.dialInfo ?? null : null,
      })),

      // NOTE: We intentionally do NOT persist hosts here when participants flag is ON.
      // Your existing /api/bookings/:id route can still accept hosts, but we prefer
      // the normalized participants route for HOSTS. If your server requires 'hosts'
      // in the payload during migration, keep it by uncommenting below:
      // hosts: form.hosts,
    };

    try {
      // Save booking core
      const res = await fetch(`/api/bookings/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(
          j?.error ||
            (res.status === 401
              ? "Please sign in."
              : res.status === 403
              ? "You don’t have permission to edit this booking."
              : "Failed to save booking.")
        );
        return;
      }

      // Sync HOSTS to participants (no primary)
      if (MULTI_PARTICIPANTS_ENABLED) {
        await syncHostsToParticipants(String(id), form.hosts || []);
      }

      setOk("Saved.");
      // router.push(`/modules/booking/${id}`);
    } catch (e) {
      setSaveError("Network error while saving.");
    }
  }

  /* ---------- render ---------- */
  if (loading) return <div className="p-3 text-sm text-gray-600">Loading…</div>;
  if (!form) {
    return (
      <div className="p-3 text-sm text-red-700">
        {loadError || "Booking not found."}
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
    <form className="flex flex-col gap-6 p-4" onSubmit={onSubmit}>
      <h1 className="text-2xl font-semibold">Edit booking</h1>

      {saveError && <UIAlert intent="error">{saveError}</UIAlert>}
      {ok && <UIAlert intent="success">{ok}</UIAlert>}

      {/* Basic */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Subject</span>
          <input
            value={form.subject}
            onChange={(e) => patch({ subject: e.target.value })}
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Newsroom name</span>
          <input
            value={form.newsroomName}
            onChange={(e) => patch({ newsroomName: e.target.value })}
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
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

        <label className="flex flex-col gap-1">
          <span className="text-sm">Duration (mins)</span>
          <input
            inputMode="numeric"
            value={form.durationMins}
            onChange={(e) =>
              patch({ durationMins: Number(e.target.value || 0) })
            }
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>
      </div>

      {/* Guests controls */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1">
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
              <label className="flex flex-col gap-1">
                <span className="text-sm">Access provisioning (guests)</span>
                <select
                  value={form.accessProvisioning}
                  onChange={(e) =>
                    patch({
                      accessProvisioning: e.target.value as TProvisioning,
                    })
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
            <div className="text-sm text-gray-700 md:col-span-2">
              Each guest selects their own appearance and access. Provisioning
              is per guest.
            </div>
          )}
        </div>

        {/* Guest defaults (UNIFIED + SHARED) */}
        {guestsSharedProvisioned && guestsUnified && (
          <div className="rounded-md border p-3">
            <div className="font-medium mb-2">Guest defaults</div>

            {(form.appearanceType ?? "ONLINE") === "ONLINE" && (
              <label className="flex flex-col gap-1">
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
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1">
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
                    <span className="text-xs text-red-600">
                      {fieldErrors.locationName}
                    </span>
                  )}
                </label>

                <label className="flex flex-col gap-1">
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
                    <span className="text-xs text-red-600">
                      {fieldErrors.locationAddress}
                    </span>
                  )}
                </label>
              </div>
            )}

            {(form.appearanceType ?? "ONLINE") === "PHONE" && PHONE_ENABLED && (
              <label className="flex flex-col gap-1">
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
      </div>

      {/* Guests list */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">Guests</div>
          <div className="text-xs text-gray-500">
            {form.guests?.length ?? 0} selected
          </div>
        </div>

        {(form.guests || []).length === 0 && (
          <div className="rounded-md border p-3 text-sm text-gray-600">
            No guests yet. Use “Add guest” below to append experts or reporters.
          </div>
        )}

        <div className="flex flex-col gap-3">
          {form.guests?.map((g, idx) => {
            const ge = guestErrors[idx] || {};
            const unifiedType = (form.appearanceType ??
              "ONLINE") as TAppearance;

            return (
              <div
                key={g.id || `${g.userId}-${idx}`}
                className="rounded-md border p-3"
              >
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
                    aria-label={`Remove guest ${g.name}`}
                  >
                    Remove
                  </button>
                </div>

                {g.userId && (
                  <div className="text-[11px] text-gray-500 mb-2">
                    {g.userId}
                  </div>
                )}

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
                            {ge.joinUrl && (
                              <span className="text-xs text-red-600">
                                {ge.joinUrl}
                              </span>
                            )}
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
                              {ge.venueName && (
                                <span className="text-xs text-red-600">
                                  {ge.venueName}
                                </span>
                              )}
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
                              {ge.venueAddress && (
                                <span className="text-xs text-red-600">
                                  {ge.venueAddress}
                                </span>
                              )}
                            </label>
                          </div>
                        )}

                        {unifiedType === "PHONE" && PHONE_ENABLED && (
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
                            {g.dialInfo && (
                              <span className="text-xs text-red-600">
                                {g.dialInfo}
                              </span>
                            )}
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
                        {ge.joinUrl && (
                          <span className="text-xs text-red-600">
                            {ge.joinUrl}
                          </span>
                        )}
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
                          {ge.venueName && (
                            <span className="text-xs text-red-600">
                              {ge.venueName}
                            </span>
                          )}
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
                          {ge.venueAddress && (
                            <span className="text-xs text-red-600">
                              {ge.venueAddress}
                            </span>
                          )}
                        </label>
                      </div>
                    )}

                    {g.appearanceType === "PHONE" && PHONE_ENABLED && (
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
                        {g.dialInfo && (
                          <span className="text-xs text-red-600">
                            {g.dialInfo}
                          </span>
                        )}
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
      </div>

      {/* Hosts (participants-driven persistence on save; no primary) */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1">
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
              <label className="flex flex-col gap-1">
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

              <label className="flex flex-col gap-1">
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
            <div className="text-sm text-gray-700 md:col-span-2">
              Each host selects their own appearance and access. Provisioning is
              per host.
            </div>
          )}
        </div>

        {/* Host defaults (UNIFIED + SHARED) */}
        {hostsUnified && hostsShared && (
          <div className="rounded-md border p-3">
            <div className="font-medium mb-2">Host defaults</div>

            {hostUnifiedType === "ONLINE" && (
              <label className="flex flex-col gap-1">
                <span className="text-sm">Default meeting link (hosts)</span>
                <input
                  value={form.hostLocationUrl ?? ""}
                  onChange={(e) => patch({ hostLocationUrl: e.target.value })}
                  className={clsx(
                    "w-full rounded-md border px-3 py-2",
                    hostDefaultsErrors.hostLocationUrl && "border-red-500"
                  )}
                  placeholder="https://…"
                />
                {hostDefaultsErrors.hostLocationUrl && (
                  <span className="text-xs text-red-600">
                    {hostDefaultsErrors.hostLocationUrl}
                  </span>
                )}
              </label>
            )}

            {hostUnifiedType === "IN_PERSON" && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-sm">Default host venue name</span>
                  <input
                    value={form.hostLocationName ?? ""}
                    onChange={(e) =>
                      patch({ hostLocationName: e.target.value })
                    }
                    className={clsx(
                      "w-full rounded-md border px-3 py-2",
                      hostDefaultsErrors.hostLocationName && "border-red-500"
                    )}
                    placeholder="Studio A"
                  />
                  {hostDefaultsErrors.hostLocationName && (
                    <span className="text-xs text-red-600">
                      {hostDefaultsErrors.hostLocationName}
                    </span>
                  )}
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-sm">Default host address</span>
                  <input
                    value={form.hostLocationAddress ?? ""}
                    onChange={(e) =>
                      patch({ hostLocationAddress: e.target.value })
                    }
                    className={clsx(
                      "w-full rounded-md border px-3 py-2",
                      hostDefaultsErrors.hostLocationAddress && "border-red-500"
                    )}
                    placeholder="123 Example St…"
                  />
                  {hostDefaultsErrors.hostLocationAddress && (
                    <span className="text-xs text-red-600">
                      {hostDefaultsErrors.hostLocationAddress}
                    </span>
                  )}
                </label>
              </div>
            )}

            {hostUnifiedType === "PHONE" && PHONE_ENABLED && (
              <label className="flex flex-col gap-1">
                <span className="text-sm">Default host dial info</span>
                <input
                  value={form.hostDialInfo ?? ""}
                  onChange={(e) => patch({ hostDialInfo: e.target.value })}
                  className={clsx(
                    "w-full rounded-md border px-3 py-2",
                    hostDefaultsErrors.hostDialInfo && "border-red-500"
                  )}
                  placeholder="e.g., +1 555 123 4567 PIN 0000"
                />
                {hostDefaultsErrors.hostDialInfo && (
                  <span className="text-xs text-red-600">
                    {hostDefaultsErrors.hostDialInfo}
                  </span>
                )}
              </label>
            )}
          </div>
        )}
      </div>

      {/* Hosts list (no primary badge) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">Hosts</div>
          <div className="text-xs text-gray-500">
            {form.hosts?.length ?? 0} selected
          </div>
        </div>

        {(form.hosts || []).length === 0 && (
          <div className="rounded-md border p-3 text-sm text-gray-600">
            No hosts yet. Use “Add host” to append hosts.
          </div>
        )}

        <div className="flex flex-col gap-3">
          {form.hosts?.map((h, idx) => {
            const he = hostErrors[idx] || {};

            return (
              <div
                key={h.id || `${h.userId}-${idx}`}
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
                      aria-label={`Move host ${h.name} up`}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => moveHost(idx, +1)}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                      title="Move down"
                      aria-label={`Move host ${h.name} down`}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() => removeHost(idx)}
                      className="rounded-md border px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      title="Remove host"
                      aria-label={`Remove host ${h.name}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {h.userId && (
                  <div className="text-[11px] text-gray-500 mb-2">
                    {h.userId}
                  </div>
                )}

                {/* Host access fields */}
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
                            {he.joinUrl && (
                              <span className="text-xs text-red-600">
                                {he.joinUrl}
                              </span>
                            )}
                          </label>
                        )}

                        {hostUnifiedType === "IN_PERSON" && (
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
                              {he.venueName && (
                                <span className="text-xs text-red-600">
                                  {he.venueName}
                                </span>
                              )}
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
                              {he.venueAddress && (
                                <span className="text-xs text-red-600">
                                  {he.venueAddress}
                                </span>
                              )}
                            </label>
                          </div>
                        )}

                        {hostUnifiedType === "PHONE" && PHONE_ENABLED && (
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
                            {h.dialInfo && (
                              <span className="text-xs text-red-600">
                                {h.dialInfo}
                              </span>
                            )}
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
                        {PHONE_ENABLED && <option value="PHONE">PHONE</option>}
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
                        {he.joinUrl && (
                          <span className="text-xs text-red-600">
                            {he.joinUrl}
                          </span>
                        )}
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
                              "w/full rounded-md border px-3 py-2",
                              he.venueName && "border-red-500"
                            )}
                            placeholder="Studio A"
                          />
                          {he.venueName && (
                            <span className="text-xs text-red-600">
                              {he.venueName}
                            </span>
                          )}
                        </label>

                        <label className="flex flex-col gap-1">
                          <span className="text-sm">Venue address</span>
                          <input
                            value={h.venueAddress ?? ""}
                            onChange={(ev) =>
                              patchHost(idx, { venueAddress: ev.target.value })
                            }
                            className={clsx(
                              "w/full rounded-md border px-3 py-2",
                              he.venueAddress && "border-red-500"
                            )}
                            placeholder="123 Example St…"
                          />
                          {he.venueAddress && (
                            <span className="text-xs text-red-600">
                              {he.venueAddress}
                            </span>
                          )}
                        </label>
                      </div>
                    )}

                    {h.appearanceType === "PHONE" && PHONE_ENABLED && (
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
                        {h.dialInfo && (
                          <span className="text-xs text-red-600">
                            {h.dialInfo}
                          </span>
                        )}
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
          existingIds={(form.hosts || [])
            .filter((h) => h.userId)
            .map((h) => h.userId as string)}
          startAtISO={form.startAt}
          durationMins={form.durationMins}
        />
      </div>

      {/* Optionals */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Program name</span>
          <input
            value={form.programName ?? ""}
            onChange={(e) => patch({ programName: e.target.value })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Program"
          />
        </label>

        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-sm">Talking points</span>
          <textarea
            value={form.talkingPoints ?? ""}
            onChange={(e) => patch({ talkingPoints: e.target.value })}
            className="min-h-[120px] w-full rounded-md border px-3 py-2"
            placeholder="Any internal notes for the team…"
          />
        </label>
      </div>

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
