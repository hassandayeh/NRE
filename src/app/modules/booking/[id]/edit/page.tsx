"use client";

/**
 * Edit Booking
 * - Final rule agreed:
 *   • If Appearance scope = PER_GUEST → Access provisioning is forced to PER_GUEST (selector hidden).
 *     Booking defaults are hidden; guests carry their own access fields based on appearance.
 *   • If Appearance scope = UNIFIED → provisioning selector is shown (SHARED or PER_GUEST).
 * - Validation:
 *   • UNIFIED + IN_PERSON + SHARED -> require booking-level venue name OR address.
 */

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import { z } from "zod";

/* Safe UI imports */
import * as ButtonModule from "../../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;
import * as AlertModule from "../../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/* Flags (PHONE option toggle for selects) */
const PHONE_ENABLED =
  (process.env.NEXT_PUBLIC_APPEARANCE_PHONE ?? "true") !== "false";

/* Utils */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}
function clsx(...xs: any[]) {
  return xs.filter(Boolean).join(" ");
}
function useDebounce<T>(v: T, delay = 250): T {
  const [s, setS] = React.useState(v);
  React.useEffect(() => {
    const t = setTimeout(() => setS(v), delay);
    return () => clearTimeout(t);
  }, [v, delay]);
  return s;
}

/* Types */
type TAppearance = "ONLINE" | "IN_PERSON" | "PHONE";
type TScope = "UNIFIED" | "PER_GUEST";
type TProvisioning = "SHARED" | "PER_GUEST";

type PickerItem = {
  id: string;
  name: string | null;
  kind: "EXPERT" | "REPORTER";
  city?: string | null;
  countryCode?: string | null;
  tags?: string[] | null;
  availability?: { status: "AVAILABLE" | "BUSY" } | null;
};

type HostRow = {
  id: string;
  name: string | null;
  availability?: "AVAILABLE" | "BUSY" | null;
};

type GuestRow = {
  id?: string;
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

/* -------- Unified Add-Guest Picker (Org / Public / All) -------- */
function AddGuestPicker(props: {
  startAtISO: string;
  durationMins: number;
  onPick: (row: {
    id: string;
    name: string;
    kind: "EXPERT" | "REPORTER";
  }) => void;
  existingIds: string[];
}) {
  const { startAtISO, durationMins, onPick, existingIds } = props;

  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [visibility, setVisibility] = React.useState<"org" | "public" | "all">(
    "org"
  );
  const [onlyAvailable, setOnlyAvailable] = React.useState(false);

  const [items, setItems] = React.useState<PickerItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const debouncedQ = useDebounce(q, 250);
  const haveWindow = !!(startAtISO && durationMins > 0);

  React.useEffect(() => {
    if (!open) return;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debouncedQ, visibility, onlyAvailable, startAtISO, durationMins]);

  async function fetchOrgRows(): Promise<PickerItem[]> {
    const sp = new URLSearchParams();
    if (debouncedQ) sp.set("q", debouncedQ);
    if (haveWindow) {
      sp.set("start", new Date(startAtISO).toISOString());
      sp.set(
        "end",
        new Date(
          new Date(startAtISO).getTime() + durationMins * 60_000
        ).toISOString()
      );
    }
    const res = await fetch(`/api/directory/org?${sp.toString()}`, {
      credentials: "include",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(j?.error || `Directory failed (${res.status})`);
    const dirItems = Array.isArray(j.items) ? j.items : [];
    let rows = dirItems
      .filter((u: any) => u?.kind === "REPORTER" || u?.kind === "EXPERT")
      .map((u: any) => ({
        id: String(u.id),
        name: (u.displayName as string) ?? null,
        kind: (u.kind as "EXPERT" | "REPORTER") ?? "EXPERT",
        city: u.city ?? null,
        countryCode: u.countryCode ?? null,
        tags: u.tags ?? [],
        availability:
          u.availability === "AVAILABLE" || u.availability === "BUSY"
            ? { status: u.availability }
            : null,
      })) as PickerItem[];
    if (onlyAvailable && haveWindow) {
      rows = rows.filter((r) => r.availability?.status === "AVAILABLE");
    }
    return rows;
  }

  async function fetchPublicRows(): Promise<PickerItem[]> {
    const sp = new URLSearchParams({ visibility: "public", take: "20" });
    if (debouncedQ) sp.set("q", debouncedQ);
    if (haveWindow) {
      sp.set("startAt", new Date(startAtISO).toISOString());
      sp.set("durationMins", String(durationMins));
      if (onlyAvailable) sp.set("onlyAvailable", "true");
    }
    const res = await fetch(`/api/experts/search?${sp.toString()}`, {
      credentials: "include",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(j?.error || `Public search failed (${res.status})`);
    const expItems = Array.isArray(j.items) ? j.items : [];
    return expItems.map((e: any) => ({
      id: String(e.id),
      name: (e.name as string) ?? null,
      kind: "EXPERT" as const,
      city: e.city ?? null,
      countryCode: e.countryCode ?? null,
      tags: e.tags ?? [],
      availability: e.availability?.status
        ? { status: e.availability.status }
        : null,
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
      // all => union
      let orgRows: PickerItem[] = [];
      let pubRows: PickerItem[] = [];
      try {
        orgRows = await fetchOrgRows();
      } catch {}
      try {
        pubRows = await fetchPublicRows();
      } catch {}
      const byId = new Map<string, PickerItem>();
      [...orgRows, ...pubRows].forEach((r) =>
        byId.set(r.id, byId.get(r.id) ?? r)
      );
      setItems([...byId.values()]);
    } catch (e: any) {
      setError(e?.message || "Failed to load directory.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border px-2 py-1 text-sm hover:bg-gray-50"
        >
          {open ? "Hide" : "Browse"}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
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
              >
                {v === "all" ? "All" : v}
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

          {loading && (
            <div className="rounded-md border bg-white px-3 py-2 text-sm">
              Loading…
            </div>
          )}

          {error && <UIAlert intent="error">{error}</UIAlert>}
          {!loading && !error && items.length === 0 && (
            <div className="rounded-md border bg-white px-3 py-2 text-sm">
              No matches.
            </div>
          )}

          <div className="grid gap-2">
            {items.map((row) => {
              const disabled = existingIds.includes(row.id);
              const status = row.availability?.status;
              const badge =
                status === "AVAILABLE"
                  ? "bg-green-100 text-green-800"
                  : status === "BUSY"
                  ? "bg-red-100 text-red-800"
                  : null;

              return (
                <button
                  key={row.id}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onPick({
                      id: row.id,
                      name:
                        row.name ||
                        (row.kind === "REPORTER" ? "Reporter" : "Expert"),
                      kind: row.kind,
                    })
                  }
                  className={clsx(
                    "w-full rounded-md border px-3 py-2 text-left",
                    disabled && "opacity-50"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {row.name ||
                        (row.kind === "REPORTER" ? "Reporter" : "Unnamed")}
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-700">
                        {row.kind}
                      </span>
                    </div>
                    {badge && (
                      <span
                        className={clsx("rounded px-2 py-0.5 text-xs", badge)}
                      >
                        {status}
                      </span>
                    )}
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

/* Host combobox (unchanged) */
function HostCombobox(props: {
  value: HostRow | null;
  onChange: (next: HostRow | null) => void;
  startAtISO: string;
  durationMins: number;
}) {
  const { value, onChange, startAtISO, durationMins } = props;
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
        const sp = new URLSearchParams();
        if (debouncedQ) sp.set("q", debouncedQ);
        if (startAtISO && durationMins > 0) {
          sp.set("start", new Date(startAtISO).toISOString());
          sp.set(
            "end",
            new Date(
              new Date(startAtISO).getTime() + durationMins * 60_000
            ).toISOString()
          );
        }
        const res = await fetch(`/api/directory/org?${sp.toString()}`, {
          credentials: "include",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || "Failed to load directory");
        const list: HostRow[] = Array.isArray(j.items)
          ? j.items
              .filter((u: any) => u?.kind === "HOST")
              .map((u: any) => ({
                id: u.id,
                name: u.displayName ?? null,
                availability: u.availability ?? null,
              }))
          : [];
        setItems(list);
      } catch (e: any) {
        setError(e?.message || "Failed to load directory");
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, debouncedQ, startAtISO, durationMins]);

  function AvailabilityBadge({
    status,
  }: {
    status: "AVAILABLE" | "BUSY" | null;
  }) {
    if (!status) return null;
    const klass =
      status === "AVAILABLE"
        ? "bg-green-100 text-green-800"
        : "bg-red-100 text-red-800";
    return (
      <span className={clsx("rounded px-2 py-0.5 text-xs", klass)}>
        {status}
      </span>
    );
  }

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium">Host</span>
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
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        className="w-full rounded-md border px-3 py-2"
        placeholder="Search hosts…"
      />

      {open && (
        <div className="mt-2 grid gap-2">
          {items.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => {
                onChange({
                  id: h.id,
                  name: h.name || "Unknown",
                  availability: h.availability ?? null,
                });
                setOpen(false);
              }}
              className="w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium">{h.name || "Unnamed"}</div>
                <AvailabilityBadge status={h.availability ?? null} />
              </div>
              <div className="mt-1 text-xs text-gray-500">{h.id}</div>
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 text-sm text-gray-700">
        Selected host: <strong>{value ? value.name : "none"}</strong>
      </div>
    </div>
  );
}

/* -------- Page -------- */

type FieldErrors = {
  locationName?: string;
  locationAddress?: string;
};
type GuestFieldErrors = {
  joinUrl?: string;
  venueName?: string;
  venueAddress?: string;
  dialInfo?: string;
};

export default function EditBookingPage() {
  const router = useRouter();

  // robust params guard
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
  const [hostPick, setHostPick] = React.useState<HostRow | null>(null);

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [guestErrors, setGuestErrors] = React.useState<GuestFieldErrors[]>([]);
  const deletedGuestIdsRef = React.useRef<string[]>([]);

  React.useEffect(() => {
    let alive = true;
    if (!id) return;

    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        setSaveError(null); // clear any stale banner on fresh load

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
          .sort((a, b2) => (a.order ?? 0) - (b2.order ?? 0))
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

        if (!PHONE_ENABLED && b.appearanceType === "PHONE")
          b.appearanceType = "ONLINE";

        if (alive) {
          setForm(b);
          setHostPick(
            b.hostUserId ? { id: b.hostUserId, name: b.hostName ?? null } : null
          );
          setGuestErrors(new Array((b.guests || []).length).fill({}));
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

  /* patch helpers clear errors as user edits */
  function patch(p: Partial<BookingDto>) {
    setSaveError(null);
    setFieldErrors({});
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
      }),
    []
  );

  /* ---- Client-side validation that mirrors server rules ---- */
  function validateClient(f: BookingDto) {
    const errs: FieldErrors = {};
    const gErrs: GuestFieldErrors[] = [];

    // UNIFIED + IN_PERSON + SHARED => require booking-level Name or Address
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
          // Validate against the unified appearance type
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
          // PER_GUEST scope: validate using guest.appearanceType
          if (g.appearanceType === "ONLINE") {
            if (!String(g.joinUrl ?? "").trim())
              ge.joinUrl = "Join URL is required (per-guest access).";
          } else if (g.appearanceType === "IN_PERSON") {
            const vn = String(g.venueName ?? "").trim();
            const va = String(g.venueAddress ?? "").trim();
            if (!vn && !va)
              ge.venueName = ge.venueAddress =
                "Venue name or address is required (per-guest access).";
          } else if (g.appearanceType === "PHONE") {
            if (!String(g.dialInfo ?? "").trim())
              ge.dialInfo = "Dial info is required (per-guest access).";
          }
        }
      }

      gErrs[i] = ge;
    });

    const guestIssues = gErrs.some((o) => Object.keys(o || {}).length > 0);
    const ok = Object.keys(errs).length === 0 && !guestIssues;

    // Banner summary (explicit & specific)
    let banner: string | null = null;
    if (!ok) {
      const parts: string[] = [];
      if (errs.locationName || errs.locationAddress)
        parts.push("Booking defaults (venue name or address)");
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
      banner = `Fix ${parts.length} item${
        parts.length > 1 ? "s" : ""
      }: ${parts.join("; ")}.`;
    }

    return { ok, fieldErrs: errs, guestErrs: gErrs, banner };
  }

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

  function addPerson(
    kind: "EXPERT" | "REPORTER",
    row: { id: string; name: string }
  ) {
    setForm((f) => {
      if (!f) return f;
      if ((f.guests || []).some((g) => g.userId === row.id)) return f;
      const next: GuestRow = {
        userId: row.id,
        name: row.name || (kind === "REPORTER" ? "Reporter" : "Expert"),
        kind,
        order: f.guests?.length ?? 0,
        appearanceType: "ONLINE",
        joinUrl: null,
        venueName: null,
        venueAddress: null,
        dialInfo: null,
      };
      setGuestErrors((errs) => [...errs, {}]);
      return { ...f, guests: [...(f.guests || []), next] };
    });
  }

  function onPickParticipant(row: {
    id: string;
    name: string;
    kind: "EXPERT" | "REPORTER";
  }) {
    addPerson(row.kind, row);
  }

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
      });
    } catch (err: any) {
      setSaveError(err?.errors?.[0]?.message ?? "Please check your inputs.");
      return;
    }

    const v = validateClient(form);
    if (!v.ok) {
      setFieldErrors(v.fieldErrs);
      setGuestErrors(v.guestErrs);
      setSaveError(v.banner || "Fix the highlighted fields.");
      return;
    }
    setFieldErrors({});
    setGuestErrors([]);

    // Construct payload
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
      talkingPoints: form.talkingPoints || null,
      hostUserId: hostPick ? hostPick.id : null,
      hostName: hostPick ? hostPick.name || null : null,
    };

    if (form.appearanceScope === "PER_GUEST") {
      // Forced PER_GUEST provisioning; each guest must supply their access for their type
      payload.guests = (form.guests || []).map((g, i) => {
        const t = g.appearanceType;
        return {
          id: g.id,
          userId: g.userId ?? null,
          name: g.name,
          // TEMP until backend supports REPORTER explicitly
          kind: g.kind === "REPORTER" ? "EXPERT" : g.kind,
          order: Number.isFinite(g.order) ? g.order : i,
          appearanceType: t,
          joinUrl: t === "ONLINE" ? g.joinUrl || null : null,
          venueName: t === "IN_PERSON" ? g.venueName || null : null,
          venueAddress: t === "IN_PERSON" ? g.venueAddress || null : null,
          dialInfo: t === "PHONE" ? g.dialInfo || null : null,
        };
      });
    } else {
      // UNIFIED scope: guests inherit unified type; access may be shared or per-guest
      const unifiedType: TAppearance = form.appearanceType ?? "ONLINE";
      payload.guests = (form.guests || []).map((g, i) => ({
        id: g.id,
        userId: g.userId ?? null,
        name: g.name,
        kind: g.kind === "REPORTER" ? "EXPERT" : g.kind,
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

  if (loading)
    return (
      <div className="rounded-md border bg-white p-4 text-sm">Loading…</div>
    );

  if (!form) {
    return (
      <div className="rounded-md border bg-white p-4">
        <UIAlert intent="error">{loadError || "Not found"}</UIAlert>
      </div>
    );
  }

  const existingUserIds = (form.guests || [])
    .filter((g) => g.userId)
    .map((g) => g.userId as string);

  const unifiedInPerson =
    form.accessProvisioning === "SHARED" &&
    form.appearanceScope === "UNIFIED" &&
    (form.appearanceType ?? "ONLINE") === "IN_PERSON";
  const perGuestProvisioned =
    form.appearanceScope === "PER_GUEST" ||
    form.accessProvisioning === "PER_GUEST";
  const sharedProvisioned = form.accessProvisioning === "SHARED";
  const unified = form.appearanceScope === "UNIFIED";

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <h1 className="text-xl font-semibold">Edit booking</h1>

      {saveError && <UIAlert intent="error">{saveError}</UIAlert>}
      {ok && <UIAlert intent="success">{ok}</UIAlert>}

      {/* Basic */}
      <div className="grid gap-2 rounded-md border p-3">
        <label className="grid gap-1 text-sm">
          <span>Subject</span>
          <input
            value={form.subject || ""}
            onChange={(e) => patch({ subject: e.target.value })}
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span>Newsroom name</span>
          <input
            value={form.newsroomName || ""}
            onChange={(e) => patch({ newsroomName: e.target.value })}
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span>Start at</span>
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

        <label className="grid gap-1 text-sm">
          <span>Duration (mins)</span>
          <input
            type="number"
            min={5}
            max={600}
            value={form.durationMins ?? 30}
            onChange={(e) => patch({ durationMins: Number(e.target.value) })}
            className="w-full rounded-md border px-3 py-2"
            required
          />
        </label>
      </div>

      {/* Model */}
      <div className="grid gap-2 rounded-md border p-3">
        <label className="grid gap-1 text-sm">
          <span>Appearance scope</span>
          <select
            value={form.appearanceScope}
            onChange={(e) => {
              const next = e.target.value as TScope;
              if (next === "PER_GUEST") {
                // Force provisioning to PER_GUEST and hide it
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
            <label className="grid gap-1 text-sm">
              <span>Access provisioning</span>
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

            <label className="grid gap-1 text-sm">
              <span>Unified type</span>
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
          // PER_GUEST scope -> provisioning fixed to PER_GUEST
          <div className="rounded-md bg-gray-50 p-2 text-xs text-gray-600">
            Each guest selects their own appearance and access. Provisioning is
            per guest.
          </div>
        )}
      </div>

      {/* Booking defaults — only UNIFIED + SHARED */}
      {sharedProvisioned && unified && (
        <div className="grid gap-2 rounded-md border p-3">
          <span className="text-sm font-medium">Booking defaults</span>

          {(form.appearanceType ?? "ONLINE") === "ONLINE" && (
            <label className="grid gap-1 text-sm">
              <span>Default meeting link</span>
              <input
                value={form.locationUrl ?? ""}
                onChange={(e) => patch({ locationUrl: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                className="w-full rounded-md border px-3 py-2"
                placeholder="https://…"
              />
            </label>
          )}

          {(form.appearanceType ?? "ONLINE") === "IN_PERSON" && (
            <>
              <label className="grid gap-1 text-sm">
                <span>Default venue name</span>
                <input
                  value={form.locationName ?? ""}
                  onChange={(e) => patch({ locationName: e.target.value })}
                  className={clsx(
                    "w-full rounded-md border px-3 py-2",
                    unifiedInPerson &&
                      fieldErrors.locationName &&
                      "border-red-500"
                  )}
                  placeholder="Studio A"
                  aria-invalid={!!fieldErrors.locationName}
                />
                {unifiedInPerson && fieldErrors.locationName && (
                  <p className="mt-1 text-xs text-red-600">
                    {fieldErrors.locationName}
                  </p>
                )}
              </label>

              <label className="grid gap-1 text-sm">
                <span>Default address</span>
                <input
                  value={form.locationAddress ?? ""}
                  onChange={(e) => patch({ locationAddress: e.target.value })}
                  className={clsx(
                    "w-full rounded-md border px-3 py-2",
                    unifiedInPerson &&
                      fieldErrors.locationAddress &&
                      "border-red-500"
                  )}
                  placeholder="123 Example St…"
                  aria-invalid={!!fieldErrors.locationAddress}
                />
                {unifiedInPerson && fieldErrors.locationAddress && (
                  <p className="mt-1 text-xs text-red-600">
                    {fieldErrors.locationAddress}
                  </p>
                )}
              </label>
            </>
          )}

          {(form.appearanceType ?? "ONLINE") === "PHONE" && (
            <label className="grid gap-1 text-sm">
              <span>Default dial info</span>
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

      {/* Guests */}
      <div className="grid gap-2 rounded-md border p-3">
        <span className="text-sm font-medium">Guests</span>

        {(form.guests || []).length === 0 && (
          <div className="rounded-md border bg-white px-3 py-2 text-sm">
            No guests yet. Use “Add guest” below to append experts or reporters.
          </div>
        )}

        {form.guests?.map((g, idx) => {
          const ge = guestErrors[idx] || {};
          const unifiedType = (form.appearanceType ?? "ONLINE") as TAppearance;

          return (
            <div key={idx} className="rounded-md border p-2">
              <div className="mb-2 flex items-center justify-between text-sm">
                <div className="font-medium">
                  #{idx + 1} {g.name}{" "}
                  <span className="text-gray-500">{g.kind}</span>
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
                <div className="mb-2 text-xs text-gray-500">{g.userId}</div>
              )}

              {/* UNIFIED scope */}
              {unified ? (
                <>
                  {/* No appearance selector in UNIFIED */}
                  {sharedProvisioned ? (
                    <div className="mt-1 rounded-md bg-gray-50 p-2 text-xs text-gray-600">
                      Using unified settings ({form.appearanceType ?? "ONLINE"}
                      ). No per-guest access fields.
                    </div>
                  ) : (
                    // UNIFIED + PER_GUEST provisioning: per-guest access based on unified type
                    <>
                      {unifiedType === "ONLINE" && (
                        <label className="grid gap-1 text-sm">
                          <span>Join URL</span>
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
                            <p className="mt-1 text-xs text-red-600">
                              {ge.joinUrl}
                            </p>
                          )}
                        </label>
                      )}

                      {unifiedType === "IN_PERSON" && (
                        <>
                          <label className="mt-2 grid gap-1 text-sm">
                            <span>Venue name</span>
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
                              <p className="mt-1 text-xs text-red-600">
                                {ge.venueName}
                              </p>
                            )}
                          </label>

                          <label className="mt-2 grid gap-1 text-sm">
                            <span>Venue address</span>
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
                              <p className="mt-1 text-xs text-red-600">
                                {ge.venueAddress}
                              </p>
                            )}
                          </label>
                        </>
                      )}

                      {unifiedType === "PHONE" && PHONE_ENABLED && (
                        <label className="mt-2 grid gap-1 text-sm">
                          <span>Dial info</span>
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
                            <p className="mt-1 text-xs text-red-600">
                              {ge.dialInfo}
                            </p>
                          )}
                        </label>
                      )}
                    </>
                  )}
                </>
              ) : (
                // PER_GUEST scope (forced per-guest provisioning)
                <>
                  <label className="grid gap-1 text-sm">
                    <span>Appearance</span>
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

                  {/* Access fields always visible in PER_GUEST scope */}
                  {g.appearanceType === "ONLINE" && (
                    <label className="mt-2 grid gap-1 text-sm">
                      <span>Join URL</span>
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
                        <p className="mt-1 text-xs text-red-600">
                          {ge.joinUrl}
                        </p>
                      )}
                    </label>
                  )}

                  {g.appearanceType === "IN_PERSON" && (
                    <>
                      <label className="mt-2 grid gap-1 text-sm">
                        <span>Venue name</span>
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
                          <p className="mt-1 text-xs text-red-600">
                            {ge.venueName}
                          </p>
                        )}
                      </label>

                      <label className="mt-2 grid gap-1 text-sm">
                        <span>Venue address</span>
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
                          <p className="mt-1 text-xs text-red-600">
                            {ge.venueAddress}
                          </p>
                        )}
                      </label>
                    </>
                  )}

                  {g.appearanceType === "PHONE" && PHONE_ENABLED && (
                    <label className="mt-2 grid gap-1 text-sm">
                      <span>Dial info</span>
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
                        <p className="mt-1 text-xs text-red-600">
                          {ge.dialInfo}
                        </p>
                      )}
                    </label>
                  )}
                </>
              )}
            </div>
          );
        })}

        <AddGuestPicker
          startAtISO={form.startAt}
          durationMins={form.durationMins}
          onPick={onPickParticipant}
          existingIds={existingUserIds}
        />
      </div>

      {/* Host */}
      <HostCombobox
        value={hostPick}
        onChange={(h) => setHostPick(h)}
        startAtISO={form.startAt}
        durationMins={form.durationMins}
      />

      {/* Optionals */}
      <div className="grid gap-2 rounded-md border p-3">
        <label className="grid gap-1 text-sm">
          <span>Program name</span>
          <input
            value={form.programName ?? ""}
            onChange={(e) => patch({ programName: e.target.value })}
            className="w-full rounded-md border px-3 py-2"
            placeholder="Program"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span>Talking points</span>
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
