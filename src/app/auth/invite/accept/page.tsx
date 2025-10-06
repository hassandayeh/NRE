"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Base64URL → Buffer */
function b64urlToBuf(u: string) {
  const b64 =
    u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((u.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

type InvitePayload = Partial<{
  typ: string;
  type: string;
  t: string;
  orgId: string;
  userId: string;
  email: string;
  iat: number;
  exp: number;
}>;

function tryDecodePayload(token: string | null): InvitePayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(b64urlToBuf(parts[1]).toString("utf8")) as InvitePayload;
  } catch {
    return null;
  }
}

/* Fetch small org info to display its name (best effort) */
async function tryFetchJson<T>(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
function extractOrgName(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.name === "string") return obj.name;
  if (typeof obj.displayName === "string") return obj.displayName;
  if (typeof obj.label === "string") return obj.label;
  if (typeof obj.title === "string") return obj.title;
  if (obj.org) return extractOrgName(obj.org);
  if (obj.organization) return extractOrgName(obj.organization);
  if (obj.data?.org) return extractOrgName(obj.data.org);
  if (obj.item?.org) return extractOrgName(obj.item.org);
  if (Array.isArray(obj.items)) {
    for (const it of obj.items) {
      const n = extractOrgName(it);
      if (n) return n;
    }
  }
  return null;
}
async function fetchOrgName(orgId: string): Promise<string | null> {
  const qs = `orgId=${encodeURIComponent(orgId)}`;
  const candidates = [
    `/api/directory/org?${qs}`,
    `/api/org?${qs}`,
    `/api/org/info?${qs}`,
    `/api/org/${encodeURIComponent(orgId)}`,
  ];
  for (const url of candidates) {
    const data = await tryFetchJson<any>(url);
    const name = extractOrgName(data);
    if (name) return name;
  }
  return null;
}

/* Forward-ref input so we can control focus properly */
type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  which?: "pwd" | "confirm";
};
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ which, className, onFocus, onBlur, onKeyDown, ...props }, ref) => (
    <input
      ref={ref}
      {...props}
      onFocus={(e) => {
        (e.currentTarget as any).__which = which ?? "pwd";
        onFocus?.(e);
      }}
      onBlur={(e) => {
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        e.stopPropagation(); // avoid global handlers stealing focus
        onKeyDown?.(e);
      }}
      className={
        "mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10 " +
        (className || "")
      }
    />
  )
);
Input.displayName = "Input";

export default function AcceptInvitePage() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token");

  const payload = React.useMemo(() => tryDecodePayload(token), [token]);

  // Org name (best-effort)
  const [orgName, setOrgName] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!payload?.orgId) return;
      const name = await fetchOrgName(payload.orgId);
      if (alive) setOrgName(name);
    })();
    return () => {
      alive = false;
    };
  }, [payload?.orgId]);

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  // Focus management
  const pwdRef = React.useRef<HTMLInputElement>(null);
  const confirmRef = React.useRef<HTMLInputElement>(null);
  const lastFocused = React.useRef<"pwd" | "confirm">("pwd");

  const restoreFocusIfLost = React.useCallback(() => {
    if (typeof document === "undefined") return;
    const active = document.activeElement as HTMLElement | null;
    const isOnInput =
      active &&
      (active === pwdRef.current || active === confirmRef.current) &&
      active.tagName === "INPUT";
    if (!isOnInput) {
      const ref = lastFocused.current === "confirm" ? confirmRef : pwdRef;
      ref.current?.focus();
    }
  }, []);

  const canSubmit =
    !!token && !submitting && password.length >= 6 && password === confirm;

  const expText =
    payload?.exp &&
    new Date(payload.exp * 1000).toLocaleString(undefined, { hour12: false });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !token) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await fetch("/api/auth/invite/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setServerError(
          (data?.error as string) || `Failed to complete invite (${res.status})`
        );
        setSubmitting(false);
        // keep focus on the last field to let the user retry
        setTimeout(restoreFocusIfLost, 0);
        return;
      }
      setDone(true);
    } catch {
      setServerError("Network error. Please try again.");
      setSubmitting(false);
      setTimeout(restoreFocusIfLost, 0);
    }
  }

  // Redirect to sign-in after success (short delay to show success)
  React.useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      router.push("/auth/signin");
    }, 900);
    return () => clearTimeout(t);
  }, [done, router]);

  const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="mt-4 text-sm font-medium text-neutral-700">{children}</p>
  );

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">
          Accept invitation
        </h1>

        {payload?.email || payload?.orgId || payload?.exp ? (
          <div className="mt-2 text-sm text-neutral-700">
            {payload?.email && (
              <p>
                You&apos;re setting a password for:{" "}
                <span className="font-medium">{payload.email}</span>
              </p>
            )}

            {(orgName || payload?.orgId) && (
              <p className="mt-1">
                Org:{" "}
                <span className="tabular-nums">
                  {orgName ?? payload?.orgId}
                </span>
              </p>
            )}

            {payload?.exp && (
              <p className="mt-1">
                Expires: <span className="tabular-nums">{expText}</span>
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-neutral-500">
            If this link looks stale, ask your admin to regenerate it.
          </p>
        )}

        {!done ? (
          <form onSubmit={onSubmit} className="mt-6">
            <Label>New password</Label>
            <Input
              which="pwd"
              ref={pwdRef}
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => {
                lastFocused.current = "pwd";
                setPassword(e.target.value);
              }}
              onBlur={() => {
                lastFocused.current = "pwd";
                setTimeout(restoreFocusIfLost, 0);
              }}
              placeholder="••••••••"
            />

            <Label>Confirm password</Label>
            <Input
              which="confirm"
              ref={confirmRef}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                lastFocused.current = "confirm";
                setConfirm(e.target.value);
              }}
              onBlur={() => {
                lastFocused.current = "confirm";
                setTimeout(restoreFocusIfLost, 0);
              }}
              placeholder="••••••••"
            />

            {serverError && (
              <p className="mt-2 text-sm text-red-600">{serverError}</p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-6 w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Setting…" : "Set password"}
            </button>

            <p className="mt-3 text-xs text-neutral-500">
              Having trouble? Ask your admin to regenerate the invite link.
            </p>
          </form>
        ) : (
          <div className="mt-6 rounded-md bg-green-50 p-4 text-sm text-green-700">
            Password set. You can now sign in.
          </div>
        )}
      </div>
    </main>
  );
}
