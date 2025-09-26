"use client";

/**
 * New Booking (Win-All merge)
 * - Experts: MULTI-SELECT (chips; removable) — no “primary” concept in UI.
 * - Host: first-class combobox (mirrors to legacy hostName for back-compat).
 *
 * - Appearance model parity with Edit (PHONE now supported on create when enabled):
 *   • appearanceScope: UNIFIED | PER_GUEST
 *   • accessProvisioning: SHARED | PER_GUEST
 *   • unifiedType (when UNIFIED): ONLINE | IN_PERSON | PHONE (if enabled)
 *   • booking defaults (locationUrl | locationName/locationAddress | dialInfo)
 *   • per-guest appearance & fields when PER_GUEST (ONLINE/IN_PERSON/PHONE if enabled)
 *
 * API:
 * - Mirrors first expert to expertUserId/expertName for back-compat.
 * - Sends ordered guests[] for persistence in BookingGuest.
 */

import * as React from "react";
import { z } from "zod";
import { useRouter } from "next/navigation";

/* ---------- Feature flags (dataset = dynamic settings, env = build-time) ---------- */
function readBooleanDataset(key: string, fallback = true): boolean {
  if (typeof document === "undefined") return fallback;
  const raw = (document.body.dataset as DOMStringMap)[key];
  if (raw == null) return fallback;
  return raw === "true";
}
const PHONE_ENABLED =
  (process.env.NEXT_PUBLIC_APPEARANCE_PHONE ?? "true") !== "false";

type Flags = {
  showProgramName: boolean;
  showHostName: boolean;
  showTalkingPoints: boolean;
};

/* ---------- Enums (PHONE included only if PHONE_ENABLED) ---------- */
const AppearanceType = z.enum(
  (PHONE_ENABLED
    ? ["ONLINE", "IN_PERSON", "PHONE"]
    : ["ONLINE", "IN_PERSON"]) as
    | readonly ["ONLINE", "IN_PERSON"]
    | readonly ["ONLINE", "IN_PERSON", "PHONE"]
);
type TAppearanceType = z.infer<typeof AppearanceType>;

const Scope = z.enum(["UNIFIED", "PER_GUEST"]);
type TScope = z.infer<typeof Scope>;

const Provisioning = z.enum(["SHARED", "PER_GUEST"]);
type TProvisioning = z.infer<typeof Provisioning>;

/* ---------- Datetime helpers ---------- */
function nextFullHourLocalISO(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/* ---------- UI building blocks (repo primitives with safe fallback) ---------- */
import * as ButtonModule from "../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/* ---------- Tiny utils ---------- */
function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
function useDebounce<T>(value: T, delay = 250) {
  const [v, setV] = React.useState<T>(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* =======================================================================
 * Expert Combobox (MULTI-SELECT)
 * ======================================================================= */
type ExpertRow = {
  id: string;
  name: string | null;
  bio?: string | null;
  city?: string | null;
  countryCode?: string | null;
  tags?: string[];
  availability?: {
    status: "AVAILABLE" | "BUSY" | "UNKNOWN";
    reasons?: string[];
  };
};
type Picked = { id: string; name: string };

function ExpertCombobox(props: {
  startAtISO: string;
  durationMins: number;
  values: Picked[];
  onChange: (next: Picked[]) => void;
}) {
  const { startAtISO, durationMins, values, onChange } = props;
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [visibility, setVisibility] = React.useState<"org" | "public" | "both">(
    "org"
  );
  const [onlyAvailable, setOnlyAvailable] = React.useState(false);
  const [items, setItems] = React.useState<ExpertRow[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const debouncedQ = useDebounce(q, 250);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debouncedQ, visibility, onlyAvailable, startAtISO, durationMins]);

  async function fetchPage(reset = false) {
    try {
      setLoading(true);
      setError("");
      const sp = new URLSearchParams({ visibility, take: "20" });
      if (debouncedQ) sp.set("q", debouncedQ);
      if (startAtISO && durationMins > 0) {
        sp.set("startAt", new Date(startAtISO).toISOString());
        sp.set("durationMins", String(durationMins));
        if (onlyAvailable) sp.set("onlyAvailable", "true");
      }
      if (!reset && nextCursor) sp.set("cursor", nextCursor);

      const res = await fetch(`/api/experts/search?${sp.toString()}`, {
        credentials: "include",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed (${res.status})`);
      setItems((prev) =>
        reset ? j.items || [] : [...prev, ...(j.items || [])]
      );
      setNextCursor(j.nextCursor || null);
    } catch (err: any) {
      setError(err?.message || "Failed to search experts.");
      if (reset) {
        setItems([]);
        setNextCursor(null);
      }
    } finally {
      setLoading(false);
    }
  }

  function alreadyPicked(id: string) {
    return values.some((v) => v.id === id);
  }
  function add(row: ExpertRow) {
    if (alreadyPicked(row.id)) return;
    onChange([...values, { id: row.id, name: row.name || "Unknown" }]);
  }
  function remove(id: string) {
    onChange(values.filter((v) => v.id !== id));
  }

  return (
    <div ref={wrapRef} className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="font-medium">Select experts (search)</div>
        {values.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
          >
            Clear all
          </button>
        )}
      </div>

      {/* chips */}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((v) => (
            <span
              key={v.id}
              className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-2 py-1 text-sm"
            >
              {v.name}
              <button
                onClick={() => remove(v.id)}
                className="rounded p-0.5 text-gray-500 hover:bg-gray-200"
                aria-label={`Remove ${v.name}`}
                title="Remove"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* search + toggle */}
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search experts…"
          className="min-w-[240px] flex-1 rounded-md border px-3 py-2"
        />
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>
      </div>

      {open && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center gap-2">
            {(["org", "public", "both"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVisibility(v)}
                className={clsx(
                  "rounded-md border px-2 py-1 text-xs capitalize",
                  visibility === v ? "bg-black text-white" : "hover:bg-gray-50"
                )}
              >
                {v}
              </button>
            ))}
            <label className="ml-2 inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
              />
              Show availability (slot-aware)
            </label>
          </div>

          {loading && <div className="text-sm">Loading…</div>}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="text-sm text-gray-500">No matches.</div>
          )}

          {items.map((e) => {
            const picked = alreadyPicked(e.id);
            const badge =
              e.availability?.status === "AVAILABLE"
                ? "bg-green-100 text-green-800"
                : e.availability?.status === "BUSY"
                ? "bg-red-100 text-red-800"
                : "bg-gray-100 text-gray-700";
            return (
              <button
                key={e.id}
                onClick={() => add(e)}
                disabled={picked}
                className={clsx(
                  "w-full rounded-md border px-3 py-2 text-left",
                  picked && "opacity-50"
                )}
              >
                <div className="font-medium">{e.name || "Unnamed"}</div>
                <div
                  className={clsx(
                    "mt-1 inline-flex items-center rounded px-1.5 py-0.5 text-xs",
                    badge
                  )}
                >
                  {e.availability?.status ?? "UNKNOWN"}
                </div>
                <div className="mt-1 text-xs text-gray-600">
                  {e.city && <span>{e.city}</span>}{" "}
                  {e.countryCode && (
                    <span className="rounded border px-1">{e.countryCode}</span>
                  )}
                  {(e.tags || []).slice(0, 2).map((t) => (
                    <span key={t} className="ml-1 rounded bg-gray-100 px-1">
                      #{t}
                    </span>
                  ))}
                </div>
                {e.bio && <p className="mt-1 line-clamp-2 text-xs">{e.bio}</p>}
              </button>
            );
          })}

          {nextCursor && !loading && (
            <button
              onClick={() => fetchPage(false)}
              type="button"
              className="mt-2 w-full rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Load more
            </button>
          )}

          <div className="text-right">
            <button
              onClick={() => setOpen(false)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =======================================================================
 * Host Combobox (first-class; mirrors name to legacy hostName)
 * ======================================================================= */
type HostRow = { id: string; name: string | null };

function HostCombobox(props: {
  value: HostRow | null;
  onChange: (next: HostRow | null) => void;
}) {
  const { value, onChange } = props;
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<HostRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const debouncedQ = useDebounce(q, 250);

  React.useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const sp = new URLSearchParams({ take: "20" });
        if (debouncedQ) sp.set("q", debouncedQ);
        const res = await fetch(`/api/hosts/search?${sp.toString()}`, {
          credentials: "include",
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j?.error || "Failed to load hosts");
        setItems(j.items || []);
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
        <div className="font-medium">Host (optional)</div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        className="w-full rounded-md border px-3 py-2"
        placeholder="Search hosts…"
      />

      {open && (
        <div className="space-y-2 rounded-md border p-3">
          {loading && <div className="text-sm">Loading hosts…</div>}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="text-sm text-gray-500">
              No host directory available.
            </div>
          )}
          {items.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                onChange({ id: h.id, name: h.name || "Unknown" });
                setOpen(false);
              }}
              className="w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50"
            >
              <div className="font-medium">{h.name || "Unnamed"}</div>
              <div className="text-xs text-gray-500">{h.id}</div>
            </button>
          ))}
        </div>
      )}

      {value && (
        <div className="text-sm text-gray-600">
          Selected host: <span className="font-medium">{value.name}</span>
        </div>
      )}
    </div>
  );
}

/* =======================================================================
 * Page
 * ======================================================================= */
type GuestRow = {
  appearanceType: TAppearanceType;
  joinUrl?: string;
  venueName?: string;
  venueAddress?: string;
  dialInfo?: string;
};

export default function NewBookingPage() {
  const router = useRouter();

  const flags: Flags = {
    showProgramName: readBooleanDataset("flagShowProgramName", true),
    showHostName: readBooleanDataset("flagShowHostName", true),
    showTalkingPoints: readBooleanDataset("flagShowTalkingPoints", true),
  };

  // Minimal schema (server remains the source of truth)
  const Schema = React.useMemo(
    () =>
      z.object({
        subject: z.string().min(2),
        newsroomName: z.string().min(2),
        startAt: z.preprocess(
          (v) => (typeof v === "string" ? new Date(v) : v),
          z.date()
        ),
        durationMins: z.number().min(5).max(600),
        appearanceScope: Scope,
        accessProvisioning: Provisioning,
        unifiedType: AppearanceType.optional(),
      }),
    []
  );

  /* ---------- Core fields ---------- */
  const [form, setForm] = React.useState({
    subject: "",
    newsroomName: "",
    startAt: nextFullHourLocalISO(),
    durationMins: 30,
    appearanceScope: "UNIFIED" as TScope,
    accessProvisioning: "SHARED" as TProvisioning,
    unifiedType: "ONLINE" as TAppearanceType, // when UNIFIED
    // booking defaults
    locationUrl: "",
    locationName: "",
    locationAddress: "",
    dialInfo: "", // NEW: default phone dial-in / instructions
    // optional extras
    programName: "",
    hostName: "",
    talkingPoints: "",
  });

  const [experts, setExperts] = React.useState<Picked[]>([]);
  const [host, setHost] = React.useState<HostRow | null>(null);

  // Per-guest fields when PER_GUEST
  const [guestMap, setGuestMap] = React.useState<Record<string, GuestRow>>({});

  React.useEffect(() => {
    // ensure guestMap has rows for all picked experts
    setGuestMap((prev) => {
      const next = { ...prev };
      for (const e of experts) {
        if (!next[e.id]) {
          next[e.id] = { appearanceType: "ONLINE" };
        }
      }
      // prune removed
      for (const k of Object.keys(next)) {
        if (!experts.some((e) => e.id === k)) delete next[k];
      }
      return next;
    });
  }, [experts]);

  // Mirror selected host name to legacy hostName text field
  React.useEffect(() => {
    if (host?.name) setForm((f) => ({ ...f, hostName: host.name! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host?.name]);

  function updateGuest(id: string, patch: Partial<GuestRow>) {
    setGuestMap((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  }

  /* ---------- Submit ---------- */
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);

    const primary = experts[0] ?? null;

    // Build guests[] payload (order preserved)
    const guests =
      experts.length === 0
        ? []
        : experts.map((x, i) => {
            const g = guestMap[x.id] || {
              appearanceType: "ONLINE" as TAppearanceType,
            };
            return {
              userId: x.id,
              name: x.name,
              kind: "EXPERT",
              order: i,
              appearanceType:
                form.appearanceScope === "UNIFIED"
                  ? form.unifiedType
                  : g.appearanceType,
              joinUrl:
                form.appearanceScope === "PER_GUEST" &&
                g.appearanceType === "ONLINE"
                  ? g.joinUrl || null
                  : null,
              venueName:
                form.appearanceScope === "PER_GUEST" &&
                g.appearanceType === "IN_PERSON"
                  ? g.venueName || null
                  : null,
              venueAddress:
                form.appearanceScope === "PER_GUEST" &&
                g.appearanceType === "IN_PERSON"
                  ? g.venueAddress || null
                  : null,
              dialInfo:
                form.appearanceScope === "PER_GUEST" &&
                g.appearanceType === "PHONE"
                  ? g.dialInfo || null
                  : null,
            };
          });

    const payload = {
      subject: form.subject,
      newsroomName: form.newsroomName,
      startAt: new Date(form.startAt).toISOString(),
      durationMins: Number(form.durationMins),
      appearanceScope: form.appearanceScope,
      accessProvisioning: form.accessProvisioning,
      appearanceType:
        form.appearanceScope === "UNIFIED" ? form.unifiedType : null,
      // booking defaults (used directly when UNIFIED; as fallbacks when PER_GUEST + SHARED)
      locationUrl: form.locationUrl || null,
      locationName: form.locationName || null,
      locationAddress: form.locationAddress || null,
      dialInfo: form.dialInfo || null, // NEW
      // back-compat mirror + full guests
      expertUserId: primary?.id,
      expertName: primary?.name ?? undefined,
      guests,
      // optional extras
      programName: form.programName || undefined,
      hostName: form.hostName || undefined, // updated when Host selected
      talkingPoints: form.talkingPoints || undefined,
    };

    // Minimal client validation (server is the source of truth)
    try {
      Schema.parse({
        subject: payload.subject,
        newsroomName: payload.newsroomName,
        startAt: payload.startAt,
        durationMins: payload.durationMins,
        appearanceScope: payload.appearanceScope,
        accessProvisioning: payload.accessProvisioning,
        unifiedType:
          form.appearanceScope === "UNIFIED" ? form.unifiedType : undefined,
      });
    } catch (err: any) {
      const first = err?.errors?.[0]?.message ?? "Please check your inputs.";
      setError(first);
      return;
    }

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
      setOk("Booking created.");
      // Navigate to the canonical view page
      router.push(`/modules/booking/${j.booking?.id}`);
    } catch (err: any) {
      setError(err?.message || "Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------- Render ---------- */
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">New booking</h1>

      {error && (
        <UIAlert className="border-red-200 bg-red-50 text-red-800">
          {error}
        </UIAlert>
      )}
      {ok && (
        <UIAlert className="border-green-200 bg-green-50 text-green-800">
          {ok}
        </UIAlert>
      )}

      {/* Basic info */}
      <form onSubmit={onSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-sm font-medium">Subject</div>
            <input
              value={form.subject}
              onChange={(e) =>
                setForm((f) => ({ ...f, subject: e.target.value }))
              }
              required
              className="w-full rounded-md border px-3 py-2"
            />
          </label>

          <label className="space-y-1">
            <div className="text-sm font-medium">Newsroom name</div>
            <input
              value={form.newsroomName}
              onChange={(e) =>
                setForm((f) => ({ ...f, newsroomName: e.target.value }))
              }
              required
              className="w-full rounded-md border px-3 py-2"
            />
          </label>

          <label className="space-y-1">
            <div className="text-sm font-medium">Start at</div>
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

          <label className="space-y-1">
            <div className="text-sm font-medium">Duration (mins)</div>
            <input
              type="number"
              min={5}
              max={600}
              value={form.durationMins}
              onChange={(e) =>
                setForm((f) => ({ ...f, durationMins: Number(e.target.value) }))
              }
              required
              className="w-full rounded-md border px-3 py-2"
            />
          </label>
        </div>

        {/* Appearance model */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-sm font-medium">Appearance scope</div>
            <select
              value={form.appearanceScope}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  appearanceScope: e.target.value as TScope,
                }))
              }
              className="w-full rounded-md border px-3 py-2"
            >
              <option value="UNIFIED">UNIFIED (single)</option>
              <option value="PER_GUEST">PER_GUEST</option>
            </select>
          </label>

          <label className="space-y-1">
            <div className="text-sm font-medium">Access provisioning</div>
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

          {form.appearanceScope === "UNIFIED" && (
            <label className="space-y-1 md:col-span-2">
              <div className="text-sm font-medium">Unified type</div>
              <select
                value={form.unifiedType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    unifiedType: e.target.value as TAppearanceType,
                  }))
                }
                className="w-full rounded-md border px-3 py-2"
              >
                <option value="ONLINE">ONLINE</option>
                <option value="IN_PERSON">IN_PERSON</option>
                {PHONE_ENABLED && <option value="PHONE">PHONE</option>}
              </select>
            </label>
          )}
        </div>

        {/* Booking defaults */}
        <div className="space-y-3 rounded-md border p-4">
          <div className="font-medium">Booking defaults</div>

          {form.appearanceScope === "UNIFIED" &&
            form.unifiedType === "ONLINE" && (
              <label className="space-y-1">
                <div className="text-sm">Default meeting link</div>
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

          {form.appearanceScope === "UNIFIED" &&
            form.unifiedType === "IN_PERSON" && (
              <>
                <label className="space-y-1">
                  <div className="text-sm">Default venue name</div>
                  <input
                    value={form.locationName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, locationName: e.target.value }))
                    }
                    className="w-full rounded-md border px-3 py-2"
                    placeholder="Studio A"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-sm">Default address</div>
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

          {form.appearanceScope === "UNIFIED" &&
            PHONE_ENABLED &&
            form.unifiedType === "PHONE" && (
              <label className="space-y-1">
                <div className="text-sm">Default dial info</div>
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

          {form.appearanceScope === "PER_GUEST" &&
            form.accessProvisioning === "SHARED" && (
              <div className="text-xs text-gray-600">
                Tip: With SHARED provisioning, you may leave guest fields empty
                and they will fall back to these booking defaults (if provided).
              </div>
            )}
        </div>

        {/* Experts picker */}
        <ExpertCombobox
          startAtISO={form.startAt}
          durationMins={form.durationMins}
          values={experts}
          onChange={setExperts}
        />

        {/* Per-guest fields when PER_GUEST */}
        {form.appearanceScope === "PER_GUEST" && experts.length > 0 && (
          <div className="space-y-3 rounded-md border p-4">
            <div className="font-medium">Guests</div>

            {experts.map((e, idx) => {
              const g = guestMap[e.id] || {
                appearanceType: "ONLINE" as TAppearanceType,
              };
              return (
                <div key={e.id} className="rounded-md border p-3">
                  <div className="mb-2 text-sm font-medium">
                    #{idx + 1} {e.name}
                  </div>

                  <div className="mb-1 text-[10px] text-gray-500">{e.id}</div>

                  <label className="mb-3 block space-y-1">
                    <div className="text-sm">Appearance</div>
                    <select
                      value={g.appearanceType}
                      onChange={(ev) =>
                        updateGuest(e.id, {
                          appearanceType: ev.target.value as TAppearanceType,
                          joinUrl: undefined,
                          venueName: undefined,
                          venueAddress: undefined,
                          dialInfo: undefined,
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
                    <label className="block space-y-1">
                      <div className="text-sm">Join URL</div>
                      <input
                        value={g.joinUrl || ""}
                        onChange={(ev) =>
                          updateGuest(e.id, { joinUrl: ev.target.value })
                        }
                        className="w-full rounded-md border px-3 py-2"
                        placeholder="https://…"
                      />
                    </label>
                  )}

                  {g.appearanceType === "IN_PERSON" && (
                    <>
                      <label className="block space-y-1">
                        <div className="text-sm">Venue name</div>
                        <input
                          value={g.venueName || ""}
                          onChange={(ev) =>
                            updateGuest(e.id, { venueName: ev.target.value })
                          }
                          className="w-full rounded-md border px-3 py-2"
                          placeholder="Studio A"
                        />
                      </label>
                      <label className="block space-y-1">
                        <div className="text-sm">Venue address</div>
                        <input
                          value={g.venueAddress || ""}
                          onChange={(ev) =>
                            updateGuest(e.id, { venueAddress: ev.target.value })
                          }
                          className="w-full rounded-md border px-3 py-2"
                          placeholder="123 Example St…"
                        />
                      </label>
                    </>
                  )}

                  {PHONE_ENABLED && g.appearanceType === "PHONE" && (
                    <label className="block space-y-1">
                      <div className="text-sm">Dial info</div>
                      <input
                        value={g.dialInfo || ""}
                        onChange={(ev) =>
                          updateGuest(e.id, { dialInfo: ev.target.value })
                        }
                        className="w-full rounded-md border px-3 py-2"
                        placeholder="e.g., +1 555 123 4567 PIN 0000"
                      />
                    </label>
                  )}

                  {form.accessProvisioning === "SHARED" && (
                    <div className="mt-2 text-xs text-gray-500">
                      Leave blank to use booking defaults (if any).
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Host */}
        <HostCombobox value={host} onChange={setHost} />

        {/* Optionals via flags */}
        {flags.showProgramName && (
          <label className="block space-y-1">
            <div className="text-sm">Program name</div>
            <input
              value={form.programName}
              onChange={(e) =>
                setForm((f) => ({ ...f, programName: e.target.value }))
              }
              className="w-full rounded-md border px-3 py-2"
              placeholder="Program"
            />
          </label>
        )}
        {flags.showHostName && (
          <label className="block space-y-1">
            <div className="text-sm">Host name (legacy)</div>
            <input
              value={form.hostName}
              onChange={(e) =>
                setForm((f) => ({ ...f, hostName: e.target.value }))
              }
              className="w-full rounded-md border px-3 py-2"
              placeholder="Leave empty if you selected a host above"
            />
          </label>
        )}
        {flags.showTalkingPoints && (
          <label className="block space-y-1">
            <div className="text-sm">Talking points</div>
            <textarea
              value={form.talkingPoints}
              onChange={(e) =>
                setForm((f) => ({ ...f, talkingPoints: e.target.value }))
              }
              className="w-full min-h-[90px] rounded-md border px-3 py-2"
              placeholder="Optional"
            />
          </label>
        )}

        <div>
          <UIButton type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create booking"}
          </UIButton>
        </div>

        {form.appearanceScope === "UNIFIED" && (
          <div className="text-xs text-gray-500">
            Tip: when UNIFIED, only the unified type’s default fields are
            required.
          </div>
        )}
      </form>
    </div>
  );
}
