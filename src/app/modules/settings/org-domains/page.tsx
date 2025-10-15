// src/app/modules/settings/org-domains/page.tsx
"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

/**
 * Minimal types that match /api/org/domains
 * (GET now returns { orgId, canManage, domains })
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
  const orgId = sp.get("orgId") || "";

  const [loading, setLoading] = React.useState(false);
  const [domainInput, setDomainInput] = React.useState("");
  const [domains, setDomains] = React.useState<DomainRow[] | null>(null);
  const [canManage, setCanManage] = React.useState(false);
  const [forbidden, setForbidden] = React.useState(false); // lacks org:domains:read
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await fetch(
        `/api/org/domains?orgId=${encodeURIComponent(orgId)}`,
        {
          cache: "no-store",
        }
      );
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setForbidden(true);
          setDomains(null);
          setCanManage(false);
          return;
        }
        const j = await safeJson(res);
        throw new Error(j?.error || `Failed to load domains (${res.status})`);
      }
      const j = (await res.json()) as {
        orgId: string;
        canManage?: boolean;
        domains: DomainRow[];
      };
      setDomains(j.domains || []);
      setCanManage(!!j.canManage);
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
    if (!orgId || !canManage) return;
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
    if (!orgId || !canManage) return;
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
    if (!orgId || !canManage) return;
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

  // ─────────────────────────── UI states ───────────────────────────
  if (!orgId) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="mb-2 text-2xl font-semibold">Claimed domains</h1>
        <p className="text-sm text-gray-600">
          Add <code>?orgId=&lt;ORG_ID&gt;</code> to the URL.
        </p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="mb-2 text-2xl font-semibold">Claimed domains</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          You don’t have permission to view claimed domains for this
          organization.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      {/* Title */}
      <h1 className="mb-2 text-2xl font-semibold">Claimed domains</h1>
      <p className="mb-6 text-sm text-gray-600">
        Domains owned by this organization. Guests using these domains will be
        blocked.
      </p>

      {/* Add form — visible only if org:domains:manage */}
      {canManage && (
        <form onSubmit={onAdd} className="mb-8 space-y-2">
          <h2 className="text-lg font-medium">Add a domain</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="acme.com"
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring"
              aria-describedby="domain-help"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl border bg-white px-4 py-2 text-sm shadow-sm hover:bg-gray-50 disabled:opacity-60"
            >
              {loading ? "Working..." : "Add"}
            </button>
          </div>
          <p id="domain-help" className="text-xs text-gray-500">
            We’ll normalize to lowercase and remove a leading “@” if present.
          </p>
        </form>
      )}

      {/* Feedback */}
      {error ? (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {info}
        </div>
      ) : null}

      {/* List */}
      <h2 className="mb-2 text-lg font-medium">Current domains</h2>
      {domains === null ? (
        <div className="text-sm text-gray-600">Loading…</div>
      ) : domains.length === 0 ? (
        <div className="text-sm text-gray-600">
          No domains yet. {canManage ? "Add one above." : ""}
        </div>
      ) : (
        <ul className="space-y-3">
          {domains.map((d) => (
            <li
              key={d.domain}
              className="rounded-xl border bg-white p-3 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {d.domain}{" "}
                    {d.isPrimary ? (
                      <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                        Primary
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-gray-500">
                    {d.status}
                    {d.verifiedAt
                      ? ` • verified ${new Date(
                          d.verifiedAt
                        ).toLocaleDateString()}`
                      : ""}
                  </div>
                </div>

                {/* Actions — visible only if org:domains:manage */}
                {canManage && (
                  <div className="flex items-center gap-2">
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
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Footer: light status line */}
      <div className="mt-6 text-xs text-gray-500">
        {loading ? "Working" : "Idle"}
      </div>
    </div>
  );
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
