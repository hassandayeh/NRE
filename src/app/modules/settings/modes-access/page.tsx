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
  if (!data || !Array.isArray(data.modes) || !Array.isArray(data.access))
    return { modes: [], access: [] };
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
    SELECT p."id" AS id,
           m."slot" AS "modeSlot",
           m."label" AS "modeLabel",
           f."label" AS "label",
           p."value" AS "details"
    FROM "OrganizationAccessPreset" p
    JOIN "OrganizationAccessField" f ON p."accessFieldId" = f."id"
    JOIN "OrganizationMode" m ON p."modeId" = m."id"
    WHERE m."orgId" = $1
    ORDER BY m."slot", f."label", p."value"
  `,
    orgId
  )) as ModeAccessRow[];

  return rows ?? [];
}

/** Resolve orgId (server-only). Try cookie first, then /api/org/profile. */
async function resolveOrgIdServer(): Promise<string | null> {
  // 1) common cookies used across org-aware pages
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
    // no-op
  }

  // 2) fallback to profile endpoint with forwarded cookies
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

    const data = await res.json().catch(() => ({} as any));
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

  const baseKey = toSlug(labelRaw) || `access-${Date.now().toString(36)}`;
  const key = baseKey.slice(0, 40);
  const label = labelRaw.slice(0, 80);
  const details = detailsRaw.slice(0, 240);

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "OrganizationAccessField" ("id","orgId","key","label")
      VALUES ($1, $2, $3, $4)
      ON CONFLICT ("orgId","key") DO UPDATE SET "label" = EXCLUDED."label"
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
  // 1) Read from query
  const orgIdFromQuery =
    (Array.isArray(searchParams.orgId)
      ? searchParams.orgId[0]
      : searchParams.orgId) || "";

  // 2) If missing, resolve server-side and redirect with ?orgId=...
  if (!orgIdFromQuery) {
    const resolved = await resolveOrgIdServer();
    if (resolved) {
      redirect(
        `/modules/settings/modes-access?orgId=${encodeURIComponent(resolved)}`
      );
    }
  }

  const orgId = orgIdFromQuery;

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
          <p className="mt-2 text-xs text-neutral-500">
            <span className="font-medium">Org:</span> {orgId || "—"}
          </p>
        </div>
        <Link
          href={`/modules/settings${
            orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""
          }`}
          className="inline-flex h-9 items-center rounded-xl border border-neutral-200 bg-white px-3 text-sm hover:bg-neutral-50"
        >
          Settings
        </Link>
      </header>

      {!orgId ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-medium">No organization provided.</p>
          <p className="mt-1">
            Append{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5">
              ?orgId=YOUR_ORG_ID
            </code>{" "}
            to manage Modes &amp; Access.
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
    <div className="space-y-8">
      {/* Slot pills */}
      <section className="mb-2">
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Mode slots
        </h2>
        <SlotPills modes={modes} />
      </section>

      {/* MODES (activate + label) */}
      <Section
        title="Modes"
        description="Activate a slot (1..10) and set its label."
      >
        <div className="overflow-hidden rounded-xl border border-neutral-200">
          <div className="grid grid-cols-12 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-700">
            <div className="col-span-3">Slot</div>
            <div className="col-span-3">Active</div>
            <div className="col-span-4">Label</div>
            <div className="col-span-2">Actions</div>
          </div>
          <ul className="divide-y divide-neutral-200">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((slot) => {
              const m = bySlot.get(slot);
              const saveFormId = `save-mode-${slot}`;
              const resetFormId = `reset-mode-${slot}`;

              return (
                <li
                  key={slot}
                  className="grid grid-cols-12 items-center px-4 py-3"
                >
                  <div className="col-span-3 text-sm text-neutral-800">
                    Mode {slot}
                  </div>

                  {/* SAVE form uses "contents" to span columns */}
                  <form id={saveFormId} action={saveMode} className="contents">
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="slot" value={slot} />

                    <div className="col-span-3">
                      <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
                        <input
                          name="active"
                          type="checkbox"
                          defaultChecked={!!m?.active}
                          className="peer relative h-5 w-9 cursor-pointer appearance-none rounded-full bg-neutral-300 outline-none transition-colors
                                     before:absolute before:left-0.5 before:top-0.5 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform
                                     checked:bg-neutral-900 checked:before:translate-x-4"
                          role="switch"
                          aria-checked={!!m?.active}
                        />
                        <span className="text-xs text-neutral-600 peer-checked:hidden">
                          inactive
                        </span>
                        <span className="hidden text-xs text-neutral-600 peer-checked:inline">
                          active
                        </span>
                      </label>
                    </div>

                    <div className="col-span-4">
                      <input
                        name="label"
                        type="text"
                        placeholder="Label"
                        defaultValue={m?.label ?? ""}
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="col-span-2">
                      <div className="flex items-center justify-start gap-2">
                        <button
                          type="submit"
                          className="inline-flex h-9 items-center rounded-xl border border-neutral-200 bg-white px-3 text-sm hover:bg-neutral-50"
                        >
                          Save
                        </button>
                        <button
                          type="submit"
                          form={resetFormId}
                          className="inline-flex h-9 items-center rounded-xl border border-neutral-200 bg-white px-3 text-sm hover:bg-neutral-50"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* Hidden reset form */}
                  <form id={resetFormId} action={resetMode} className="hidden">
                    <input type="hidden" name="orgId" value={orgId} />
                    <input type="hidden" name="slot" value={slot} />
                  </form>
                </li>
              );
            })}
          </ul>
        </div>
      </Section>

      {/* ACCESS (Mode + Label + Details) */}
      <Section
        title="Access"
        description="Add Access entries by selecting a Mode, giving them a Label, and entering Details (e.g., address or call link)."
      >
        <AddAccessForm orgId={orgId} />
        <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200">
          <div className="grid grid-cols-12 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-700">
            <div className="col-span-3">Mode</div>
            <div className="col-span-4">Label</div>
            <div className="col-span-3">Details</div>
            <div className="col-span-2">Actions</div>
          </div>
          <AccessList orgId={orgId} />
        </div>
      </Section>
    </div>
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
    <details className="rounded-2xl border border-neutral-200 bg-white shadow-sm open:shadow-md">
      <summary className="list-none cursor-pointer select-none rounded-2xl px-5 py-4 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-neutral-600">{description}</p>
            ) : null}
          </div>
          <span aria-hidden className="ml-4 inline-block text-neutral-400">
            ▾
          </span>
        </div>
      </summary>
      <div className="border-t border-neutral-200 px-5 py-5">{children}</div>
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
              "inline-flex items-center rounded-full px-3 py-1 text-sm",
              isActive
                ? "bg-neutral-900 text-white"
                : "border border-dashed border-neutral-300 text-neutral-600",
            ].join(" ")}
            aria-label={`Mode slot ${n} (${isActive ? "active" : "inactive"})`}
            title={`Mode slot ${n} (${isActive ? "active" : "inactive"})`}
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
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <h3 className="text-sm font-medium text-neutral-900">Add access</h3>
      <p className="mt-1 text-xs text-neutral-500">
        Example: Mode “In-Person”, Label “HQ address”, Details “123 Queens
        Street…”.
      </p>

      <form
        action={createModeAccess}
        className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-5"
      >
        <input type="hidden" name="orgId" value={orgId} />

        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-700">Mode</span>
          <select
            name="modeSlot"
            required
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
            defaultValue=""
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
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-700">Label</span>
          <input
            name="label"
            required
            placeholder="HQ address, Zoom, Teams…"
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
          />
        </label>

        <label className="md:col-span-2 flex flex-col gap-1">
          <span className="text-xs text-neutral-700">Details</span>
          <input
            name="details"
            required
            placeholder="123 Queens Street…, https://…"
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
          />
        </label>

        <div className="flex items-end">
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-xl border border-neutral-200 bg-white px-3 text-sm hover:bg-neutral-50 disabled:opacity-50"
            title="Create access"
          >
            Save access
          </button>
        </div>
      </form>
    </div>
  );
}

async function AccessList({ orgId }: { orgId: string }) {
  const accesses = await loadModeAccesses(orgId);
  if (accesses.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-neutral-700">
        No access entries yet.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-neutral-200">
      {accesses.map((row) => (
        <li key={row.id} className="grid grid-cols-12 items-center px-4 py-3">
          <div className="col-span-3 text-sm text-neutral-800">
            {row.modeLabel || `Mode ${row.modeSlot}`}
          </div>
          <div className="col-span-4 text-sm text-neutral-800">{row.label}</div>
          <div className="col-span-3 text-sm text-neutral-800 truncate">
            {row.details}
          </div>
          <div className="col-span-2">
            <form action={deleteModeAccess} className="flex justify-end">
              <input type="hidden" name="id" value={row.id} />
              <button
                type="submit"
                className="inline-flex h-8 items-center rounded-lg border border-neutral-200 bg-white px-2 text-xs hover:bg-neutral-50"
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
