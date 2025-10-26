// src/app/modules/booking/[id]/page.tsx
import Link from "next/link";
import { headers, cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* --------------------------- Types --------------------------- */

type BookingDTO = {
  id: string;
  orgId: string;
  subject: string;
  status: string;
  startAt: string; // ISO
  durationMins: number;
  appearanceType: string | null;
  locationUrl: string | null;
  locationName: string | null;
  locationAddress: string | null;
  dialInfo: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

type ParticipantsItem = {
  id: string;
  userId: string | null;
  displayName: string | null;
  roleSlot: number | null;
  roleLabel: string | null; // snapshot label
  inviteStatus: string | null; // PENDING | ACCEPTED | DECLINED | CANCELED
  invitedAt: string | null;
  respondedAt: string | null;
};

type ParticipantsRes = ApiOk<{ items: ParticipantsItem[] }> | ApiErr;

/* ------------------------ Helpers (UI) ------------------------ */

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(mins: number | null | undefined) {
  if (!mins && mins !== 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

function StatusPill({ status }: { status?: string | null }) {
  const s = (status || "").toUpperCase();
  const color =
    s === "CONFIRMED"
      ? "bg-green-100 text-green-800 ring-green-200"
      : s === "CANCELED"
      ? "bg-gray-100 text-gray-700 ring-gray-200"
      : s === "PENDING"
      ? "bg-amber-100 text-amber-800 ring-amber-200"
      : "bg-slate-100 text-slate-800 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${color}`}
    >
      {s || "UNKNOWN"}
    </span>
  );
}

function InviteStatusPill({ s }: { s: string | null }) {
  const v = (s || "").toUpperCase();
  const color =
    v === "ACCEPTED"
      ? "bg-green-100 text-green-800 ring-green-200"
      : v === "DECLINED"
      ? "bg-rose-100 text-rose-800 ring-rose-200"
      : v === "CANCELED"
      ? "bg-gray-100 text-gray-700 ring-gray-200"
      : "bg-amber-100 text-amber-800 ring-amber-200"; // PENDING/unknown
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1 ${color}`}
    >
      {v || "PENDING"}
    </span>
  );
}

/* ----------------------- Server fetchers ---------------------- */

function currentOrigin() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

function authCookiesHeader() {
  return cookies()
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}

async function fetchBooking(id: string): Promise<{
  ok: boolean;
  data?: BookingDTO;
  error?: string;
  status: number;
}> {
  const origin = currentOrigin();
  const res = await fetch(`${origin}/api/bookings/${encodeURIComponent(id)}`, {
    cache: "no-store",
    headers: { cookie: authCookiesHeader() },
  });

  let json: ApiOk<{ booking: BookingDTO }> | ApiErr | undefined;
  try {
    json = (await res.json()) as any;
  } catch {
    // no-op
  }

  if (!res.ok || !json || !("ok" in json) || !json.ok) {
    const message =
      (json && "error" in json && json.error) ||
      (res.status === 401 && "Unauthorized") ||
      (res.status === 403 && "Forbidden") ||
      (res.status === 404 && "Not found") ||
      "Failed to load";
    return { ok: false, error: message, status: res.status };
  }
  return { ok: true, data: (json as any).booking, status: res.status };
}

async function fetchParticipants(id: string): Promise<{
  ok: boolean;
  items?: ParticipantsItem[];
  error?: string;
  status: number;
}> {
  const origin = currentOrigin();
  const res = await fetch(
    `${origin}/api/bookings/${encodeURIComponent(id)}/participants`,
    { cache: "no-store", headers: { cookie: authCookiesHeader() } }
  );

  let json: ParticipantsRes | undefined;
  try {
    json = (await res.json()) as any;
  } catch {
    // no-op
  }

  if (!res.ok || !json || !("ok" in json) || !json.ok) {
    const message =
      (json && "error" in json && json.error) ||
      (res.status === 401 && "Unauthorized") ||
      (res.status === 403 && "Forbidden") ||
      (res.status === 404 && "Not found") ||
      "Failed to load";
    return { ok: false, error: message, status: res.status };
  }

  return { ok: true, items: (json as any).items, status: res.status };
}

/* --------------------------- Page ---------------------------- */

export default async function BookingViewPage({
  params,
}: {
  params: { id: string };
}) {
  const [bookingRes, participantsRes] = await Promise.all([
    fetchBooking(params.id),
    fetchParticipants(params.id),
  ]);

  // Error & empty states for booking (primary)
  if (!bookingRes.ok) {
    const { status, error } = bookingRes;
    const isNoOrg =
      status === 403 && (error || "").toLowerCase().includes("no org");
    const isUnauthorized = status === 401;

    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Booking</h1>
          <Link
            href="/modules/booking/view"
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            ← Back to list
          </Link>
        </div>

        {isUnauthorized ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
            You need to{" "}
            <Link href="/auth/signin" className="underline">
              sign in
            </Link>{" "}
            to view this booking.
          </div>
        ) : isNoOrg ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
            No organization selected. Go to{" "}
            <Link href="/modules/settings" className="underline">
              Settings
            </Link>{" "}
            to pick an organization.
          </div>
        ) : status === 404 ? (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-700">
            Booking not found or you don’t have access.
          </div>
        ) : (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            {error || "Something went wrong. Try again."}
          </div>
        )}
      </div>
    );
  }

  const b = bookingRes.data!;
  const pOk = participantsRes.ok;
  const items = participantsRes.items ?? [];
  const pError = participantsRes.error;

  // Group participants by role label (fallback to Role X)
  const byRole = new Map<string, ParticipantsItem[]>();
  if (pOk) {
    for (const it of items) {
      const label =
        (it.roleLabel && it.roleLabel.trim()) ||
        (typeof it.roleSlot === "number" ? `Role ${it.roleSlot}` : "Role");
      const arr = byRole.get(label) || [];
      arr.push(it);
      byRole.set(label, arr);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">
            {b.subject || "Untitled booking"}
          </h1>
          <p className="text-sm text-gray-600">
            <StatusPill status={b.status} /> <span className="mx-2">•</span>{" "}
            {formatDateTime(b.startAt)} <span className="mx-2">•</span>{" "}
            {formatDuration(b.durationMins)}
          </p>
        </div>

        <Link
          href="/modules/booking/view"
          className="rounded border px-3 py-1 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          ← Back to list
        </Link>
      </div>

      {/* Details */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Basics</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex items-start justify-between gap-4">
              <dt className="text-gray-500">Appearance</dt>
              <dd className="text-gray-900">{b.appearanceType || "—"}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-gray-500">Duration</dt>
              <dd className="text-gray-900">
                {formatDuration(b.durationMins)}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-gray-500">Created</dt>
              <dd className="text-gray-900">{formatDateTime(b.createdAt)}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-gray-500">Updated</dt>
              <dd className="text-gray-900">{formatDateTime(b.updatedAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">
            Location & Access
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex items-start justify-between gap-4">
              <dt className="text-gray-500">Location name</dt>
              <dd className="text-gray-900">{b.locationName || "—"}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-gray-500">Address</dt>
              <dd className="text-gray-900">{b.locationAddress || "—"}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-gray-500">URL</dt>
              <dd className="text-gray-900">
                {b.locationUrl ? (
                  <a
                    href={b.locationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 underline break-words"
                  >
                    {b.locationUrl}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-gray-500">Dial info</dt>
              <dd className="text-gray-900 break-words whitespace-pre-wrap">
                {b.dialInfo || "—"}
              </dd>
            </div>
          </dl>
        </div>

        {/* Participants */}
        <div className="rounded-xl border bg-white p-4 md:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">Participants</h2>
            {/* Future: Add/Edit buttons (out of scope now) */}
          </div>

          {!pOk ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {pError || "Failed to load participants"}
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-gray-600">No participants yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {Array.from(byRole.entries()).map(([role, list]) => (
                <div key={role} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{role}</h3>
                    <span className="text-xs text-gray-500">
                      {list.length} {list.length === 1 ? "person" : "people"}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {list.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="truncate">{p.displayName || "—"}</span>
                        <InviteStatusPill s={p.inviteStatus} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
