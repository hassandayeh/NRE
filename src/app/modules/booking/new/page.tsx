// src/app/modules/booking/new/page.tsx
"use client";

/**
 * New Booking — People picker + Mode Level (Booking | Participant)
 *
 * This drop focuses on UI/UX polish (no API regressions):
 * - Buttons standardized (primary/secondary).
 * - "Use access presets" defaults to ON.
 * - Extra top margin above the first container.
 * - Cancel warns about unsaved changes (modal, mirrors Guest Profile UX).
 * - "Back to bookings" now navigates to /modules/booking/view.
 *
 * Compatibility: Subject is removed from UI. We still send subject = programName.
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
  return `${d.getFullYear()}-${d.getMonth() + 1 <= 9 ? "0" : ""}${
    d.getMonth() + 1
  }-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border px-2 py-1 text-sm hover:bg-gray-50"
      >
        {open ? "Hide" : "Find"}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {/* Controls */}
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
                type="button"
                key={v}
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

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={onlyAvailable}
                onChange={(e) => setOnlyAvailable(e.target.checked)}
              />
              <span>Only available</span>
            </label>
          </div>

          {/* Results */}
          <div className="rounded-md border divide-y">
            {loading && <div className="p-3 text-sm">Loading…</div>}
            {error && <div className="p-3 text-sm text-red-600">{error}</div>}
            {!loading && !error && items.length === 0 && (
              <div className="p-3 text-sm text-gray-600">No matches.</div>
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
                  type="button"
                  key={p.id}
                  disabled={disabled}
                  onClick={() => !disabled && props.onPick(p)}
                  className={clsx(
                    "w-full rounded-md border-0 px-3 py-2 text-left hover:bg-gray-50",
                    disabled && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{p.name || "Unnamed"}</div>
                    <span className="text-[10px] rounded px-1.5 py-0.5 border">
                      {p.source.toUpperCase()}
                    </span>
                    {p.kind && (
                      <span
                        className={clsx(
                          "text-[10px] rounded px-1.5 py-0.5",
                          kindBadge
                        )}
                      >
                        {p.kind}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-500 ml-auto">
                      {status ?? "UNKNOWN"}
                    </span>
                    {p.city && <span className="text-[10px]">{p.city}</span>}
                    {p.countryCode && (
                      <span className="text-[10px] text-gray-500">
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
      className="rounded-md border px-2 py-1 text-xs"
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
      <div className="flex items-center gap-2 border-b p-2">
        <RtButton onClick={() => exec("bold")} title="Bold">
          B
        </RtButton>
        <RtButton onClick={() => exec("italic")} title="Italic">
          I
        </RtButton>
        <RtButton onClick={() => exec("underline")} title="Underline">
          U
        </RtButton>
        <div className="ml-auto">
          <RtButton
            onClick={() => exec("removeFormat")}
            title="Clear formatting"
          >
            Clear format
          </RtButton>
        </div>
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

  // Core booking fields (Subject removed; Program name is the primary)
  const [form, setForm] = React.useState<{
    programName: string;
    newsroomName: string;
    talkingPoints: string;
    startAt: string; // ISO
    durationMins: number;
  }>({
    programName: "",
    newsroomName: "",
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
  const [bookingValid, setBookingValid] = React.useState(true);
  // Guard readiness & skip switches
  const [maReady, setMaReady] = React.useState(false); // ModeAccessControl fired once
  const [baselineSet, setBaselineSet] = React.useState(false); // baseline snapshot established
  const skipGuardsRef = React.useRef(false); // set true during programmatic navigations (save/redirect)

  function onBookingMAChange(
    _state: ModeAccessState,
    derived: ModeAccessDerived,
    _errors: ModeAccessErrors
  ) {
    setBookingAccess(derived.accessConfig);
    setBookingValid(derived.valid);
    // First onChange from ModeAccessControl indicates its initial state is ready.
    // We only need to set this once.
    setMaReady((was) => (was ? was : true));
  }

  /* ---------- Per-participant Mode & Access (future slice) ---------- */
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
  const formValid = bookingValid && participantsValid && !!form.programName;

  /* ---------- Unsaved changes (modal guard) ---------- */
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  const [leaveBusy, setLeaveBusy] = React.useState(false);
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const baselineRef = React.useRef<string>("");

  // Establish baseline once the page is stable:
  // - session is resolved (so orgId doesn’t flip later),
  // - ModeAccessControl has emitted its initial state (when modeLevel === 'BOOKING').
  // If user chooses PARTICIPANT, we don't wait for bookingAccess.
  React.useEffect(() => {
    const sessionReady = session.kind === "ready";
    const maIsNeeded = modeLevel === "BOOKING";
    const stable = sessionReady && (!maIsNeeded || maReady);

    if (!baselineSet && stable) {
      baselineRef.current = JSON.stringify({
        form,
        people,
        modeLevel,
        bookingAccess: maIsNeeded ? bookingAccess : undefined,
        participantMA: !maIsNeeded ? participantMA : undefined,
      });

      setBaselineSet(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session.kind,
    maReady,
    modeLevel,
    baselineSet,
    form,
    people,
    bookingAccess,
    participantMA,
  ]);

  const dirty = React.useMemo(() => {
    if (!baselineSet) return false;
    try {
      const snap = JSON.stringify({
        form,
        people,
        modeLevel,
        bookingAccess: modeLevel === "BOOKING" ? bookingAccess : undefined,
        participantMA: modeLevel === "PARTICIPANT" ? participantMA : undefined,
      });

      return snap !== baselineRef.current;
    } catch {
      return false;
    }
  }, [baselineSet, form, people, modeLevel, bookingAccess, participantMA]);

  // native refresh/close
  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty || skipGuardsRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // in-app links
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirty) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const target = e.target as Element | null;
      if (!target) return;
      const a = target.closest("a") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.dataset && (a.dataset as any).bypassUnsaved === "true") return;

      const raw = a.getAttribute("href") || a.href;
      if (!raw) return;
      let dest: string | null = null;
      if (raw.startsWith("/")) {
        dest = raw;
      } else {
        try {
          const u = new URL(raw);
          if (u.host === window.location.host)
            dest = u.pathname + u.search + u.hash;
          else return;
        } catch {
          return;
        }
      }
      if (dest && dest.startsWith("#")) return;

      e.preventDefault();
      setPendingHref(dest);
      setLeaveOpen(true);
    };

    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [dirty]);

  async function leaveViaSave() {
    if (leaveBusy) return;
    setLeaveBusy(true);
    const ok = await saveAndStay(); // light client-side save (same as Create payload but no redirect)
    setLeaveBusy(false);
    if (ok) {
      const dest = pendingHref ?? "/modules/booking/view";
      skipGuardsRef.current = true;
      baselineRef.current = JSON.stringify({
        form,
        people,
        modeLevel,
        bookingAccess: modeLevel === "BOOKING" ? bookingAccess : undefined,
        participantMA: modeLevel === "PARTICIPANT" ? participantMA : undefined,
      });

      setLeaveOpen(false);
      setPendingHref(null);
      router.push(dest);
    }
  }
  function leaveDiscard() {
    const dest = pendingHref ?? "/modules/booking/view";
    setLeaveOpen(false);
    setPendingHref(null);
    router.push(dest);
  }

  /* ---------- Submit ---------- */
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const blockedNow =
      session.kind === "ready" &&
      (!session.user ||
        session.identity !== "staff" ||
        !session.user.orgId ||
        session.user.orgId === null);

    if (blockedNow) {
      setError("You don’t have permission to create bookings.");
      return;
    }
    if (!formValid) return;

    // Build booking payload (Subject removed; we bridge subject = programName)
    const payload: any = {
      subject: form.programName || undefined, // compat shim
      programName: form.programName || undefined,
      newsroomName: form.newsroomName,
      talkingPoints: form.talkingPoints || undefined,
      startAt: new Date(form.startAt).toISOString(),
      durationMins: Number(form.durationMins),
      modeLevel,
      ...(modeLevel === "BOOKING" && bookingAccess
        ? { accessConfig: bookingAccess }
        : {}),
    };

    try {
      setSubmitting(true);

      // 1) Create the booking
      const createRes = await fetch("/api/bookings", {
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
      const createJson = await createRes.json().catch(() => ({}));
      if (!createRes.ok)
        throw new Error(createJson?.error || "Failed to create booking");

      const bookingId: string = createJson.booking?.id ?? createJson?.id;
      if (!bookingId) throw new Error("Booking created without id.");

      // 2) If we picked people, add them as participants
      if (people.length > 0) {
        const participantsPayload = {
          participants: people.map((p) => {
            const acc =
              modeLevel === "PARTICIPANT"
                ? participantMA[p.userId]?.access
                : undefined;
            return {
              userId: p.userId,
              // Host = 1, Reporter(Producer) = 2, Expert = 3
              roleSlot: p.isHost ? 1 : p.kind === "REPORTER" ? 2 : 3,
              ...(acc ? { accessConfig: acc } : {}),
            };
          }),
        };

        const partRes = await fetch(`/api/bookings/${bookingId}/participants`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(participantsPayload),
        });
        if (!partRes.ok) {
          const pj = await partRes.json().catch(() => ({}));
          console.error("Participants add failed:", pj);
          setError(
            (pj as any)?.error ||
              "Booking created, but adding participants failed."
          );
        }
      }

      // 3) Go to the single booking view
      skipGuardsRef.current = true; // prevent unload prompt
      baselineRef.current = JSON.stringify({
        form,
        people,
        modeLevel,
        bookingAccess: modeLevel === "BOOKING" ? bookingAccess : undefined,
        participantMA: modeLevel === "PARTICIPANT" ? participantMA : undefined,
      });

      window.location.assign(`/modules/booking/${bookingId}`);
    } catch (err: any) {
      setError(err?.message || "Failed to create booking");
    } finally {
      setSubmitting(false);
    }
  }

  // lightweight save used by the modal’s “Save and leave”
  async function saveAndStay(): Promise<boolean> {
    if (!formValid) return false;
    try {
      const payload: any = {
        subject: form.programName || undefined,
        programName: form.programName || undefined,
        newsroomName: form.newsroomName,
        talkingPoints: form.talkingPoints || undefined,
        startAt: new Date(form.startAt).toISOString(),
        durationMins: Number(form.durationMins),
        modeLevel,
        ...(modeLevel === "BOOKING" && bookingAccess
          ? { accessConfig: bookingAccess }
          : {}),
      };
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /* ---------------------------- Render ---------------------------- */
  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-4xl p-4">
      {/* Header row */}
      <div className="mb-4 flex items-center justify-between">
        <a
          href="/modules/booking/view"
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          ← Back to bookings
        </a>
        <div className="flex items-center gap-2">
          <UIButton
            type="button"
            onClick={() => {
              if (dirty) {
                setPendingHref("/modules/booking/view");
                setLeaveOpen(true);
                return;
              }
              router.push("/modules/booking/view");
            }}
            className="rounded-md border px-4 py-2"
          >
            Cancel
          </UIButton>
          <UIButton
            type="submit"
            disabled={!formValid || submitting || blocked}
            className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create booking"}
          </UIButton>
        </div>
      </div>

      {/* Basic Info (extra margin to the top) */}
      <section className="mt-6 rounded-md border p-4">
        <h2 className="text-lg font-medium">Basic Info</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="text-gray-700">Program name</span>
            <input
              value={form.programName}
              onChange={(e) =>
                setForm((f) => ({ ...f, programName: e.target.value }))
              }
              className="mt-1 w-full rounded-md border px-3 py-2"
              placeholder=""
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">Newsroom name</span>
            <input
              value={form.newsroomName}
              onChange={(e) =>
                setForm((f) => ({ ...f, newsroomName: e.target.value }))
              }
              className="mt-1 w-full rounded-md border px-3 py-2"
              placeholder=""
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">Start at</span>
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(form.startAt)}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  startAt: new Date(e.target.value).toISOString(),
                }))
              }
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">Duration (mins)</span>
            <input
              type="number"
              min={5}
              step={5}
              value={form.durationMins}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  durationMins: Number(e.target.value || 0),
                }))
              }
              className="mt-1 w-full rounded-md border px-3 py-2"
            />
          </label>
        </div>

        <div className="mt-4">
          <label className="block text-sm">
            <span className="text-gray-700">Talking points</span>
            <div className="mt-1">
              <RichTextEditor
                value={form.talkingPoints}
                onChange={(html) =>
                  setForm((f) => ({ ...f, talkingPoints: html }))
                }
              />
            </div>
          </label>
        </div>
      </section>

      {/* Mode & Access */}
      <section className="mt-6 rounded-md border p-4">
        <h2 className="text-lg font-medium">Mode &amp; Access</h2>
        <div className="mt-3 grid grid-cols-1 gap-4">
          <label className="block text-sm">
            <span className="text-gray-700">Mode Level</span>
            <select
              value={modeLevel}
              onChange={(e) => setModeLevel(e.target.value as ModeLevel)}
              className="mt-1 w-full rounded-md border px-3 py-2"
            >
              <option value="BOOKING">Booking</option>
              <option value="PARTICIPANT">Participant</option>
            </select>
          </label>

          {/* Booking-level MA (presets default ON) */}
          {modeLevel === "BOOKING" && (
            <div className="rounded-md border p-3">
              <ModeAccessControl
                scope="BOOKING"
                modes={modes}
                presets={presets}
                initial={{ usePresets: true }}
                onChange={onBookingMAChange}
              />
            </div>
          )}
        </div>
      </section>

      {/* Participants */}
      <section className="mt-6 rounded-md border p-4">
        <h2 className="text-lg font-medium">Participants</h2>

        <div className="mt-2">
          <PeoplePicker
            startAtISO={form.startAt}
            durationMins={form.durationMins}
            existingIds={existingIds}
            onPick={addPersonFromDirectory}
            orgId={effectiveOrgId ?? undefined}
          />
        </div>

        {people.length === 0 ? (
          <div className="mt-3 rounded-md border p-3 text-sm text-gray-600">
            No participants yet. Use “Find” to add people.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {people.map((p, i) => (
              <div key={p.userId} className="rounded-md border p-2">
                {/* Row header */}
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="text-[10px] rounded px-1.5 py-0.5 border">
                      {p.source.toUpperCase()}
                    </span>
                    {p.kind && (
                      <span className="text-[10px] rounded bg-gray-100 px-1.5 py-0.5">
                        {p.kind}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={p.isHost}
                        onChange={(e) => toggleHost(i, e.target.checked)}
                      />
                      <span>Host</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => removePerson(i)}
                      className="rounded-md border px-2 py-1 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {/* Participant-level Mode & Access */}
                {modeLevel === "PARTICIPANT" && (
                  <div className="mt-2">
                    <ModeAccessControl
                      scope="PARTICIPANT"
                      modes={modes}
                      presets={presets}
                      initial={{ usePresets: true }}
                      disabled={false}
                      onChange={(state, derived, errors) =>
                        onParticipantMAChange(p.userId, state, derived, errors)
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Footer buttons (duplicated for long forms) */}
      <div className="mt-6 flex items-center justify-end gap-2">
        <UIButton
          type="button"
          onClick={() => {
            if (dirty) {
              setPendingHref("/modules/booking/view");
              setLeaveOpen(true);
              return;
            }
            router.push("/modules/booking/view");
          }}
          className="rounded-md border px-4 py-2"
        >
          Cancel
        </UIButton>
        <UIButton
          type="submit"
          disabled={!formValid || submitting || blocked}
          className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create booking"}
        </UIButton>
      </div>

      {/* Errors */}
      {error && (
        <div className="mt-3">
          <UIAlert severity="error">{error}</UIAlert>
        </div>
      )}

      {/* Unsaved changes modal */}
      {leaveOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-lg font-semibold">Unsaved changes</h3>
            <p className="mt-1 text-sm text-gray-600">
              You have unsaved changes. What would you like to do?
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setLeaveOpen(false)}
                className="rounded-md border px-4 py-2"
              >
                Stay
              </button>
              <button
                type="button"
                onClick={leaveDiscard}
                className="rounded-md border px-4 py-2"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={leaveViaSave}
                disabled={!formValid || leaveBusy}
                className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50"
              >
                {leaveBusy ? "Saving…" : "Save & leave"}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
