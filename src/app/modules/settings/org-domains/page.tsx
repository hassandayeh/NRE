// src/app/modules/settings/org-domains/page.tsx
"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";

/**
 * Minimal types that match /api/org/domains
 */
type DomainRow = {
  domain: string;
  status: "PENDING" | "VERIFIED" | "REVOKED";
  isPrimary: boolean;
  verifiedAt: string | null;
};

function normalizeDomain(input: string) {
  let d = (input || "").trim().toLowerCase();
  if (d.startsWith("@")) d = d.slice(1);
  return d;
}

export default function OrgDomainsPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const orgId = sp.get("orgId") || "";

  const [loading, setLoading] = React.useState(false);
  const [domainInput, setDomainInput] = React.useState("");
  const [domains, setDomains] = React.useState<DomainRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/org/domains?orgId=${encodeURIComponent(orgId)}`,
        {
          cache: "no-store",
        }
      );
      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(j?.error || `Failed to load domains (${res.status})`);
      }
      const j = (await res.json()) as { orgId: string; domains: DomainRow[] };
      setDomains(j.domains || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load domains");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    const raw = domainInput;
    const domain = normalizeDomain(raw);
    if (!domain) {
      setError("Please enter a domain (e.g., acme.com)");
      return;
    }
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/org/domains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, domain }),
      });
      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(j?.error || `Failed to add domain (${res.status})`);
      }
      setDomainInput("");
      await load();
      setInfo(`Added ${domain}`);
    } catch (e: any) {
      setError(e?.message || "Failed to add domain");
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(domain: string) {
    if (!orgId) return;
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const url = `/api/org/domains?orgId=${encodeURIComponent(
        orgId
      )}&domain=${encodeURIComponent(domain)}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(j?.error || `Failed to remove domain (${res.status})`);
      }
      await load();
      setInfo(`Removed ${domain}`);
    } catch (e: any) {
      setError(e?.message || "Failed to remove domain");
    } finally {
      setLoading(false);
    }
  }

  async function onMakePrimary(domain: string) {
    if (!orgId) return;
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/org/domains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, domain, makePrimary: true }),
      });
      if (!res.ok) {
        const j = await safeJson(res);
        throw new Error(j?.error || `Failed to set primary (${res.status})`);
      }
      await load();
      setInfo(`Set ${domain} as primary`);
    } catch (e: any) {
      setError(e?.message || "Failed to set primary");
    } finally {
      setLoading(false);
    }
  }

  if (!orgId) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Claimed domains</h1>
        <p className="mt-2 text-sm text-gray-600">
          Add <code>?orgId=&lt;ORG_ID&gt;</code> to the URL to manage domains
          for a specific org.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Claimed domains</h1>
        <p className="mt-1 text-sm text-gray-600">
          Domains owned by this organization. Guests using these domains will be
          blocked (once enforcement is wired).
        </p>
      </header>

      <section aria-labelledby="add-domain" className="rounded-2xl border p-4">
        <h2 id="add-domain" className="text-lg font-medium">
          Add a domain
        </h2>
        <form onSubmit={onAdd} className="mt-3 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="domain">
            Domain
          </label>
          <input
            id="domain"
            name="domain"
            type="text"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            placeholder="acme.com"
            className="w-full rounded-xl border px-3 py-2 outline-none focus:ring"
            aria-describedby="domain-help"
          />
          <button
            type="submit"
            className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
            disabled={loading}
            aria-label="Add domain"
          >
            {loading ? "Working..." : "Add"}
          </button>
        </form>
        <p id="domain-help" className="mt-2 text-xs text-gray-500">
          We’ll normalize to lowercase and remove a leading “@” if present.
        </p>
      </section>

      <section
        aria-labelledby="list-domains"
        className="mt-6 rounded-2xl border p-4"
      >
        <h2 id="list-domains" className="text-lg font-medium">
          Current domains
        </h2>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </div>
        )}
        {info && (
          <div
            role="status"
            className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {info}
          </div>
        )}

        <div className="mt-3">
          {domains === null ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : domains.length === 0 ? (
            <p className="text-sm">No domains yet. Add one above.</p>
          ) : (
            <ul className="divide-y">
              {domains.map((d) => (
                <li
                  key={d.domain}
                  className="flex items-center justify-between py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{d.domain}</span>
                      {d.isPrimary && (
                        <span
                          className="rounded-full border px-2 py-0.5 text-xs"
                          aria-label="primary-domain-badge"
                        >
                          Primary
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {d.status}{" "}
                      {d.verifiedAt
                        ? `• verified ${new Date(
                            d.verifiedAt
                          ).toLocaleDateString()}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!d.isPrimary && (
                      <button
                        onClick={() => onMakePrimary(d.domain)}
                        className="rounded-lg border px-3 py-1 text-sm"
                        disabled={loading}
                        aria-label={`Make ${d.domain} primary`}
                      >
                        Make primary
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(d.domain)}
                      className="rounded-lg border px-3 py-1 text-sm"
                      disabled={loading}
                      aria-label={`Remove ${d.domain}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="sr-only" aria-live="polite">
        {loading ? "Working" : "Idle"}
      </div>
    </main>
  );
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
