"use client";

/**
 * New Booking
 * - Experts: MULTI-SELECT, no "primary"
 * - Host: first-class combobox (mirrors to hostName for back-compat)
 * - Appearance model parity with Edit (minus PHONE on create for now):
 *     * appearanceScope: UNIFIED | PER_GUEST
 *     * accessProvisioning: SHARED | PER_GUEST
 *     * unifiedType (when UNIFIED): ONLINE | IN_PERSON
 *     * booking defaults (locationUrl | locationName/locationAddress)
 *     * per-guest appearance & fields when PER_GUEST (ONLINE/IN_PERSON only)
 */

import React from "react";
import { z } from "zod";
import { useRouter } from "next/navigation";

/* ---------- Flags from <body data-*> ---------- */
function readBooleanDataset(key: string, fallback = true): boolean {
  if (typeof document === "undefined") return fallback;
  const raw = (document.body.dataset as DOMStringMap)[key];
  if (raw == null) return fallback;
  return raw === "true";
}

type Flags = {
  showProgramName: boolean;
  showHostName: boolean;
  showTalkingPoints: boolean;
};

/* ---------- Enums (PHONE disabled on create to match API) ---------- */
const AppearanceType = z.enum(["ONLINE", "IN_PERSON"]);
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

/* ---------- UI building blocks ---------- */
import * as ButtonModule from "../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
function useDebounce<T>(value: T, delay = 250) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* ===============================================================
 * Expert Search (MULTI-SELECT)
 * ===============================================================*/
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

  const [activeIndex, setActiveIndex] = React.useState(-1);
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
      setActiveIndex((x) => (reset ? (j.items?.length ? 0 : -1) : x));
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
    <div className="space-y-2" ref={wrapRef}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Select experts (search)</div>
        {values.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
          >
            Clear all
          </button>
        )}
      </div>

      {/* chips */}
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <span
            key={v.id}
            className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm"
          >
            <span>{v.name}</span>
            <button
              type="button"
              onClick={() => remove(v.id)}
              className="rounded p-0.5 text-gray-500 hover:bg-gray-200"
              aria-label={`Remove ${v.name}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* search+toggle */}
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search experts…"
          className="min-w-[240px] flex-1 rounded-md border px-3 py-2"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>
      </div>

      {open && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {(["org", "public", "both"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={clsx(
                    "rounded-md border px-2 py-1 text-xs capitalize",
                    visibility === v
                      ? "bg-black text-white"
                      : "hover:bg-gray-50"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
              />
              Only available for this slot
            </label>
          </div>

          <div className="space-y-2">
            {loading && (
              <div className="rounded-md bg-gray-50 p-3 text-sm">Loading…</div>
            )}
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {!loading && !error && items.length === 0 && (
              <div className="rounded-md bg-gray-50 p-3 text-sm">
                No matches.
              </div>
            )}

            {items.map((e, idx) => {
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
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => add(e)}
                  disabled={picked}
                  className={clsx(
                    "w-full rounded-md border px-3 py-2 text-left",
                    picked && "opacity-50"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{e.name || "Unnamed"}</div>
                    <span
                      className={clsx("rounded px-2 py-0.5 text-xs", badge)}
                    >
                      {e.availability?.status ?? "UNKNOWN"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    {e.city && <span className="mr-2">{e.city}</span>}
                    {e.countryCode && (
                      <span className="mr-2">{e.countryCode}</span>
                    )}
                    {(e.tags || []).slice(0, 2).map((t) => (
                      <span key={t} className="mr-2">
                        #{t}
                      </span>
                    ))}
                  </div>
                  {e.bio && (
                    <div className="mt-1 line-clamp-2 text-xs text-gray-500">
                      {e.bio}
                    </div>
                  )}
                </button>
              );
            })}

            {nextCursor && !loading && (
              <button
                onClick={() => fetchPage(false)}
                type="button"
                className="w-full rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
              >
                Load more
              </button>
            )}
          </div>

          <div className="mt-2 flex justify-end">
            <button
              type="button"
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

/* ===============================================================
 * Host Combobox (first-class object; mirrors name to legacy hostName)
 * ===============================================================*/
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
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Host (optional)</div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>
      </div>

      <input
        placeholder="Search hosts…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        className="w-full rounded-md border px-3 py-2"
      />

      {open && (
        <div className="space-y-2 rounded-md border p-3">
          {loading && (
            <div className="rounded-md bg-gray-50 p-3 text-sm">
              Loading hosts…
            </div>
          )}
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="rounded-md bg-gray-50 p-3 text-sm">
              No host directory available.
            </div>
          )}
          {items.map((h) => (
            <button
              key={h.id}
              type="button"
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-gray-50"
              onClick={() => {
                onChange({ id: h.id, name: h.name || "Unknown" });
                setOpen(false);
              }}
            >
              <span>{h.name || "Unnamed"}</span>
              <span className="text-xs text-gray-400">{h.id}</span>
            </button>
          ))}
        </div>
      )}

      {value && (
        <div className="text-xs text-gray-600">
          Selected host: <span className="font-medium">{value.name}</span>
        </div>
      )}
    </div>
  );
}

/* ===============================================================
 * Page
 * ===============================================================*/
type GuestRow = {
  appearanceType: TAppearanceType;
  joinUrl?: string;
  venueName?: string;
  venueAddress?: string;
};

export default function NewBookingPage() {
  const router = useRouter();

  const flags: Flags = {
    showProgramName: readBooleanDataset("flagShowProgramName", true),
    showHostName: readBooleanDataset("flagShowHostName", true),
    showTalkingPoints: readBooleanDataset("flagShowTalkingPoints", true),
  };

  // Minimal schema (server is source of truth for complex validation)
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
    unifiedType: "ONLINE" as TAppearanceType, // UNIFIED only
    // booking defaults
    locationUrl: "",
    locationName: "",
    locationAddress: "",
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
    // ensure guestMap has rows for all picked experts (initialize from unified defaults)
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

      // booking defaults (server will require relevant ones based on unifiedType)
      locationUrl: form.locationUrl || null,
      locationName: form.locationName || null,
      locationAddress: form.locationAddress || null,

      // back-compat mirror + full guests
      expertUserId: primary?.id,
      expertName: primary?.name ?? undefined,
      guests,

      // optional extras
      programName: form.programName || undefined,
      hostName: form.hostName || undefined,
      talkingPoints: form.talkingPoints || undefined,
    };

    // Minimal client validation, server remains the source of truth
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
      router.push(`/modules/booking/${j.booking?.id}`);
    } catch (err: any) {
      setError(err?.message || "Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------- Render ---------- */
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">New booking</h1>

      {error && <UIAlert intent="error">{error}</UIAlert>}
      {ok && <UIAlert intent="success">{ok}</UIAlert>}

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Basic info */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Subject</label>
            <input
              className="w-full rounded-md border px-3 py-2"
              placeholder="Interview with…"
              value={form.subject}
              onChange={(e) =>
                setForm((f) => ({ ...f, subject: e.target.value }))
              }
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Newsroom name</label>
            <input
              className="w-full rounded-md border px-3 py-2"
              placeholder="Your newsroom"
              value={form.newsroomName}
              onChange={(e) =>
                setForm((f) => ({ ...f, newsroomName: e.target.value }))
              }
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Start at</label>
            <input
              type="datetime-local"
              className="w-full rounded-md border px-3 py-2"
              value={toDatetimeLocalValue(form.startAt)}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  startAt: new Date(e.target.value).toISOString(),
                }))
              }
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Duration (mins)</label>
            <input
              type="number"
              min={5}
              max={600}
              className="w-full rounded-md border px-3 py-2"
              value={form.durationMins}
              onChange={(e) =>
                setForm((f) => ({ ...f, durationMins: Number(e.target.value) }))
              }
              required
            />
          </div>
        </div>

        {/* Appearance model */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Appearance scope</label>
            <select
              className="w-full rounded-md border px-3 py-2"
              value={form.appearanceScope}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  appearanceScope: e.target.value as TScope,
                }))
              }
            >
              <option value="UNIFIED">UNIFIED (single)</option>
              <option value="PER_GUEST">PER_GUEST</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Access provisioning</label>
            <select
              className="w-full rounded-md border px-3 py-2"
              value={form.accessProvisioning}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  accessProvisioning: e.target.value as TProvisioning,
                }))
              }
            >
              <option value="SHARED">SHARED</option>
              <option value="PER_GUEST">PER_GUEST</option>
            </select>
          </div>

          {form.appearanceScope === "UNIFIED" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Unified type</label>
              <select
                className="w-full rounded-md border px-3 py-2"
                value={form.unifiedType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    unifiedType: e.target.value as TAppearanceType,
                  }))
                }
              >
                <option value="ONLINE">ONLINE</option>
                <option value="IN_PERSON">IN_PERSON</option>
              </select>
            </div>
          )}
        </div>

        {/* Booking defaults */}
        <div className="space-y-2">
          <div className="text-sm font-medium">Booking defaults</div>

          {form.appearanceScope === "UNIFIED" &&
            form.unifiedType === "ONLINE" && (
              <div className="space-y-2">
                <label className="text-sm">Default meeting link</label>
                <input
                  className="w-full rounded-md border px-3 py-2"
                  placeholder="https://…"
                  value={form.locationUrl}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, locationUrl: e.target.value }))
                  }
                />
              </div>
            )}

          {form.appearanceScope === "UNIFIED" &&
            form.unifiedType === "IN_PERSON" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm">Default venue name</label>
                  <input
                    className="w-full rounded-md border px-3 py-2"
                    placeholder="e.g., Studio A"
                    value={form.locationName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, locationName: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm">Default address</label>
                  <input
                    className="w-full rounded-md border px-3 py-2"
                    placeholder="123 Main St"
                    value={form.locationAddress}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        locationAddress: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            )}

          {form.appearanceScope === "PER_GUEST" &&
            form.accessProvisioning === "SHARED" && (
              <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-600">
                Tip: With **SHARED** provisioning, you may leave guest fields
                empty and they will fall back to these booking defaults (if
                provided).
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
          <div className="space-y-3">
            <div className="text-sm font-medium">Guests</div>
            <div className="space-y-3">
              {experts.map((e, idx) => {
                const g = guestMap[e.id] || {
                  appearanceType: "ONLINE" as TAppearanceType,
                };
                return (
                  <div key={e.id} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="font-medium">
                        #{idx + 1} {e.name}
                      </div>
                      <div className="text-xs text-gray-500">{e.id}</div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-1">
                        <label className="text-xs">Appearance</label>
                        <select
                          className="w-full rounded-md border px-2 py-2"
                          value={g.appearanceType}
                          onChange={(ev) =>
                            updateGuest(e.id, {
                              appearanceType: ev.target
                                .value as TAppearanceType,
                              joinUrl: undefined,
                              venueName: undefined,
                              venueAddress: undefined,
                            })
                          }
                        >
                          <option value="ONLINE">ONLINE</option>
                          <option value="IN_PERSON">IN_PERSON</option>
                        </select>
                      </div>

                      {g.appearanceType === "ONLINE" && (
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-xs">Join URL</label>
                          <input
                            className="w-full rounded-md border px-3 py-2"
                            placeholder="https://…"
                            value={g.joinUrl || ""}
                            onChange={(ev) =>
                              updateGuest(e.id, { joinUrl: ev.target.value })
                            }
                          />
                        </div>
                      )}

                      {g.appearanceType === "IN_PERSON" && (
                        <>
                          <div className="space-y-1">
                            <label className="text-xs">Venue name</label>
                            <input
                              className="w-full rounded-md border px-3 py-2"
                              placeholder="e.g., Studio A"
                              value={g.venueName || ""}
                              onChange={(ev) =>
                                updateGuest(e.id, {
                                  venueName: ev.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <label className="text-xs">Venue address</label>
                            <input
                              className="w-full rounded-md border px-3 py-2"
                              placeholder="123 Main St"
                              value={g.venueAddress || ""}
                              onChange={(ev) =>
                                updateGuest(e.id, {
                                  venueAddress: ev.target.value,
                                })
                              }
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {form.accessProvisioning === "SHARED" && (
                      <div className="mt-2 text-xs text-gray-500">
                        Leave blank to use booking defaults (if any).
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Host */}
        <HostCombobox value={host} onChange={setHost} />

        {/* Optionals via flags */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {flags.showProgramName && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Program name</label>
              <input
                className="w-full rounded-md border px-3 py-2"
                value={form.programName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, programName: e.target.value }))
                }
                placeholder="Program"
              />
            </div>
          )}

          {flags.showHostName && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Host name (legacy)</label>
              <input
                className="w-full rounded-md border px-3 py-2"
                value={form.hostName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, hostName: e.target.value }))
                }
                placeholder="Leave empty if you selected a host above"
              />
            </div>
          )}
        </div>

        {flags.showTalkingPoints && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Talking points</label>
            <textarea
              className="w-full rounded-md border px-3 py-2"
              rows={3}
              value={form.talkingPoints}
              onChange={(e) =>
                setForm((f) => ({ ...f, talkingPoints: e.target.value }))
              }
              placeholder="Optional"
            />
          </div>
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
