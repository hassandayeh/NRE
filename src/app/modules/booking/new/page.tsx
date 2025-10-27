// src/app/modules/booking/new/page.tsx
"use client";

/**
 * New Booking — People picker + Mode Level (Booking | Participant)
 *
 * Uses reusable <ModeAccessControl /> for:
 *  - Booking-level Mode & Access (when modeLevel = BOOKING)
 *  - Per-participant Mode & Access (when modeLevel = PARTICIPANT)
 *
 * Layout (this slice):
 *  - Each top-level section is its own container (rounded + border + p-4).
 *  - Internal spacing normalized to space-y-4 for section body, space-y-3 for field stacks.
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

/* ---------- Mode & Access (reusable) ---------- */
import ModeAccessControl, {
  type ModeLevel,
  type ModeDto,
  type AccessPresetRow,
  type BookingAccessConfig,
  type ModeAccessState,
  type ModeAccessDerived,
  type ModeAccessErrors,
} from "../../../../components/booking/ModeAccessControl";

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

/* ---------- Types (local) ---------- */
type TKind = "EXPERT" | "REPORTER";
type DirectoryItem = {
  id: string;
  name: string | null;
  kind?: TKind | null;
  city?: string | null;
  countryCode?: string | null;
  tags?: string[] | null;
  availability?: { status: "AVAILABLE" | "BUSY" | "UNKNOWN" } | null;
  source: "org" | "public";
};
type SelectedPerson = {
  userId: string;
  name: string;
  source: "org" | "public";
  kind?: TKind | null;
  isHost: boolean;
  order: number;
};

/* ===============================================================
   Unified People Picker (Org | Public | Both)
   ===============================================================*/
function PeoplePicker(props: {
  startAtISO: string;
  durationMins: number;
  onPick: (row: DirectoryItem) => void;
  existingIds: string[];
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border px-2 py-1 text-sm hover:bg-gray-50"
      >
        {open ? "Hide" : "Find"}
      </button>

      {open && (
        <div className="space-y-3 rounded-md border p-3">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
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
                checked={!!onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
              />
              Only available
            </label>
          </div>

          {/* Results */}
          <div className="space-y-2">
            {loading && <div className="text-sm text-gray-500">Loading…</div>}
            {error && <div className="text-sm text-red-700">{error}</div>}
            {!loading && !error && items.length === 0 && (
              <div className="text-sm text-gray-500">No matches.</div>
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
                  key={p.id}
                  disabled={disabled}
                  onClick={() => !disabled && props.onPick(p)}
                  className={clsx(
                    "w-full rounded-md border px-3 py-2 text-left hover:bg-gray-50",
                    disabled && "opacity-50"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{p.name || "Unnamed"}</div>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] tracking-wide">
                      {p.source.toUpperCase()}
                    </span>
                    {p.kind && (
                      <span
                        className={clsx(
                          "rounded px-1.5 py-0.5 text-[10px]",
                          kindBadge
                        )}
                      >
                        {p.kind}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      {status ?? "UNKNOWN"}
                    </span>
                    {p.city && (
                      <span className="text-xs text-gray-500">{p.city}</span>
                    )}
                    {p.countryCode && (
                      <span className="text-xs text-gray-400">
                        ({p.countryCode})
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

/* ---------------------- Lightweight Rich Text ---------------------- */
function RtButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
    >
      {children}
    </button>
  );
}

function RichTextEditor({
  value = "",
  disabled,
  onChange,
}: {
  value?: string;
  disabled?: boolean;
  onChange?: (html: string) => void;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  // Initialize once; do NOT control value on each render (keeps caret stable)
  React.useEffect(() => {
    if (ref.current) ref.current.innerHTML = value || "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exec = (cmd: string, val?: string) => {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(cmd, false, val);
    onChange?.(ref.current?.innerHTML ?? "");
  };

  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-1 border-b p-1">
        <RtButton onClick={() => exec("bold")} title="Bold">
          <span className="font-bold">B</span>
        </RtButton>
        <RtButton onClick={() => exec("italic")} title="Italic">
          <span className="italic">I</span>
        </RtButton>
        <RtButton onClick={() => exec("underline")} title="Underline">
          <span className="underline">U</span>
        </RtButton>
        <RtButton onClick={() => exec("removeFormat")} title="Clear formatting">
          Clear format
        </RtButton>
      </div>

      <div
        ref={ref}
        contentEditable={!disabled}
        onInput={() => onChange?.(ref.current?.innerHTML ?? "")}
        className={clsx(
          "h-40 min-h-[120px] w-full resize-y overflow-auto px-3 py-2 focus:outline-none focus:ring-0",
          disabled ? "cursor-not-allowed bg-gray-50" : "bg-white"
        )}
        suppressContentEditableWarning
      />
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

  // Core booking fields
  const [form, setForm] = React.useState<{
    subject: string;
    newsroomName: string;
    programName: string;
    talkingPoints: string;
    startAt: string; // ISO
    durationMins: number;
  }>({
    subject: "",
    newsroomName: "",
    programName: "",
    talkingPoints: "",
    startAt: nextFullHourLocalISO(),
    durationMins: 30,
  });

  // Selected participants
  const [people, setPeople] = React.useState<SelectedPerson[]>([]);
  const existingIds = people.map((p) => p.userId);

  // ---------- Mode Level ----------
  const [modeLevel, setModeLevel] = React.useState<ModeLevel>("BOOKING");

  // ---------- Org Modes + Presets ----------
  const [modes, setModes] = React.useState<ModeDto[]>([]);
  const [presets, setPresets] = React.useState<AccessPresetRow[]>([]);

  React.useEffect(() => {
    if (session.kind !== "ready") return;
    const orgId = effectiveOrgId;
    if (!orgId) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/org/modes?orgId=${encodeURIComponent(orgId)}`,
          {
            cache: "no-store",
            credentials: "include",
            headers: { ...(orgId ? { "x-org-id": orgId } : {}) },
          }
        );
        const j = (await res.json()) as { modes?: ModeDto[] };
        const active = (j?.modes ?? []).filter((m) => m.active);
        setModes(active);
      } catch {
        setModes([]);
      }
    })();
  }, [session.kind, effectiveOrgId]);

  React.useEffect(() => {
    if (session.kind !== "ready") return;
    const orgId = effectiveOrgId;
    if (!orgId) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/org/modes/presets?orgId=${encodeURIComponent(orgId)}`,
          {
            cache: "no-store",
            credentials: "include",
            headers: { ...(orgId ? { "x-org-id": orgId } : {}) },
          }
        );
        if (!res.ok) throw new Error("no presets");
        const rows: AccessPresetRow[] = await res.json();
        setPresets(Array.isArray(rows) ? rows : []);
      } catch {
        setPresets([]);
      }
    })();
  }, [session.kind, effectiveOrgId]);

  /* ---------- Booking-level Mode & Access (via component) ---------- */
  const [bookingAccess, setBookingAccess] = React.useState<
    BookingAccessConfig | undefined
  >(undefined);
  const [bookingValid, setBookingValid] = React.useState<boolean>(true);

  function onBookingMAChange(
    _state: ModeAccessState,
    derived: ModeAccessDerived,
    _errors: ModeAccessErrors
  ) {
    setBookingAccess(derived.accessConfig);
    setBookingValid(derived.valid);
  }

  /* ---------- Per-participant Mode & Access (via component) ---------- */
  const [participantMA, setParticipantMA] = React.useState<
    Record<string, { access?: BookingAccessConfig; valid: boolean }>
  >({});

  function onParticipantMAChange(
    userId: string,
    _state: ModeAccessState,
    derived: ModeAccessDerived,
    _errors: ModeAccessErrors
  ) {
    setParticipantMA((m) => ({
      ...m,
      [userId]: { access: derived.accessConfig, valid: derived.valid },
    }));
  }

  // Selected participants (helpers)
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
    setPeople((xs) => xs.map((p, i) => (i === idx ? { ...p, isHost } : p)));
  }

  /* ---------- Form validity (Create button) ---------- */
  const participantsValid =
    modeLevel !== "PARTICIPANT" ||
    people.every((p) => participantMA[p.userId]?.valid ?? true);
  const formValid = bookingValid && participantsValid;

  // ---------- Submit ----------
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const blocked =
      session.kind === "ready" &&
      (!session.user ||
        session.identity !== "staff" ||
        !session.user.orgId ||
        session.user.orgId === null);

    if (blocked) {
      setError("You don’t have permission to create bookings.");
      return;
    }
    if (!formValid) return;

    const participantsAccess =
      modeLevel === "PARTICIPANT"
        ? people
            .map((p) => ({
              userId: p.userId,
              accessConfig: participantMA[p.userId]?.access,
            }))
            .filter(
              (x): x is { userId: string; accessConfig: BookingAccessConfig } =>
                !!x.accessConfig
            )
        : undefined;

    const payload: any = {
      subject: form.subject,
      newsroomName: form.newsroomName,
      programName: form.programName || undefined,
      talkingPoints: form.talkingPoints || undefined,
      startAt: new Date(form.startAt).toISOString(),
      durationMins: Number(form.durationMins),
      modeLevel,
      ...(modeLevel === "BOOKING" && bookingAccess
        ? { accessConfig: bookingAccess }
        : {}),
      ...(modeLevel === "PARTICIPANT" && participantsAccess?.length
        ? { participantsAccess }
        : {}),
    };

    try {
      setSubmitting(true);
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session.kind === "ready" && session.user?.orgId
            ? { "x-org-id": session.user.orgId }
            : {}),
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to create booking");
      const bookingId: string = j.booking?.id ?? j?.id;
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
    <form className="mx-auto max-w-3xl space-y-6" onSubmit={onSubmit}>
      {/* Access gate + errors */}
      {session.kind === "loading" ? (
        <div className="text-sm text-gray-500">Checking your access…</div>
      ) : null}
      {error && <UIAlert kind="error">{error}</UIAlert>}

      {/* Basic Info (container) */}
      <section className="rounded-md border p-4 space-y-4">
        <h2 className="text-lg font-medium">Basic Info</h2>
        <div className="space-y-3">
          <label className="block space-y-1">
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

          <label className="block space-y-1">
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

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
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

            <label className="block space-y-1">
              <span className="text-sm">Duration (mins)</span>
              <input
                type="number"
                min={5}
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
              />
            </label>
          </div>

          {/* Talking points (rich text) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm">Talking points</span>
            </div>
            <RichTextEditor
              value={form.talkingPoints}
              onChange={(html) =>
                setForm((f) => ({ ...f, talkingPoints: html }))
              }
            />
          </div>
        </div>
      </section>

      {/* Mode & Access (container) */}
      <section className="rounded-md border p-4 space-y-4">
        <h2 className="text-lg font-medium">Mode &amp; Access</h2>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm">Mode Level</span>
            <select
              value={modeLevel}
              onChange={(e) => setModeLevel(e.target.value as ModeLevel)}
              className="w-full rounded-md border px-3 py-2"
            >
              <option value="BOOKING">Booking</option>
              <option value="PARTICIPANT">Participant</option>
            </select>
          </label>

          {modeLevel === "BOOKING" && (
            <ModeAccessControl
              scope="BOOKING"
              modes={modes}
              presets={presets}
              onChange={onBookingMAChange}
            />
          )}
        </div>
      </section>

      {/* Participants (container) */}
      <section className="rounded-md border p-4 space-y-4">
        <h2 className="text-lg font-medium">Participants</h2>

        <PeoplePicker
          startAtISO={form.startAt}
          durationMins={form.durationMins}
          onPick={(row) => addPersonFromDirectory(row)}
          existingIds={existingIds}
          orgId={
            session.kind === "ready"
              ? session.user?.orgId ?? undefined
              : undefined
          }
        />

        {people.length === 0 && (
          <div className="rounded-md border border-dashed p-3 text-sm text-gray-500">
            No participants yet. Use “Find” to add people.
          </div>
        )}

        <div className="space-y-3">
          {people.map((p, idx) => {
            return (
              <div key={p.userId} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">
                      #{idx + 1}&nbsp;&nbsp;{p.name}{" "}
                    </div>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] tracking-wide">
                      {p.source.toUpperCase()}
                    </span>
                    {p.kind && (
                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-800">
                        {p.kind}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!p.isHost}
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
                </div>

                {modeLevel === "PARTICIPANT" && (
                  <div className="mt-3">
                    <ModeAccessControl
                      scope="PARTICIPANT"
                      modes={modes}
                      presets={presets}
                      onChange={(s, d, e) =>
                        onParticipantMAChange(p.userId, s, d, e)
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer actions (containerless) */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border px-3 py-2 hover:bg-gray-50"
        >
          Cancel
        </button>
        <UIButton type="submit" disabled={submitting || !formValid}>
          {submitting ? "Creating…" : "Create booking"}
        </UIButton>
      </div>
    </form>
  );
}
