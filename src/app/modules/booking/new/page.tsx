// src/app/modules/booking/new/page.tsx
"use client";

/**
 * New Booking — People picker + Mode Level (Booking | Participant)
 *
 * Modes & Access (org-driven presets):
 * - Preset path: Mode (dropdown) → Label (dropdown) → Details (auto or dropdown)
 * - Custom path: "Use access presets" OFF → Mode becomes TEXTBOX; Label & Details are TEXTBOXES
 * - Sends copied values so bookings remain stable if org presets change later.
 *
 * Mode Level drives visibility:
 * - BOOKING      → one booking-level block (no per-participant blocks)
 * - PARTICIPANT  → per-participant blocks (hosts included); booking-level block hidden
 *
 * POST payload:
 * - modeLevel: "BOOKING" | "PARTICIPANT"
 * - If BOOKING: accessConfig: { mode:{slot,label?}, label, details, source }
 * - If PARTICIPANT: participantsAccess: Array<{ userId, accessConfig }>
 *
 * Note on custom Mode text: we send slot:-1 and label:"<text>" (source:"custom")
 * to keep API shape consistent without schema changes.
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
  source: "org" | "public";
  kind?: TKind | null;
  isHost: boolean;
  order: number;

  // Per-participant Mode & Access (only used when modeLevel === "PARTICIPANT")
  modeAccess?: PersonModeAccessState;
};

type ModeDto = { slot: number; active: boolean; label?: string | null };
type ModesApiResponse = {
  modes: ModeDto[];
  access: { key: string; label: string; presets?: string[] }[]; // parity only
};
type AccessPresetRow = {
  modeSlot: number;
  modeLabel: string | null;
  label: string; // e.g., Teams, Zoom, Street, Café
  details: string; // e.g., URL or address
};
type BookingAccessConfig = {
  mode: { slot: number; label?: string | null };
  label: string;
  details: string;
  source: "preset" | "custom";
};

type ModeLevel = "BOOKING" | "PARTICIPANT";

/* ---------- Per-participant Mode & Access state ---------- */
type PersonModeAccessState = {
  usePresets: boolean;

  // PRESET path
  selectedModeSlot: number | null;
  selectedModeLabel: string | null;
  labelOptions: string[];
  selectedLabel: string;
  detailsOptions: string[];
  selectedDetails: string;

  // CUSTOM path
  modeText: string; // free-text Mode when presets OFF
  customLabel: string;
  customDetails: string;
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

  // ---------- NEW: Mode Level ----------
  const [modeLevel, setModeLevel] = React.useState<ModeLevel>("BOOKING");
  const bookingLevelHidden = modeLevel !== "BOOKING";

  // ---------- Org Modes + Presets (booking-level & for seeding per-person) ----------
  const [modes, setModes] = React.useState<ModeDto[]>([]);
  const [presets, setPresets] = React.useState<AccessPresetRow[]>([]);

  // Booking-level state
  const [usePresets, setUsePresets] = React.useState(true);

  // PRESET path (booking-level)
  const [selectedModeSlot, setSelectedModeSlot] = React.useState<number | null>(
    null
  );
  const [selectedModeLabel, setSelectedModeLabel] = React.useState<
    string | null
  >(null);
  const [labelOptions, setLabelOptions] = React.useState<string[]>([]);
  const [selectedLabel, setSelectedLabel] = React.useState<string>("");
  const [detailsOptions, setDetailsOptions] = React.useState<string[]>([]);
  const [selectedDetails, setSelectedDetails] = React.useState<string>("");

  // CUSTOM path (booking-level)
  const [customModeText, setCustomModeText] = React.useState<string>("");
  const [customLabel, setCustomLabel] = React.useState<string>("");
  const [customDetails, setCustomDetails] = React.useState<string>("");

  // Load org modes
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
        const j: ModesApiResponse = await res.json();
        const active = (j?.modes ?? []).filter((m) => m.active);
        setModes(active);
        if (active.length === 1) {
          setSelectedModeSlot(active[0].slot);
          setSelectedModeLabel(active[0].label ?? null);
        }
      } catch {
        // silent; page remains usable
      }
    })();
  }, [session.kind, effectiveOrgId]);

  // Load presets
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
        if (!rows?.length) setUsePresets(false);
      } catch {
        setUsePresets(false);
      }
    })();
  }, [session.kind, effectiveOrgId]);

  // Booking-level: when Mode (dropdown) changes → recompute Label/Details options
  function handleModeChange(slotStr: string) {
    const s = Number(slotStr);
    if (Number.isNaN(s)) {
      setSelectedModeSlot(null);
      setSelectedModeLabel(null);
      setLabelOptions([]);
      setSelectedLabel("");
      setDetailsOptions([]);
      setSelectedDetails("");
      return;
    }
    const m = modes.find((x) => x.slot === s) || null;
    setSelectedModeSlot(s);
    setSelectedModeLabel(m?.label ?? null);

    const labels = Array.from(
      new Set(
        presets
          .filter((r) => r.modeSlot === s)
          .map((r) => r.label)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    setLabelOptions(labels);
    const autoLabel = labels.length === 1 ? labels[0] : "";
    setSelectedLabel(autoLabel);

    const details = Array.from(
      new Set(
        presets
          .filter(
            (r) =>
              r.modeSlot === s && (autoLabel ? r.label === autoLabel : true)
          )
          .map((r) => r.details)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
    setDetailsOptions(autoLabel ? details : []);
    setSelectedDetails(details.length === 1 ? details[0] : "");
  }

  function handleLabelChange(label: string) {
    setSelectedLabel(label);
    const s = selectedModeSlot;
    if (s == null) {
      setDetailsOptions([]);
      setSelectedDetails("");
      return;
    }
    const details = Array.from(
      new Set(
        presets
          .filter((r) => r.modeSlot === s && r.label === label)
          .map((r) => r.details)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
    setDetailsOptions(details);
    setSelectedDetails(details.length === 1 ? details[0] : "");
  }

  // Selected participants (helpers)
  function addPersonFromDirectory(row: DirectoryItem) {
    setPeople((xs) => {
      if (xs.some((p) => p.userId === row.id)) return xs;
      const base: SelectedPerson = {
        userId: row.id,
        name: row.name || (row.kind ? row.kind : "Person"),
        source: row.source,
        kind: row.kind ?? null,
        isHost: false, // default to Guest
        order: xs.length,
      };
      // Seed per-participant modeAccess if we’re in PARTICIPANT mode
      if (modeLevel === "PARTICIPANT") {
        base.modeAccess = seedPersonModeAccess();
      }
      return [...xs, base];
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
            }
          : p
      )
    );
  }
  function patchPerson(idx: number, patch: Partial<SelectedPerson>) {
    setPeople((xs) => xs.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function patchPersonMA(idx: number, patch: Partial<PersonModeAccessState>) {
    setPeople((xs) =>
      xs.map((p, i) =>
        i === idx
          ? {
              ...p,
              modeAccess: {
                ...(p.modeAccess ?? seedPersonModeAccess()),
                ...patch,
              },
            }
          : p
      )
    );
  }
  function seedPersonModeAccess(): PersonModeAccessState {
    // If org has zero presets, default to custom path
    const hasAnyPresets = (presets?.length ?? 0) > 0;
    return {
      usePresets: hasAnyPresets,
      selectedModeSlot: modes.length === 1 ? modes[0].slot : null,
      selectedModeLabel: modes.length === 1 ? modes[0].label ?? null : null,
      labelOptions: [],
      selectedLabel: "",
      detailsOptions: [],
      selectedDetails: "",
      modeText: "",
      customLabel: "",
      customDetails: "",
    };
  }

  // For PARTICIPANT mode, keep person.modeAccess seeded
  React.useEffect(() => {
    if (modeLevel !== "PARTICIPANT") return;
    setPeople((xs) =>
      xs.map((p) =>
        p.modeAccess ? p : { ...p, modeAccess: seedPersonModeAccess() }
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeLevel, presets.length, modes.length]);

  // Build booking-level accessConfig (or undefined)
  function buildBookingAccess(): BookingAccessConfig | undefined {
    if (bookingLevelHidden) return undefined;

    if (usePresets) {
      if (selectedModeSlot == null) return undefined;
      if (!selectedLabel) return undefined;

      const finalDetails =
        selectedDetails ||
        (detailsOptions.length === 1 ? detailsOptions[0] : "");
      if (!finalDetails) return undefined;

      return {
        mode: { slot: selectedModeSlot, label: selectedModeLabel ?? null },
        label: selectedLabel,
        details: finalDetails,
        source: "preset",
      };
    }

    // custom path
    const modeLabel = customModeText.trim();
    const lbl = customLabel.trim();
    const det = customDetails.trim();
    if (!modeLabel && !lbl && !det) return undefined; // nothing filled

    return {
      mode: { slot: -1, label: modeLabel || null },
      label: lbl,
      details: det,
      source: "custom",
    };
  }

  // Build per-participant access for PARTICIPANT mode
  function buildParticipantsAccess():
    | Array<{ userId: string; accessConfig: BookingAccessConfig }>
    | undefined {
    if (modeLevel !== "PARTICIPANT") return undefined;

    const out: Array<{ userId: string; accessConfig: BookingAccessConfig }> =
      [];
    for (const p of people) {
      const ma = p.modeAccess ?? seedPersonModeAccess();

      if (ma.usePresets) {
        if (ma.selectedModeSlot == null) continue;
        if (!ma.selectedLabel) continue;
        const det =
          ma.selectedDetails ||
          (ma.detailsOptions.length === 1 ? ma.detailsOptions[0] : "");
        if (!det) continue;

        out.push({
          userId: p.userId,
          accessConfig: {
            mode: {
              slot: ma.selectedModeSlot,
              label: ma.selectedModeLabel ?? null,
            },
            label: ma.selectedLabel,
            details: det,
            source: "preset",
          },
        });
      } else {
        const modeLbl = ma.modeText.trim();
        const lbl = ma.customLabel.trim();
        const det = ma.customDetails.trim();
        if (!modeLbl && !lbl && !det) continue;

        out.push({
          userId: p.userId,
          accessConfig: {
            mode: { slot: -1, label: modeLbl || null },
            label: lbl,
            details: det,
            source: "custom",
          },
        });
      }
    }
    return out;
  }

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

    const accessConfig = buildBookingAccess();
    const participantsAccess = buildParticipantsAccess();

    const payload: any = {
      subject: form.subject,
      newsroomName: form.newsroomName,
      programName: form.programName || undefined,
      talkingPoints: form.talkingPoints || undefined,
      startAt: new Date(form.startAt).toISOString(),
      durationMins: Number(form.durationMins),

      modeLevel,
      ...(modeLevel === "BOOKING" && accessConfig ? { accessConfig } : {}),
      ...(modeLevel === "PARTICIPANT" && participantsAccess
        ? { participantsAccess }
        : {}),
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

        {/* Mode Level + Booking-level Mode & Access (if applicable) */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Mode &amp; Access</h2>

          {/* Mode Level (single driver) */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium">Mode Level</label>
              <select
                value={modeLevel}
                onChange={(e) => setModeLevel(e.target.value as ModeLevel)}
                className="w-full rounded-md border px-3 py-2"
                disabled={blocked}
              >
                <option value="BOOKING">Booking</option>
                <option value="PARTICIPANT">Participant</option>
              </select>
            </div>
          </div>

          {/* Booking-level block (hidden for PARTICIPANT) */}
          {!bookingLevelHidden && (
            <div className="rounded-md border p-3 space-y-3">
              {/* Toggle: Use presets */}
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={usePresets}
                  onChange={(e) => setUsePresets(e.target.checked)}
                  disabled={blocked || presets.length === 0}
                />
                Use access presets
                {presets.length === 0 && (
                  <span className="text-xs text-gray-500">
                    (no presets found)
                  </span>
                )}
              </label>

              {usePresets ? (
                <>
                  {/* Mode (dropdown) */}
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Mode
                    </label>
                    <select
                      value={selectedModeSlot ?? ""}
                      onChange={(e) => handleModeChange(e.target.value)}
                      className="w-full rounded-md border px-3 py-2"
                      disabled={blocked || modes.length === 0}
                    >
                      <option value="" disabled>
                        {modes.length
                          ? "Select a mode…"
                          : "No active modes configured"}
                      </option>
                      {modes.map((m) => (
                        <option key={m.slot} value={m.slot}>
                          {m.label ?? `Mode ${m.slot}`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Label */}
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Label
                    </label>
                    <select
                      value={selectedLabel}
                      onChange={(e) => handleLabelChange(e.target.value)}
                      className="w-full rounded-md border px-3 py-2"
                      disabled={
                        blocked ||
                        selectedModeSlot == null ||
                        labelOptions.length === 0
                      }
                    >
                      <option value="" disabled>
                        {selectedModeSlot == null
                          ? "Select mode first"
                          : labelOptions.length
                          ? "Select a label…"
                          : "No labels for this mode"}
                      </option>
                      {labelOptions.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Details */}
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Details
                    </label>
                    {detailsOptions.length <= 1 ? (
                      <input
                        type="text"
                        readOnly
                        value={detailsOptions[0] ?? ""}
                        className="w-full cursor-not-allowed rounded-md border bg-gray-50 px-3 py-2"
                        placeholder={
                          selectedLabel
                            ? "Auto-filled from preset"
                            : "Select label"
                        }
                      />
                    ) : (
                      <select
                        value={selectedDetails}
                        onChange={(e) => setSelectedDetails(e.target.value)}
                        className="w-full rounded-md border px-3 py-2"
                        disabled={blocked}
                      >
                        <option value="" disabled>
                          Select details…
                        </option>
                        {detailsOptions.map((d, i) => (
                          <option key={`${d}-${i}`} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* CUSTOM: Mode textbox */}
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Mode
                    </label>
                    <input
                      value={customModeText}
                      onChange={(e) => setCustomModeText(e.target.value)}
                      className="w-full rounded-md border px-3 py-2"
                      placeholder="e.g., Online / In-person / Phone"
                      disabled={blocked}
                    />
                  </div>
                  {/* CUSTOM: Label & Details */}
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Label
                    </label>
                    <input
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      className="w-full rounded-md border px-3 py-2"
                      placeholder="e.g., Teams / HQ address"
                      disabled={blocked}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Details
                    </label>
                    <input
                      value={customDetails}
                      onChange={(e) => setCustomDetails(e.target.value)}
                      className="w-full rounded-md border px-3 py-2"
                      placeholder="https://… or address / info"
                      disabled={blocked}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* Participants */}
        <section className="space-y-2">
          <h2 className="text-lg font-medium">Participants</h2>

          <div className="mt-1 rounded-md border p-3">
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

                    {/* Per-participant Mode & Access (only when modeLevel=PARTICIPANT) */}
                    {modeLevel === "PARTICIPANT" && (
                      <div className="rounded-md border p-3 space-y-3 bg-gray-50">
                        {/* state pre-seeded via useEffect */}
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={p.modeAccess?.usePresets ?? false}
                            onChange={(e) =>
                              patchPersonMA(idx, {
                                usePresets: e.target.checked,
                              })
                            }
                            disabled={blocked || presets.length === 0}
                          />
                          Use access presets
                          {presets.length === 0 && (
                            <span className="text-xs text-gray-500">
                              (no presets found)
                            </span>
                          )}
                        </label>

                        {p.modeAccess?.usePresets ?? false ? (
                          <>
                            {/* Mode (dropdown) */}
                            <div>
                              <label className="mb-1 block text-sm font-medium">
                                Mode
                              </label>
                              <select
                                value={p.modeAccess?.selectedModeSlot ?? ""}
                                onChange={(e) => {
                                  const s = Number(e.target.value);
                                  if (Number.isNaN(s)) {
                                    patchPersonMA(idx, {
                                      selectedModeSlot: null,
                                      selectedModeLabel: null,
                                      labelOptions: [],
                                      selectedLabel: "",
                                      detailsOptions: [],
                                      selectedDetails: "",
                                    });
                                    return;
                                  }
                                  const m =
                                    modes.find((x) => x.slot === s) || null;
                                  const labels = Array.from(
                                    new Set(
                                      presets
                                        .filter((r) => r.modeSlot === s)
                                        .map((r) => r.label)
                                        .filter(Boolean)
                                    )
                                  ).sort((a, b) => a.localeCompare(b));
                                  const autoLabel =
                                    labels.length === 1 ? labels[0] : "";
                                  const details = Array.from(
                                    new Set(
                                      presets
                                        .filter(
                                          (r) =>
                                            r.modeSlot === s &&
                                            (autoLabel
                                              ? r.label === autoLabel
                                              : true)
                                        )
                                        .map((r) => r.details)
                                        .filter(Boolean)
                                    )
                                  ).sort((a, b) => a.localeCompare(b));
                                  patchPersonMA(idx, {
                                    selectedModeSlot: s,
                                    selectedModeLabel: m?.label ?? null,
                                    labelOptions: labels,
                                    selectedLabel: autoLabel,
                                    detailsOptions: autoLabel ? details : [],
                                    selectedDetails:
                                      details.length === 1 ? details[0] : "",
                                  });
                                }}
                                className="w-full rounded-md border px-3 py-2"
                                disabled={blocked || modes.length === 0}
                              >
                                <option value="" disabled>
                                  {modes.length
                                    ? "Select a mode…"
                                    : "No active modes configured"}
                                </option>
                                {modes.map((m) => (
                                  <option key={m.slot} value={m.slot}>
                                    {m.label ?? `Mode ${m.slot}`}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Label */}
                            <div>
                              <label className="mb-1 block text-sm font-medium">
                                Label
                              </label>
                              <select
                                value={p.modeAccess?.selectedLabel ?? ""}
                                onChange={(e) => {
                                  const label = e.target.value;
                                  const s =
                                    p.modeAccess?.selectedModeSlot ?? null;
                                  if (s == null) {
                                    patchPersonMA(idx, {
                                      detailsOptions: [],
                                      selectedDetails: "",
                                      selectedLabel: "",
                                    });
                                    return;
                                  }
                                  const details = Array.from(
                                    new Set(
                                      presets
                                        .filter(
                                          (r) =>
                                            r.modeSlot === s &&
                                            r.label === label
                                        )
                                        .map((r) => r.details)
                                        .filter(Boolean)
                                    )
                                  ).sort((a, b) => a.localeCompare(b));
                                  patchPersonMA(idx, {
                                    selectedLabel: label,
                                    detailsOptions: details,
                                    selectedDetails:
                                      details.length === 1 ? details[0] : "",
                                  });
                                }}
                                className="w-full rounded-md border px-3 py-2"
                                disabled={
                                  blocked ||
                                  p.modeAccess?.selectedModeSlot == null ||
                                  (p.modeAccess?.labelOptions.length ?? 0) === 0
                                }
                              >
                                <option value="" disabled>
                                  {p.modeAccess?.selectedModeSlot == null
                                    ? "Select mode first"
                                    : p.modeAccess?.labelOptions.length ?? 0
                                    ? "Select a label…"
                                    : "No labels for this mode"}
                                </option>
                                {(p.modeAccess?.labelOptions ?? []).map((l) => (
                                  <option key={l} value={l}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Details */}
                            <div>
                              <label className="mb-1 block text-sm font-medium">
                                Details
                              </label>
                              {(p.modeAccess?.detailsOptions.length ?? 0) <=
                              1 ? (
                                <input
                                  type="text"
                                  readOnly
                                  value={p.modeAccess?.detailsOptions[0] ?? ""}
                                  className="w-full cursor-not-allowed rounded-md border bg-gray-100 px-3 py-2"
                                  placeholder={
                                    p.modeAccess?.selectedLabel ?? ""
                                      ? "Auto-filled from preset"
                                      : "Select label"
                                  }
                                />
                              ) : (
                                <select
                                  value={p.modeAccess?.selectedDetails ?? ""}
                                  onChange={(e) =>
                                    patchPersonMA(idx, {
                                      selectedDetails: e.target.value,
                                    })
                                  }
                                  className="w-full rounded-md border px-3 py-2"
                                  disabled={blocked}
                                >
                                  <option value="" disabled>
                                    Select details…
                                  </option>
                                  {(p.modeAccess?.detailsOptions ?? []).map(
                                    (d, i) => (
                                      <option key={`${d}-${i}`} value={d}>
                                        {d}
                                      </option>
                                    )
                                  )}
                                </select>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            {/* CUSTOM: Mode textbox */}
                            <div>
                              <label className="mb-1 block text-sm font-medium">
                                Mode
                              </label>
                              <input
                                value={p.modeAccess?.modeText ?? ""}
                                onChange={(e) =>
                                  patchPersonMA(idx, {
                                    modeText: e.target.value,
                                  })
                                }
                                className="w-full rounded-md border px-3 py-2"
                                placeholder="e.g., Online / In-person / Phone"
                                disabled={blocked}
                              />
                            </div>
                            {/* CUSTOM: Label & Details */}
                            <div>
                              <label className="mb-1 block text-sm font-medium">
                                Label
                              </label>
                              <input
                                value={p.modeAccess?.customLabel ?? ""}
                                onChange={(e) =>
                                  patchPersonMA(idx, {
                                    customLabel: e.target.value,
                                  })
                                }
                                className="w-full rounded-md border px-3 py-2"
                                placeholder="e.g., Teams / HQ address"
                                disabled={blocked}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-sm font-medium">
                                Details
                              </label>
                              <input
                                value={p.modeAccess?.customDetails ?? ""}
                                onChange={(e) =>
                                  patchPersonMA(idx, {
                                    customDetails: e.target.value,
                                  })
                                }
                                className="w-full rounded-md border px-3 py-2"
                                placeholder="https://… or address / info"
                                disabled={blocked}
                              />
                            </div>
                          </>
                        )}
                      </div>
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
