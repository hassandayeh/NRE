"use client";

/**
 * New Booking (Win-All merge)
 * - Experts: MULTI-SELECT (chips; removable).
 * - Host: first-class combobox (mirrors to legacy hostName for back-compat).
 * - Appearance parity with Edit; PHONE supported via flag.
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
  showHostName: boolean; // legacy textbox visibility
  showTalkingPoints: boolean;
};

/* ---------- Enums ---------- */
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

/* ---------- UI primitives ---------- */
import * as ButtonModule from "../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/* ---------- Utils ---------- */
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
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const browseBtnRef = React.useRef<HTMLButtonElement | null>(null);

  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [visibility, setVisibility] = React.useState<"org" | "public" | "both">(
    "org"
  );
  const [onlyAvailable, setOnlyAvailable] = React.useState(false);
  const [items, setItems] = React.useState<ExpertRow[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>("");

  // a11y: active row index for ↑/↓ and aria-activedescendant
  const [activeIndex, setActiveIndex] = React.useState(0);
  const debouncedQ = useDebounce(q, 250);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Fetch items when opened / filters change
  React.useEffect(() => {
    if (!open) return;
    void fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debouncedQ, visibility, onlyAvailable, startAtISO, durationMins]);

  // Focus search when panel opens; reset highlight
  React.useEffect(() => {
    if (open) {
      setActiveIndex(0);
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  // Keep activeIndex in bounds when items change
  React.useEffect(() => {
    setActiveIndex((i) =>
      items.length === 0 ? 0 : Math.min(Math.max(i, 0), items.length - 1)
    );
  }, [items.length]);

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

  // a11y helpers
  const panelId = "experts-popover";
  const activeId =
    open && items[activeIndex] ? `exp-opt-${items[activeIndex].id}` : undefined;

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Never submit the form from the search box
    if (e.key === "Enter") {
      e.preventDefault();
      // Add highlighted expert if any
      if (open && items[activeIndex]) {
        add(items[activeIndex]);
      }
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        items.length ? (i - 1 + items.length) % items.length : 0
      );
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      // return focus to Browse
      setTimeout(() => browseBtnRef.current?.focus(), 0);
    }
  }

  return (
    <div ref={wrapRef} className="space-y-2">
      <label className="block text-sm font-medium">
        Select experts (search)
      </label>

      {values.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
        >
          Clear all
        </button>
      )}

      {/* chips */}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((v) => (
            <span
              key={v.id}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs"
            >
              {v.name}
              <button
                type="button"
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
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          placeholder="Search experts…"
          className="min-w-[240px] flex-1 rounded-md border px-3 py-2"
          aria-controls={panelId}
          aria-activedescendant={activeId}
        />
        <button
          ref={browseBtnRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>
      </div>

      {open && (
        <div
          id={panelId}
          role="listbox"
          aria-label="Experts"
          className="space-y-2 rounded-md border p-3"
        >
          <div className="flex items-center gap-2">
            {(["org", "public", "both"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                className={clsx(
                  "rounded-md border px-2 py-1 text-xs capitalize",
                  visibility === v ? "bg-black text-white" : "hover:bg-gray-50"
                )}
              >
                {v}
              </button>
            ))}
            <label className="ml-2 inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
              />
              Show availability (slot-aware)
            </label>
          </div>

          {loading && <div className="text-sm text-gray-500">Loading…</div>}
          {error && <UIAlert variant="destructive">{error}</UIAlert>}
          {!loading && !error && items.length === 0 && (
            <div className="text-sm text-gray-500">No matches.</div>
          )}

          {items.map((e, idx) => {
            const picked = values.some((v) => v.id === e.id);
            const badge =
              e.availability?.status === "AVAILABLE"
                ? "bg-green-100 text-green-800"
                : e.availability?.status === "BUSY"
                ? "bg-red-100 text-red-800"
                : "bg-gray-100 text-gray-700";
            const isActive = idx === activeIndex;
            return (
              <button
                id={`exp-opt-${e.id}`}
                key={e.id}
                role="option"
                aria-selected={isActive}
                type="button"
                onClick={() => add(e)}
                disabled={picked}
                className={clsx(
                  "w-full rounded-md border px-3 py-2 text-left",
                  picked && "opacity-50",
                  isActive && "ring-2 ring-black"
                )}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">{e.name || "Unnamed"}</div>
                  <span
                    className={clsx("rounded px-1.5 py-0.5 text-[11px]", badge)}
                  >
                    {e.availability?.status ?? "UNKNOWN"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {e.city && <span>{e.city}</span>}{" "}
                  {e.countryCode && (
                    <span className="rounded border px-1">{e.countryCode}</span>
                  )}
                  {(e.tags || []).slice(0, 2).map((t) => (
                    <span key={t} className="ml-2 text-gray-400">
                      #{t}
                    </span>
                  ))}
                </div>
                {e.bio && (
                  <div className="mt-1 text-xs text-gray-600">{e.bio}</div>
                )}
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

          <div className="pt-2">
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

/* =======================================================================
 * Host Combobox (first-class; mirrors name to legacy hostName)
 * ======================================================================= */
type HostRow = { id: string; name: string | null };

function HostCombobox(props: {
  value: HostRow | null;
  onChange: (next: HostRow | null) => void;
}) {
  const { value, onChange } = props;

  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const browseBtnRef = React.useRef<HTMLButtonElement | null>(null);

  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<HostRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0); // a11y
  const debouncedQ = useDebounce(q, 250);
  const panelId = "hosts-popover";

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
        setActiveIndex(0);
        setTimeout(() => searchRef.current?.focus(), 0);
      } catch (e: any) {
        setError(e?.message || "Failed to load hosts");
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, debouncedQ]);

  React.useEffect(() => {
    setActiveIndex((i) =>
      items.length === 0 ? 0 : Math.min(Math.max(i, 0), items.length - 1)
    );
  }, [items.length]);

  const activeId =
    open && items[activeIndex]
      ? `host-opt-${items[activeIndex].id}`
      : undefined;

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault(); // don't submit the form
      if (open && items[activeIndex]) {
        onChange({
          id: items[activeIndex].id,
          name: items[activeIndex].name || "Unknown",
        });
        setOpen(false);
        setTimeout(() => browseBtnRef.current?.focus(), 0);
      }
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        items.length ? (i - 1 + items.length) % items.length : 0
      );
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setTimeout(() => browseBtnRef.current?.focus(), 0);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">Host (optional)</label>

      <div className="flex items-center gap-2">
        <button
          ref={browseBtnRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>

        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          className="w-full rounded-md border px-3 py-2"
          placeholder="Search hosts…"
          aria-controls={panelId}
          aria-activedescendant={activeId}
        />
      </div>

      {open && (
        <div
          id={panelId}
          role="listbox"
          aria-label="Hosts"
          className="space-y-2 rounded-md border p-3"
        >
          {loading && (
            <div className="text-sm text-gray-500">Loading hosts…</div>
          )}
          {error && <UIAlert variant="destructive">{error}</UIAlert>}
          {!loading && !error && items.length === 0 && (
            <div className="text-sm text-gray-500">
              No host directory available.
            </div>
          )}
          {items.map((h, idx) => {
            const isActive = idx === activeIndex;
            return (
              <button
                id={`host-opt-${h.id}`}
                key={h.id}
                role="option"
                aria-selected={isActive}
                type="button"
                onClick={() => {
                  onChange({ id: h.id, name: h.name || "Unknown" });
                  setOpen(false);
                  setTimeout(() => browseBtnRef.current?.focus(), 0);
                }}
                className={clsx(
                  "w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50",
                  isActive && "ring-2 ring-black"
                )}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <div className="font-medium">{h.name || "Unnamed"}</div>
                <div className="text-xs text-gray-500">{h.id}</div>
              </button>
            );
          })}
        </div>
      )}

      {value && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span>
            <span className="mr-1">Selected host:</span>
            <span className="font-medium">{value.name}</span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded border px-1.5 py-0.5 hover:bg-gray-50"
            aria-label="Remove host"
          >
            Remove
          </button>
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
    // ↓ Default to FALSE so legacy textbox is hidden unless explicitly enabled
    showHostName: readBooleanDataset("flagShowHostName", false),
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
    dialInfo: "",

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
        if (!next[e.id]) next[e.id] = { appearanceType: "ONLINE" };
      }
      // prune removed
      for (const k of Object.keys(next)) {
        if (!experts.some((e) => e.id === k)) delete next[k];
      }
      return next;
    });
  }, [experts]);

  // Mirror selected host name to legacy hostName; clear on remove
  React.useEffect(() => {
    setForm((f) => ({ ...f, hostName: host?.name ?? "" }));
  }, [host?.name]); // eslint-disable-line react-hooks/exhaustive-deps

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
            const g =
              guestMap[x.id] || ({ appearanceType: "ONLINE" } as GuestRow);
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

      // booking defaults / fallbacks
      locationUrl: form.locationUrl || null,
      locationName: form.locationName || null,
      locationAddress: form.locationAddress || null,
      dialInfo: form.dialInfo || null,

      // guests and back-compat mirror
      expertUserId: primary?.id,
      expertName: primary?.name ?? undefined,
      guests,

      // host (first-class + legacy mirror)
      hostUserId: host?.id ?? undefined,
      hostName: form.hostName || undefined,

      // optionals
      programName: form.programName || undefined,
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
      <h1 className="text-xl font-semibold">New booking</h1>

      {error && <UIAlert variant="destructive">{error}</UIAlert>}
      {ok && <UIAlert variant="success">{ok}</UIAlert>}

      <form onSubmit={onSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium">Subject</label>
          <input
            value={form.subject}
            onChange={(e) =>
              setForm((f) => ({ ...f, subject: e.target.value }))
            }
            required
            className="w-full rounded-md border px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Newsroom name</label>
          <input
            value={form.newsroomName}
            onChange={(e) =>
              setForm((f) => ({ ...f, newsroomName: e.target.value }))
            }
            required
            className="w-full rounded-md border px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Start at</label>
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
        </div>

        <div>
          <label className="block text-sm font-medium">Duration (mins)</label>
          <input
            type="number"
            value={form.durationMins}
            onChange={(e) =>
              setForm((f) => ({ ...f, durationMins: Number(e.target.value) }))
            }
            required
            className="w-full rounded-md border px-3 py-2"
          />
        </div>

        {/* Appearance model */}
        <div>
          <label className="block text-sm font-medium">Appearance scope</label>
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
        </div>

        <div>
          <label className="block text-sm font-medium">
            Access provisioning
          </label>
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
        </div>

        {form.appearanceScope === "UNIFIED" && (
          <div>
            <label className="block text-sm font-medium">Unified type</label>
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
          </div>
        )}

        {/* Booking defaults */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Booking defaults</legend>

          {form.appearanceScope === "UNIFIED" &&
            form.unifiedType === "ONLINE" && (
              <div>
                <label className="block text-sm">Default meeting link</label>
                <input
                  value={form.locationUrl}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, locationUrl: e.target.value }))
                  }
                  className="w-full rounded-md border px-3 py-2"
                  placeholder="https://…"
                />
              </div>
            )}

          {form.appearanceScope === "UNIFIED" &&
            form.unifiedType === "IN_PERSON" && (
              <>
                <div>
                  <label className="block text-sm">Default venue name</label>
                  <input
                    value={form.locationName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, locationName: e.target.value }))
                    }
                    className="w-full rounded-md border px-3 py-2"
                    placeholder="Studio A"
                  />
                </div>
                <div>
                  <label className="block text-sm">Default address</label>
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
                </div>
              </>
            )}

          {form.appearanceScope === "UNIFIED" &&
            PHONE_ENABLED &&
            form.unifiedType === "PHONE" && (
              <div>
                <label className="block text-sm">Default dial info</label>
                <input
                  value={form.dialInfo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, dialInfo: e.target.value }))
                  }
                  className="w-full rounded-md border px-3 py-2"
                  placeholder="e.g., +1 555 123 4567 PIN 0000"
                />
              </div>
            )}

          {form.appearanceScope === "PER_GUEST" &&
            form.accessProvisioning === "SHARED" && (
              <p className="text-xs text-gray-500">
                Tip: With SHARED provisioning, you may leave guest fields empty
                and they will fall back to these booking defaults (if provided).
              </p>
            )}
        </fieldset>

        {/* Experts picker */}
        <ExpertCombobox
          startAtISO={form.startAt}
          durationMins={form.durationMins}
          values={experts}
          onChange={setExperts}
        />

        {/* Per-guest fields when PER_GUEST */}
        {form.appearanceScope === "PER_GUEST" && experts.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Guests</h3>
            {experts.map((e, idx) => {
              const g =
                guestMap[e.id] || ({ appearanceType: "ONLINE" } as GuestRow);
              return (
                <div key={e.id} className="rounded-md border p-3">
                  <div className="mb-1 text-sm font-medium">
                    #{idx + 1} {e.name}
                  </div>
                  <div className="mb-2 text-xs text-gray-500">{e.id}</div>

                  <label className="block text-sm font-medium">
                    Appearance
                  </label>
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

                  {g.appearanceType === "ONLINE" && (
                    <div className="mt-2">
                      <label className="block text-sm">Join URL</label>
                      <input
                        value={g.joinUrl ?? ""}
                        onChange={(ev) =>
                          updateGuest(e.id, { joinUrl: ev.target.value })
                        }
                        className="w-full rounded-md border px-3 py-2"
                        placeholder="https://…"
                      />
                    </div>
                  )}

                  {g.appearanceType === "IN_PERSON" && (
                    <>
                      <div className="mt-2">
                        <label className="block text-sm">Venue name</label>
                        <input
                          value={g.venueName ?? ""}
                          onChange={(ev) =>
                            updateGuest(e.id, { venueName: ev.target.value })
                          }
                          className="w-full rounded-md border px-3 py-2"
                          placeholder="Studio A"
                        />
                      </div>
                      <div className="mt-2">
                        <label className="block text-sm">Venue address</label>
                        <input
                          value={g.venueAddress ?? ""}
                          onChange={(ev) =>
                            updateGuest(e.id, { venueAddress: ev.target.value })
                          }
                          className="w-full rounded-md border px-3 py-2"
                          placeholder="123 Example St…"
                        />
                      </div>
                    </>
                  )}

                  {PHONE_ENABLED && g.appearanceType === "PHONE" && (
                    <div className="mt-2">
                      <label className="block text-sm">Dial info</label>
                      <input
                        value={g.dialInfo ?? ""}
                        onChange={(ev) =>
                          updateGuest(e.id, { dialInfo: ev.target.value })
                        }
                        className="w-full rounded-md border px-3 py-2"
                        placeholder="e.g., +1 555 123 4567 PIN 0000"
                      />
                    </div>
                  )}

                  {form.accessProvisioning === "SHARED" && (
                    <p className="mt-1 text-xs text-gray-500">
                      Leave blank to use booking defaults (if any).
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Host */}
        <HostCombobox
          value={host}
          onChange={(next) => {
            setHost(next);
            if (!next) {
              // ensure legacy mirror is cleared when host removed
              setForm((f) => ({ ...f, hostName: "" }));
            }
          }}
        />

        {/* Optionals via flags */}
        {flags.showProgramName && (
          <div>
            <label className="block text-sm font-medium">Program name</label>
            <input
              value={form.programName}
              onChange={(e) =>
                setForm((f) => ({ ...f, programName: e.target.value }))
              }
              className="w-full rounded-md border px-3 py-2"
              placeholder="Program"
            />
          </div>
        )}

        {/* Legacy host textbox is hidden by default now */}
        {flags.showHostName && (
          <div>
            <label className="block text-sm font-medium">
              Host name (legacy)
            </label>
            <input
              value={form.hostName}
              onChange={(e) =>
                setForm((f) => ({ ...f, hostName: e.target.value }))
              }
              className="w-full rounded-md border px-3 py-2"
              placeholder="Leave empty if you selected a host above"
            />
          </div>
        )}

        {flags.showTalkingPoints && (
          <label className="block">
            <span className="text-sm font-medium">Talking points</span>
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
      </form>
    </div>
  );
}
