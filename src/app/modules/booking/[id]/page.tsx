// src/app/modules/booking/[id]/page.tsx
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

  // legacy mirrors
  expertUserId: string | null;
  expertName: string;

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
  if (t === "IN_PERSON") return "🏛️";
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

  const booking = data && "ok" in data && data.ok ? data.booking : null;
  const canEdit = data && "ok" in data && data.ok ? data.canEdit : false;

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
        } else if (res.status === 403) {
          // 👇 Change: Experts aren’t allowed to read newsroom/staff notes.
          // Treat as "no visible notes" instead of surfacing a red error.
          setNotes([]);
          // do NOT set noteMsg (hide the alert)
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
    if (!data || ("ok" in data && data.ok)) return null;
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
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4">
        <Link href="/modules/booking" className="text-blue-600 underline">
          Back to bookings
        </Link>
      </div>

      <h1 className="mb-4 text-2xl font-semibold">Booking</h1>

      {booking && canEdit && (
        <div className="mb-3">
          <Link
            href={`/modules/booking/${booking.id}/edit`}
            className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-black"
          >
            Edit
          </Link>
        </div>
      )}

      {banner && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {banner.text}
        </div>
      )}

      {booking && (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-lg font-medium">{booking.subject}</h2>

          <div className="mt-1 text-sm text-gray-700">
            <div>
              {fmtDate(booking.startAt)} • {booking.durationMins}m
            </div>

            <div className="mt-1">
              <span className="text-gray-500">Newsroom:</span>{" "}
              <span className="font-medium">{booking.newsroomName}</span>
              {booking.programName ? (
                <>
                  {" "}
                  • <span className="text-gray-500">Program:</span>{" "}
                  <span>{booking.programName}</span>
                </>
              ) : null}
              {booking.hostName ? (
                <>
                  {" "}
                  • <span className="text-gray-500">Host:</span>{" "}
                  <span>{booking.hostName}</span>
                </>
              ) : null}
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border px-2 py-0.5 text-xs">
                <span className="text-gray-500">Scope:</span>{" "}
                {booking.appearanceScope}
              </span>
              <span className="rounded-full border px-2 py-0.5 text-xs">
                <span className="text-gray-500">Access:</span>{" "}
                {booking.accessProvisioning}
              </span>
              {booking.appearanceScope === "UNIFIED" &&
                booking.appearanceType && (
                  <span className="rounded-full border px-2 py-0.5 text-xs">
                    Unified type: {booking.appearanceType}
                  </span>
                )}
            </div>

            {booking.locationUrl && (
              <div className="mt-2">
                <span className="text-gray-500">Default link:</span>{" "}
                <a
                  href={booking.locationUrl}
                  className="text-blue-600 underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {booking.locationUrl}
                </a>
              </div>
            )}

            {(booking.locationName || booking.locationAddress) && (
              <div className="mt-1">
                <span className="text-gray-500">Default venue:</span>{" "}
                <span>{booking.locationName}</span>
                {booking.locationAddress ? (
                  <> — {booking.locationAddress}</>
                ) : null}
              </div>
            )}

            {booking.dialInfo && (
              <div className="mt-1">
                <span className="text-gray-500">Default dial:</span>{" "}
                {booking.dialInfo}
              </div>
            )}
          </div>

          <h3 className="mt-5 text-base font-semibold">Guests</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {booking.guests.map((g) => (
              <li key={g.id} className="rounded-md border px-3 py-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">
                      {typeIcon(g.appearanceType)} {g.name}{" "}
                      <span className="text-gray-500">
                        ({g.kind.toLowerCase()})
                      </span>
                    </div>

                    {g.appearanceType === "ONLINE" &&
                      (g.joinUrl || booking.locationUrl) && (
                        <div className="mt-1">
                          Link:{" "}
                          <a
                            href={g.joinUrl || booking.locationUrl || "#"}
                            className="text-blue-600 underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {g.joinUrl || booking.locationUrl}
                          </a>
                        </div>
                      )}

                    {g.appearanceType === "IN_PERSON" &&
                      (g.venueName ||
                        g.venueAddress ||
                        booking.locationName ||
                        booking.locationAddress) && (
                        <div className="mt-1">
                          Venue: {g.venueName || booking.locationName || ""}
                          {(g.venueAddress || booking.locationAddress) && (
                            <> — {g.venueAddress || booking.locationAddress}</>
                          )}
                        </div>
                      )}

                    {g.appearanceType === "PHONE" &&
                      (g.dialInfo || booking.dialInfo) && (
                        <div className="mt-1">
                          Dial: {g.dialInfo || booking.dialInfo}
                        </div>
                      )}
                  </div>

                  <div className="text-xs text-gray-400">#{g.order}</div>
                </div>
              </li>
            ))}
          </ul>

          {/* Notes */}
          <h3 className="mt-6 text-base font-semibold">Notes</h3>
          <div className="mt-2">
            {notesLoading ? (
              <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Loading notes…
              </div>
            ) : notes.length === 0 ? (
              <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-600">
                No notes yet.
              </div>
            ) : (
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-md border px-3 py-2">
                    <div className="text-xs text-gray-500">
                      By {n.authorName} • {fmtDate(n.createdAt)}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm">
                      {n.body}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Composer */}
            {noteMsg && (
              <div
                className={`mt-3 rounded-md border px-3 py-2 text-sm ${
                  noteMsg.tone === "success"
                    ? "border-green-200 bg-green-50 text-green-800"
                    : "border-red-200 bg-red-50 text-red-800"
                }`}
                role={noteMsg.tone === "error" ? "alert" : "status"}
              >
                {noteMsg.text}
              </div>
            )}

            <div className="mt-3">
              <textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Add a note for this booking..."
                className="h-24 w-full rounded-md border p-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
              <div className="mt-2">
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
