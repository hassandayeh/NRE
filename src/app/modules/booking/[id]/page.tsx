"use client";

/**
 * Booking View (read-only)
 *
 * What’s new (no regressions):
 * - Prefer Hosts from /api/bookings/:id/participants (role=HOST), no “primary” host.
 * - If participants are unavailable/disabled, fall back to your existing hosts model.
 * - If neither exists, fall back to legacy single-host summary (hostUserId/hostName).
 * - Guests, booking defaults, and notes behavior preserved as before.
 *
 * Flags:
 * - NEXT_PUBLIC_MULTI_PARTICIPANTS_ENABLED (default: true) → use participants for Hosts.
 * - NEXT_PUBLIC_FEATURE_MULTI_HOSTS (respected as legacy fallback)
 * - NEXT_PUBLIC_APPEARANCE_PHONE (default: true)
 */

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

/* --- Feature flags --- */
const PHONE_ENABLED =
  (process.env.NEXT_PUBLIC_APPEARANCE_PHONE ?? "true") !== "false";
const MULTI_PARTICIPANTS_ENABLED =
  (process.env.NEXT_PUBLIC_MULTI_PARTICIPANTS_ENABLED ?? "true") !== "false";
/** Legacy flag — kept for fallback only (no regressions) */
const MULTI_HOSTS_ENABLED =
  (process.env.NEXT_PUBLIC_FEATURE_MULTI_HOSTS ?? "false") === "true";

/* --- Types (DTO aligned with API) --- */
type TAppearance = "ONLINE" | "IN_PERSON" | "PHONE";
type TScope = "UNIFIED" | "PER_GUEST";
type TProvisioning = "SHARED" | "PER_GUEST";

type THostScope = "UNIFIED" | "PER_HOST";
type THostProvisioning = "SHARED" | "PER_HOST";

type TKind = "EXPERT" | "REPORTER";

type GuestRow = {
  id?: string;
  userId?: string | null;
  name: string;
  kind: TKind;
  order: number;
  appearanceType: TAppearance;
  joinUrl?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  dialInfo?: string | null;
};

type HostRow = {
  id?: string;
  userId?: string | null;
  name: string;
  order: number;
  appearanceType: TAppearance;
  joinUrl?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  dialInfo?: string | null;
};

type BookingDto = {
  id: string;
  orgId?: string;

  subject: string;
  newsroomName: string;

  startAt: string;
  durationMins: number;

  // Guests model (existing)
  appearanceScope: TScope;
  accessProvisioning: TProvisioning;
  appearanceType: TAppearance | null; // UNIFIED default

  // UNIFIED defaults (guests)
  locationUrl?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  dialInfo?: string | null;

  // Extras
  programName?: string | null;
  talkingPoints?: string | null;

  // Legacy mirrors
  hostUserId?: string | null;
  hostName?: string | null;
  expertUserId?: string | null;
  expertName?: string | null;

  // Hosts model (legacy multi-hosts fallback)
  hostAppearanceScope?: THostScope;
  hostAccessProvisioning?: THostProvisioning;
  hostAppearanceType?: TAppearance | null; // when UNIFIED
  hostLocationUrl?: string | null;
  hostLocationName?: string | null;
  hostLocationAddress?: string | null;
  hostDialInfo?: string | null;
  hosts?: HostRow[];

  guests?: GuestRow[];
};

type Note = {
  id: string;
  bookingId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

/* --- Participants DTO (HOST only used here) --- */
type Role = "HOST" | "EXPERT" | "REPORTER" | "INTERPRETER";
type ParticipantDTO = {
  id: string;
  userId: string | null;
  roleInBooking: Role;
  user?: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null;
};

/* --- Small helpers --- */
function fmtDateRange(startISO: string, durationMins: number) {
  const start = new Date(startISO);
  const end = new Date(start.getTime() + durationMins * 60_000);
  const sameDay = start.toDateString() === end.toDateString();
  const d = (x: Date) =>
    x.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const t = (x: Date) =>
    x.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `${d(start)} — ${t(end)}` : `${d(start)} → ${d(end)}`;
}
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function ExternalLink(props: { href: string; children: React.ReactNode }) {
  const { href, children } = props;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
    >
      {children}
    </a>
  );
}

/* Minimal inline UI primitives */
function ButtonLike(props: React.ComponentProps<"button">) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center rounded-md border px-3 py-1.5 text-sm",
        "bg-black text-white hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-black",
        className,
      ].join(" ")}
    />
  );
}
function AlertBox(props: {
  children: React.ReactNode;
  variant?: "error" | "success";
}) {
  const { children, variant = "error" } = props;
  const styles =
    variant === "success"
      ? "border-green-200 bg-green-50 text-green-800"
      : "border-red-200 bg-red-50 text-red-800";
  return (
    <div className={`mb-2 rounded-md border p-2 text-sm ${styles}`}>
      {children}
    </div>
  );
}

/* Effective value for a guest when provisioning is SHARED (fallback to defaults) */
function effectiveForGuest(
  g: GuestRow,
  b: BookingDto
): {
  kind: "ONLINE" | "IN_PERSON" | "PHONE";
  value: string | null;
  usedFallback: boolean;
} {
  if (g.appearanceType === "ONLINE") {
    const own = g.joinUrl || null;
    const def =
      b.appearanceScope === "UNIFIED" && b.accessProvisioning === "SHARED"
        ? b.locationUrl || null
        : null;
    return { kind: "ONLINE", value: own ?? def, usedFallback: !own && !!def };
  }
  if (g.appearanceType === "IN_PERSON") {
    const own =
      [g.venueName, g.venueAddress].filter(Boolean).join(" · ") || null;
    const def =
      b.appearanceScope === "UNIFIED" && b.accessProvisioning === "SHARED"
        ? [b.locationName, b.locationAddress].filter(Boolean).join(" · ") ||
          null
        : null;
    return {
      kind: "IN_PERSON",
      value: own ?? def,
      usedFallback: !own && !!def,
    };
  }
  // PHONE
  const own = g.dialInfo || null;
  const def =
    b.appearanceScope === "UNIFIED" && b.accessProvisioning === "SHARED"
      ? b.dialInfo || null
      : null;
  return { kind: "PHONE", value: own ?? def, usedFallback: !own && !!def };
}

/* Effective value for a host given hosts model and defaults */
function effectiveForHost(
  h: HostRow,
  b: BookingDto
): {
  kind: "ONLINE" | "IN_PERSON" | "PHONE";
  value: string | null;
  usedFallback: boolean;
} {
  const hostScope = b.hostAppearanceScope ?? "UNIFIED";
  const hostProv = b.hostAccessProvisioning ?? "SHARED";
  const unifiedType = (b.hostAppearanceType ?? "ONLINE") as TAppearance;
  const type = hostScope === "UNIFIED" ? unifiedType : h.appearanceType;

  if (type === "ONLINE") {
    const own = h.joinUrl || null;
    const def =
      hostScope === "UNIFIED" && hostProv === "SHARED"
        ? b.hostLocationUrl || null
        : null;
    return { kind: "ONLINE", value: own ?? def, usedFallback: !own && !!def };
  }
  if (type === "IN_PERSON") {
    const own =
      [h.venueName, h.venueAddress].filter(Boolean).join(" · ") || null;
    const def =
      hostScope === "UNIFIED" && hostProv === "SHARED"
        ? [b.hostLocationName, b.hostLocationAddress]
            .filter(Boolean)
            .join(" · ") || null
        : null;
    return {
      kind: "IN_PERSON",
      value: own ?? def,
      usedFallback: !own && !!def,
    };
  }
  // PHONE
  const own = h.dialInfo || null;
  const def =
    hostScope === "UNIFIED" && hostProv === "SHARED"
      ? b.hostDialInfo || null
      : null;
  return { kind: "PHONE", value: own ?? def, usedFallback: !own && !!def };
}

/* --- Page --- */
export default function BookingViewPage() {
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [booking, setBooking] = React.useState<BookingDto | null>(null);
  const [canEdit, setCanEdit] = React.useState(false);

  // Participants (HOSTS only used here)
  const [participantsHosts, setParticipantsHosts] = React.useState<
    ParticipantDTO[]
  >([]);
  const [participantsReady, setParticipantsReady] = React.useState(false);

  // Notes (guest privacy is enforced server-side; we handle 403 quietly)
  const [notesLoading, setNotesLoading] = React.useState(true);
  const [notes, setNotes] = React.useState<Note[]>([]);
  const [noteBody, setNoteBody] = React.useState("");
  const [noteMsg, setNoteMsg] = React.useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [posting, setPosting] = React.useState(false);

  // Load booking
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/bookings/${id}`, {
          credentials: "include",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || "Failed to load booking");

        const b: BookingDto = j?.booking ?? j;

        // Sort guests/hosts by order for display parity
        b.guests = (b.guests || [])
          .slice()
          .sort((a, z) => (a.order ?? 0) - (z.order ?? 0));
        b.hosts = (b.hosts || [])
          .slice()
          .sort((a, z) => (a.order ?? 0) - (z.order ?? 0));

        // Phone flag safety
        if (!PHONE_ENABLED && b.appearanceType === "PHONE")
          b.appearanceType = "ONLINE";
        if (!PHONE_ENABLED && b.hostAppearanceType === "PHONE")
          b.hostAppearanceType = "ONLINE";

        if (alive) {
          setBooking(b);
          setCanEdit(!!j?.canEdit);
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

  // Load participants (HOSTS), preferring normalized participants if enabled
  React.useEffect(() => {
    if (!MULTI_PARTICIPANTS_ENABLED) {
      setParticipantsReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/bookings/${id}/participants`, {
          credentials: "include",
          cache: "no-store",
        });
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && Array.isArray(j?.participants)) {
          const hosts = (j.participants as ParticipantDTO[]).filter(
            (p) => p.roleInBooking === "HOST"
          );
          setParticipantsHosts(hosts);
        } else {
          setParticipantsHosts([]);
        }
      } catch {
        setParticipantsHosts([]);
      } finally {
        if (!cancelled) setParticipantsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Load notes (expert-safe handling)
  React.useEffect(() => {
    let cancelled = false;
    async function loadNotes() {
      setNotesLoading(true);
      setNoteMsg(null);
      try {
        const res = await fetch(`/api/bookings/${id}/notes`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && json?.ok) {
          setNotes(json.notes || []);
        } else if (res.status === 403) {
          // Some viewers (e.g., expert) can't read newsroom notes; fail silent.
          setNotes([]);
        } else {
          setNotes([]);
          setNoteMsg({
            tone: "error",
            text: json?.error || "Failed to load notes.",
          });
        }
      } catch {
        if (cancelled) return;
        setNoteMsg({
          tone: "error",
          text: "Network error while loading notes.",
        });
      } finally {
        if (!cancelled) setNotesLoading(false);
      }
    }
    if (id) loadNotes();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function postNote() {
    setPosting(true);
    setNoteMsg(null);
    try {
      const body = (noteBody || "").trim();
      if (!body) {
        setNoteMsg({ tone: "error", text: "Write something first." });
        setPosting(false);
        return;
      }
      const res = await fetch(`/api/bookings/${id}/notes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setNoteMsg({
          tone: "error",
          text:
            json?.error ||
            (res.status === 401
              ? "Please sign in."
              : res.status === 403
              ? "You don’t have permission to add notes."
              : "Failed to add note."),
        });
      } else {
        setNotes((prev) => [...prev, json.note]);
        setNoteBody("");
        setNoteMsg({ tone: "success", text: "Note added." });
      }
    } catch {
      setNoteMsg({ tone: "error", text: "Network error while posting note." });
    } finally {
      setPosting(false);
    }
  }

  if (loading) return <div className="p-4 text-sm text-gray-600">Loading…</div>;
  if (error || !booking) {
    return (
      <div className="p-4 text-sm text-red-700">{error || "Not found"}</div>
    );
  }

  const b = booking;

  // Build a view list for Hosts:
  // If participants HOSTs are available, map them to display rows.
  // Use per-host details from legacy hosts[] when present (match by userId).
  const participantHostRows =
    MULTI_PARTICIPANTS_ENABLED &&
    participantsReady &&
    participantsHosts.length > 0
      ? participantsHosts.map((p, i) => {
          const byUser = (b.hosts || []).find(
            (h) => String(h.userId ?? "") === String(p.userId ?? "")
          );
          const hRow: HostRow =
            byUser ??
            ({
              userId: p.userId ?? undefined,
              name: p.user?.name || "Host",
              order: i,
              // When not found, we fallback to unified host type; access shown via defaults
              appearanceType: (b.hostAppearanceType ?? "ONLINE") as TAppearance,
              joinUrl: null,
              venueName: null,
              venueAddress: null,
              dialInfo: null,
            } as HostRow);
          return { p, hRow };
        })
      : [];

  return (
    <div className="mx-auto max-w-4xl p-4">
      {/* Title */}
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">{b.subject}</h1>
        <div className="text-sm text-gray-600">{b.newsroomName}</div>
        <div className="text-sm text-gray-600">
          {fmtDateRange(b.startAt, b.durationMins)}
        </div>
        {canEdit && (
          <div className="mt-2 flex gap-2">
            <Link
              href={`/modules/booking/${b.id}/edit`}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Edit
            </Link>
            <Link
              href={`/modules/booking/new`}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              New booking
            </Link>
          </div>
        )}
      </div>

      {/* Hosts */}
      <section className="mb-6 rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-medium">Hosts</h2>

        {/* Preferred: participants HOSTs */}
        {participantHostRows.length > 0 ? (
          <div className="flex flex-col gap-3">
            {participantHostRows.map(({ p, hRow }, idx) => {
              const eff = effectiveForHost(hRow, b);
              const scope = b.hostAppearanceScope ?? "UNIFIED";
              const typeLabel =
                scope === "UNIFIED"
                  ? b.hostAppearanceType ?? "ONLINE"
                  : hRow.appearanceType;
              return (
                <div key={p.id} className="rounded-md border p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                      #{idx + 1}
                    </span>
                    <span className="font-medium">
                      {hRow.name || p.user?.name || "Host"}
                    </span>
                    {p.userId && (
                      <span className="text-xs text-gray-500">
                        ({p.userId})
                      </span>
                    )}
                    <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
                      {typeLabel}
                    </span>
                  </div>

                  {/* Appearance-specific effective detail */}
                  {eff.kind === "ONLINE" && (
                    <div className="text-sm">
                      Join:{" "}
                      {eff.value ? (
                        <ExternalLink href={eff.value}>Open link</ExternalLink>
                      ) : (
                        "—"
                      )}{" "}
                      {eff.usedFallback && (
                        <span className="text-xs text-gray-600">
                          (using booking defaults)
                        </span>
                      )}
                    </div>
                  )}
                  {eff.kind === "IN_PERSON" && (
                    <div className="text-sm">
                      Venue/address: {eff.value || "—"}{" "}
                      {eff.usedFallback && (
                        <span className="text-xs text-gray-600">
                          (using booking defaults)
                        </span>
                      )}
                    </div>
                  )}
                  {PHONE_ENABLED && eff.kind === "PHONE" && (
                    <div className="text-sm">
                      Dial info: {eff.value || "—"}{" "}
                      {eff.usedFallback && (
                        <span className="text-xs text-gray-600">
                          (using booking defaults)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          // Fallback: original multi-hosts section (respects legacy flag)
          <>
            {MULTI_HOSTS_ENABLED && (b.hosts?.length ?? 0) > 0 ? (
              <>
                <div className="flex flex-col gap-3">
                  {(b.hosts || []).map((h, idx) => {
                    const eff = effectiveForHost(h, b);
                    const scope = b.hostAppearanceScope ?? "UNIFIED";
                    const typeLabel =
                      scope === "UNIFIED"
                        ? b.hostAppearanceType ?? "ONLINE"
                        : h.appearanceType;
                    return (
                      <div
                        key={h.id || `${h.userId}-${idx}`}
                        className="rounded-md border p-3"
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                            #{idx + 1}
                          </span>
                          <span className="font-medium">
                            {h.name || "Host"}
                          </span>
                          {h.userId && (
                            <span className="text-xs text-gray-500">
                              ({h.userId})
                            </span>
                          )}
                          <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
                            {typeLabel}
                          </span>
                        </div>

                        {eff.kind === "ONLINE" && (
                          <div className="text-sm">
                            Join:{" "}
                            {eff.value ? (
                              <ExternalLink href={eff.value}>
                                Open link
                              </ExternalLink>
                            ) : (
                              "—"
                            )}{" "}
                            {eff.usedFallback && (
                              <span className="text-xs text-gray-600">
                                (using booking defaults)
                              </span>
                            )}
                          </div>
                        )}
                        {eff.kind === "IN_PERSON" && (
                          <div className="text-sm">
                            Venue/address: {eff.value || "—"}{" "}
                            {eff.usedFallback && (
                              <span className="text-xs text-gray-600">
                                (using booking defaults)
                              </span>
                            )}
                          </div>
                        )}
                        {PHONE_ENABLED && eff.kind === "PHONE" && (
                          <div className="text-sm">
                            Dial info: {eff.value || "—"}{" "}
                            {eff.usedFallback && (
                              <span className="text-xs text-gray-600">
                                (using booking defaults)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Legacy single-host summary for parity */}
                <div className="mt-3 rounded-md border p-3 text-sm text-gray-700">
                  <div className="font-medium">Legacy host summary</div>
                  {b.hostUserId ? (
                    <div>
                      {b.hostName || "Host"} ({b.hostUserId})
                    </div>
                  ) : (
                    <div>None</div>
                  )}
                </div>
              </>
            ) : (
              /* Final fallback: legacy single-host section (unchanged) */
              <div className="text-sm text-gray-700">
                {b.hostUserId ? (
                  <div>
                    <div className="font-medium">{b.hostName || "Host"}</div>
                    <div className="text-xs text-gray-500">{b.hostUserId}</div>
                  </div>
                ) : (
                  <div>None</div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Booking defaults (Guests UNIFIED) */}
      {b.appearanceScope === "UNIFIED" && (
        <section className="mb-6 rounded-lg border p-4">
          <h2 className="mb-2 text-lg font-medium">
            Booking defaults (guests)
          </h2>
          <div className="text-sm">
            <div className="mb-1">Type: {b.appearanceType ?? "ONLINE"}</div>
            {(b.appearanceType ?? "ONLINE") === "ONLINE" && (
              <div>
                {b.locationUrl ? (
                  <>
                    Join link:{" "}
                    <ExternalLink href={b.locationUrl}>Open link</ExternalLink>
                  </>
                ) : (
                  "No link provided."
                )}
              </div>
            )}
            {(b.appearanceType ?? "ONLINE") === "IN_PERSON" && (
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                <div>Venue: {b.locationName || "—"}</div>
                <div>Address: {b.locationAddress || "—"}</div>
              </div>
            )}
            {PHONE_ENABLED && (b.appearanceType ?? "ONLINE") === "PHONE" && (
              <div>Dial info: {b.dialInfo || "—"}</div>
            )}
          </div>
        </section>
      )}

      {/* Guests */}
      <section className="mb-6 rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-medium">Guests</h2>
        {(!b.guests || b.guests.length === 0) && (
          <div className="text-sm text-gray-700">None added.</div>
        )}
        <div className="flex flex-col gap-3">
          {(b.guests || []).map((g, idx) => {
            const eff = effectiveForGuest(g, b);
            return (
              <div
                key={g.id || `${g.userId}-${idx}`}
                className="rounded-md border p-3"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                    #{idx + 1}
                  </span>
                  <span className="font-medium">{g.name}</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
                    {g.kind}
                  </span>
                  <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
                    {g.appearanceType}
                  </span>
                </div>

                {g.userId && (
                  <div className="text-xs text-gray-500">User: {g.userId}</div>
                )}

                {/* Appearance-specific detail (effective) */}
                {eff.kind === "ONLINE" && (
                  <div className="text-sm">
                    Join:{" "}
                    {eff.value ? (
                      <ExternalLink href={eff.value}>Open link</ExternalLink>
                    ) : (
                      "—"
                    )}{" "}
                    {eff.usedFallback && (
                      <span className="text-xs text-gray-600">
                        (using default)
                      </span>
                    )}
                  </div>
                )}
                {eff.kind === "IN_PERSON" && (
                  <div className="text-sm">
                    Venue/address: {eff.value || "—"}{" "}
                    {eff.usedFallback && (
                      <span className="text-xs text-gray-600">
                        (using default)
                      </span>
                    )}
                  </div>
                )}
                {PHONE_ENABLED && eff.kind === "PHONE" && (
                  <div className="text-sm">
                    Dial info: {eff.value || "—"}{" "}
                    {eff.usedFallback && (
                      <span className="text-xs text-gray-600">
                        (using default)
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Additional details */}
      {(b.programName || b.talkingPoints) && (
        <section className="mb-6 rounded-lg border p-4">
          <h2 className="mb-2 text-lg font-medium">Additional details</h2>
          <div className="text-sm">
            {b.programName && <div>Program: {b.programName}</div>}
            {b.talkingPoints && (
              <div className="mt-2">
                <div className="mb-1 font-medium">Talking points:</div>
                <div className="whitespace-pre-wrap">{b.talkingPoints}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Notes (server enforces who sees what; guests can post and only see their own) */}
      <section className="mb-6 rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-medium">Notes</h2>
        {noteMsg && <AlertBox variant={noteMsg.tone}>{noteMsg.text}</AlertBox>}

        {notesLoading ? (
          <div className="text-sm text-gray-600">Loading notes…</div>
        ) : notes.length === 0 ? (
          <div className="text-sm text-gray-700">No notes yet.</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border p-2">
                <div className="mb-1 text-xs text-gray-600">
                  <span className="font-medium">{n.authorName}</span> •{" "}
                  {fmtDate(n.createdAt)}
                </div>
                <div className="whitespace-pre-wrap text-sm">{n.body}</div>
              </li>
            ))}
          </ul>
        )}

        {/* Composer (all roles may post; server enforces visibility & perms) */}
        <div className="mt-2">
          <textarea
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            placeholder="Add a note for this booking..."
            className="h-24 w-full rounded-md border p-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
          <div className="mt-2">
            <ButtonLike
              type="button"
              onClick={postNote}
              disabled={posting}
              aria-label="Post note"
            >
              {posting ? "Posting…" : "Post note"}
            </ButtonLike>
          </div>
        </div>
      </section>
    </div>
  );
}
