"use client";

/**
 * Booking View
 * - Displays all booking fields WITHOUT regressions
 * - UNIFIED defaults: ONLINE (join) | IN_PERSON (venue) | PHONE (dial)
 * - PER_GUEST: appearance-specific detail with SHARED fallbacks
 * - Host is first-class (user) or "None"
 * - ✨ Notes thread restored (GET/POST /api/bookings/[id]/notes)
 * - No external UI imports to avoid path issues
 */

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

/* --- Feature flag --- */
const PHONE_ENABLED =
  (process.env.NEXT_PUBLIC_APPEARANCE_PHONE ?? "true") !== "false";

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

type BookingDto = {
  id: string;
  subject: string;
  newsroomName: string;
  startAt: string;
  durationMins: number;

  appearanceScope: TScope;
  accessProvisioning: TProvisioning;
  appearanceType: TAppearance | null;

  // UNIFIED defaults
  locationUrl?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  dialInfo?: string | null;

  // extras
  programName?: string | null;
  talkingPoints?: string | null;

  // host (first-class)
  hostUserId?: string | null;
  hostName?: string | null;

  // legacy mirrors (ignored here but tolerated)
  expertUserId?: string | null;
  expertName?: string | null;

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
      rel="noreferrer noopener"
      className="text-blue-700 underline hover:text-blue-900"
    >
      {children}
    </a>
  );
}

/* Minimal inline UI primitives (no external deps) */
function ButtonLike(props: React.ComponentProps<"button">) {
  const { className = "", ...rest } = props;
  return (
    <button
      className={`inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-gray-50 ${className}`}
      {...rest}
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
  return <div className={`rounded-md border p-2 ${styles}`}>{children}</div>;
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

/* --- Page --- */
export default function BookingViewPage() {
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [booking, setBooking] = React.useState<BookingDto | null>(null);

  // Notes state (restored)
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
        b.guests = (b.guests || [])
          .slice()
          .sort((a, z) => (a.order ?? 0) - (z.order ?? 0));
        if (!PHONE_ENABLED && b.appearanceType === "PHONE")
          b.appearanceType = "ONLINE";
        if (alive) setBooking(b);
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

  // Load notes (restored, expert-safe handling)
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
          // Experts aren’t allowed to read newsroom/staff notes — show nothing (no red alert)
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

  if (loading) return <div className="p-4">Loading…</div>;
  if (error || !booking) {
    return (
      <div className="p-4">
        <AlertBox>{error || "Not found"}</AlertBox>
      </div>
    );
  }

  const b = booking;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      {/* Title */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{b.subject}</h1>
        </div>
        <Link href={`/modules/booking/${b.id}/edit`} className="shrink-0">
          <ButtonLike type="button">Edit</ButtonLike>
        </Link>
      </div>
      <div className="text-sm text-gray-600">{b.newsroomName}</div>
      <div className="text-sm">{fmtDateRange(b.startAt, b.durationMins)}</div>

      {/* Host */}
      <section className="rounded-md border p-4">
        <div className="font-medium">Host</div>
        {b.hostUserId ? (
          <div className="mt-2 text-sm">
            <span className="font-medium">{b.hostName || "Host"}</span>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {b.hostUserId}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-sm text-gray-600">None</div>
        )}
      </section>

      {/* Booking defaults (UNIFIED) */}
      {b.appearanceScope === "UNIFIED" && (
        <section className="rounded-md border p-4">
          <div className="font-medium">Booking defaults</div>
          <div className="mt-2 text-sm">
            <div>
              <span className="rounded border px-1 text-[10px]">
                {b.appearanceType ?? "ONLINE"}
              </span>
            </div>

            {(b.appearanceType ?? "ONLINE") === "ONLINE" && (
              <div className="mt-1">
                {b.locationUrl ? (
                  <ExternalLink href={b.locationUrl}>Join link</ExternalLink>
                ) : (
                  <em className="text-gray-600">No link provided.</em>
                )}
              </div>
            )}

            {(b.appearanceType ?? "ONLINE") === "IN_PERSON" && (
              <div className="mt-1 space-y-0.5">
                <div>
                  <span className="text-gray-500">Venue:</span>{" "}
                  {b.locationName || <em className="text-gray-600">—</em>}
                </div>
                <div>
                  <span className="text-gray-500">Address:</span>{" "}
                  {b.locationAddress || <em className="text-gray-600">—</em>}
                </div>
              </div>
            )}

            {PHONE_ENABLED && (b.appearanceType ?? "ONLINE") === "PHONE" && (
              <div className="mt-1">
                <span className="text-gray-500">Dial info:</span>{" "}
                {b.dialInfo || <em className="text-gray-600">—</em>}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Guests */}
      <section className="rounded-md border p-4">
        <div className="font-medium">Guests</div>
        {(!b.guests || b.guests.length === 0) && (
          <div className="mt-2 rounded-md border bg-gray-50 p-3 text-sm text-gray-600">
            None added.
          </div>
        )}

        <div className="mt-2 space-y-3">
          {(b.guests || []).map((g, idx) => {
            const eff = effectiveForGuest(g, b);
            const tagClass =
              g.appearanceType === "ONLINE"
                ? "bg-blue-100 text-blue-800"
                : g.appearanceType === "IN_PERSON"
                ? "bg-amber-100 text-amber-800"
                : "bg-purple-100 text-purple-800";

            return (
              <div
                key={g.id ?? `${g.userId}-${idx}`}
                className="rounded-md border p-3"
              >
                <div className="flex items-start justify-between">
                  <div className="text-sm font-medium">
                    #{idx + 1} {g.name}
                    <span className="ml-2 rounded px-1 text-[10px] border">
                      {g.kind}
                    </span>
                  </div>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${tagClass}`}
                  >
                    {g.appearanceType}
                  </span>
                </div>

                {g.userId && (
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    {g.userId}
                  </div>
                )}

                {/* Appearance-specific detail (effective) */}
                <div className="mt-2 text-sm">
                  {eff.kind === "ONLINE" && (
                    <div>
                      <span className="text-gray-500">Join:</span>{" "}
                      {eff.value ? (
                        <ExternalLink href={eff.value}>Link</ExternalLink>
                      ) : (
                        <em className="text-gray-600">—</em>
                      )}
                      {eff.usedFallback && (
                        <span className="ml-1 text-[11px] text-gray-500">
                          (using default)
                        </span>
                      )}
                    </div>
                  )}

                  {eff.kind === "IN_PERSON" && (
                    <div>
                      <span className="text-gray-500">Venue/address:</span>{" "}
                      {eff.value || <em className="text-gray-600">—</em>}
                      {eff.usedFallback && (
                        <span className="ml-1 text-[11px] text-gray-500">
                          (using default)
                        </span>
                      )}
                    </div>
                  )}

                  {PHONE_ENABLED && eff.kind === "PHONE" && (
                    <div>
                      <span className="text-gray-500">Dial info:</span>{" "}
                      {eff.value || <em className="text-gray-600">—</em>}
                      {eff.usedFallback && (
                        <span className="ml-1 text-[11px] text-gray-500">
                          (using default)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Additional details (program/talking points) */}
      {(b.programName || b.talkingPoints) && (
        <section className="rounded-md border p-4">
          <div className="font-medium">Additional details</div>
          {b.programName && (
            <div className="mt-2 text-sm">
              <span className="text-gray-500">Program:</span> {b.programName}
            </div>
          )}
          {b.talkingPoints && (
            <div className="mt-2 text-sm">
              <div className="text-gray-500">Talking points:</div>
              <div className="whitespace-pre-wrap">{b.talkingPoints}</div>
            </div>
          )}
        </section>
      )}

      {/* Notes (restored) */}
      <section className="rounded-md border p-4">
        <div className="font-medium">Notes</div>

        {noteMsg && (
          <div className="mt-2">
            <AlertBox variant={noteMsg.tone}>{noteMsg.text}</AlertBox>
          </div>
        )}

        {notesLoading ? (
          <div className="mt-2 text-sm text-gray-600">Loading notes…</div>
        ) : notes.length === 0 ? (
          <div className="mt-2 text-sm text-gray-600">No notes yet.</div>
        ) : (
          <ul className="mt-2 space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border p-2">
                <div className="text-sm">
                  <span className="font-medium">{n.authorName}</span>{" "}
                  <span className="text-gray-500">
                    • {fmtDate(n.createdAt)}
                  </span>
                </div>
                <div className="whitespace-pre-wrap text-sm">{n.body}</div>
              </li>
            ))}
          </ul>
        )}

        {/* Composer */}
        <div className="mt-3">
          <textarea
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            placeholder="Add a note for this booking..."
            className="h-24 w-full rounded-md border p-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
          <div className="mt-2">
            <ButtonLike type="button" onClick={postNote} disabled={posting}>
              {posting ? "Posting…" : "Post note"}
            </ButtonLike>
          </div>
        </div>
      </section>
    </div>
  );
}
