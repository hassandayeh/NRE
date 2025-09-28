"use client";

/**
 * Booking View
 * - Adds Hosts (multi-hosts) view parity with Edit/New behind NEXT_PUBLIC_FEATURE_MULTI_HOSTS.
 * - Shows effective host access value and a "(using booking defaults)" badge when fallback applies.
 * - Keeps legacy single-host summary for parity with older views.
 * - Guests, booking defaults, and notes thread preserved (no regressions).
 */

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

/* --- Feature flags --- */
const PHONE_ENABLED =
  (process.env.NEXT_PUBLIC_APPEARANCE_PHONE ?? "true") !== "false";
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

  // Hosts model (new)
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
      className="underline underline-offset-2"
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
        "rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50 " + className
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
    <div className={`rounded-md border px-3 py-2 text-sm ${styles}`}>
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

        // Sort guests/hosts by order
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
      <div className="p-4">
        <div>Loading…</div>
      </div>
    );

  if (error || !booking) {
    return (
      <div className="p-4">
        <AlertBox>{error || "Not found"}</AlertBox>
      </div>
    );
  }

  const b = booking;

  return (
    <div className="mx-auto max-w-3xl p-4">
      {/* Title */}
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">{b.subject}</h1>
        <div className="text-sm text-gray-700">{b.newsroomName}</div>
        <div className="mt-1 text-sm text-gray-700">
          {fmtDateRange(b.startAt, b.durationMins)}
        </div>

        {canEdit && (
          <div className="mt-3 flex items-center gap-2">
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
      </header>

      {/* Hosts (feature-gated) */}
      {MULTI_HOSTS_ENABLED && (b.hosts?.length ?? 0) > 0 ? (
        <section className="mb-6 rounded-md border p-3">
          <h2 className="mb-2 text-lg font-medium">Hosts</h2>

          {(b.hosts || []).map((h, idx) => {
            const eff = effectiveForHost(h, b);
            const tagClass =
              (b.hostAppearanceScope ?? "UNIFIED") === "UNIFIED"
                ? "bg-gray-100 text-gray-800"
                : h.appearanceType === "ONLINE"
                ? "bg-blue-100 text-blue-800"
                : h.appearanceType === "IN_PERSON"
                ? "bg-amber-100 text-amber-800"
                : "bg-purple-100 text-purple-800";

            const typeLabel =
              (b.hostAppearanceScope ?? "UNIFIED") === "UNIFIED"
                ? b.hostAppearanceType ?? "ONLINE"
                : h.appearanceType;

            return (
              <div
                key={`${h.userId}-${idx}`}
                className="mb-3 rounded-md border p-3"
              >
                <div className="mb-1 flex items-center justify-between">
                  <div className="font-medium">
                    #{idx + 1} {h.name || "Host"}
                  </div>
                  <span className={`rounded px-1.5 text-xs ${tagClass}`}>
                    {typeLabel}
                  </span>
                </div>

                {h.userId && (
                  <div className="text-xs text-gray-600">User: {h.userId}</div>
                )}

                {/* Appearance-specific effective detail */}
                <div className="mt-2 text-sm">
                  {eff.kind === "ONLINE" && (
                    <div>
                      Join:{" "}
                      {eff.value ? (
                        <ExternalLink href={eff.value}>Link</ExternalLink>
                      ) : (
                        "—"
                      )}{" "}
                      {eff.usedFallback && (
                        <span className="ml-1 text-xs text-gray-600">
                          (using booking defaults)
                        </span>
                      )}
                    </div>
                  )}
                  {eff.kind === "IN_PERSON" && (
                    <div>
                      Venue/address: {eff.value || "—"}{" "}
                      {eff.usedFallback && (
                        <span className="ml-1 text-xs text-gray-600">
                          (using booking defaults)
                        </span>
                      )}
                    </div>
                  )}
                  {PHONE_ENABLED && eff.kind === "PHONE" && (
                    <div>
                      Dial info: {eff.value || "—"}{" "}
                      {eff.usedFallback && (
                        <span className="ml-1 text-xs text-gray-600">
                          (using booking defaults)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Legacy summary for parity */}
          <div className="mt-3 rounded-md border p-2">
            <div className="text-xs font-medium text-gray-700">
              Legacy host summary
            </div>
            {b.hostUserId ? (
              <div className="text-sm">
                {b.hostName || "Host"}{" "}
                <span className="text-gray-500">({b.hostUserId})</span>
              </div>
            ) : (
              <div className="text-sm text-gray-600">None</div>
            )}
          </div>
        </section>
      ) : (
        /* Legacy single-host section (unchanged) */
        <section className="mb-6 rounded-md border p-3">
          <h2 className="mb-2 text-lg font-medium">Host</h2>
          {b.hostUserId ? (
            <div className="text-sm">
              <div className="font-medium">{b.hostName || "Host"}</div>
              <div className="text-gray-600">{b.hostUserId}</div>
            </div>
          ) : (
            <div className="text-sm text-gray-600">None</div>
          )}
        </section>
      )}

      {/* Booking defaults (Guests UNIFIED) */}
      {b.appearanceScope === "UNIFIED" && (
        <section className="mb-6 rounded-md border p-3">
          <h2 className="mb-2 text-lg font-medium">
            Booking defaults (guests)
          </h2>
          <div className="text-sm">
            <div className="mb-2">
              Type:{" "}
              <span className="font-medium">
                {b.appearanceType ?? "ONLINE"}
              </span>
            </div>
            {(b.appearanceType ?? "ONLINE") === "ONLINE" && (
              <div>
                {b.locationUrl ? (
                  <>
                    Join link:{" "}
                    <ExternalLink href={b.locationUrl}>Link</ExternalLink>
                  </>
                ) : (
                  "No link provided."
                )}
              </div>
            )}
            {(b.appearanceType ?? "ONLINE") === "IN_PERSON" && (
              <div>
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
      <section className="mb-6 rounded-md border p-3">
        <h2 className="mb-2 text-lg font-medium">Guests</h2>
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
            <div
              key={`${g.userId}-${idx}`}
              className="mb-3 rounded-md border p-3"
            >
              <div className="mb-1 flex items-center justify-between">
                <div className="font-medium">
                  #{idx + 1} {g.name}{" "}
                  <span className="ml-2 rounded px-1.5 text-xs bg-gray-100 text-gray-800">
                    {g.kind}
                  </span>
                </div>
                <span className={`rounded px-1.5 text-xs ${tagClass}`}>
                  {g.appearanceType}
                </span>
              </div>

              {g.userId && (
                <div className="text-xs text-gray-600">User: {g.userId}</div>
              )}

              {/* Appearance-specific detail (effective) */}
              <div className="mt-2 text-sm">
                {eff.kind === "ONLINE" && (
                  <div>
                    Join:{" "}
                    {eff.value ? (
                      <ExternalLink href={eff.value}>Link</ExternalLink>
                    ) : (
                      "—"
                    )}{" "}
                    {eff.usedFallback && (
                      <span className="ml-1 text-xs text-gray-600">
                        (using default)
                      </span>
                    )}
                  </div>
                )}
                {eff.kind === "IN_PERSON" && (
                  <div>
                    Venue/address: {eff.value || "—"}{" "}
                    {eff.usedFallback && (
                      <span className="ml-1 text-xs text-gray-600">
                        (using default)
                      </span>
                    )}
                  </div>
                )}
                {PHONE_ENABLED && eff.kind === "PHONE" && (
                  <div>
                    Dial info: {eff.value || "—"}{" "}
                    {eff.usedFallback && (
                      <span className="ml-1 text-xs text-gray-600">
                        (using default)
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* Additional details */}
      {(b.programName || b.talkingPoints) && (
        <section className="mb-6 rounded-md border p-3">
          <h2 className="mb-2 text-lg font-medium">Additional details</h2>
          <div className="text-sm">
            {b.programName && <div>Program: {b.programName}</div>}
            {b.talkingPoints && (
              <div className="mt-1">
                <div className="mb-1 font-medium">Talking points:</div>
                <div className="whitespace-pre-wrap">{b.talkingPoints}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Notes (restored) */}
      <section className="rounded-md border p-3">
        <h2 className="mb-2 text-lg font-medium">Notes</h2>
        {noteMsg && (
          <div className="mb-2">
            <AlertBox variant={noteMsg.tone}>{noteMsg.text}</AlertBox>
          </div>
        )}

        {notesLoading ? (
          <div>Loading notes…</div>
        ) : notes.length === 0 ? (
          <div className="text-sm text-gray-600">No notes yet.</div>
        ) : (
          <ul className="mb-3 list-disc pl-6">
            {notes.map((n) => (
              <li key={n.id} className="mb-2">
                <div className="text-xs text-gray-600">
                  <span className="font-medium">{n.authorName}</span> •{" "}
                  {fmtDate(n.createdAt)}
                </div>
                <div className="whitespace-pre-wrap text-sm">{n.body}</div>
              </li>
            ))}
          </ul>
        )}

        {/* Composer (all roles may post; server enforces who sees what) */}
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
