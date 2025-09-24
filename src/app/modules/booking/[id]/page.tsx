"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type AppearanceType = "ONLINE" | "IN_PERSON" | "PHONE";
type AppearanceScope = "UNIFIED" | "PER_GUEST";
type AccessProvisioning = "SHARED" | "PER_GUEST";
type ParticipantKind = "EXPERT" | "REPORTER";

type BookingGuest = {
  id: string;
  bookingId: string;
  userId: string | null;
  name: string;
  kind: ParticipantKind;
  order: number;
  appearanceType: AppearanceType;
  joinUrl: string | null;
  venueName: string | null;
  venueAddress: string | null;
  dialInfo: string | null;
};

type Booking = {
  id: string;
  subject: string;
  newsroomName: string;
  programName: string | null;
  hostName: string | null;
  talkingPoints: string | null;

  appearanceScope: AppearanceScope;
  appearanceType: AppearanceType | null;
  accessProvisioning: AccessProvisioning;

  startAt: string;
  durationMins: number;

  // Booking defaults
  locationUrl: string | null;
  locationName: string | null;
  locationAddress: string | null;
  dialInfo: string | null;

  expertUserId: string | null; // legacy mirror
  expertName: string; // legacy mirror
  orgId: string | null;

  guests: BookingGuest[];
};

type ApiGet =
  | { ok: true; booking: Booking; canEdit: boolean }
  | { ok: false; error: string };

type Note = {
  id: string;
  bookingId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type ApiNotesGet = { ok: true; notes: Note[] } | { ok: false; error: string };

type ApiNotePost = { ok: true; note: Note } | { ok: false; error: string };

function typeIcon(t: AppearanceType) {
  if (t === "ONLINE") return "☁️";
  if (t === "IN_PERSON") return "🏢";
  return "📞";
}

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function ViewBookingPage() {
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<number | null>(null);
  const [data, setData] = useState<ApiGet | null>(null);

  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [noteBody, setNoteBody] = useState("");
  const [noteMsg, setNoteMsg] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [posting, setPosting] = useState(false);

  const booking = data && data.ok ? data.booking : null;
  const canEdit = data && data.ok ? data.canEdit : false;

  // Load booking
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setStatus(null);
      setData(null);
      try {
        const res = await fetch(`/api/bookings/${id}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        if (cancelled) return;
        setStatus(res.status);
        const json = (await res.json()) as ApiGet;
        if (cancelled) return;
        setData(json);
      } catch {
        if (cancelled) return;
        setStatus(500);
        setData({ ok: false, error: "Network error" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (id) load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Load notes
  useEffect(() => {
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
        const json = (await res.json()) as ApiNotesGet;
        if (cancelled) return;
        if (res.ok && json.ok) {
          setNotes(json.notes);
        } else {
          setNotes([]);
          setNoteMsg({
            tone: "error",
            text: (json as any).error || "Failed to load notes.",
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
      const json = (await res.json()) as ApiNotePost;
      if (!res.ok || !json.ok) {
        setNoteMsg({
          tone: "error",
          text:
            (json as any).error ||
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

  const banner = useMemo(() => {
    if (loading) return null;
    if (!data || data.ok) return null;
    if (status === 401)
      return { tone: "error", text: "Unauthorized. Please sign in." };
    if (status === 403)
      return {
        tone: "error",
        text: "You don’t have permission to view this booking.",
      };
    if (status === 404) return { tone: "error", text: "Booking not found." };
    return {
      tone: "error",
      text: (data as any).error || "Server error. Please try again.",
    };
  }, [loading, data, status]);

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Booking</h1>
        <div className="flex gap-3">
          <Link href="/modules/booking" className="text-blue-600 underline">
            Back to bookings
          </Link>
          {booking && canEdit && (
            <Link
              href={`/modules/booking/${booking.id}/edit`}
              className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50"
            >
              Edit
            </Link>
          )}
        </div>
      </div>

      {banner && (
        <div
          className={`rounded-md border p-3 ${
            banner.tone === "error"
              ? "border-red-300 bg-red-50 text-red-800"
              : "border-blue-300 bg-blue-50 text-blue-800"
          }`}
        >
          {banner.text}
        </div>
      )}

      {booking && (
        <section className="space-y-4 rounded-lg border p-4 bg-white">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">{booking.subject}</h2>
            <p className="text-sm text-gray-600">
              <span className="font-medium">{fmtDate(booking.startAt)}</span> •{" "}
              {booking.durationMins}m
            </p>
            <p className="text-sm text-gray-600">
              Newsroom: <strong>{booking.newsroomName}</strong>
              {booking.programName ? (
                <>
                  {" "}
                  • Program: <strong>{booking.programName}</strong>
                </>
              ) : null}
              {booking.hostName ? (
                <>
                  {" "}
                  • Host: <strong>{booking.hostName}</strong>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-gray-100 px-2 py-1">
              Scope: <strong>{booking.appearanceScope}</strong>
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-1">
              Access: <strong>{booking.accessProvisioning}</strong>
            </span>
            {booking.appearanceScope === "UNIFIED" &&
              booking.appearanceType && (
                <span className="rounded-full bg-gray-100 px-2 py-1">
                  Unified type: <strong>{booking.appearanceType}</strong>
                </span>
              )}
          </div>

          <div className="text-sm text-gray-700 space-y-1">
            {booking.locationUrl && (
              <div>
                Default link:{" "}
                <a
                  href={booking.locationUrl}
                  className="text-blue-600 underline break-all"
                >
                  {booking.locationUrl}
                </a>
              </div>
            )}
            {(booking.locationName || booking.locationAddress) && (
              <div>
                Default venue:{" "}
                <span className="font-medium">{booking.locationName}</span>
                {booking.locationAddress ? (
                  <> — {booking.locationAddress}</>
                ) : null}
              </div>
            )}
            {booking.dialInfo && <div>Default dial: {booking.dialInfo}</div>}
          </div>

          <div className="space-y-2">
            <h3 className="font-medium">Guests</h3>
            <ul className="space-y-2">
              {booking.guests.map((g) => (
                <li
                  key={g.id}
                  className="flex items-start justify-between rounded border p-2"
                >
                  <div>
                    <div className="font-medium">
                      {typeIcon(g.appearanceType)} {g.name}{" "}
                      <span className="text-xs text-gray-500">
                        ({g.kind.toLowerCase()})
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {g.appearanceType === "ONLINE" &&
                        (g.joinUrl || booking.locationUrl) && (
                          <>
                            Link:{" "}
                            <a
                              href={g.joinUrl || booking.locationUrl || "#"}
                              className="text-blue-600 underline break-all"
                            >
                              {g.joinUrl || booking.locationUrl}
                            </a>
                          </>
                        )}
                      {g.appearanceType === "IN_PERSON" &&
                        (g.venueName ||
                          g.venueAddress ||
                          booking.locationName ||
                          booking.locationAddress) && (
                          <>
                            Venue:{" "}
                            <span className="font-medium">
                              {g.venueName || booking.locationName || ""}
                            </span>
                            {(g.venueAddress || booking.locationAddress) && (
                              <>
                                {" "}
                                — {g.venueAddress || booking.locationAddress}
                              </>
                            )}
                          </>
                        )}
                      {g.appearanceType === "PHONE" &&
                        (g.dialInfo || booking.dialInfo) && (
                          <>Dial: {g.dialInfo || booking.dialInfo}</>
                        )}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">#{g.order}</div>
                </li>
              ))}
            </ul>
          </div>

          {/* Notes */}
          <div className="pt-2">
            <div className="mb-2 text-sm font-medium">Notes</div>
            {notesLoading ? (
              <div className="rounded border bg-gray-50 p-3 text-gray-700">
                Loading notes…
              </div>
            ) : (
              <div className="space-y-2">
                {notes.length === 0 ? (
                  <div className="rounded border bg-gray-50 p-3 text-gray-600">
                    No notes yet.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {notes.map((n) => (
                      <li key={n.id} className="rounded border p-3">
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>By {n.authorName}</span>
                          <span>{fmtDate(n.createdAt)}</span>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-sm">
                          {n.body}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Composer (allowed roles will succeed; others get clear error) */}
            <div className="mt-3 space-y-2">
              {noteMsg && (
                <div
                  className={`rounded-md border p-2 text-sm ${
                    noteMsg.tone === "success"
                      ? "border-green-300 bg-green-50 text-green-800"
                      : "border-red-300 bg-red-50 text-red-800"
                  }`}
                >
                  {noteMsg.text}
                </div>
              )}
              <textarea
                className="w-full rounded border p-2"
                rows={3}
                placeholder="Add a note for this booking…"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
              />
              <div>
                <button
                  className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50"
                  onClick={postNote}
                  disabled={posting}
                >
                  {posting ? "Posting…" : "Post note"}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
