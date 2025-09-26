"use client";

/**
 * Booking View
 * - Displays all booking fields WITHOUT regressions
 * - UNIFIED defaults: ONLINE (join) | IN_PERSON (venue) | PHONE (dial)
 * - PER_GUEST: appearance-specific detail with SHARED fallbacks
 * - Host is first-class (user) or "None"
 * - Notes thread restored (GET/POST /api/bookings/[id]/notes)
 * - Edit & New buttons are shown only when canEdit === true
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
  orgId?: string;
  subject: string;
  newsroomName: string;
  startAt: string;
  durationMins: number;

  appearanceScope: TScope;
  accessProvisioning: TProvisioning;
  appearanceType: TAppearance | null; // UNIFIED default

  // UNIFIED defaults
  locationUrl?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  dialInfo?: string | null;

  // extras
  programName?: string | null;
  talkingPoints?: string | null;

  // host (first-class + legacy mirror)
  hostUserId?: string | null;
  hostName?: string | null;

  // legacy mirrors (still present)
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
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:opacity-80"
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
      className={
        "inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 " +
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
    <div role="status" className={`rounded-md border p-2 text-sm ${styles}`}>
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

/* --- Page --- */
export default function BookingViewPage() {
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [booking, setBooking] = React.useState<BookingDto | null>(null);
  const [canEdit, setCanEdit] = React.useState(false);

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

  if (loading)
    return (
      <div className="p-4 text-sm text-gray-600" aria-busy="true">
        Loading…
      </div>
    );

  if (error || !booking) {
    return (
      <div className="space-y-2 p-4">
        <AlertBox>{error || "Not found"}</AlertBox>
      </div>
    );
  }

  const b = booking;

  return (
    <div className="space-y-8 p-4">
      {/* Title */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{b.subject}</h1>
          <div className="text-sm text-gray-600">{b.newsroomName}</div>
          <div className="text-sm text-gray-600">
            {fmtDateRange(b.startAt, b.durationMins)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <Link
                href={`/modules/booking/${b.id}/edit`}
                className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Edit
              </Link>
              <Link
                href="/modules/booking/new"
                className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                New booking
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Host */}
      <section className="space-y-2 rounded-md border p-3">
        <div className="text-sm font-semibold">Host</div>
        {b.hostUserId ? (
          <div className="text-sm">
            <div className="font-medium">{b.hostName || "Host"}</div>
            <div className="text-xs text-gray-500">{b.hostUserId}</div>
          </div>
        ) : (
          <div className="text-sm text-gray-600">None</div>
        )}
      </section>

      {/* Booking defaults (UNIFIED) */}
      {b.appearanceScope === "UNIFIED" && (
        <section className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Booking defaults</div>
            <div className="text-xs uppercase tracking-wide text-gray-600">
              {b.appearanceType ?? "ONLINE"}
            </div>
          </div>

          {(b.appearanceType ?? "ONLINE") === "ONLINE" && (
            <div className="text-sm">
              {b.locationUrl ? (
                <ExternalLink href={b.locationUrl}>Join link</ExternalLink>
              ) : (
                <span className="text-gray-600">No link provided.</span>
              )}
            </div>
          )}

          {(b.appearanceType ?? "ONLINE") === "IN_PERSON" && (
            <div className="space-y-1 text-sm">
              <div>
                <span className="font-medium">Venue:</span>{" "}
                {b.locationName || "—"}
              </div>
              <div>
                <span className="font-medium">Address:</span>{" "}
                {b.locationAddress || "—"}
              </div>
            </div>
          )}

          {PHONE_ENABLED && (b.appearanceType ?? "ONLINE") === "PHONE" && (
            <div className="text-sm">
              <span className="font-medium">Dial info:</span>{" "}
              {b.dialInfo || "—"}
            </div>
          )}
        </section>
      )}

      {/* Guests */}
      <section className="space-y-3 rounded-md border p-3">
        <div className="text-sm font-semibold">Guests</div>

        {(!b.guests || b.guests.length === 0) && (
          <div className="text-sm text-gray-600">None added.</div>
        )}

        {(b.guests || []).map((g, idx) => {
          const eff = effectiveForGuest(g, b);
          const tagClass =
            g.appearanceType === "ONLINE"
              ? "bg-blue-100 text-blue-800"
              : g.appearanceType === "IN_PERSON"
              ? "bg-amber-100 text-amber-800"
              : "bg-purple-100 text-purple-800";

          return (
            <div key={idx} className="space-y-1 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">
                  #{idx + 1} {g.name}{" "}
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                    {g.kind}
                  </span>
                </div>
                <span className={`rounded px-2 py-0.5 text-xs ${tagClass}`}>
                  {g.appearanceType}
                </span>
              </div>

              {g.userId && (
                <div className="text-xs text-gray-500">{g.userId}</div>
              )}

              {/* Appearance-specific detail (effective) */}
              {eff.kind === "ONLINE" && (
                <div className="text-sm">
                  <span className="font-medium">Join:</span>{" "}
                  {eff.value ? (
                    <ExternalLink href={eff.value}>Link</ExternalLink>
                  ) : (
                    "—"
                  )}
                  {eff.usedFallback && (
                    <span className="ml-2 text-xs text-gray-600">
                      (using default)
                    </span>
                  )}
                </div>
              )}

              {eff.kind === "IN_PERSON" && (
                <div className="text-sm">
                  <span className="font-medium">Venue/address:</span>{" "}
                  {eff.value || "—"}
                  {eff.usedFallback && (
                    <span className="ml-2 text-xs text-gray-600">
                      (using default)
                    </span>
                  )}
                </div>
              )}

              {PHONE_ENABLED && eff.kind === "PHONE" && (
                <div className="text-sm">
                  <span className="font-medium">Dial info:</span>{" "}
                  {eff.value || "—"}
                  {eff.usedFallback && (
                    <span className="ml-2 text-xs text-gray-600">
                      (using default)
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Additional details (program / talking points) */}
      {(b.programName || b.talkingPoints) && (
        <section className="space-y-2 rounded-md border p-3">
          <div className="text-sm font-semibold">Additional details</div>
          {b.programName && (
            <div className="text-sm">
              <span className="font-medium">Program:</span> {b.programName}
            </div>
          )}
          {b.talkingPoints && (
            <div className="space-y-1 text-sm">
              <div className="font-medium">Talking points:</div>
              <div className="whitespace-pre-wrap">{b.talkingPoints}</div>
            </div>
          )}
        </section>
      )}

      {/* Notes (restored) */}
      <section className="space-y-2 rounded-md border p-3">
        <div className="text-sm font-semibold">Notes</div>

        {noteMsg && (
          <AlertBox variant={noteMsg.tone === "success" ? "success" : "error"}>
            {noteMsg.text}
          </AlertBox>
        )}

        {notesLoading ? (
          <div className="text-sm text-gray-600">Loading notes…</div>
        ) : notes.length === 0 ? (
          <div className="text-sm text-gray-600">No notes yet.</div>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-md border p-2">
                <div className="text-xs text-gray-600">
                  <strong>{n.authorName}</strong> • {fmtDate(n.createdAt)}
                </div>
                <div className="whitespace-pre-wrap text-sm">{n.body}</div>
              </li>
            ))}
          </ul>
        )}

        {/* Composer (all roles may post; server enforces who sees what) */}
        <div>
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
