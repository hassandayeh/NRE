// src/app/modules/booking/[id]/page.tsx
"use client";

/**
 * Single Booking — mirrors the "New" page layout (containers & spacing)
 * Sections:
 *  - Basic Info (read-only)
 *  - Mode & Access (read-only; BOOKING-level summary or participant-level note)
 *  - Participants (grouped by role)
 *
 * Notes:
 *  - Fresh build (no legacy).
 *  - Defensive to partial payloads — hides unknown/empty rows.
 *  - Containers match New: rounded + border + p-4, space-y-4.
 */

import * as React from "react";
import { useRouter, useParams } from "next/navigation";

/* ---------- Small UI helpers ---------- */
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

import * as AlertModule from "../../../../components/ui/Alert";
const UIAlert: React.ElementType =
  (AlertModule as any).Alert ?? (AlertModule as any).default;

/* ---------- Types (tolerant) ---------- */
type ModeLevel = "BOOKING" | "PARTICIPANT";

type BookingDetail = {
  id: string;
  subject?: string | null;
  newsroomName?: string | null;
  programName?: string | null; // optional: only render if exists
  startAt?: string | null;
  durationMins?: number | null;
  talkingPoints?: string | null; // HTML saved by New
  modeLevel?: ModeLevel | null;
  accessConfig?: any;
  access?: any;
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
function FieldRow({
  label,
  value,
}: {
  label: string;
  value?: React.ReactNode;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-3">
      <span className="w-28 shrink-0 text-sm text-gray-500">{label}</span>
      <div className="min-w-0 text-sm text-gray-900">{value}</div>
    </div>
  );
}

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
      <div className="rounded-md border border-dashed p-3 text-sm text-gray-500">
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
    <div className="rounded-md border p-3">
      {nothing ? (
        <pre className="whitespace-pre-wrap break-words text-xs text-gray-600">
          {kvFallback(config)}
        </pre>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow label="Mode" value={modeLabel} />
          <FieldRow label="Preset" value={presetKey} />
          <FieldRow label="Label" value={accessLabel} />
          <FieldRow label="Details" value={accessDetails} />
          <FieldRow label="Location" value={location} />
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
  const [participants, setParticipants] = React.useState<ParticipantsResponse>({
    ok: true,
    items: [],
    grouped: {},
    roles: [],
  } as any);

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
          subject: j?.booking?.subject ?? j?.subject ?? null,
          newsroomName: j?.booking?.newsroomName ?? j?.newsroomName ?? null,
          // Only render Program name if backend returns it
          programName: j?.booking?.programName ?? j?.programName ?? undefined,
          startAt: (j?.booking?.startAt ?? j?.startAt) || null,
          durationMins:
            j?.booking?.durationMins ?? j?.durationMins ?? undefined,
          talkingPoints:
            j?.booking?.talkingPoints ?? j?.talkingPoints ?? undefined,
          modeLevel:
            j?.booking?.modeLevel ?? j?.modeLevel ?? ("BOOKING" as ModeLevel),
          accessConfig:
            j?.booking?.accessConfig ?? j?.accessConfig ?? j?.access,
          access: j?.booking?.access ?? undefined,
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

  const grouped =
    (participants as any)?.grouped &&
    typeof (participants as any).grouped === "object"
      ? (participants as any).grouped
      : (() => {
          const m: Record<string, ParticipantItem[]> = {};
          if ((participants as any)?.items?.length) {
            for (const it of (participants as any).items as ParticipantItem[]) {
              const key =
                (it.roleLabel && it.roleLabel.trim()) ||
                (typeof it.roleSlot === "number"
                  ? `Role ${it.roleSlot}`
                  : "Participants");
              (m[key] ||= []).push(it);
            }
          }
          return m;
        })();

  const roleKeys = Object.keys(grouped ?? {});

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Top-level errors / loading */}
      {loading ? (
        <div className="text-sm text-gray-500">Loading booking…</div>
      ) : null}
      {err ? <UIAlert kind="error">{err}</UIAlert> : null}

      {/* Basic Info */}
      <section className="rounded-md border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Basic Info</h2>
          {/* subtle section meta could go here in future */}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Program name replaces Subject. Fallback to subject so old payloads still show. */}
          <label className="block space-y-1">
            <span className="text-sm">Program name</span>
            <input
              value={detail?.programName ?? detail?.subject ?? ""}
              readOnly
              className="w-full rounded-md border bg-gray-50 px-3 py-2"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm">Newsroom name</span>
            <input
              value={detail?.newsroomName ?? ""}
              readOnly
              className="w-full rounded-md border bg-gray-50 px-3 py-2"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm">Duration (mins)</span>
            <input
              value={
                typeof detail?.durationMins === "number"
                  ? String(detail.durationMins)
                  : ""
              }
              readOnly
              className="w-full rounded-md border bg-gray-50 px-3 py-2"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-sm">Start at</span>
          <input
            type="datetime-local"
            value={toDatetimeLocalValue(detail?.startAt ?? null)}
            readOnly
            className="w-full rounded-md border bg-gray-50 px-3 py-2"
          />
        </label>

        {/* Talking points */}
        <div className="space-y-1">
          <span className="text-sm">Talking points</span>
          <div className="rounded-md border bg-white">
            <div
              className={clsx(
                "min-h-[120px] max-h-[320px] overflow-auto px-3 py-2 prose prose-sm",
                !detail?.talkingPoints && "italic text-gray-500"
              )}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{
                __html:
                  (detail?.talkingPoints &&
                    String(detail.talkingPoints).trim()) ||
                  "No talking points.",
              }}
            />
          </div>
        </div>
      </section>

      {/* Mode & Access */}
      <section className="rounded-md border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Mode &amp; Access</h2>
        </div>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm">Mode Level</span>
            <select
              value={modeLevel ?? ""}
              disabled
              className="w-full rounded-md border bg-gray-50 px-3 py-2"
            >
              <option value="">—</option>
              <option value="BOOKING">Booking</option>
              <option value="PARTICIPANT">Participant</option>
            </select>
          </label>

          {modeLevel === "BOOKING" ? (
            <ModeAccessSummary
              config={detail?.accessConfig ?? detail?.access ?? null}
            />
          ) : (
            <div className="rounded-md border border-dashed p-3 text-sm text-gray-600">
              Participant-level access — see each participant below.
            </div>
          )}
        </div>
      </section>

      {/* Participants */}
      <section className="rounded-md border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Participants</h2>
        </div>

        {("ok" in participants && participants.ok && roleKeys.length === 0) ||
        (!("ok" in participants) && !roleKeys.length) ? (
          <div className="rounded-md border border-dashed p-3 text-sm text-gray-500">
            No participants found.
          </div>
        ) : null}

        {"ok" in participants && !participants.ok ? (
          <UIAlert kind="error">{participants.error}</UIAlert>
        ) : null}

        {roleKeys.length > 0 && (
          <div className="space-y-4">
            {roleKeys.map((role) => {
              const rows: ParticipantItem[] = grouped[role] ?? [];
              return (
                <div key={role} className="space-y-2">
                  <div className="text-sm font-medium">{role}</div>
                  <div className="space-y-2">
                    {rows.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-md border px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {p.displayName ?? "Unnamed"}
                          </span>
                          {typeof p.roleSlot === "number" ? (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
                              #{p.roleSlot}
                            </span>
                          ) : null}
                        </div>
                        <span
                          className={clsx(
                            "rounded px-1.5 py-0.5 text-[10px]",
                            p.inviteStatus === "ACCEPTED"
                              ? "bg-green-100 text-green-800"
                              : p.inviteStatus === "DECLINED"
                              ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-700"
                          )}
                        >
                          {p.inviteStatus ?? "PENDING"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border px-3 py-2 hover:bg-gray-50"
        >
          Back
        </button>
        <UIButton asChild>
          <a href="/modules/booking/new">New booking</a>
        </UIButton>
      </div>
    </div>
  );
}
