// app/modules/settings/modes-access/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "../../../../lib/prisma";

/** ===================== Types ===================== */
type ModeDto = {
  slot: number;
  active: boolean; // computed by API: row existence for (orgId, slot)
  label?: string | null;
  accessFieldLabel?: string | null; // read-only join
  presets?: string[];
};

type ModesApiResponse = {
  modes: ModeDto[];
  access: { key: string; label: string; presets?: string[] }[];
};

type ModeAccessRow = {
  id: string;
  modeSlot: number;
  modeLabel: string | null;
  label: string;
  details: string;
};

/** ===================== Helpers ===================== */
function toSlug(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function makeId(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2)}${Date.now().toString(
    36
  )}`;
}

async function loadModesAndAccess(orgId: string): Promise<ModesApiResponse> {
  if (!orgId) return { modes: [], access: [] };

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}`;

  const url = `${base}/api/org/modes?orgId=${encodeURIComponent(orgId)}`;

  // Forward cookies so the API doesn't redirect to /auth/signin (HTML).
  const res = await fetch(url, {
    cache: "no-store",
    headers: { cookie: h.get("cookie") ?? "" },
  });

  // If we got HTML or a non-OK, fail safe (prevents "<!DOCTYPE" JSON crash).
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (!res.ok || !ctype.includes("application/json")) {
    return { modes: [], access: [] };
  }

  const data = (await res.json().catch(() => null)) as ModesApiResponse | null;
  if (!data || !Array.isArray(data.modes) || !Array.isArray(data.access)) {
    return { modes: [], access: [] };
  }
  return data;
}

async function loadModeAccesses(orgId: string): Promise<ModeAccessRow[]> {
  const rows = (await prisma.$queryRawUnsafe<
    {
      id: string;
      modeSlot: number;
      modeLabel: string | null;
      label: string;
      details: string;
    }[]
  >(
    `
    SELECT
      p."id"                         AS id,
      m."slot"                       AS "modeSlot",
      m."label"                      AS "modeLabel",
      f."label"                      AS "label",
      p."value"                      AS "details"
    FROM "OrganizationAccessPreset" p
    JOIN "OrganizationAccessField" f ON p."accessFieldId" = f."id"
    JOIN "OrganizationMode"       m ON p."orgModeId"      = m."id"
    WHERE m."orgId" = $1
    ORDER BY m."slot", f."label", p."value"
  `,
    orgId
  )) as ModeAccessRow[];

  return rows ?? [];
}

/**
 * Resolve orgId (server-only).
 * Try cookie first, then /api/org/profile.
 */
async function resolveOrgIdServer(): Promise<string | null> {
  try {
    const c = cookies();
    const fromCookie =
      c.get("orgId")?.value ??
      c.get("org_id")?.value ??
      c.get("org")?.value ??
      c.get("oid")?.value ??
      "";
    if (fromCookie) return fromCookie;
  } catch {
    // ignore
  }

  try {
    const h = headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    const base = `${proto}://${host}`;

    const res = await fetch(`${base}/api/org/profile`, {
      cache: "no-store",
      headers: { cookie: h.get("cookie") ?? "" },
    });
    if (!res.ok) return null;

    const data = (await res.json().catch(() => ({} as any))) as any;

    const resolved =
      (typeof data?.orgId === "string" && data.orgId) ||
      (typeof data?.organizationId === "string" && data.organizationId) ||
      (typeof data?.id === "string" && data.id) ||
      (typeof data?.org?.id === "string" && data.org.id) ||
      null;

    return resolved || null;
  } catch {
    return null;
  }
}

/** ===================== Server actions — Modes ===================== */
/**
 * Save behavior:
 * - If a label is provided OR active checkbox is checked → upsert via API (becomes active).
 * - If checkbox is unchecked AND no label → delete the row (becomes inactive).
 */
async function saveMode(formData: FormData) {
  "use server";
  const orgId = String(formData.get("orgId") ?? "").trim();
  const slot = Number(formData.get("slot") ?? 0);
  const activeVal = String(formData.get("active") ?? ""); // "on" when checked
  const labelRaw = String(formData.get("label") ?? "").trim();

  if (!orgId || !slot || slot < 1 || slot > 10) {
    revalidatePath("/modules/settings/modes-access");
    return;
  }

  const wantsActive = activeVal === "on" || !!labelRaw;
  const label = labelRaw || `Mode ${slot}`;

  if (wantsActive) {
    // Upsert through the API — forward cookies so it doesn't redirect to /auth/signin.
    const h = headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    const base = `${proto}://${host}`;
    const cookie = h.get("cookie") ?? "";

    const res = await fetch(`${base}/api/org/modes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        action: "mode:update",
        orgId,
        slot,
        label,
      }),
      cache: "no-store",
    });

    // Non-JSON? bail quietly but keep UX stable.
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok || !ctype.includes("application/json")) {
      revalidatePath("/modules/settings/modes-access");
      redirect(
        `/modules/settings/modes-access?orgId=${encodeURIComponent(orgId)}`
      );
      return;
    }
  } else {
    // Explicit inactivate: remove the row; presets cascade via FK.
    await prisma.$executeRawUnsafe(
      `DELETE FROM "OrganizationMode" WHERE "orgId" = $1 AND "slot" = $2`,
      orgId,
      slot
    );
  }

  revalidatePath("/modules/settings/modes-access");
  redirect(
    `/modules/settings/modes-access?orgId=${encodeURIComponent(orgId)}&saved=1`
  );
}

/** ===================== Server actions — Access (Mode, Label, Details) ===================== */
async function createModeAccess(formData: FormData) {
  "use server";
  const orgId = String(formData.get("orgId") ?? "").trim();
  const modeSlot = Number(formData.get("modeSlot") ?? 0);
  const labelRaw = String(formData.get("label") ?? "").trim();
  const detailsRaw = String(formData.get("details") ?? "").trim();

  if (!orgId) throw new Error("Missing orgId.");
  if (!modeSlot || modeSlot < 1 || modeSlot > 10)
    throw new Error("Mode is required.");
  if (!labelRaw) throw new Error("Label is required.");
  if (!detailsRaw) throw new Error("Details are required.");

  // Ensure the mode row exists for (orgId, slot) and get its id
  const ensured = (await prisma.$queryRawUnsafe<{ id: string }[]>(
    `
    WITH upsert AS (
      INSERT INTO "OrganizationMode" ("id","orgId","slot","label","updatedAt")
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT ("orgId","slot")
      DO UPDATE SET "updatedAt" = NOW()
      RETURNING "id"
    )
    SELECT "id" FROM upsert
    `,
    makeId("om_"),
    orgId,
    modeSlot,
    `Mode ${modeSlot}`
  )) as { id: string }[];

  const orgModeId = ensured?.[0]?.id;
  if (!orgModeId) throw new Error("Mode not found. Save the Mode first.");

  // Access field is GLOBAL (no orgId). Upsert by key, with timestamps.
  const key = (toSlug(labelRaw) || `access-${Date.now().toString(36)}`).slice(
    0,
    40
  );
  const label = labelRaw.slice(0, 80);
  const details = detailsRaw.slice(0, 240);

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "OrganizationAccessField" ("id","key","label","createdAt","updatedAt")
    VALUES ($1, $2, $3, NOW(), NOW())
    ON CONFLICT ("key")
    DO UPDATE SET "label" = EXCLUDED."label", "updatedAt" = NOW()
    `,
    makeId("accf_"),
    key,
    label
  );

  const fieldRow = (await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "OrganizationAccessField" WHERE "key" = $1 LIMIT 1`,
    key
  )) as { id: string }[];
  const accessFieldId = fieldRow?.[0]?.id;
  if (!accessFieldId)
    throw new Error("Failed to create or fetch access field.");

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "OrganizationAccessPreset" ("id","accessFieldId","value","orgModeId","createdAt","updatedAt")
    SELECT $1, $2, $3, $4, NOW(), NOW()
    WHERE NOT EXISTS (
      SELECT 1
      FROM "OrganizationAccessPreset"
      WHERE "accessFieldId" = $2 AND "value" = $3 AND "orgModeId" = $4
    )
    `,
    makeId("apre_"),
    accessFieldId,
    details,
    orgModeId
  );

  revalidatePath("/modules/settings/modes-access");
  // Force a fresh render so the form fields reset to their initial (empty) state.
  redirect(
    `/modules/settings/modes-access?orgId=${encodeURIComponent(orgId)}&saved=1`
  );
}

async function deleteModeAccess(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "").trim();
  if (!id) {
    revalidatePath("/modules/settings/modes-access");
    return;
  }

  await prisma.$executeRawUnsafe(
    `DELETE FROM "OrganizationAccessPreset" WHERE "id" = $1`,
    id
  );

  // GC unreferenced global fields
  await prisma.$executeRawUnsafe(`
    DELETE FROM "OrganizationAccessField"
    WHERE "id" IN (
      SELECT f."id"
      FROM "OrganizationAccessField" f
      LEFT JOIN "OrganizationAccessPreset" p ON p."accessFieldId" = f."id"
      WHERE p."id" IS NULL
    )
  `);

  revalidatePath("/modules/settings/modes-access");
}

/** ===================== Page ===================== */
export const metadata: Metadata = {
  title: "Modes & access — Settings",
};

export default async function ModesAndAccessPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const orgIdFromQuery =
    (Array.isArray(searchParams.orgId)
      ? searchParams.orgId[0]
      : searchParams.orgId) || "";

  if (!orgIdFromQuery) {
    const resolved = await resolveOrgIdServer();
    if (resolved) {
      redirect(
        `/modules/settings/modes-access?orgId=${encodeURIComponent(resolved)}`
      );
    }
  }

  const orgId = orgIdFromQuery;
  const justSaved = searchParams.saved === "1";

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Modes & access
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Create Modes (1..10), then add Access entries linked to a Mode with
            just a Label and Details.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {justSaved ? (
            <span className="inline-flex items-center rounded-full border px-2 py-1 text-xs">
              Saved
            </span>
          ) : null}
          <Link
            href="/modules/settings"
            className="inline-flex h-9 items-center rounded-xl border px-3 text-sm"
          >
            Settings
          </Link>
        </div>
      </header>

      {/* Org line removed per request */}

      {!orgId ? (
        <div className="rounded-xl border p-4 text-sm">
          <p className="font-medium">No organization provided.</p>
          <p className="mt-1">
            Append <code>?orgId=YOUR_ORG_ID</code> to manage Modes &amp; Access.
          </p>
        </div>
      ) : (
        <Content orgId={orgId} />
      )}
    </main>
  );
}

/** ===================== Content ===================== */
async function Content({ orgId }: { orgId: string }) {
  const { modes } = await loadModesAndAccess(orgId);
  const bySlot = new Map<number, ModeDto>();
  modes.forEach((m) => bySlot.set(m.slot, m));

  return (
    <>
      {/* MODES (activate + label) */}
      <Section title="Modes">
        <div role="table" className="grid grid-cols-12 gap-2 text-sm">
          <div role="row" className="contents text-neutral-500">
            <div role="columnheader" className="col-span-2">
              Slot
            </div>
            <div role="columnheader" className="col-span-3">
              Active
            </div>
            <div role="columnheader" className="col-span-5">
              Label
            </div>
            <div role="columnheader" className="col-span-2 text-right">
              Actions
            </div>
          </div>

          {Array.from({ length: 10 }, (_, i) => i + 1).map((slot) => {
            const m = bySlot.get(slot);

            return (
              <div key={slot} role="row" className="contents items-center">
                <div className="col-span-2 py-2 font-medium">Mode {slot}</div>

                <form action={saveMode} className="contents">
                  <input type="hidden" name="orgId" value={orgId} />
                  <input type="hidden" name="slot" value={slot} />

                  <div className="col-span-3 flex items-center gap-3 py-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={!!m?.active}
                        aria-label="active"
                      />
                      <span className="text-neutral-600">active</span>
                    </label>
                  </div>

                  <div className="col-span-5 py-2">
                    <input
                      name="label"
                      defaultValue={m?.label ?? ""}
                      placeholder="Optional mode label"
                      className="w-full rounded-xl border px-3 py-2"
                    />
                  </div>

                  <div className="col-span-2 py-2 text-right">
                    <button
                      type="submit"
                      className="inline-flex h-9 items-center rounded-xl border px-3"
                    >
                      Save
                    </button>
                  </div>
                </form>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ACCESS (Mode + Label + Details) */}
      <Section title="Access">
        <AddAccessForm orgId={orgId} />
        <AccessList orgId={orgId} />
      </Section>
    </>
  );
}

/** ===== Small UI helpers ===== */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <details open className="mb-8 rounded-2xl border">
      <summary className="flex cursor-pointer select-none items-center justify-between p-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-neutral-600">{description}</p>
          ) : null}
        </div>
        <span aria-hidden>▾</span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function SlotPills({ modes }: { modes: ModeDto[] }) {
  const activeSlots = new Set(modes.filter((m) => m.active).map((m) => m.slot));
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const isActive = activeSlots.has(n);
        return (
          <span
            key={n}
            className={[
              "inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs",
              isActive ? "font-semibold" : "opacity-50",
            ].join(" ")}
            aria-pressed={isActive}
            aria-label={`Mode ${n} ${isActive ? "active" : "inactive"}`}
          >
            {n}
          </span>
        );
      })}
    </div>
  );
}

async function AddAccessForm({ orgId }: { orgId: string }) {
  const { modes } = await loadModesAndAccess(orgId);

  // Force a fresh form mount on each render so inputs reset after a save/redirect
  const formKey = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2)}`;

  return (
    <form
      key={formKey}
      action={createModeAccess}
      className="mb-6 grid grid-cols-12 gap-2 text-sm"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <div className="col-span-3">
        <label className="mb-1 block text-xs text-neutral-500">Mode</label>
        <select
          name="modeSlot"
          defaultValue=""
          className="w-full rounded-xl border px-3 py-2"
          required
        >
          <option value="">Select mode</option>
          {modes
            .filter((m) => m.active)
            .map((m) => (
              <option key={m.slot} value={m.slot}>
                {m.label || `Mode ${m.slot}`}
              </option>
            ))}
        </select>
      </div>
      <div className="col-span-4">
        <label className="mb-1 block text-xs text-neutral-500">Label</label>
        <input
          name="label"
          defaultValue=""
          placeholder="e.g., HQ address"
          className="w-full rounded-xl border px-3 py-2"
          required
        />
      </div>
      <div className="col-span-4">
        <label className="mb-1 block text-xs text-neutral-500">Details</label>
        <input
          name="details"
          defaultValue=""
          placeholder="e.g., 123 Queens Street…"
          className="w-full rounded-xl border px-3 py-2"
          required
        />
      </div>
      <div className="col-span-1 flex items-end justify-end">
        <button
          type="submit"
          className="inline-flex h-9 items-center rounded-xl border px-3"
        >
          Save
        </button>
      </div>
    </form>
  );
}

async function AccessList({ orgId }: { orgId: string }) {
  const accesses = await loadModeAccesses(orgId);

  if (accesses.length === 0) {
    return (
      <div className="rounded-xl border p-4 text-sm text-neutral-600">
        No access entries yet.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {accesses.map((row) => (
        <li
          key={row.id}
          className="grid grid-cols-12 items-start gap-2 rounded-xl border p-3 text-sm"
        >
          <div className="col-span-3 font-medium">
            {row.modeLabel || `Mode ${row.modeSlot}`}
          </div>
          <div className="col-span-3">{row.label}</div>
          <div className="col-span-5">{row.details}</div>
          <div className="col-span-1 text-right">
            <form action={deleteModeAccess}>
              <input type="hidden" name="id" value={row.id} />
              <button
                type="submit"
                className="inline-flex h-8 items-center rounded-xl border px-3 text-xs"
              >
                Delete
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}
