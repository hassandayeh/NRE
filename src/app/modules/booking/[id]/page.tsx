"use client";

/**
 * Booking View (read-only) — flag-free, Vercel-friendly
 * - Hosts are derived from /api/bookings/:id/participants (role=HOST)
 * - No “primary host” and no legacy env flags
 * - Guests, defaults, and notes preserved
 */

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

/* --- Types (DTO aligned with API) --- */
type TAppearance = "ONLINE" | "IN_PERSON" | "PHONE";
type TScope = "UNIFIED" | "PER_GUEST";
type TProvisioning = "SHARED" | "PER_GUEST";

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

  // Legacy mirrors (kept only to print raw IDs if present; no flags)
  hostUserId?: string | null;
  hostName?: string | null;

  // Legacy multi-hosts structure (we won’t gate on it anymore)
  hostAppearanceScope?: "UNIFIED" | "PER_HOST";
  hostAccessProvisioning?: "SHARED" | "PER_HOST";
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
  inviteStatus?: string | null;
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
      className="underline underline-offset-2 hover:opacity-80"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}

function ButtonLike(props: React.ComponentProps<"button">) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={
        "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 " +
        className
      }
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
    <div className={`rounded-md border p-3 text-sm ${styles}`}>{children}</div>
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

/** ======================================================================
 * ParticipantsByRolePanel (read-only)
 * - Fetches /api/bookings/[id]/participants
 * - Renders sections from response.roles (NO hard-coded role names)
 * - No flags; hooks unconditionally called
 * ====================================================================== */
function ParticipantsByRolePanel({ bookingId }: { bookingId: string }) {
  type Participant = {
    id: string;
    userId: string | null;
    roleInBooking: string; // enum today; future: string/catalog
    inviteStatus?: string | null;
    user?: {
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
    } | null;
  };

  // ✅ Hooks are always called; no early returns
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [roles, setRoles] = React.useState<string[]>([]);
  const [grouped, setGrouped] = React.useState<Record<string, Participant[]>>(
    {}
  );

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/bookings/${bookingId}/participants`, {
          credentials: "include",
          cache: "no-store",
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || `Failed (${res.status})`);
        if (!alive) return;
        setRoles(Array.isArray(j.roles) ? j.roles : []);
        setGrouped(
          j.grouped && typeof j.grouped === "object"
            ? (j.grouped as Record<string, Participant[]>)
            : {}
        );
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load participants.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookingId]);

  return (
    <section className="mt-10 rounded-lg border p-4">
      <h2 className="mb-2 text-lg font-semibold">Participants (by role)</h2>
      <p className="mb-4 text-sm text-gray-600">
        Rendered dynamically from the API’s roles. No role names are hard-coded.
      </p>

      {loading && <div className="text-sm text-gray-600">Loading…</div>}

      {error && <AlertBox>{error}</AlertBox>}

      {!loading && !error && roles.length === 0 && (
        <div className="text-sm text-gray-600">No participants yet.</div>
      )}

      {!loading &&
        !error &&
        roles.map((role) => {
          const list = grouped?.[role] ?? [];
          return (
            <div key={role} className="mb-6">
              <h3 className="mb-2 font-medium">
                {role} ({list.length})
              </h3>

              {list.length === 0 ? (
                <div className="text-sm text-gray-600">
                  No entries for this role.
                </div>
              ) : (
                <ul className="space-y-1">
                  {list.map((p) => {
                    const name =
                      p?.user?.name ||
                      (p as any).name ||
                      p?.userId ||
                      "Unknown user";
                    const invite = (p?.inviteStatus || "").toString();
                    const pill =
                      invite === "CONFIRMED"
                        ? "bg-green-100 text-green-800"
                        : invite === "DECLINED" || invite === "CANCELLED"
                        ? "bg-red-100 text-red-800"
                        : invite
                        ? "bg-gray-100 text-gray-700"
                        : "";

                    return (
                      <li
                        key={p.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span>{name}</span>
                        {!!invite && (
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${pill}`}
                          >
                            {invite}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
    </section>
  );
}

/* --- Page --- */
export default function BookingViewPage() {
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [booking, setBooking] = React.useState<BookingDto | null>(null);
  const [canEdit, setCanEdit] = React.useState(false);

  // Participants (HOSTS only used in the "Hosts" section)
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

  // Load participants (HOSTS)
  React.useEffect(() => {
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

  if (loading) return <div className="p-6 text-sm text-gray-600">Loading…</div>;

  if (error || !booking) {
    return (
      <div className="p-6">
        <AlertBox>{error || "Not found"}</AlertBox>
      </div>
    );
  }

  const b = booking;

  // Build a view list for Hosts from participants HOSTs; if none, show "None"
  const participantHostRows =
    participantsReady && participantsHosts.length > 0
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
    <div className="mx-auto max-w-4xl p-6">
      {/* Title */}
      <section className="mb-4">
        <h1 className="text-2xl font-semibold">{b.subject}</h1>
        <div className="text-sm text-gray-600">{b.newsroomName}</div>
        <div className="text-sm text-gray-600">
          {fmtDateRange(b.startAt, b.durationMins)}
        </div>
        {canEdit && (
          <div className="mt-2 flex gap-2">
            <Link href={`/modules/booking/${b.id}/edit`} className="underline">
              Edit
            </Link>
            <Link href="/modules/booking/new" className="underline">
              New booking
            </Link>
          </div>
        )}
      </section>

      {/* Participants by role (always rendered; no flags) */}
      <ParticipantsByRolePanel bookingId={b.id} />

      {/* Hosts */}
      <section className="mt-6 rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-semibold">Hosts</h2>

        {/* Preferred: participants HOSTs */}
        {participantHostRows.length > 0 ? (
          <ul className="space-y-4">
            {participantHostRows.map(({ p, hRow }, idx) => {
              const eff = effectiveForHost(hRow, b);
              const scope = b.hostAppearanceScope ?? "UNIFIED";
              const typeLabel =
                scope === "UNIFIED"
                  ? b.hostAppearanceType ?? "ONLINE"
                  : hRow.appearanceType;
              return (
                <li key={p.id ?? idx} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">#{idx + 1}</span>
                    <span>{hRow.name || p.user?.name || "Host"}</span>
                    {p.userId && (
                      <span className="text-gray-500">({p.userId})</span>
                    )}
                    <span className="ml-auto rounded bg-gray-100 px-2 py-0.5 text-xs">
                      {typeLabel}
                    </span>
                  </div>

                  {/* Appearance-specific effective detail */}
                  {eff.kind === "ONLINE" && (
                    <div className="mt-1">
                      Join:{" "}
                      {eff.value ? (
                        <ExternalLink href={eff.value}>Open link</ExternalLink>
                      ) : (
                        "—"
                      )}{" "}
                      {eff.usedFallback && (
                        <span className="text-xs text-gray-500">
                          (using booking defaults)
                        </span>
                      )}
                    </div>
                  )}
                  {eff.kind === "IN_PERSON" && (
                    <div className="mt-1">
                      Venue/address: {eff.value || "—"}{" "}
                      {eff.usedFallback && (
                        <span className="text-xs text-gray-500">
                          (using booking defaults)
                        </span>
                      )}
                    </div>
                  )}
                  {eff.kind === "PHONE" && (
                    <div className="mt-1">
                      Dial info: {eff.value || "—"}{" "}
                      {eff.usedFallback && (
                        <span className="text-xs text-gray-500">
                          (using booking defaults)
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-sm text-gray-600">None</div>
        )}
      </section>

      {/* Booking defaults (Guests UNIFIED) */}
      {b.appearanceScope === "UNIFIED" && (
        <section className="mt-6 rounded-lg border p-4">
          <h2 className="mb-2 text-lg font-semibold">
            Booking defaults (guests)
          </h2>
          <div className="text-sm">Type: {b.appearanceType ?? "ONLINE"}</div>

          {(b.appearanceType ?? "ONLINE") === "ONLINE" && (
            <div className="mt-1 text-sm">
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
            <div className="mt-1 text-sm">
              <div>Venue: {b.locationName || "—"}</div>
              <div>Address: {b.locationAddress || "—"}</div>
            </div>
          )}

          {(b.appearanceType ?? "ONLINE") === "PHONE" && (
            <div className="mt-1 text-sm">Dial info: {b.dialInfo || "—"}</div>
          )}
        </section>
      )}

      {/* Guests */}
      <section className="mt-6 rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-semibold">Guests</h2>

        {(!b.guests || b.guests.length === 0) && (
          <div className="text-sm text-gray-600">None added.</div>
        )}

        {(b.guests || []).map((g, idx) => {
          const eff = effectiveForGuest(g, b);
          return (
            <div
              key={g.id ?? idx}
              className="mb-3 rounded-md border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">#{idx + 1}</span>
                <span>{g.name}</span>
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                  {g.kind}
                </span>
                <span className="ml-auto rounded bg-gray-100 px-2 py-0.5 text-xs">
                  {g.appearanceType}
                </span>
              </div>

              {g.userId && (
                <div className="mt-1 text-xs text-gray-600">
                  User: <span className="font-mono">{g.userId}</span>
                </div>
              )}

              {/* Appearance-specific detail (effective) */}
              {eff.kind === "ONLINE" && (
                <div className="mt-1">
                  Join:{" "}
                  {eff.value ? (
                    <ExternalLink href={eff.value}>Open link</ExternalLink>
                  ) : (
                    "—"
                  )}{" "}
                  {eff.usedFallback && (
                    <span className="text-xs text-gray-500">
                      (using default)
                    </span>
                  )}
                </div>
              )}
              {eff.kind === "IN_PERSON" && (
                <div className="mt-1">
                  Venue/address: {eff.value || "—"}{" "}
                  {eff.usedFallback && (
                    <span className="text-xs text-gray-500">
                      (using default)
                    </span>
                  )}
                </div>
              )}
              {eff.kind === "PHONE" && (
                <div className="mt-1">
                  Dial info: {eff.value || "—"}{" "}
                  {eff.usedFallback && (
                    <span className="text-xs text-gray-500">
                      (using default)
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Additional details */}
      {(b.programName || b.talkingPoints) && (
        <section className="mt-6 rounded-lg border p-4">
          <h2 className="mb-2 text-lg font-semibold">Additional details</h2>
          {b.programName && (
            <div className="text-sm">Program: {b.programName}</div>
          )}
          {b.talkingPoints && (
            <div className="mt-1 whitespace-pre-wrap text-sm">
              {b.talkingPoints}
            </div>
          )}
        </section>
      )}

      {/* Notes (server enforces who sees what; guests can post and only see their own) */}
      <section className="mt-6 rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-semibold">Notes</h2>

        {noteMsg && (
          <div className="mb-2">
            <AlertBox variant={noteMsg.tone}>{noteMsg.text}</AlertBox>
          </div>
        )}

        {notesLoading ? (
          <div className="text-sm text-gray-600">Loading notes…</div>
        ) : notes.length === 0 ? (
          <div className="text-sm text-gray-600">No notes yet.</div>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border p-2">
                <div className="text-xs text-gray-500">
                  {n.authorName} • {fmtDate(n.createdAt)}
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
