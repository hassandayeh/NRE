"use client";

/**
 * Edit Booking (full parity + manage participants)
 * - Add/remove guests (search + pick experts)
 * - Edit each guest’s appearance (ONLINE / IN_PERSON / PHONE) + fields
 * - UNIFIED vs PER_GUEST models with booking defaults
 * - Host is a FIRST-CLASS object (combobox); can be cleared
 * - PATCH payload mirrors POST V2 shape (+ optional deletedGuestIds hint)
 *
 * Safe by flags:
 * - PHONE options are shown only if NEXT_PUBLIC_APPEARANCE_PHONE !== "false"
 */

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import { z } from "zod";

/* UI primitives (with safe fallbacks) */
import * as ButtonModule from "../../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

import * as AlertModule from "../../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/* -------- feature flag -------- */
const PHONE_ENABLED =
  (process.env.NEXT_PUBLIC_APPEARANCE_PHONE ?? "true") !== "false";

/* -------- utils -------- */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}
function useDebounce<T>(v: T, delay = 250) {
  const [s, setS] = React.useState(v);
  React.useEffect(() => {
    const t = setTimeout(() => setS(v), delay);
    return () => clearTimeout(t);
  }, [v, delay]);
  return s;
}

/* -------- small types -------- */
type TAppearance = "ONLINE" | "IN_PERSON" | "PHONE";
type TScope = "UNIFIED" | "PER_GUEST";
type TProvisioning = "SHARED" | "PER_GUEST";

/* ===== Expert quick-search (for adding guests) ===== */

type ExpertRow = {
  id: string;
  name: string | null;
  city?: string | null;
  countryCode?: string | null;
  tags?: string[] | null;
  availability?: {
    status: "AVAILABLE" | "BUSY" | "UNKNOWN";
    reasons?: string[];
  };
};

function AddGuestPicker(props: {
  startAtISO: string;
  durationMins: number;
  onPick: (row: { id: string; name: string }) => void;
  existingIds: string[]; // to prevent duplicates
}) {
  const { startAtISO, durationMins, onPick, existingIds } = props;
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [visibility, setVisibility] = React.useState<"org" | "public" | "both">(
    "org"
  );
  const [onlyAvailable, setOnlyAvailable] = React.useState(false);
  const [items, setItems] = React.useState<ExpertRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const debouncedQ = useDebounce(q, 250);

  React.useEffect(() => {
    if (!open) return;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debouncedQ, visibility, onlyAvailable, startAtISO, durationMins]);

  async function run() {
    try {
      setLoading(true);
      setError(null);
      const sp = new URLSearchParams({ visibility, take: "20" });
      if (debouncedQ) sp.set("q", debouncedQ);
      if (startAtISO && durationMins > 0) {
        sp.set("startAt", new Date(startAtISO).toISOString());
        sp.set("durationMins", String(durationMins));
        if (onlyAvailable) sp.set("onlyAvailable", "true");
      }
      const res = await fetch(`/api/experts/search?${sp.toString()}`, {
        credentials: "include",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed (${res.status})`);
      setItems(j.items || []);
    } catch (e: any) {
      setError(e?.message || "Failed to search experts.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-medium">Add guest (expert)</div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-2 py-1 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>
      </div>

      {open && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search experts…"
              className="min-w-[240px] flex-1 rounded-md border px-3 py-2"
            />
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
            <label className="ml-2 inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
              />
              Only available
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

          <div className="space-y-2">
            {items.map((e: ExpertRow) => {
              const disabled = existingIds.includes(e.id);
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
                  disabled={disabled}
                  onClick={() => onPick({ id: e.id, name: e.name || "Expert" })}
                  className={clsx(
                    "w-full rounded-md border px-3 py-2 text-left",
                    disabled && "opacity-50"
                  )}
                >
                  <div className="font-medium">{e.name || "Unnamed"}</div>
                  <div
                    className={clsx(
                      "mt-1 inline-flex rounded px-1.5 py-0.5 text-xs",
                      badge
                    )}
                  >
                    {e.availability?.status ?? "UNKNOWN"}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    {e.city && <span>{e.city}</span>}{" "}
                    {e.countryCode && (
                      <span className="rounded border px-1">
                        {e.countryCode}
                      </span>
                    )}
                    {(e.tags || []).slice(0, 2).map((t) => (
                      <span key={t} className="ml-1 rounded bg-gray-100 px-1">
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

/* ===== Host combobox (first-class + clear) ===== */

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
        <div className="font-medium">Host</div>
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
            aria-label="Remove host"
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
              type="button"
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

      <div className="text-sm text-gray-600">
        Selected host:{" "}
        {value ? (
          <span className="font-medium">{value.name}</span>
        ) : (
          <em>none</em>
        )}
      </div>
    </div>
  );
}

/* ===== Page ===== */

type GuestRow = {
  id?: string; // BookingGuest id (existing rows)
  userId?: string | null;
  name: string;
  kind: "EXPERT" | "REPORTER";
  order: number;
  appearanceType: TAppearance;
  joinUrl?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  dialInfo?: string | null;
};

type BookingDto = {
  id: string;
  subject: string;
  newsroomName: string;
  startAt: string;
  durationMins: number;

  appearanceScope: TScope;
  accessProvisioning: TProvisioning;
  appearanceType: TAppearance | null;

  locationUrl?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  dialInfo?: string | null;

  programName?: string | null;
  hostName?: string | null;
  talkingPoints?: string | null;

  hostUserId?: string | null;
  guests?: GuestRow[];
};

export default function EditBookingPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const [form, setForm] = React.useState<BookingDto | null>(null);

  // host picker (explicit, first-class)
  const [hostPick, setHostPick] = React.useState<HostRow | null>(null);

  // track deletions (if API supports it)
  const deletedGuestIdsRef = React.useRef<string[]>([]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/bookings/${id}`, {
          credentials: "include",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || "Failed to load booking");
        const b: BookingDto = j?.booking ?? j;
        b.appearanceScope = (b.appearanceScope ?? "UNIFIED") as TScope;
        b.accessProvisioning = (b.accessProvisioning ??
          "SHARED") as TProvisioning;
        b.guests = (b.guests || [])
          .slice()
          .sort((a: GuestRow, b2: GuestRow) => (a.order ?? 0) - (b2.order ?? 0))
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
        if (!PHONE_ENABLED && b.appearanceType === "PHONE") {
          b.appearanceType = "ONLINE";
        }
        if (alive) {
          setForm(b);
          setError(null);
          setHostPick(
            b.hostUserId ? { id: b.hostUserId, name: b.hostName ?? null } : null
          );
        }
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load booking");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  function patch(p: Partial<BookingDto>) {
    setForm((f) => (f ? { ...f, ...p } : f));
  }
  function patchGuest(idx: number, p: Partial<GuestRow>) {
    setForm((f) => {
      if (!f) return f;
      const list = (f.guests || []).slice();
      list[idx] = { ...list[idx], ...p };
      return { ...f, guests: list };
    });
  }

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
        appearanceScope: z.enum(["UNIFIED", "PER_GUEST"]),
        accessProvisioning: z.enum(["SHARED", "PER_GUEST"]),
      }),
    []
  );

  function addExpertGuest(row: { id: string; name: string }) {
    setForm((f) => {
      if (!f) return f;
      const exists = (f.guests || []).some((g) => g.userId === row.id);
      if (exists) return f;
      const next: GuestRow = {
        userId: row.id,
        name: row.name || "Expert",
        kind: "EXPERT",
        order: f.guests?.length ?? 0,
        appearanceType: "ONLINE",
        joinUrl: null,
        venueName: null,
        venueAddress: null,
        dialInfo: null,
      };
      return { ...f, guests: [...(f.guests || []), next] };
    });
  }

  function removeGuest(idx: number) {
    setForm((f) => {
      if (!f) return f;
      const list = (f.guests || []).slice();
      const [removed] = list.splice(idx, 1);
      if (removed?.id) {
        deletedGuestIdsRef.current = [
          ...deletedGuestIdsRef.current,
          removed.id,
        ];
      }
      list.forEach((g, i) => (g.order = i));
      return { ...f, guests: list };
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;

    setError(null);
    setOk(null);

    try {
      Schema.parse({
        subject: form.subject,
        newsroomName: form.newsroomName,
        startAt: form.startAt,
        durationMins: form.durationMins,
        appearanceScope: form.appearanceScope,
        accessProvisioning: form.accessProvisioning,
      });
    } catch (err: any) {
      const first = err?.errors?.[0]?.message ?? "Please check your inputs.";
      setError(first);
      return;
    }

    const payload: any = {
      subject: form.subject,
      newsroomName: form.newsroomName,
      startAt: new Date(form.startAt).toISOString(),
      durationMins: Number(form.durationMins),
      appearanceScope: form.appearanceScope,
      accessProvisioning: form.accessProvisioning,
      appearanceType:
        form.appearanceScope === "UNIFIED"
          ? form.appearanceType ?? "ONLINE"
          : null,
      locationUrl: form.locationUrl || null,
      locationName: form.locationName || null,
      locationAddress: form.locationAddress || null,
      dialInfo: form.dialInfo || null,
      programName: form.programName || null,
      talkingPoints: form.talkingPoints || null, // ✅ ensure talking points are saved
      // Host as first-class: send FK and mirror name for back-compat
      hostUserId: hostPick ? hostPick.id : null,
      hostName: hostPick ? hostPick.name || null : null,
    };

    if (form.appearanceScope === "PER_GUEST") {
      payload.guests = (form.guests || []).map((g, i) => {
        const type = g.appearanceType;
        return {
          id: g.id,
          userId: g.userId ?? null,
          name: g.name,
          kind: g.kind,
          order: Number.isFinite(g.order) ? g.order : i,
          appearanceType: type,
          joinUrl: type === "ONLINE" ? g.joinUrl || null : null,
          venueName: type === "IN_PERSON" ? g.venueName || null : null,
          venueAddress: type === "IN_PERSON" ? g.venueAddress || null : null,
          dialInfo: type === "PHONE" ? g.dialInfo || null : null,
        };
      });
    } else {
      payload.guests = (form.guests || []).map((g, i) => ({
        id: g.id,
        userId: g.userId ?? null,
        name: g.name,
        kind: g.kind,
        order: Number.isFinite(g.order) ? g.order : i,
      }));
    }

    if (deletedGuestIdsRef.current.length > 0) {
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
      if (!res.ok) throw new Error(j?.error || "Failed to save booking");
      setOk("Saved.");
      router.push(`/modules/booking/${id}`);
    } catch (err: any) {
      setError(err?.message || "Save failed");
    }
  }

  if (loading) return <div className="p-4">Loading…</div>;
  if (!form) {
    return (
      <div className="p-4">
        <UIAlert className="border-red-200 bg-red-50 text-red-800">
          {error || "Not found"}
        </UIAlert>
      </div>
    );
  }

  const existingExpertIds = (form.guests || [])
    .filter((g) => g.kind === "EXPERT" && g.userId)
    .map((g) => g.userId as string);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Edit booking</h1>

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

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Basic */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-sm font-medium">Subject</div>
            <input
              value={form.subject}
              onChange={(e) => patch({ subject: e.target.value })}
              className="w-full rounded-md border px-3 py-2"
              required
            />
          </label>

          <label className="space-y-1">
            <div className="text-sm font-medium">Newsroom name</div>
            <input
              value={form.newsroomName}
              onChange={(e) => patch({ newsroomName: e.target.value })}
              className="w-full rounded-md border px-3 py-2"
              required
            />
          </label>

          <label className="space-y-1">
            <div className="text-sm font-medium">Start at</div>
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
            <div className="text-sm font-medium">Duration (mins)</div>
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

        {/* Appearance model */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-sm font-medium">Appearance scope</div>
            <select
              value={form.appearanceScope}
              onChange={(e) =>
                patch({ appearanceScope: e.target.value as TScope })
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
                patch({ accessProvisioning: e.target.value as TProvisioning })
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
          )}
        </div>

        {/* Booking defaults */}
        <div className="space-y-3 rounded-md border p-4">
          <div className="font-medium">Booking defaults</div>

          {form.appearanceScope === "UNIFIED" &&
            (form.appearanceType ?? "ONLINE") === "ONLINE" && (
              <label className="space-y-1">
                <div className="text-sm">Default meeting link</div>
                <input
                  value={form.locationUrl ?? ""}
                  onChange={(e) => patch({ locationUrl: e.target.value })}
                  className="w-full rounded-md border px-3 py-2"
                  placeholder="https://…"
                />
              </label>
            )}

          {form.appearanceScope === "UNIFIED" &&
            (form.appearanceType ?? "ONLINE") === "IN_PERSON" && (
              <>
                <label className="space-y-1">
                  <div className="text-sm">Default venue name</div>
                  <input
                    value={form.locationName ?? ""}
                    onChange={(e) => patch({ locationName: e.target.value })}
                    className="w-full rounded-md border px-3 py-2"
                    placeholder="Studio A"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-sm">Default address</div>
                  <input
                    value={form.locationAddress ?? ""}
                    onChange={(e) => patch({ locationAddress: e.target.value })}
                    className="w-full rounded-md border px-3 py-2"
                    placeholder="123 Example St…"
                  />
                </label>
              </>
            )}

          {form.appearanceScope === "UNIFIED" &&
            PHONE_ENABLED &&
            (form.appearanceType ?? "ONLINE") === "PHONE" && (
              <label className="space-y-1">
                <div className="text-sm">Default dial info</div>
                <input
                  value={form.dialInfo ?? ""}
                  onChange={(e) => patch({ dialInfo: e.target.value })}
                  className="w-full rounded-md border px-3 py-2"
                  placeholder="e.g., +1 555 123 4567 PIN 0000"
                />
              </label>
            )}

          {form.appearanceScope === "PER_GUEST" &&
            form.accessProvisioning === "SHARED" && (
              <div className="text-xs text-gray-600">
                With SHARED provisioning, blank per-guest fields fall back to
                these defaults.
              </div>
            )}
        </div>

        {/* Guests */}
        <div className="space-y-3 rounded-md border p-4">
          <div className="mb-2 font-medium">Guests</div>

          {(form.guests || []).length === 0 && (
            <div className="rounded-md border bg-gray-50 p-3 text-sm text-gray-600">
              No guests yet. Use “Add guest (expert)” below to append experts.
            </div>
          )}

          {form.guests?.map((g, idx) => (
            <div
              key={g.id ?? `${g.userId}-${idx}`}
              className="rounded-md border p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-medium">
                  #{idx + 1} {g.name}{" "}
                  <span className="ml-2 rounded border px-1 text-[10px]">
                    {g.kind}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeGuest(idx)}
                  className="rounded-md border px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  aria-label={`Remove ${g.name}`}
                  title="Remove guest"
                >
                  Remove
                </button>
              </div>

              {g.userId && (
                <div className="mb-1 text-[10px] text-gray-500">{g.userId}</div>
              )}

              <label className="mb-3 block space-y-1">
                <div className="text-sm">Appearance</div>
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
                <label className="block space-y-1">
                  <div className="text-sm">Join URL</div>
                  <input
                    value={g.joinUrl ?? ""}
                    onChange={(ev) =>
                      patchGuest(idx, { joinUrl: ev.target.value })
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
                      value={g.venueName ?? ""}
                      onChange={(ev) =>
                        patchGuest(idx, { venueName: ev.target.value })
                      }
                      className="w-full rounded-md border px-3 py-2"
                      placeholder="Studio A"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="text-sm">Venue address</div>
                    <input
                      value={g.venueAddress ?? ""}
                      onChange={(ev) =>
                        patchGuest(idx, { venueAddress: ev.target.value })
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
                    value={g.dialInfo ?? ""}
                    onChange={(ev) =>
                      patchGuest(idx, { dialInfo: ev.target.value })
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
          ))}

          {/* Add guest (expert) */}
          <AddGuestPicker
            startAtISO={form.startAt}
            durationMins={form.durationMins}
            existingIds={existingExpertIds}
            onPick={(row) => addExpertGuest(row)}
          />
        </div>

        {/* Host (first-class) */}
        <div className="space-y-3 rounded-md border p-4">
          <HostCombobox value={hostPick} onChange={(h) => setHostPick(h)} />
        </div>

        {/* Optionals */}
        <label className="block space-y-1">
          <div className="text-sm">Program name</div>
          <input
            value={form.programName ?? ""}
            onChange={(e) => patch({ programName: e.target.value })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Program"
          />
        </label>

        <label className="block space-y-1">
          <div className="text-sm">Talking points</div>
          <textarea
            value={form.talkingPoints ?? ""}
            onChange={(e) => patch({ talkingPoints: e.target.value })}
            className="w-full min-h-[90px] rounded-md border px-3 py-2"
            placeholder="Optional"
          />
        </label>

        <div>
          <UIButton type="submit">Save changes</UIButton>
        </div>
      </form>
    </div>
  );
}
