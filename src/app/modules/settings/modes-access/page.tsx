// app/modules/settings/modes-access/page.tsx
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "../../../../lib/prisma";

type ModeDto = {
  slot: number;
  active: boolean;
  label?: string;
  accessFieldLabel?: string;
  presets?: string[];
};

type AccessFieldDto = {
  key: string;
  label: string;
  presets?: string[];
};

type ModesApiResponse = { modes: ModeDto[]; access: AccessFieldDto[] };

// ========== Helpers ==========
function toSlug(input: string): string {
  // Normalize to kebab-case slug: letters/numbers/dash only
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

// Build absolute URL and fetch with orgId (no-store)
async function loadModesAndAccess(orgId: string): Promise<ModesApiResponse> {
  if (!orgId) return { modes: [], access: [] };

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}`;
  const url = new URL(
    `/api/org/modes?orgId=${encodeURIComponent(orgId)}`,
    base
  ).toString();

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { modes: [], access: [] };
  const data = (await res.json()) as ModesApiResponse;
  if (!data || !Array.isArray(data.modes) || !Array.isArray(data.access))
    return { modes: [], access: [] };
  return data;
}

// ========== Server actions ==========

// Create Access Field (+ optional presets)
async function createAccessField(formData: FormData) {
  "use server";
  const orgId = String(formData.get("orgId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const keyRaw = String(formData.get("key") ?? "").trim();
  const presetsCsv = String(formData.get("presets") ?? "").trim();

  if (!orgId) throw new Error("Missing orgId.");
  if (!label) throw new Error("Label is required.");
  if (!keyRaw) throw new Error("Key is required.");

  const key = toSlug(keyRaw).slice(0, 40); // enforce slug + length cap
  if (!key) throw new Error("Key must contain letters/numbers.");

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
    label.slice(0, 80)
  );

  // Fetch field id
  const fieldRow = (await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "OrganizationAccessField" WHERE "orgId" = $1 AND "key" = $2 LIMIT 1`,
    orgId,
    key
  )) as { id: string }[];
  const fieldId = fieldRow?.[0]?.id;

  // Insert presets (unique per field)
  if (fieldId && presetsCsv) {
    const values = presetsCsv
      .split(",")
      .map((s) => toSlug(s).replace(/-/g, " ").trim()) // store human-friendly but normalized
      .filter(Boolean);
    for (const v of values) {
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "OrganizationAccessPreset" ("id","accessFieldId","value")
        SELECT $1, $2, $3
        WHERE NOT EXISTS (
          SELECT 1 FROM "OrganizationAccessPreset"
          WHERE "accessFieldId" = $2 AND "value" = $3
        )
      `,
        `apre_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
        fieldId,
        v.slice(0, 120)
      );
    }
  }

  revalidatePath("/modules/settings/modes-access");
}

// Delete Access Field (and its presets)
async function deleteAccessField(formData: FormData) {
  "use server";
  const orgId = String(formData.get("orgId") ?? "").trim();
  const key = String(formData.get("key") ?? "").trim(); // use exact stored key (no slug), so legacy rows can be removed

  if (!orgId || !key) return;

  // get field id
  const row = (await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "OrganizationAccessField" WHERE "orgId" = $1 AND "key" = $2 LIMIT 1`,
    orgId,
    key
  )) as { id: string }[];
  const fieldId = row?.[0]?.id;
  if (!fieldId) {
    revalidatePath("/modules/settings/modes-access");
    return;
  }

  // delete presets first (no FK cascade in DB)
  await prisma.$executeRawUnsafe(
    `DELETE FROM "OrganizationAccessPreset" WHERE "accessFieldId" = $1`,
    fieldId
  );
  // delete the field
  await prisma.$executeRawUnsafe(
    `DELETE FROM "OrganizationAccessField" WHERE "id" = $1`,
    fieldId
  );

  revalidatePath("/modules/settings/modes-access");
}

// ========== Page ==========

export default async function ModesAndAccessPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const orgId =
    (Array.isArray(searchParams.orgId)
      ? searchParams.orgId[0]
      : searchParams.orgId) || "";

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Modes &amp; Access
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Configure appearance modes and access fields for your organization.
          This is the scalable “slot + label + presets” model (Mode 1…10; Access
          fields with presets).
        </p>

        <div className="mt-4 flex items-center gap-3">
          <Link
            href="/modules/settings"
            className="inline-flex items-center rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
          >
            ← Back to Settings
          </Link>
          <span className="text-xs text-neutral-500">
            Org: <strong>{orgId || "—"}</strong>
          </span>
        </div>
      </header>

      {!orgId ? (
        <div className="rounded-2xl border bg-white p-4 text-sm text-neutral-600">
          No organization provided. Append <code>?orgId=YOUR_ORG_ID</code> to
          the URL to manage Modes &amp; Access.
        </div>
      ) : (
        <Content orgId={orgId} />
      )}
    </main>
  );
}

async function Content({ orgId }: { orgId: string }) {
  const { modes, access } = await loadModesAndAccess(orgId);
  const activeModes = modes.filter((m) => m.active);
  const inactiveModes = modes.filter((m) => !m.active);

  return (
    <section className="space-y-4">
      {/* MODES (read-only for now) */}
      <details
        className="group rounded-2xl border bg-white p-4 shadow-sm open:shadow-md"
        open
      >
        <summary className="flex cursor-pointer list-none items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">Modes</h2>
            <p className="text-sm text-neutral-500">
              Define Mode 1…10 (rename, toggle active, set associated access
              field, manage presets).
            </p>
          </div>
          <span className="ml-4 text-sm text-neutral-500 group-open:rotate-90 transition">
            ▶
          </span>
        </summary>

        <div className="mt-4 space-y-6">
          {activeModes.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center">
              <p className="text-sm text-neutral-600">
                No active modes. Activate and label Mode 1…10 in settings.
              </p>
              <div className="mt-2 text-xs text-neutral-500">
                Tip: Example labels — <em>Online</em>, <em>In-Person</em>,{" "}
                <em>Phone</em>.
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {activeModes.map((m) => (
                  <div
                    key={m.slot}
                    className="rounded-2xl border bg-white p-4 shadow-sm"
                    role="region"
                    aria-labelledby={`mode-${m.slot}-title`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div
                          id={`mode-${m.slot}-title`}
                          className="text-sm font-medium"
                        >
                          Mode {m.slot}: {m.label}
                        </div>
                        <p className="mt-1 text-xs text-neutral-500">
                          Access field:{" "}
                          <strong>{m.accessFieldLabel ?? "—"}</strong>
                        </p>
                      </div>
                      <span className="ml-3 rounded-full border px-2 py-0.5 text-[11px] text-neutral-600">
                        {m.presets && m.presets.length > 0
                          ? `${m.presets.length} preset${
                              m.presets.length > 1 ? "s" : ""
                            }`
                          : "No presets"}
                      </span>
                    </div>

                    {m.presets && m.presets.length > 0 && (
                      <ul className="mt-3 list-disc pl-5 text-sm text-neutral-700">
                        {m.presets.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              {inactiveModes.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-neutral-500 mb-2">
                    Inactive slots
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {inactiveModes.map((m) => (
                      <span
                        key={m.slot}
                        className="rounded-full border px-3 py-1 text-xs text-neutral-500"
                        aria-label={`Mode ${m.slot} inactive`}
                        title="Inactive"
                      >
                        Mode {m.slot}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </details>

      {/* ACCESS (create form + list with delete) */}
      <details
        className="group rounded-2xl border bg-white p-4 shadow-sm open:shadow-md"
        open
      >
        <summary className="flex cursor-pointer list-none items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">Access</h2>
            <p className="text-sm text-neutral-500">
              Configure the access fields (e.g., “Link”, “Address”, “Dial-in”)
              and optional presets usable on bookings.
            </p>
          </div>
          <span className="ml-4 text-sm text-neutral-500 group-open:rotate-90 transition">
            ▶
          </span>
        </summary>

        {/* Create Access Field */}
        <div className="mt-4 rounded-xl border border-dashed p-4">
          <h3 className="text-sm font-medium">Add access field</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Example: Label “Link”, Key “link”. Presets are optional
            (comma-separated).
          </p>

          <form
            action={createAccessField}
            className="mt-3 grid gap-3 sm:grid-cols-3"
          >
            {/* Hidden orgId so the action doesn’t depend on auth helpers */}
            <input type="hidden" name="orgId" value={orgId} />
            <div className="sm:col-span-1">
              <label
                className="block text-xs text-neutral-600 mb-1"
                htmlFor="label"
              >
                Label
              </label>
              <input
                id="label"
                name="label"
                required
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-black/20"
                placeholder="Link"
              />
            </div>
            <div className="sm:col-span-1">
              <label
                className="block text-xs text-neutral-600 mb-1"
                htmlFor="key"
              >
                Key (kebab-case)
              </label>
              <input
                id="key"
                name="key"
                required
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-black/20"
                placeholder="link"
              />
            </div>
            <div className="sm:col-span-1">
              <label
                className="block text-xs text-neutral-600 mb-1"
                htmlFor="presets"
              >
                Presets (comma-separated)
              </label>
              <input
                id="presets"
                name="presets"
                className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-black/20"
                placeholder="Zoom (Default), Teams"
              />
            </div>

            <div className="sm:col-span-3">
              <button
                type="submit"
                className="rounded-xl bg-black px-3 py-2 text-sm text-white hover:bg-black/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
              >
                Save access field
              </button>
            </div>
          </form>
        </div>

        {/* Existing Access Fields */}
        <div className="mt-4 space-y-4">
          {access.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center">
              <p className="text-sm text-neutral-600">
                No access fields configured yet. Create labels and presets to
                speed up booking entry.
              </p>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {access.map((a) => (
                <li
                  key={a.key}
                  className="rounded-2xl border bg-white p-4 shadow-sm"
                  role="region"
                  aria-labelledby={`access-${a.key}-title`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div
                        id={`access-${a.key}-title`}
                        className="text-sm font-medium"
                      >
                        {a.label}{" "}
                        <span className="ml-2 text-xs text-neutral-500">
                          ({a.key})
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-500">
                        {a.presets && a.presets.length > 0
                          ? "Presets available"
                          : "No presets yet"}
                      </p>
                    </div>

                    <form action={deleteAccessField} method="post">
                      <input type="hidden" name="orgId" value={orgId} />
                      <input type="hidden" name="key" value={a.key} />
                      <button
                        type="submit"
                        className="rounded-xl border px-2 py-1 text-xs hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
                        title="Delete access field"
                      >
                        Delete
                      </button>
                    </form>
                  </div>

                  {a.presets && a.presets.length > 0 && (
                    <ul className="mt-3 list-disc pl-5 text-sm text-neutral-700">
                      {a.presets.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
