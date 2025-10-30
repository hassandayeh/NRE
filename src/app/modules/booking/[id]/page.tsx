// src/app/modules/booking/[id]/page.tsx
"use client";

/**
 * Single Booking — mirrors "New" layout
 *
 * UI/UX in this drop:
 * - Standardized buttons (matches New).
 * - Extra top margin for the first container.
 * - "New booking" → "Edit booking" (link: /modules/booking/[id]/edit).
 * - Participants: render group headers, but map "Expert" → "Guest".
 * - Talking points: collapsible with Read more / Read less.
 *
 * NOTE about names:
 * - Participants API enriches from `user.displayName/email`. For public experts
 *   without user records, this returns null → "Unnamed" here.
 * - I’ll patch the API to also enrich from the public expert profile once you
 *   share the schema + /api/experts/search route so I don’t guess.
 */

import * as React from "react";
import { useRouter, useParams } from "next/navigation";

/* ---------- Small helpers ---------- */
const clsx = (...xs: any[]) => xs.filter(Boolean).join(" ");
const pad = (n: number) => String(n).padStart(2, "0");
const toDatetimeLocalValue = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

/* ---------- Design system shims (same approach as New page) ---------- */
import * as ButtonModule from "../../../../components/ui/Button";
const UIButton: React.ElementType =
  (ButtonModule as any).Button ?? (ButtonModule as any).default;

/* ---------- Types (tolerant) ---------- */
type ModeLevel = "BOOKING" | "PARTICIPANT";

type BookingDetail = {
  id: string;
  programName?: string | null;
  newsroomName?: string | null;
  startAt?: string | null;
  durationMins?: number | null;
  talkingPoints?: string | null; // HTML
  modeLevel?: ModeLevel | null;
  accessConfig?: any;
};

type ParticipantItem = {
  id: string;
  userId: string | null;
  displayName: string | null;
  roleSlot: number | null;
  roleLabel: string | null;
  inviteStatus: string | null;
  invitedAt: string | null;
  respondedAt: string | null;
};

type ParticipantsResponse =
  | {
      ok: true;
      items: ParticipantItem[];
      roles?: string[];
      grouped?: Record<string, ParticipantItem[]>;
    }
  | { ok: false; error: string };

/* ------------------------- Access summary helpers ------------------------- */
function kvFallback(config: unknown) {
  try {
    return JSON.stringify(config, null, 2);
  } catch {
    return String(config ?? "");
  }
}

function ModeAccessSummary({ config }: { config: any }) {
  if (!config) {
    return (
      <div className="rounded-md border p-3 text-sm text-gray-600">
        No booking-level access provided.
      </div>
    );
  }

  const modeLabel =
    config.modeLabel ??
    config.mode?.label ??
    config.mode ??
    (typeof config.mode?.slot === "number"
      ? `Mode #${config.mode.slot}`
      : null) ??
    (typeof config.modeSlot === "number" ? `Mode #${config.modeSlot}` : null);

  const presetKey =
    config.presetKey ?? config.accessPresetKey ?? config.preset ?? null;

  const accessLabel =
    config.accessLabel ?? config.access?.label ?? config.label ?? null;
  const accessDetails =
    config.accessDetails ?? config.access?.details ?? config.details ?? null;

  const location =
    config.location ??
    config.access?.location ??
    config.address ??
    config.url ??
    null;

  const nothing =
    !modeLabel && !presetKey && !accessLabel && !accessDetails && !location;

  return (
    <div className="rounded-md border p-3 text-sm">
      {nothing ? (
        <pre className="whitespace-pre-wrap text-gray-600">
          {kvFallback(config)}
        </pre>
      ) : (
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {modeLabel && (
            <div>
              <div className="text-xs text-gray-500">Mode</div>
              <div className="font-medium">{modeLabel}</div>
            </div>
          )}
          {presetKey && (
            <div>
              <div className="text-xs text-gray-500">Preset</div>
              <div className="font-medium">{presetKey}</div>
            </div>
          )}
          {accessLabel && (
            <div>
              <div className="text-xs text-gray-500">Label</div>
              <div className="font-medium">{accessLabel}</div>
            </div>
          )}
          {accessDetails && (
            <div className="sm:col-span-2">
              <div className="text-xs text-gray-500">Details</div>
              <div className="font-medium break-words">{accessDetails}</div>
            </div>
          )}
          {location && (
            <div className="sm:col-span-2">
              <div className="text-xs text-gray-500">Location</div>
              <div className="font-medium break-words">{location}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Main page ------------------------------ */
export default function BookingViewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const bookingId = String(params?.id ?? "");

  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<BookingDetail | null>(null);
  const [participants, setParticipants] =
    React.useState<ParticipantsResponse | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);
      try {
        // Booking core
        const r = await fetch(`/api/bookings/${bookingId}`, {
          cache: "no-store",
          credentials: "include",
        });
        const j = (await r.json().catch(() => ({}))) as any;
        if (!r.ok) throw new Error(j?.error || `Failed to load booking`);

        const b: BookingDetail = {
          id: j?.booking?.id ?? j?.id ?? bookingId,
          programName: j?.booking?.programName ?? j?.programName ?? null,
          newsroomName: j?.booking?.newsroomName ?? j?.newsroomName ?? null,
          startAt: (j?.booking?.startAt ?? j?.startAt) || null,
          durationMins: j?.booking?.durationMins ?? j?.durationMins ?? null,
          talkingPoints: j?.booking?.talkingPoints ?? j?.talkingPoints ?? null,
          modeLevel:
            j?.booking?.modeLevel ?? j?.modeLevel ?? ("BOOKING" as ModeLevel),
          accessConfig: j?.booking?.accessConfig ?? j?.accessConfig ?? null,
        };
        if (!cancelled) setDetail(b);

        // Participants
        const rp = await fetch(`/api/bookings/${bookingId}/participants`, {
          cache: "no-store",
          credentials: "include",
        });
        const jp = (await rp.json().catch(() => ({}))) as ParticipantsResponse;
        if (!cancelled) {
          if (!rp.ok || !("ok" in jp) || !jp.ok) {
            setParticipants({
              ok: false,
              error: (jp as any)?.error || "Error",
            });
          } else {
            setParticipants(jp);
          }
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load booking");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (bookingId) run();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const modeLevel: ModeLevel | null = (detail?.modeLevel as ModeLevel) ?? null;

  // Build grouped map if API didn't provide it
  const grouped: Record<string, ParticipantItem[]> = React.useMemo(() => {
    const p = participants;
    if (!p || ("ok" in p && !p.ok)) return {};
    const items = "ok" in p && p.ok && Array.isArray(p.items) ? p.items : [];
    const m: Record<string, ParticipantItem[]> = {};
    for (const it of items) {
      const raw =
        (it.roleLabel && it.roleLabel.trim()) ||
        (typeof it.roleSlot === "number"
          ? `Role ${it.roleSlot}`
          : "Participants");
      // UI copy rule: show "Guest" instead of "Expert"
      const label = raw.toLowerCase() === "expert" ? "Guest" : raw;
      (m[label] ||= []).push(it);
    }
    return m;
  }, [participants]);

  const roleKeys = Object.keys(grouped);

  /* ---------- Read more for talking points ---------- */
  const [tpExpanded, setTpExpanded] = React.useState(false);
  const hasTalkingPoints = (detail?.talkingPoints ?? "").trim().length > 0;

  return (
    <div className="mx-auto max-w-4xl p-4">
      {/* Header row */}
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          ← Back
        </button>

        <div className="flex items-center gap-2">
          <a
            href={`/modules/booking/${bookingId}/edit`}
            className="rounded-md bg-black px-4 py-2 text-sm text-white"
          >
            Edit booking
          </a>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="rounded-md border p-4 text-sm">Loading booking…</div>
      )}
      {err && (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* Basic Info */}
      <section className="mt-6 rounded-md border p-4">
        <h2 className="text-lg font-medium">Basic Info</h2>

        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="text-gray-700">Program name</span>
            <input
              readOnly
              value={detail?.programName ?? ""}
              className="mt-1 w-full cursor-default rounded-md border bg-gray-50 px-3 py-2"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">Newsroom name</span>
            <input
              readOnly
              value={detail?.newsroomName ?? ""}
              className="mt-1 w-full cursor-default rounded-md border bg-gray-50 px-3 py-2"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">Duration (mins)</span>
            <input
              readOnly
              value={detail?.durationMins ?? ""}
              className="mt-1 w-full cursor-default rounded-md border bg-gray-50 px-3 py-2"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">Start at</span>
            <input
              readOnly
              type="datetime-local"
              value={toDatetimeLocalValue(detail?.startAt)}
              className="mt-1 w-full cursor-default rounded-md border bg-gray-50 px-3 py-2"
            />
          </label>
        </div>

        {/* Talking points */}
        <div className="mt-4">
          <div className="text-sm text-gray-700">Talking points</div>

          {!hasTalkingPoints ? (
            <div className="mt-1 rounded-md border p-3 text-sm text-gray-500">
              No talking points.
            </div>
          ) : (
            <div className="relative mt-1">
              <div
                className={clsx(
                  "rounded-md border p-3 text-sm prose prose-sm max-w-none",
                  !tpExpanded && "max-h-40 overflow-hidden"
                )}
                // HTML saved by New
                dangerouslySetInnerHTML={{ __html: detail!.talkingPoints! }}
              />
              {!tpExpanded && (
                <div className="pointer-events-none absolute inset-x-0 bottom-10 h-10 bg-gradient-to-t from-white to-transparent" />
              )}
              <div className="mt-2 text-right">
                <UIButton
                  type="button"
                  onClick={() => setTpExpanded((v: boolean) => !v)}
                  className="rounded-md border px-3 py-1 text-sm"
                >
                  {tpExpanded ? "Read less" : "Read more"}
                </UIButton>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Mode & Access */}
      <section className="mt-6 rounded-md border p-4">
        <h2 className="text-lg font-medium">Mode &amp; Access</h2>

        <div className="mt-3 text-sm text-gray-700">
          <div className="mb-3">
            <span className="text-gray-500">Mode Level — </span>
            <span className="font-medium">
              {modeLevel === "PARTICIPANT" ? "Participant" : "Booking"}
            </span>
          </div>

          {modeLevel === "BOOKING" ? (
            <ModeAccessSummary config={detail?.accessConfig} />
          ) : (
            <div className="rounded-md border p-3 text-sm text-gray-600">
              Participant-level access — see each participant below.
            </div>
          )}
        </div>
      </section>

      {/* Participants */}
      <section className="mt-6 rounded-md border p-4">
        <h2 className="text-lg font-medium">Participants</h2>

        {participants && "ok" in participants && !participants.ok ? (
          <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {participants.error}
          </div>
        ) : null}

        {roleKeys.length === 0 ? (
          <div className="mt-3 rounded-md border p-3 text-sm text-gray-600">
            No participants found.
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {roleKeys.map((role) => {
              const rows = grouped[role] ?? [];
              return (
                <div key={role} className="rounded-md border">
                  <div className="flex items-center justify-between border-b p-2">
                    <div className="text-sm font-medium">{role}</div>
                  </div>
                  {rows.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {p.displayName ?? "Unnamed"}
                        </div>
                        {typeof p.roleSlot === "number" && (
                          <div className="text-[11px] text-gray-500">
                            #{p.roleSlot}
                          </div>
                        )}
                      </div>
                      <div className="text-[11px]">
                        {p.inviteStatus ?? "PENDING"}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Footer actions */}
      <div className="mt-6 flex items-center justify-end">
        <UIButton
          type="button"
          onClick={() => router.push("/modules/booking/view")}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          Back
        </UIButton>
      </div>
    </div>
  );
}
