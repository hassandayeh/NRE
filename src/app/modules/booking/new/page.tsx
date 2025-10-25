// src/app/modules/booking/new/page.tsx
"use client";

/**
 * New Booking — Unified People Picker + Host toggle (slot-safe)
 * - One picker (Org | Public | Both). No label/role-name filtering.
 * - Add people once; mark any as Host via toggle (default: Guest).
 * - Only non-hosts are sent as "guests" in the create payload.
 * - After create, we batch-add toggled hosts via /participants.
 * - Org context is threaded via query param + x-org-id header.
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

/* ---------- Flags (env) ---------- */
const PHONE_ENABLED =
  (process.env.NEXT_PUBLIC_APPEARANCE_PHONE ?? "true") !== "false";
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

/* ---------- Session (client) ---------- */
type SessionUser = {
  role?: string; // "guest" for guest identity
  orgId?: string | null;
  name?: string | null;
  email?: string | null;
};
function useSessionIdentity() {
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "ready"; user: SessionUser | null; identity: "guest" | "staff" }
  >({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        const user = (json?.user ?? null) as SessionUser | null;
        const identity =
          (user as any)?.role === "guest" ? "guest" : ("staff" as const);
        if (!cancelled) setState({ kind: "ready", user, identity });
      } catch {
        if (!cancelled)
          setState({ kind: "ready", user: null, identity: "guest" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/* ---------- Types ---------- */
type TAppearance = "ONLINE" | "IN_PERSON" | "PHONE";
type TScope = "UNIFIED" | "PER_GUEST";
type TProvisioning = "SHARED" | "PER_GUEST";
type TKind = "EXPERT" | "REPORTER"; // optional hint if the API provides it

type DirectoryItem = {
  id: string;
  name: string | null;
  kind?: TKind | null; // optional, display only
  city?: string | null;
  countryCode?: string | null;
  tags?: string[] | null;
  availability?: { status: "AVAILABLE" | "BUSY" | "UNKNOWN" } | null;
  source: "org" | "public";
};

type SelectedPerson = {
  userId: string;
  name: string;
  // presentation
  source: "org" | "public";
  kind?: TKind | null;

  // host toggle
  isHost: boolean;

  // guest-appearance fields (used only when !isHost)
  order: number;
  appearanceType: TAppearance;
  joinUrl: string | null;
  venueName: string | null;
  venueAddress: string | null;
  dialInfo: string | null;
};

/* ===============================================================
   Unified People Picker (Org | Public | Both)
   ===============================================================*/
function PeoplePicker(props: {
  startAtISO: string;
  durationMins: number;
  onPick: (row: DirectoryItem) => void;
  existingIds: string[]; // userIds currently selected
  orgId?: string | null;
}) {
  const { startAtISO, durationMins, onPick, existingIds, orgId } = props;

  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [visibility, setVisibility] = React.useState<"org" | "public" | "all">(
    "org"
  );
  const [onlyAvailable, setOnlyAvailable] = React.useState(false);
  const [items, setItems] = React.useState<DirectoryItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const haveWindow = !!(startAtISO && durationMins > 0);
  const debouncedQ = useDebounce(q, 250);

  React.useEffect(() => {
    if (!open) return;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    debouncedQ,
    visibility,
    onlyAvailable,
    startAtISO,
    durationMins,
    orgId,
  ]);

  function normAvail(v: any): "AVAILABLE" | "BUSY" | "UNKNOWN" {
    const s = String(v?.status ?? v ?? "UNKNOWN").toUpperCase();
    return s === "AVAILABLE" || s === "BUSY" ? (s as any) : "UNKNOWN";
  }

  function mapOrgRows(raw: any[]): DirectoryItem[] {
    const out: DirectoryItem[] = [];
    for (const u of raw || []) {
      const id = u?.id ?? u?.userId ?? u?.uid ?? u?.email ?? null;
      if (!id) continue;

      const name = u?.displayName ?? u?.name ?? u?.fullName ?? u?.email ?? null;

      const maybeKind = String(u?.kind ?? "").toUpperCase();
      const kind: TKind | null =
        maybeKind === "EXPERT" || maybeKind === "REPORTER"
          ? (maybeKind as TKind)
          : null;

      out.push({
        id: String(id),
        name: name ? String(name) : null,
        kind,
        city: u?.city ?? null,
        countryCode: u?.countryCode ?? null,
        tags: Array.isArray(u?.tags) ? u.tags : [],
        availability: { status: normAvail(u?.availability) },
        source: "org",
      });
    }
    return out;
  }

  async function fetchOrgRows(): Promise<DirectoryItem[]> {
    const sp = new URLSearchParams();
    if (debouncedQ) sp.set("q", debouncedQ);
    if (haveWindow) {
      const start = new Date(startAtISO);
      const end = new Date(start.getTime() + durationMins * 60_000);
      sp.set("start", start.toISOString());
      sp.set("end", end.toISOString());
      // compatibility variants
      sp.set("startAt", start.toISOString());
      sp.set("durationMins", String(durationMins));
    }
    if (orgId) sp.set("orgId", orgId);

    const res = await fetch(`/api/directory/org?${sp.toString()}`, {
      credentials: "include",
      headers: { ...(orgId ? { "x-org-id": orgId } : {}) },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(j?.error || `Directory failed (${res.status})`);

    const arr = Array.isArray(j.items)
      ? j.items
      : Array.isArray(j.users)
      ? j.users
      : [];

    // Align to the route’s shape: prefer an explicit boolean if present.
    // 1) If any row has `bookable`, filter by it.
    // 2) Else if any row has `inviteable`, filter by it.
    // 3) Else show all (route did not provide a flag).
    const hasBookable = (arr as any[]).some((u) =>
      Object.prototype.hasOwnProperty.call(u ?? {}, "bookable")
    );
    const hasInviteable = !hasBookable
      ? (arr as any[]).some((u) =>
          Object.prototype.hasOwnProperty.call(u ?? {}, "inviteable")
        )
      : false;

    const base = hasBookable
      ? (arr as any[]).filter((u) => u?.bookable === true)
      : hasInviteable
      ? (arr as any[]).filter((u) => u?.inviteable === true)
      : (arr as any[] as any[]);

    let rows = mapOrgRows(base);

    if (onlyAvailable && haveWindow) {
      rows = rows.filter((r) => r.availability?.status === "AVAILABLE");
    }
    return rows;
  }

  async function fetchPublicRows(): Promise<DirectoryItem[]> {
    const sp = new URLSearchParams({ visibility: "public", take: "20" });
    if (debouncedQ) sp.set("q", debouncedQ);

    if (haveWindow) {
      const start = new Date(startAtISO);
      const end = new Date(start.getTime() + durationMins * 60_000);
      sp.set("start", start.toISOString());
      sp.set("end", end.toISOString());
      sp.set("startAt", start.toISOString());
      sp.set("durationMins", String(durationMins));
    }
    if (onlyAvailable) sp.set("onlyAvailable", "true");
    if (orgId) sp.set("orgId", orgId);

    const res = await fetch(`/api/experts/search?${sp.toString()}`, {
      credentials: "include",
      headers: { ...(orgId ? { "x-org-id": orgId } : {}) },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(j?.error || `Public search failed (${res.status})`);

    const items: any[] = Array.isArray(j.items) ? j.items : [];
    return items.map((e: any) => {
      const avail = e?.availability;
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
        availability: { status } as DirectoryItem["availability"],
        source: "public" as const,
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
      let orgRows: DirectoryItem[] = [];
      let pubRows: DirectoryItem[] = [];
      try {
        orgRows = await fetchOrgRows();
      } catch {}
      try {
        pubRows = await fetchPublicRows();
      } catch {}
      const map = new Map<string, DirectoryItem>();
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
          {open ? "Hide" : "Add"}&nbsp; person
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

        <label className="ml-2 inline-flex select-none items-center gap-2 text-xs">
          <input
            type="checkbox"
            onChange={(e) => setOnlyAvailable(e.target.checked)}
          />
          Only available
        </label>
      </div>

      {open && (
        <div className="space-y-2 rounded-md border p-2">
          {loading && <div className="text-sm opacity-80">Loading…</div>}
          {error && <div className="text-sm text-red-700">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="text-sm opacity-70">No matches.</div>
          )}

          {items.map((p) => {
            const disabled = props.existingIds.includes(p.id);
            const status = p.availability?.status;
            const kindBadge =
              p.kind === "REPORTER"
                ? "bg-blue-100 text-blue-800"
                : p.kind === "EXPERT"
                ? "bg-purple-100 text-purple-800"
                : "bg-gray-100 text-gray-700";

            return (
              <button
                key={`${p.source}-${p.id}`}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && onPick(p)}
                className={clsx(
                  "w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50",
                  disabled && "opacity-50"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="font-medium">{p.name || "Unnamed"}</div>
                  <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[11px]">
                    {p.source.toUpperCase()}
                  </span>
                  {p.kind && (
                    <span
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-[11px]",
                        kindBadge
                      )}
                    >
                      {p.kind}
                    </span>
                  )}
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px]">
                    {status ?? "UNKNOWN"}
                  </span>
                  {p.city && (
                    <span className="text-xs opacity-70">{p.city}</span>
                  )}
                  {p.countryCode && (
                    <span className="text-xs opacity-70">
                      ({p.countryCode})
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ===============================================================
   Page
   ===============================================================*/
export default function NewBookingPage() {
  const router = useRouter();

  // Access control (client): guests cannot create; staff must have orgId
  const session = useSessionIdentity();
  const blocked =
    session.kind === "ready" &&
    (!session.user ||
      session.identity !== "staff" ||
      !session.user.orgId ||
      session.user.orgId === null);

  const effectiveOrgId =
    session.kind === "ready" ? session.user?.orgId ?? null : null;

  // Core booking fields (guests model retained; "guests" === non-host participants)
  const [form, setForm] = React.useState<{
    subject: string;
    newsroomName: string;
    programName: string;
    talkingPoints: string;
    startAt: string; // ISO
    durationMins: number;

    // Guest appearance model (applies only to non-hosts)
    appearanceScope: TScope;
    accessProvisioning: TProvisioning;
    appearanceType: TAppearance | null; // when UNIFIED

    // UNIFIED defaults (non-hosts)
    locationUrl: string;
    locationName: string;
    locationAddress: string;
    dialInfo: string;
  }>({
    subject: "",
    newsroomName: "",
    programName: "",
    talkingPoints: "",
    startAt: nextFullHourLocalISO(),
    durationMins: 30,

    appearanceScope: "UNIFIED",
    accessProvisioning: "SHARED",
    appearanceType: "ONLINE",
    locationUrl: "",
    locationName: "",
    locationAddress: "",
    dialInfo: "",
  });

  // Selected participants (single list, each with Host toggle)
  const [people, setPeople] = React.useState<SelectedPerson[]>([]);

  // Derived
  const guestsUnified = form.appearanceScope === "UNIFIED";
  const guestsSharedProvisioned = form.accessProvisioning === "SHARED";

  // Form helpers
  function addPersonFromDirectory(row: DirectoryItem) {
    setPeople((xs) => {
      if (xs.some((p) => p.userId === row.id)) return xs;
      return [
        ...xs,
        {
          userId: row.id,
          name: row.name || (row.kind ? row.kind : "Person"),
          source: row.source,
          kind: row.kind ?? null,
          isHost: false, // default to Guest
          order: xs.length,
          appearanceType: (form.appearanceType ?? "ONLINE") as TAppearance,
          joinUrl: null,
          venueName: null,
          venueAddress: null,
          dialInfo: null,
        },
      ];
    });
  }
  function removePerson(idx: number) {
    setPeople((xs) =>
      xs.filter((_, i) => i !== idx).map((p, i) => ({ ...p, order: i }))
    );
  }
  function toggleHost(idx: number, isHost: boolean) {
    setPeople((xs) =>
      xs.map((p, i) =>
        i === idx
          ? {
              ...p,
              isHost,
              // Clear guest-only fields when toggled to Host
              ...(isHost
                ? {
                    joinUrl: null,
                    venueName: null,
                    venueAddress: null,
                    dialInfo: null,
                  }
                : {}),
            }
          : p
      )
    );
  }
  function patchPerson(idx: number, patch: Partial<SelectedPerson>) {
    setPeople((xs) => xs.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  const existingIds = people.map((p) => p.userId);

  // Validations — apply ONLY to non-hosts (guests)
  const guestErrors = React.useMemo(() => {
    const guestOnly = people.filter((p) => !p.isHost);
    const errs: Array<Partial<Record<keyof SelectedPerson, string>>> =
      guestOnly.map(() => ({}));

    if (guestsUnified) {
      if (!guestsSharedProvisioned) {
        // UNIFIED + PER_GUEST → each guest provides access
        guestOnly.forEach((g, idx) => {
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
      // PER_GUEST → each guest chooses type and access
      guestOnly.forEach((g, idx) => {
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
    return { guestOnly, errs };
  }, [people, guestsUnified, guestsSharedProvisioned, form.appearanceType]);

  // Submit
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (blocked) {
      setError("You don’t have permission to create bookings.");
      return;
    }

    // Build guests[] payload from non-hosts (order preserved among non-hosts)
    const nonHosts = people.filter((p) => !p.isHost);
    const guestsPayload =
      nonHosts.length === 0
        ? []
        : nonHosts.map((g, i) => {
            const unifiedType = (form.appearanceType ??
              "ONLINE") as TAppearance;
            const type =
              form.appearanceScope === "UNIFIED"
                ? unifiedType
                : g.appearanceType;

            return {
              userId: g.userId,
              name: g.name,
              // if the backend uses "kind" it can ignore missing
              kind: g.kind ?? undefined,
              order: i, // order among guests only
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

    const payload: any = {
      subject: form.subject,
      newsroomName: form.newsroomName,
      programName: form.programName || undefined,
      talkingPoints: form.talkingPoints || undefined,
      startAt: new Date(form.startAt).toISOString(),
      durationMins: Number(form.durationMins),

      // guest appearance model (non-hosts)
      appearanceScope: form.appearanceScope,
      accessProvisioning: form.accessProvisioning,
      appearanceType:
        form.appearanceScope === "UNIFIED" ? form.appearanceType : null,
      locationUrl: form.locationUrl || null,
      locationName: form.locationName || null,
      locationAddress: form.locationAddress || null,
      dialInfo: form.dialInfo || null,

      guests: guestsPayload,
    };

    try {
      setSubmitting(true);
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(effectiveOrgId ? { "x-org-id": effectiveOrgId } : {}),
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to create booking");

      const bookingId: string = j.booking?.id ?? j?.id;

      // Batch-add hosts as participants (role=HOST)
      const hostAdds = people
        .filter((p) => p.isHost)
        .map((p) => p.userId)
        .filter(Boolean)
        .map((userId) => ({ userId, roleInBooking: "HOST" as const }));

      if (bookingId && MULTI_PARTICIPANTS_ENABLED && hostAdds.length) {
        try {
          await fetch(`/api/bookings/${bookingId}/participants`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              ...(effectiveOrgId ? { "x-org-id": effectiveOrgId } : {}),
            },
            body: JSON.stringify({ participants: hostAdds }),
          });
        } catch {
          // ignore; creation succeeded
        }
      }

      // Navigate to View page
      if (bookingId) {
        router.push(`/modules/booking/${bookingId}`);
      } else {
        router.push(`/modules/booking`);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------------------- Render ---------------------------- */
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">New booking</h1>

      {session.kind === "loading" ? (
        <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm">
          Checking your access…
        </div>
      ) : blocked ? (
        <UIAlert variant="warning">
          You must be <strong>staff</strong> with an <strong>org</strong> to
          create bookings. Guests can’t create bookings.
        </UIAlert>
      ) : null}

      {error && (
        <UIAlert variant="error">
          <div className="text-sm">{error}</div>
        </UIAlert>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        {/* What */}
        <section className="space-y-2">
          <h2 className="text-lg font-medium">What</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Subject</label>
              <input
                value={form.subject}
                onChange={(e) =>
                  setForm((f) => ({ ...f, subject: e.target.value }))
                }
                required
                className="w-full rounded-md border px-3 py-2"
                disabled={blocked}
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
                disabled={blocked}
              />
            </div>
          </div>
        </section>

        {/* Participants (Guests + Hosts via toggle) */}
        <section className="space-y-2">
          <h2 className="text-lg font-medium">Participants</h2>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium">
                Appearance scope (non-hosts)
              </label>
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
                disabled={blocked}
              >
                <option value="UNIFIED">UNIFIED (single)</option>
                <option value="PER_GUEST">PER_GUEST</option>
              </select>
            </div>

            {form.appearanceScope === "UNIFIED" ? (
              <>
                <div>
                  <label className="block text-sm font-medium">
                    Access provisioning (non-hosts)
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
                    disabled={blocked}
                  >
                    <option value="SHARED">SHARED</option>
                    <option value="PER_GUEST">PER_GUEST</option>
                  </select>
                </div>

                <div>
                  <label className="block text sm font-medium">
                    Unified type (non-hosts)
                  </label>
                  <select
                    value={form.appearanceType ?? "ONLINE"}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        appearanceType: e.target.value as TAppearance,
                      }))
                    }
                    className="w-full rounded-md border px-3 py-2"
                    disabled={blocked}
                  >
                    <option value="ONLINE">ONLINE</option>
                    <option value="IN_PERSON">IN_PERSON</option>
                    {PHONE_ENABLED && <option value="PHONE">PHONE</option>}
                  </select>
                </div>
              </>
            ) : (
              <div className="sm:col-span-2 text-sm opacity-70">
                Each non-host selects their own appearance and access.
              </div>
            )}
          </div>

          {/* Defaults for non-hosts when UNIFIED + SHARED */}
          {form.appearanceScope === "UNIFIED" &&
            form.accessProvisioning === "SHARED" && (
              <>
                {(form.appearanceType ?? "ONLINE") === "ONLINE" && (
                  <div>
                    <label className="block text-sm font-medium">
                      Default meeting link (non-hosts)
                    </label>
                    <input
                      value={form.locationUrl}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, locationUrl: e.target.value }))
                      }
                      placeholder="https://…"
                      className="w-full rounded-md border px-3 py-2"
                      disabled={blocked}
                    />
                  </div>
                )}

                {(form.appearanceType ?? "ONLINE") === "IN_PERSON" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium">
                        Default venue name (non-hosts)
                      </label>
                      <input
                        value={form.locationName}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            locationName: e.target.value,
                          }))
                        }
                        placeholder="Studio A"
                        className="w-full rounded-md border px-3 py-2"
                        disabled={blocked}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium">
                        Default address (non-hosts)
                      </label>
                      <input
                        value={form.locationAddress}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            locationAddress: e.target.value,
                          }))
                        }
                        placeholder="123 Example St…"
                        className="w-full rounded-md border px-3 py-2"
                        disabled={blocked}
                      />
                    </div>
                  </div>
                )}

                {PHONE_ENABLED &&
                  (form.appearanceType ?? "ONLINE") === "PHONE" && (
                    <div>
                      <label className="block text-sm font-medium">
                        Default dial info (non-hosts)
                      </label>
                      <input
                        value={form.dialInfo}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, dialInfo: e.target.value }))
                        }
                        placeholder="e.g., +1 555 123 4567 PIN 0000"
                        className="w-full rounded-md border px-3 py-2"
                        disabled={blocked}
                      />
                    </div>
                  )}
              </>
            )}

          {/* People list */}
          <div className="mt-3 rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium">
                People{" "}
                <span className="opacity-60">({people.length} selected)</span>
              </div>
              <PeoplePicker
                startAtISO={form.startAt}
                durationMins={form.durationMins}
                onPick={addPersonFromDirectory}
                existingIds={existingIds}
                orgId={effectiveOrgId}
              />
            </div>

            {people.length === 0 && (
              <div className="text-sm opacity-70">
                No participants yet. Use “Add person” to append internal staff
                or public experts.
              </div>
            )}

            <div className="space-y-3">
              {people.map((p, idx) => {
                // errors array lines up with non-hosts only
                const guestIndex = people
                  .filter((x) => !x.isHost)
                  .findIndex((x, i) => i === idx && !p.isHost);
                const ge =
                  !p.isHost && guestIndex >= 0
                    ? guestErrors.errs[guestIndex] || {}
                    : {};

                const unifiedType = (form.appearanceType ??
                  "ONLINE") as TAppearance;

                return (
                  <div
                    key={`${p.userId}-${idx}`}
                    className="rounded-md border p-3"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <div className="font-medium">
                        #{idx + 1} &nbsp; {p.name}{" "}
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px]">
                          {p.source.toUpperCase()}
                        </span>
                        {p.kind && (
                          <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px]">
                            {p.kind}
                          </span>
                        )}
                      </div>

                      <label className="ml-auto inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={p.isHost}
                          onChange={(e) => toggleHost(idx, e.target.checked)}
                        />
                        Host
                      </label>

                      <button
                        type="button"
                        onClick={() => removePerson(idx)}
                        className="rounded-md border px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        title="Remove"
                      >
                        Remove
                      </button>
                    </div>

                    {/* Guest-only fields (hidden/disabled when Host) */}
                    {p.isHost ? (
                      <div className="text-sm opacity-70">
                        Marked as <strong>Host</strong>. No guest access fields
                        required.
                      </div>
                    ) : form.appearanceScope === "UNIFIED" ? (
                      <>
                        {form.accessProvisioning === "SHARED" ? (
                          <div className="text-sm opacity-70">
                            Using unified settings (
                            {form.appearanceType ?? "ONLINE"}). No per-guest
                            access fields.
                          </div>
                        ) : (
                          <>
                            {unifiedType === "ONLINE" && (
                              <div>
                                <label className="block text-sm font-medium">
                                  Join URL
                                </label>
                                <input
                                  value={p.joinUrl ?? ""}
                                  onChange={(ev) =>
                                    patchPerson(idx, {
                                      joinUrl: ev.target.value,
                                    })
                                  }
                                  className={clsx(
                                    "w-full rounded-md border px-3 py-2",
                                    (ge as any).joinUrl && "border-red-500"
                                  )}
                                  placeholder="https://…"
                                />
                              </div>
                            )}

                            {unifiedType === "IN_PERSON" && (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <label className="block text-sm font-medium">
                                    Venue name
                                  </label>
                                  <input
                                    value={p.venueName ?? ""}
                                    onChange={(ev) =>
                                      patchPerson(idx, {
                                        venueName: ev.target.value,
                                      })
                                    }
                                    className={clsx(
                                      "w-full rounded-md border px-3 py-2",
                                      (ge as any).venueName && "border-red-500"
                                    )}
                                    placeholder="Studio A"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium">
                                    Venue address
                                  </label>
                                  <input
                                    value={p.venueAddress ?? ""}
                                    onChange={(ev) =>
                                      patchPerson(idx, {
                                        venueAddress: ev.target.value,
                                      })
                                    }
                                    className={clsx(
                                      "w-full rounded-md border px-3 py-2",
                                      (ge as any).venueAddress &&
                                        "border-red-500"
                                    )}
                                    placeholder="123 Example St…"
                                  />
                                </div>
                              </div>
                            )}

                            {PHONE_ENABLED && unifiedType === "PHONE" && (
                              <div>
                                <label className="block text-sm font-medium">
                                  Dial info
                                </label>
                                <input
                                  value={p.dialInfo ?? ""}
                                  onChange={(ev) =>
                                    patchPerson(idx, {
                                      dialInfo: ev.target.value,
                                    })
                                  }
                                  className={clsx(
                                    "w-full rounded-md border px-3 py-2",
                                    (ge as any).dialInfo && "border-red-500"
                                  )}
                                  placeholder="e.g., +1 555 123 4567 PIN 0000"
                                />
                              </div>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="block text-sm font-medium">
                            Appearance
                          </label>
                          <select
                            value={p.appearanceType}
                            onChange={(ev) =>
                              patchPerson(idx, {
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
                        </div>

                        {p.appearanceType === "ONLINE" && (
                          <div>
                            <label className="block text-sm font-medium">
                              Join URL
                            </label>
                            <input
                              value={p.joinUrl ?? ""}
                              onChange={(ev) =>
                                patchPerson(idx, { joinUrl: ev.target.value })
                              }
                              className={clsx(
                                "w/full rounded-md border px-3 py-2",
                                (ge as any).joinUrl && "border-red-500"
                              )}
                              placeholder="https://…"
                            />
                          </div>
                        )}

                        {p.appearanceType === "IN_PERSON" && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className="block text-sm font-medium">
                                Venue name
                              </label>
                              <input
                                value={p.venueName ?? ""}
                                onChange={(ev) =>
                                  patchPerson(idx, {
                                    venueName: ev.target.value,
                                  })
                                }
                                className={clsx(
                                  "w-full rounded-md border px-3 py-2",
                                  (ge as any).venueName && "border-red-500"
                                )}
                                placeholder="Studio A"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium">
                                Venue address
                              </label>
                              <input
                                value={p.venueAddress ?? ""}
                                onChange={(ev) =>
                                  patchPerson(idx, {
                                    venueAddress: ev.target.value,
                                  })
                                }
                                className={clsx(
                                  "w-full rounded-md border px-3 py-2",
                                  (ge as any).venueAddress && "border-red-500"
                                )}
                                placeholder="123 Example St…"
                              />
                            </div>
                          </div>
                        )}

                        {PHONE_ENABLED && p.appearanceType === "PHONE" && (
                          <div>
                            <label className="block text-sm font-medium">
                              Dial info
                            </label>
                            <input
                              value={p.dialInfo ?? ""}
                              onChange={(ev) =>
                                patchPerson(idx, { dialInfo: ev.target.value })
                              }
                              className={clsx(
                                "w-full rounded-md border px-3 py-2",
                                (ge as any).dialInfo && "border-red-500"
                              )}
                              placeholder="e.g., +1 555 123 4567 PIN 0000"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* When */}
        <section className="space-y-2">
          <h2 className="text-lg font-medium">When</h2>
          <div className="grid gap-3 sm:grid-cols-2">
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
                disabled={blocked}
              />
            </div>
            <div>
              <label className="block text-sm font-medium">
                Duration (mins)
              </label>
              <input
                type="number"
                min={5}
                max={600}
                step={5}
                value={form.durationMins}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    durationMins: Number(e.target.value),
                  }))
                }
                required
                className="w-full rounded-md border px-3 py-2"
                disabled={blocked}
              />
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-2">
          <UIButton
            type="button"
            variant="secondary"
            onClick={() => router.back()}
          >
            Cancel
          </UIButton>
          <UIButton type="submit" disabled={blocked || submitting}>
            {submitting ? "Creating…" : "Create booking"}
          </UIButton>
        </div>
      </form>
    </main>
  );
}
