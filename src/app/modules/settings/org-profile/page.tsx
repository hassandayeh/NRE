"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type AnyObj = Record<string, any>;

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function val<T = string>(x: any, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const parts = k.split(".");
    let cur = x;
    let ok = true;
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in cur) cur = cur[p];
      else {
        ok = false;
        break;
      }
    }
    if (ok && cur != null) return cur as T;
  }
  return undefined;
}

function asArray(x: any): string[] | undefined {
  if (!x) return undefined;
  if (Array.isArray(x)) return x.map(String);
  if (typeof x === "string") return [x];
  return undefined;
}

export default function OrgProfilePage() {
  const sp = useSearchParams();
  const orgIdFromUrl = (sp.get("orgId") || "").trim();

  const [effectiveOrgId, setEffectiveOrgId] = React.useState<string | null>(
    orgIdFromUrl || null
  );
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [raw, setRaw] = React.useState<AnyObj | null>(null);
  const [probingSession, setProbingSession] = React.useState<boolean>(
    !orgIdFromUrl
  );

  // 1) If no orgId in URL, grab it from session once.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (orgIdFromUrl) {
        setProbingSession(false);
        return;
      }
      try {
        setProbingSession(true);
        const r = await fetch("/api/auth/session", { cache: "no-store" });
        const s = r.ok ? await r.json().catch(() => ({})) : {};
        const id: string =
          (s?.orgId as string) ||
          (s?.user?.orgId as string) ||
          (s?.user?.org?.id as string) ||
          "";
        if (!alive) return;
        setEffectiveOrgId(id || null);
      } catch {
        if (alive) setEffectiveOrgId(null);
      } finally {
        if (alive) setProbingSession(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [orgIdFromUrl]);

  // 2) Once we have an orgId, load the profile.
  React.useEffect(() => {
    let alive = true;

    (async () => {
      // Wait until we have an org id (or we know we don't)
      if (effectiveOrgId == null && probingSession) return;

      if (!effectiveOrgId) {
        // No org at all → show actionable message
        setLoading(false);
        setError(
          "Missing orgId. Open this page with ?orgId=… or ensure your session has an organization."
        );
        setRaw(null);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `/api/org/profile?orgId=${encodeURIComponent(effectiveOrgId)}`,
          { cache: "no-store", credentials: "include" }
        );
        if (res.status === 401) throw new Error("Unauthorized");
        if (res.status === 403) throw new Error("Forbidden");
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const json = (await res.json().catch(() => ({}))) as AnyObj;
        if (!alive) return;
        setRaw(json || {});
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load profile");
        setRaw(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [effectiveOrgId, probingSession]);

  // Gentle shape-tolerant extraction
  const org: AnyObj | null =
    raw?.org ??
    raw?.organization ??
    raw?.data?.org ??
    raw?.item?.org ??
    (raw && typeof raw === "object" && ("id" in raw || "name" in raw)
      ? raw
      : null);

  const orgId =
    val<string>(raw, "orgId") ??
    val<string>(org, "id") ??
    val<string>(raw, "organizationId") ??
    effectiveOrgId ??
    "";

  const name =
    val<string>(org, "name") ??
    val<string>(raw, "name") ??
    val<string>(raw, "org.name");

  const slug =
    val<string>(org, "slug") ??
    val<string>(org, "shortname") ??
    val<string>(raw, "slug");

  const timezone =
    val<string>(org, "timezone") ??
    val<string>(org, "tz") ??
    val<string>(raw, "timezone");

  const domains = asArray(val(org, "domain") ?? val(org, "domains"));

  const email =
    val<string>(org, "email") ??
    val<string>(org, "contactEmail") ??
    val<string>(raw, "email");

  const logoUrl =
    val<string>(org, "logoUrl") ??
    (typeof val(org, "logo") === "string"
      ? (val<string>(org, "logo") as string)
      : undefined);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">
        Organization profile
      </h1>
      <div className="mb-6">
        <Link
          href={`/modules/settings${
            effectiveOrgId ? `?orgId=${encodeURIComponent(effectiveOrgId)}` : ""
          }`}
          className="text-sm underline"
        >
          &larr; Back to settings
        </Link>
      </div>

      {(loading || probingSession) && (
        <div className="rounded-md border p-4 text-sm text-neutral-700">
          {probingSession ? "Resolving your organization…" : "Loading…"}
        </div>
      )}

      {error && !(loading || probingSession) && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && !probingSession && !error && (
        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-lg border bg-white p-4 shadow-sm md:col-span-2">
              <h2 className="mb-3 text-lg font-medium">Basics</h2>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Name" value={name ?? "—"} />
                <Field label="Org ID">
                  <Copyable value={orgId || "—"} />
                </Field>
                <Field label="Slug" value={slug ?? "—"} />
                <Field label="Timezone" value={timezone ?? "—"} />
                <Field
                  label="Domain(s)"
                  value={
                    domains?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {domains.map((d) => (
                          <span
                            key={d}
                            className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-800"
                          >
                            {d}
                          </span>
                        ))}
                      </div>
                    ) : (
                      "—"
                    )
                  }
                />
                <Field label="Contact email" value={email ?? "—"} />
              </dl>
            </div>

            <div className="rounded-lg border bg-white p-4 text-center shadow-sm">
              <h2 className="mb-3 text-lg font-medium">Logo</h2>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt="Organization logo"
                  className="mx-auto h-24 w-24 rounded object-contain"
                />
              ) : (
                <div className="rounded-md border border-dashed p-6 text-sm text-neutral-500">
                  No logo
                </div>
              )}
            </div>
          </div>

          {/* Raw fallback / inspector */}
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <details>
              <summary className="cursor-pointer text-sm text-neutral-600">
                Advanced: raw profile data
              </summary>
              <pre className="mt-3 overflow-auto rounded bg-neutral-50 p-3 text-xs">
                {JSON.stringify(raw, null, 2)}
              </pre>
            </details>
          </div>
        </section>
      )}
    </main>
  );
}

function Field(props: {
  label: string;
  value?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">
        {props.label}
      </dt>
      <dd className="mt-1 text-sm">{props.children ?? props.value ?? "—"}</dd>
    </div>
  );
}

function Copyable({ value }: { value: string }) {
  const [ok, setOk] = React.useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="rounded bg-neutral-100 px-2 py-1">{value || "—"}</code>
      <button
        className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value || "");
            setOk(true);
            setTimeout(() => setOk(false), 1200);
          } catch {}
        }}
      >
        {ok ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
