// src/components/profile/GuestProfileMeClient.tsx
"use client";

import * as React from "react";
import GuestProfileRenderer from "./GuestProfileRenderer";
import type { GuestProfileV2DTO } from "../../lib/profile/guestSchema";

type ApiOk = { ok: true; profile: GuestProfileV2DTO };
type ApiErr = { ok: false; message?: string };
type ApiRes = ApiOk | ApiErr;

export default function GuestProfileMeClient() {
  const [state, setState] = React.useState<
    | { kind: "loading" }
    | { kind: "ready"; profile: GuestProfileV2DTO }
    | { kind: "error"; msg: string }
  >({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile/guest/me", { cache: "no-store" });
        const json: ApiRes = await res.json();
        if (!res.ok || !("ok" in json) || !json.ok) {
          throw new Error(("message" in json && json.message) || "Load failed");
        }
        if (!cancelled) setState({ kind: "ready", profile: json.profile });
      } catch (e: any) {
        if (!cancelled)
          setState({
            kind: "error",
            msg: e?.message || "Failed to load profile",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Loading profile…
        </div>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {state.msg}
        </div>
      </main>
    );
  }

  return <GuestProfileRenderer profile={state.profile} />;
}
