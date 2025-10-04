// app/modules/settings/modes-access/page.tsx

import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { headers, cookies } from "next/headers";
import { prisma } from "../../../../lib/prisma";

/** ===================== Types ===================== */
type ModeDto = {
  slot: number;
  active: boolean;
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

async function loadModesAndAccess(orgId: string): Promise<ModesApiResponse> {
  if (!orgId) return { modes: [], access: [] };

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}`;

  const url = `${base}/api/org/modes?orgId=${encodeURIComponent(orgId)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { modes: [], access: [] };

  const data = (await res.json()) as ModesApiResponse;
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
      p."id"               AS id,
      m."slot"            AS "modeSlot",
      m."label"           AS "modeLabel",
      f."label"           AS "label",
      p."value"           AS "details"
    FROM "OrganizationAccessPreset" p
    JOIN "OrganizationAccessField" f ON p."accessFieldId" = f."id"
    JOIN "OrganizationMode"        m ON p."modeId"       = m."id"
    WHERE m."orgId" = $1
    ORDER BY m."slot", f."label", p."value"
  `,
    orgId
  )) as ModeAccessRow[];

  return rows ?? [];
}

/**
 * Resolve orgId (server-only) WITHOUT importing authOptions.
 * Order of precedence:
 *   1) cookie candidates: orgId, org_id, org, oid
 *   2) /api/auth/session  (reads { orgId } or { user.orgId })
 *   3) /api/org/profile   (reads orgId/organizationId/id/org.id)
 */
async function resolveOrgIdServer(): Promise<string | null> {
  // 1) cookie candidates
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

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}`;
  const cookie = h.get("cookie") ?? "";

  // 2) /api/auth/session
  try {
    const sess = await fetch(`${base}/api/auth/session`, {
      cache: "no-store",
      headers: { cookie },
    });
    if (sess.ok) {
      const data = (await sess.json()) as any;
      const fromSession: string | undefined =
        (typeof data?.orgId === "string" && data.orgId) ||
        (typeof data?.user?.orgId === "string" && data.user.orgId) ||
        undefined;
      if (fromSession) return fromSession;
    }
  } catch {
    // ignore
  }

  // 3) /api/org/profile
  try {
    const res = await fetch(`${base}/api/org/profile`, {
      cache: "no-store",
      headers: { cookie },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const resolved: string | null =
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

/** ===================== Server actions — Modes (active + label only) ===================== */
async function saveMode(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") ?? "").trim();
  const slot = Number(formData.get("slot") ?? 0);
  const active = formData.get("active") != null;
  const labelRaw = String(formData.get("label") ?? "").trim();

  if (!orgId || !slot || slot < 1 || slot > 10) {
    revalidatePath("/modules/settings/modes-access");
    return;
  }

  const label = labelRaw ? labelRaw.slice(0, 80) : null;

  const updated = (await prisma.$executeRawUnsafe(
    `
    UPDATE "OrganizationMode"
       SET "active" = $3, "label" = $4
     WHERE "orgId" = $1 AND "slot" = $2
  `,
    orgId,
    slot,
    active,
    label
  )) as number;

  if (!updated) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "OrganizationMode" ("id","orgId","slot","active","label")
      VALUES ($1, $2, $3, $4, $5)
    `,
      `om_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      orgId,
      slot,
      active,
      label
    );
  }

  revalidatePath("/modules/settings/modes-access");
}

async function resetMode(formData: FormData) {
  "use server";

  const orgId = String(formData.get("orgId") ?? "").trim();
  const slot = Number(formData.get("slot") ?? 0);

  if (!orgId || !slot || slot < 1 || slot > 10) {
    revalidatePath("/modules/settings/modes-access");
    return;
  }

  const updated = (await prisma.$executeRawUnsafe(
    `
    UPDATE "OrganizationMode"
       SET "active" = false, "label" = NULL
     WHERE "orgId" = $1 AND "slot" = $2
  `,
    orgId,
    slot
  )) as number;

  if (!updated) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "OrganizationMode" ("id","orgId","slot","active","label")
      VALUES ($1, $2, $3, false, NULL)
    `,
      `om_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
      orgId,
      slot
    );
  }

  revalidatePath("/modules/settings/modes-access");
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

  const modeRow = (await prisma.$queryRawUnsafe<
    { id: string; active: boolean }[]
  >(
    `SELECT "id","active" FROM "OrganizationMode" WHERE "orgId" = $1 AND "slot" = $2 LIMIT 1`,
    orgId,
    modeSlot
  )) as { id: string; active: boolean }[];
  const modeId = modeRow?.[0]?.id;
  if (!modeId) throw new Error("Mode not found. Save the Mode first.");

  const key = (toSlug(labelRaw) || `access-${Date.now().toString(36)}`).slice(
    0,
    40
  );
  const label = labelRaw.slice(0, 80);
  const details = detailsRaw.slice(0, 240);

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "OrganizationAccessField" ("id","orgId","key","label")
    VALUES ($1, $2, $3, $4)
    ON CONFLICT ("orgId","key")
    DO UPDATE SET "label" = EXCLUDED."label"
  `,
    `accf_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    orgId,
    key,
    label
  );

  const fieldRow = (await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "OrganizationAccessField" WHERE "orgId" = $1 AND "key" = $2 LIMIT 1`,
    orgId,
    key
  )) as { id: string }[];
  const accessFieldId = fieldRow?.[0]?.id;
  if (!accessFieldId) throw new Error("Failed to create access field.");

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "OrganizationAccessPreset" ("id","accessFieldId","value","modeId")
    SELECT $1, $2, $3, $4
    WHERE NOT EXISTS (
      SELECT 1 FROM "OrganizationAccessPreset"
      WHERE "accessFieldId" = $2 AND "value" = $3 AND "modeId" = $4
    )
  `,
    `apre_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    accessFieldId,
    details,
    modeId
  );

  revalidatePath("/modules/settings/modes-access");
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
  // 1) URL (override if provided)
  const orgIdFromQuery =
    (Array.isArray(searchParams.orgId)
      ? searchParams.orgId[0]
      : searchParams.orgId) || "";

  // 2) Fallback to server resolution (cookies → /api/auth/session → /api/org/profile)
  const orgId = orgIdFromQuery || (await resolveOrgIdServer()) || "";

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Modes &amp; access
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Create Modes (1..10), then add Access entries linked to a Mode with
            just a Label and Details.
          </p>
        </div>
        <Link
          href="/modules/settings"
          className="rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Settings
        </Link>
      </header>

      <div className="mb-4 text-sm text-neutral-500">Org: {orgId || "—"}</div>

      {!orgId ? (
        <div className="rounded-2xl border border-dashed p-6 text-sm text-neutral-700">
          <p className="mb-1 font-medium">No organization provided.</p>
          <p>
            Append <code>?orgId=YOUR_ORG_ID</code> to manage Modes &amp; Access,
            or sign in so we can detect your org automatically.
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
      {/* Slot pills */}
      <SlotPills modes={modes} />

      {/* MODES (activate + label) */}
      <Section
        title="Mode slots"
        description="Activate and label up to 10 Modes."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((slot) => {
            const m = bySlot.get(slot);
            const saveFormId = `save-mode-${slot}`;
            const resetFormId = `reset-mode-${slot}`;
            return (
              <div key={slot} className="rounded-2xl border p-4">
                <div className="mb-3 font-medium">Mode {slot}</div>

                {/* SAVE form */}
                <form id={saveFormId} action={saveMode} className="contents">
                  <input type="hidden" name="orgId" value={orgId} />
                  <input type="hidden" name="slot" value={slot} />

                  <div className="mb-2 flex items-center gap-3">
                    <label className="text-sm">Active</label>
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={!!m?.active}
                      className="size-4 accent-black"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="mb-1 block text-sm">Label</label>
                    <input
                      type="text"
                      name="label"
                      defaultValue={m?.label ?? ""}
                      placeholder={`Mode ${slot}`}
                      className="w-full rounded-lg border px-3 py-1.5 text-sm"
                    />
                  </div>
                </form>

                <div className="flex gap-2">
                  <button
                    form={saveFormId}
                    type="submit"
                    className="rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
                  >
                    Save
                  </button>

                  {/* Hidden reset form */}
                  <form id={resetFormId} action={resetMode} className="hidden">
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="slot" value={slot} />
                  </form>

                  <button
                    form={resetFormId}
                    type="submit"
                    className="rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
                  >
                    Reset
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ACCESS (Mode + Label + Details) */}
      <Section
        title="Access"
        description='Add quick-access entries for each Mode, e.g., label "HQ address" with details like "123 Queens Street".'
      >
        <div className="grid grid-cols-1 gap-4">
          <AddAccessForm orgId={orgId} />
          <AccessList orgId={orgId} />
        </div>
      </Section>
    </>
  );
}

/** ===== Small UI helpers (unchanged visual design) ===== */
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
    <section className="mb-6">
      <details className="group rounded-2xl border p-4 open:shadow-sm" open>
        <summary className="flex cursor-pointer list-none items-center justify-between">
          <span className="text-base font-medium">{title}</span>
          <span className="text-xs text-neutral-500 group-open:hidden">
            expand
          </span>
          <span className="hidden text-xs text-neutral-500 group-open:inline">
            collapse
          </span>
        </summary>
        {description ? (
          <p className="mt-2 text-sm text-neutral-600">{description}</p>
        ) : null}
        <div className="mt-4">{children}</div>
      </details>
    </section>
  );
}

function SlotPills({ modes }: { modes: ModeDto[] }) {
  const activeSlots = new Set(modes.filter((m) => m.active).map((m) => m.slot));
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const isActive = activeSlots.has(n);
        return (
          <span
            key={n}
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${
              isActive ? "bg-black text-white" : "bg-white text-neutral-700"
            }`}
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

  return (
    <form action={createModeAccess} className="rounded-2xl border p-4">
      <input type="hidden" name="orgId" value={orgId} />

      <h3 className="mb-3 text-sm font-medium">Add access</h3>
      <p className="mb-4 text-xs text-neutral-500">
        Example: Mode “In-Person”, Label “HQ address”, Details “123 Queens
        Street…”.
      </p>

      <div className="mb-3">
        <label className="mb-1 block text-sm">Mode</label>
        <select
          name="modeSlot"
          className="w-full rounded-lg border px-3 py-1.5 text-sm"
          defaultValue=""
          required
        >
          <option value="" disabled>
            Select mode
          </option>
          {modes
            .filter((m) => m.active)
            .map((m) => (
              <option key={m.slot} value={m.slot}>
                {m.label || `Mode ${m.slot}`}
              </option>
            ))}
        </select>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-sm">Label</label>
        <input
          type="text"
          name="label"
          className="w-full rounded-lg border px-3 py-1.5 text-sm"
          placeholder="e.g., Link, Address, Dial-in"
          required
        />
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-sm">Details</label>
        <input
          type="text"
          name="details"
          className="w-full rounded-lg border px-3 py-1.5 text-sm"
          placeholder="Paste the link or address here"
          required
        />
      </div>

      <button
        type="submit"
        className="rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
      >
        Save access
      </button>
    </form>
  );
}

async function AccessList({ orgId }: { orgId: string }) {
  const accesses = await loadModeAccesses(orgId);

  if (accesses.length === 0) {
    return (
      <div className="rounded-2xl border p-4 text-sm text-neutral-600">
        No access entries yet.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border p-4">
      <h3 className="mb-3 text-sm font-medium">Existing access</h3>
      <ul className="space-y-3">
        {accesses.map((row) => (
          <li
            key={row.id}
            className="flex flex-col items-start justify-between gap-2 rounded-lg border p-3 md:flex-row md:items-center"
          >
            <div className="text-sm">
              <div className="font-medium">
                {row.modeLabel || `Mode ${row.modeSlot}`}
              </div>
              <div className="text-neutral-700">{row.label}</div>
              <div className="text-neutral-500">{row.details}</div>
            </div>

            <form action={deleteModeAccess}>
              <input type="hidden" name="id" value={row.id} />
              <button
                type="submit"
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                Delete
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
