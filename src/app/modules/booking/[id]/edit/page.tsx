// src/app/modules/booking/[id]/edit/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type BookingDTO = {
  id: string;
  orgId: string;
  subject: string;
  status: string;
  startAt: string; // ISO
  durationMins: number;
  appearanceType: "ONLINE" | "IN_PERSON" | "PHONE" | null;

  // legacy fields still returned by API (not edited here)
  locationUrl: string | null;
  locationName: string | null;
  locationAddress: string | null;
  dialInfo: string | null;

  newsroomName: string | null; // edited here
  accessConfig: any | null; // non-host access knobs
  createdAt: string;
  updatedAt: string;
};

type ParticipantDTO = {
  id: string;
  userId: string | null;
  displayName: string | null;
  roleSlot: number | null;
  roleLabel: string | null;
  inviteStatus: string | null;
  invitedAt: string | null;
  respondedAt: string | null;
};

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

function toLocalInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

function fromLocalInputValue(val: string) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function groupByRole(items: ParticipantDTO[]) {
  const out = new Map<string, ParticipantDTO[]>();
  for (const it of items) {
    const key =
      (it.roleLabel?.trim() ||
        (typeof it.roleSlot === "number" ? `Role ${it.roleSlot}` : "Role")) +
      "";
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(it);
  }
  return out;
}

type AppearanceScope = "UNIFIED" | "PER_GUEST";
type AccessProvisioning = "SHARED" | "PER_GUEST";
type UnifiedType = "ONLINE" | "IN_PERSON" | "PHONE" | null;

export default function BookingEditPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const id = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What (mirrors New)
  const [subject, setSubject] = useState("");
  const [newsroomName, setNewsroomName] = useState("");

  // When / basics (mirrors New)
  const [appearanceType, setAppearanceType] = useState<
    "ONLINE" | "IN_PERSON" | "PHONE" | ""
  >("");
  const [startAtLocal, setStartAtLocal] = useState("");
  const [durationMins, setDurationMins] = useState<number | "">("");

  // Non-host access config (mirrors New)
  const [nhAppearanceScope, setNhAppearanceScope] =
    useState<AppearanceScope>("UNIFIED");
  const [nhAccessProvisioning, setNhAccessProvisioning] =
    useState<AccessProvisioning>("SHARED");
  const [nhUnifiedType, setNhUnifiedType] = useState<UnifiedType>("ONLINE");
  const [nhDefaultLink, setNhDefaultLink] = useState<string>("");

  // Participants (read-only slice for now)
  const [participants, setParticipants] = useState<ParticipantDTO[]>([]);
  const grouped = useMemo(() => groupByRole(participants), [participants]);

  // Load booking + participants
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [bRes, pRes] = await Promise.all([
          fetch(`/api/bookings/${encodeURIComponent(id)}`, {
            cache: "no-store",
          }),
          fetch(`/api/bookings/${encodeURIComponent(id)}/participants`, {
            cache: "no-store",
          }),
        ]);

        const bJson = (await bRes.json()) as
          | ApiOk<{ booking: BookingDTO }>
          | ApiErr;
        if (!bRes.ok || !("ok" in bJson) || !bJson.ok) {
          throw new Error((bJson as ApiErr)?.error || "Failed to load booking");
        }

        const pJson = (await pRes.json()) as
          | ApiOk<{ items: ParticipantDTO[]; participants?: ParticipantDTO[] }>
          | ApiErr;
        if (!pRes.ok || !("ok" in pJson) || !pJson.ok) {
          throw new Error(
            (pJson as ApiErr)?.error || "Failed to load participants"
          );
        }

        if (!alive) return;

        const b = bJson.booking;
        setSubject(b.subject || "");
        setNewsroomName(b.newsroomName || "");
        setAppearanceType((b.appearanceType as any) || "");
        setStartAtLocal(toLocalInputValue(b.startAt));
        setDurationMins(b.durationMins ?? "");

        // accessConfig → state (non-host)
        const nonHost = (b.accessConfig?.nonHost ?? {}) as Record<string, any>;
        const scope = (nonHost.appearanceScope as AppearanceScope) || "UNIFIED";
        const prov =
          (nonHost.accessProvisioning as AccessProvisioning) || "SHARED";
        const uType = (nonHost.unifiedType as UnifiedType) ?? "ONLINE";
        const link = (nonHost.defaultJoinUrl as string | null) ?? "";
        setNhAppearanceScope(scope);
        setNhAccessProvisioning(prov);
        setNhUnifiedType(uType);
        setNhDefaultLink(link || "");

        const list = (pJson as any).participants ?? (pJson as any).items ?? [];
        setParticipants(Array.isArray(list) ? list : []);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const disableSave = useMemo(() => {
    return (
      !subject.trim() || !startAtLocal || !durationMins || saving || loading
    );
  }, [subject, startAtLocal, durationMins, saving, loading]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        // What
        subject: subject.trim(),
        newsroomName: newsroomName.trim() ? newsroomName.trim() : null,

        // When
        startAt: fromLocalInputValue(startAtLocal),
        durationMins:
          typeof durationMins === "number"
            ? durationMins
            : parseInt(String(durationMins || "0"), 10),
        appearanceType: appearanceType || null,

        // Non-host access config
        accessConfig: {
          nonHost: {
            appearanceScope: nhAppearanceScope,
            accessProvisioning: nhAccessProvisioning,
            unifiedType: nhUnifiedType,
            defaultJoinUrl: nhDefaultLink.trim() || null,
          },
        },
      };

      const res = await fetch(`/api/bookings/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as
        | ApiOk<{ booking: BookingDTO }>
        | ApiErr;
      if (!res.ok || !("ok" in json) || !json.ok) {
        throw new Error((json as ApiErr)?.error || "Failed to save booking");
      }

      router.push(`/modules/booking/${encodeURIComponent(id)}`);
    } catch (e: any) {
      setError(e?.message || "Failed to save booking");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelBooking() {
    if (!confirm("Cancel this booking? This sets status to CANCELED.")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELED" }),
      });
      const json = (await res.json()) as ApiOk<unknown> | ApiErr;
      if (!res.ok || !("ok" in json) || !json.ok) {
        throw new Error((json as ApiErr)?.error || "Failed to cancel booking");
      }
      router.push(`/modules/booking/${encodeURIComponent(id)}`);
    } catch (e: any) {
      setError(e?.message || "Failed to cancel booking");
    } finally {
      setSaving(false);
    }
  }

  // ---------------- UI ----------------

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Edit booking</h1>
          <Link
            href={`/modules/booking/${encodeURIComponent(id)}`}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            ← Back to view
          </Link>
        </div>
        <p className="text-sm text-gray-600">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Edit booking</h1>
          <Link
            href={`/modules/booking/${encodeURIComponent(id)}`}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            ← Back to view
          </Link>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Edit booking</h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/modules/booking/${encodeURIComponent(id)}`}
            className="rounded border px-3 py-1 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            ← Back to view
          </Link>
          <button
            type="button"
            onClick={handleCancelBooking}
            className="rounded bg-white px-3 py-1 text-sm text-amber-700 ring-1 ring-amber-200 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500"
            disabled={saving}
          >
            Cancel booking
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* What */}
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">What</h2>

          <label className="mb-2 block text-sm text-gray-700" htmlFor="subject">
            Subject
          </label>
          <input
            id="subject"
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mb-4 w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g., Morning Show"
            required
          />

          <label
            className="mb-2 block text-sm text-gray-700"
            htmlFor="newsroomName"
          >
            Newsroom name
          </label>
          <input
            id="newsroomName"
            name="newsroomName"
            value={newsroomName}
            onChange={(e) => setNewsroomName(e.target.value)}
            className="mb-4 w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g., Newsroom"
          />
        </div>

        {/* When */}
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">When</h2>

          <label
            className="mb-2 block text-sm text-gray-700"
            htmlFor="appearanceType"
          >
            Appearance
          </label>
          <select
            id="appearanceType"
            name="appearanceType"
            value={appearanceType}
            onChange={(e) => setAppearanceType(e.target.value as any)}
            className="mb-4 w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">—</option>
            <option value="ONLINE">ONLINE</option>
            <option value="IN_PERSON">IN_PERSON</option>
            <option value="PHONE">PHONE</option>
          </select>

          <label className="mb-2 block text-sm text-gray-700" htmlFor="startAt">
            Start at
          </label>
          <input
            id="startAt"
            name="startAt"
            type="datetime-local"
            value={startAtLocal}
            onChange={(e) => setStartAtLocal(e.target.value)}
            className="mb-4 w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />

          <label
            className="mb-2 block text-sm text-gray-700"
            htmlFor="durationMins"
          >
            Duration (mins)
          </label>
          <input
            id="durationMins"
            name="durationMins"
            type="number"
            min={1}
            value={durationMins}
            onChange={(e) =>
              setDurationMins(
                e.target.value === "" ? "" : Number(e.target.value)
              )
            }
            className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
        </div>

        {/* Non-host access controls (mirror New) */}
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">
            Participants — access & appearance (non-hosts)
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label
                className="mb-2 block text-sm text-gray-700"
                htmlFor="nhScope"
              >
                Appearance scope (non-hosts)
              </label>
              <select
                id="nhScope"
                value={nhAppearanceScope}
                onChange={(e) =>
                  setNhAppearanceScope(e.target.value as AppearanceScope)
                }
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="UNIFIED">UNIFIED (single)</option>
                <option value="PER_GUEST">PER_GUEST</option>
              </select>
            </div>

            <div>
              <label
                className="mb-2 block text-sm text-gray-700"
                htmlFor="nhProv"
              >
                Access provisioning (non-hosts)
              </label>
              <select
                id="nhProv"
                value={nhAccessProvisioning}
                onChange={(e) =>
                  setNhAccessProvisioning(e.target.value as AccessProvisioning)
                }
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="SHARED">SHARED</option>
                <option value="PER_GUEST">PER_GUEST</option>
              </select>
            </div>

            {nhAppearanceScope === "UNIFIED" ? (
              <div>
                <label
                  className="mb-2 block text-sm text-gray-700"
                  htmlFor="nhUnifiedType"
                >
                  Unified type (non-hosts)
                </label>
                <select
                  id="nhUnifiedType"
                  value={nhUnifiedType ?? ""}
                  onChange={(e) =>
                    setNhUnifiedType((e.target.value || null) as UnifiedType)
                  }
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="ONLINE">ONLINE</option>
                  <option value="IN_PERSON">IN_PERSON</option>
                  <option value="PHONE">PHONE</option>
                </select>
              </div>
            ) : null}

            <div className="md:col-span-2">
              <label
                className="mb-2 block text-sm text-gray-700"
                htmlFor="nhDefaultLink"
              >
                Default meeting link (non-hosts)
              </label>
              <input
                id="nhDefaultLink"
                value={nhDefaultLink}
                onChange={(e) => setNhDefaultLink(e.target.value)}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 break-words"
                placeholder="https://…"
              />
            </div>
          </div>
        </div>

        {/* Participants (read-only for this slice) */}
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">
            Participants
          </h2>
          {participants.length === 0 ? (
            <p className="text-sm text-gray-600">No participants yet.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {[...grouped.entries()].map(([label, items]) => (
                <div key={label} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-medium text-gray-800">{label}</div>
                    <div className="text-xs text-gray-500">
                      {items.length} {items.length === 1 ? "person" : "people"}
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {items.map((it) => (
                      <li
                        key={it.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="truncate">{it.displayName ?? "—"}</div>
                        <span className="rounded-full border px-2 py-0.5 text-xs text-gray-700">
                          {it.inviteStatus ?? "PENDING"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-gray-500">
            Editing participants will ship next; status is managed on the
            participant’s side.
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Link
            href={`/modules/booking/${encodeURIComponent(id)}`}
            className="rounded border px-3 py-2 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={disableSave}
            className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
