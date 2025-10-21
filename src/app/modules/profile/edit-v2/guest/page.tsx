// src/app/modules/profile/edit-v2/guest/page.tsx
"use client";

import * as React from "react";
import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  type GuestProfileV2DTO,
  AppearanceTypeLiterals,
  ContactTypeLiterals,
  ContactVisibilityLiterals,
  HonorificLiterals,
  PronounsLiterals,
  TravelReadinessLiterals,
  CEFRLiterals,
  // Optional: we can validate on the client before POST
  safeParseGuestProfileV2,
} from "../../../../../lib/profile/guestSchema";

/**
 * G-Profile V2 — Guest Editor (wired to API)
 * Scope in this slice: guest-owned fields only (S1–S3, S6, S7.F1–F3).
 * Excludes org overlay (assistant, disclosures) and advanced sections (S4/S5 UI).
 *
 * Endpoints:
 *  - GET  /api/profile/guest/me
 *  - POST /api/profile/guest/update
 *  - POST /api/uploads/profile-photo (multipart; returns { ok, url, bust }; auto-saves DB)
 *  - DELETE /api/uploads/profile-photo (deletes current blob)
 */

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "saving" }
  | { kind: "success"; msg?: string }
  | { kind: "error"; msg: string };

// ---- S4 view-model helpers: ISO -> YYYY-MM and DTO -> UI rows ----
function isoToYearMonth(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function mapExperienceDTOToUI(
  dtoRows: GuestProfileV2DTO["experience"] | undefined
) {
  return (dtoRows ?? []).map((r) => ({
    org: r.orgName ?? "",
    role: r.roleTitle ?? "",
    from: isoToYearMonth(r.from),
    to: isoToYearMonth(r.to),
    current: !!r.isCurrent,
    note: "", // UI-only, not persisted
  }));
}
function mapEducationDTOToUI(
  dtoRows: GuestProfileV2DTO["education"] | undefined
) {
  return (dtoRows ?? []).map((r) => ({
    institution: r.institution ?? "",
    program: r.credential ?? "",
    from: isoToYearMonth(r.from),
    to: isoToYearMonth(r.to),
    note: "", // UI-only, not persisted
  }));
}

function mapPublicationsDTOToUI(
  dtoRows: GuestProfileV2DTO["publications"] | undefined
) {
  return (dtoRows ?? []).map((p) => ({
    title: p.title ?? "",
    outlet: p.outlet ?? "",
    // DTO has `year` (number); UI uses `date` (string)
    date: typeof p.year === "number" ? String(p.year) : "",
    url: p.url ?? "",
  }));
}

function mapMediaDTOToUI(dtoRows: GuestProfileV2DTO["media"] | undefined) {
  return (dtoRows ?? []).map((m) => ({
    title: m.title ?? "",
    // DTO has `outlet`; UI shows it as `network`
    network: m.outlet ?? "",
    // DTO has ISO; UI shows YYYY-MM
    date: isoToYearMonth(m.date),
    url: m.url ?? "",
  }));
}

const initialForm: GuestProfileV2DTO = {
  // Identity
  displayName: "",
  nativeName: "",
  pronouns: undefined,
  headshotUrl: undefined,

  // Headline & Summary
  headline: "",
  shortBio: "",
  fullBio: "",

  // Expertise & Coverage
  topicKeys: [],
  regionCodes: [],
  languages: [{ isoCode: "en", level: "B2" }],

  // Experience & Credentials (required arrays in DTO)
  experience: [],
  education: [],

  // Publications & Media (required arrays in DTO)
  publications: [],
  media: [],

  // Logistics
  countryCode: "",
  city: "",
  timezone: "",
  appearanceTypes: [],
  travelReadiness: undefined,

  // Contacts
  additionalEmails: [],
  contacts: [],

  // Flags
  listedPublic: false,
  inviteable: false,
};

function Section({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle ? (
        <p className="text-sm text-gray-600 mt-1">{subtitle}</p>
      ) : null}
    </div>
  );
}

export default function GuestEditorPage() {
  const router = useRouter();
  // null = unknown (loading), true = allow, false = block
  const [allow, setAllow] = useState<boolean | null>(null);
  const didAllowRef = useRef(false);

  // Allow only "true guest" accounts (has guestProfileId OR role=guest) AND not in an org (staff/admin)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (!res.ok) {
          if (active && !didAllowRef.current) setAllow(false);
          return;
        }
        const s: any = await res.json();
        const u = s?.user || null;

        const role = String(u?.role || "").toLowerCase();
        const isGuest = !!u?.guestProfileId || role === "guest";
        const isStaff = !!u?.orgId && role !== "guest";

        if (!active) return;

        if (isGuest && !isStaff) {
          didAllowRef.current = true;
          setAllow(true);
        } else {
          setAllow(false);
        }
      } catch {
        if (active && !didAllowRef.current) setAllow(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Perform the redirect only when we definitively know it's not a guest
  useEffect(() => {
    if (allow === false && !didAllowRef.current) {
      router.replace("/");
    }
  }, [allow, router]);

  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [form, setForm] = useState<GuestProfileV2DTO>(initialForm);
  const [savedPayload, setSavedPayload] = useState<GuestProfileV2DTO | null>(
    null
  );

  // Headshot upload/remove state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingHeadshot, setUploadingHeadshot] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [headshotBroken, setHeadshotBroken] = useState(false);

  // Load (only after access is allowed)
  useEffect(() => {
    if (!allow) return;
    let cancelled = false;
    async function load() {
      setStatus({ kind: "loading" });
      try {
        const res = await fetch("/api/profile/guest/me", { cache: "no-store" });
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const data = (await res.json()) as {
          ok: true;
          profile: GuestProfileV2DTO;
        };
        if (cancelled) return;
        const dto = data.profile;
        const mappedForm = {
          ...initialForm,
          ...dto,
          // S4: convert DTO rows -> UI rows (key + date shape)
          experience: mapExperienceDTOToUI(dto.experience) as any,
          education: mapEducationDTOToUI(dto.education) as any,
          publications: mapPublicationsDTOToUI(dto.publications) as any,
          media: mapMediaDTOToUI(dto.media) as any,
        };
        setForm(mappedForm);
        // Establish baseline that reflects what’s saved on the server
        setSavedPayload(buildPayload(mappedForm));
        setStatus({ kind: "idle" });
      } catch (e: any) {
        if (cancelled) return;
        setStatus({
          kind: "error",
          msg: e?.message ?? "Failed to load profile",
        });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [allow]);

  // Reset broken flag whenever the headshot url changes (e.g., after upload/remove)
  useEffect(() => {
    setHeadshotBroken(false);
  }, [form.headshotUrl]);

  // Auto-clear success pill after ~3s (keeps errors visible)
  useEffect(() => {
    if (status.kind !== "success") return;
    const t = setTimeout(() => setStatus({ kind: "idle" }), 3000);
    return () => clearTimeout(t);
  }, [status]);

  // Compare normalized payloads to detect unsaved changes
  const dirty = useMemo(() => {
    if (!savedPayload) return false;
    try {
      return (
        JSON.stringify(buildPayload(form)) !== JSON.stringify(savedPayload)
      );
    } catch {
      return false;
    }
  }, [form, savedPayload]);

  // Warn on close/refresh if there are unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Helpers
  const update = <K extends keyof GuestProfileV2DTO>(
    key: K,
    value: GuestProfileV2DTO[K]
  ) => setForm((f) => ({ ...f, [key]: value }));

  const onCommaList = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  // Build normalized payload (client-side) matching DTO (server schema)
  function buildPayload(next?: GuestProfileV2DTO): GuestProfileV2DTO {
    const src = next ?? form;

    // Accept YYYY or YYYY-MM or YYYY-MM-DD or full ISO; return RFC-3339
    const normDate = (v?: string) => {
      const s = (v || "").trim();
      if (!s) return undefined;
      let candidate = s;
      if (/^\d{4}$/.test(s)) candidate = `${s}-01-01`;
      else if (/^\d{4}-\d{2}$/.test(s)) candidate = `${s}-01`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) candidate += "T00:00:00Z";
      const d = new Date(candidate);
      return isNaN(d.getTime()) ? undefined : d.toISOString();
    };

    return {
      ...src,
      headshotUrl:
        src.headshotUrl && src.headshotUrl.trim()
          ? src.headshotUrl.trim()
          : undefined,

      // S6 normalization
      countryCode: src.countryCode
        ? src.countryCode.trim().toUpperCase()
        : undefined,
      regionCodes: (src.regionCodes || []).map((r) => r.trim().toUpperCase()),
      topicKeys: (src.topicKeys || []).map((t) => t.trim()).filter(Boolean),

      // S3 languages
      languages: (src.languages || []).map((l) => ({
        isoCode: (l.isoCode || "").trim().toLowerCase(),
        level: l.level,
      })),

      // S4 experience -> map UI keys to DTO keys (drop 'note')
      experience:
        (src as any).experience?.map((r: any) => ({
          orgName: (r.org || "").trim(),
          roleTitle: r.role ? String(r.role).trim() : undefined,
          from: normDate(r.from),
          to: normDate(r.to),
          isCurrent: !!r.current,
        })) || [],

      // S4 education -> map UI keys to DTO keys (program -> credential, drop 'note')
      education:
        (src as any).education?.map((r: any) => ({
          institution: (r.institution || "").trim(),
          credential: r.program ? String(r.program).trim() : undefined,
          fieldOfStudy: undefined, // not collected in this slice
          from: normDate(r.from),
          to: normDate(r.to),
        })) || [],

      // S5 publications & media — map UI keys to DTO + normalize
      publications: ((src as any).publications || []).map((p: any) => {
        const title = (p?.title || "").trim();
        const outlet = p?.outlet ? String(p.outlet).trim() : undefined;

        // Accept YYYY or YYYY-MM (or number); convert to year:number
        const v = (p?.date ?? p?.year) as any;
        let year: number | undefined = undefined;
        if (typeof v === "number" && Number.isFinite(v)) {
          year = Math.trunc(v);
        } else if (typeof v === "string") {
          const s = v.trim();
          if (/^\d{4}$/.test(s)) year = parseInt(s, 10);
          else if (/^\d{4}-\d{2}$/.test(s)) year = parseInt(s.slice(0, 4), 10);
        }

        const urlStr = (p?.url || "").trim();
        const url = urlStr ? urlStr : undefined; // drop empty string

        return { title, outlet, year, url };
      }),

      media: ((src as any).media || []).map((m: any) => {
        const title = (m?.title || "").trim();
        // UI uses `network`; DTO uses `outlet`
        const outlet = m?.outlet
          ? String(m.outlet).trim()
          : m?.network
          ? String(m.network).trim()
          : undefined;

        const date = normDate(m?.date); // ISO or undefined

        const urlStr = (m?.url || "").trim();
        const url = urlStr ? urlStr : undefined; // drop empty string

        const type = (m?.type as any) || undefined;

        return { title, outlet, date, url, type };
      }),

      // S7 contacts
      additionalEmails: (src.additionalEmails || []).map((e) => ({
        email: e.email.trim().toLowerCase(),
        visibility: e.visibility,
        verified: e.verified,
      })),
      contacts: (src.contacts || []).map((c) => ({
        type: c.type,
        value: c.value.trim(),
        visibility: c.visibility,
      })),
    };
  }

  // ---- S4 helpers: experience/education array updaters (UI-only) ----
  type ExpItem = {
    org?: string;
    role?: string;
    from?: string; // YYYY-MM or YYYY
    to?: string; // YYYY-MM or YYYY
    current?: boolean;
    note?: string;
  };
  type EduItem = {
    institution?: string;
    program?: string; // degree/cert
    from?: string; // YYYY or YYYY-MM
    to?: string; // YYYY or YYYY-MM
    note?: string;
  };

  const blankExp: ExpItem = {
    org: "",
    role: "",
    from: "",
    to: "",
    current: false,
    note: "",
  };
  const blankEdu: EduItem = {
    institution: "",
    program: "",
    from: "",
    to: "",
    note: "",
  };

  function addRow<K extends "experience" | "education">(key: K) {
    setForm((f) => ({
      ...f,
      [key]: [
        ...(f as any)[key],
        key === "experience" ? { ...blankExp } : { ...blankEdu },
      ] as any,
    }));
  }
  function removeRow<K extends "experience" | "education">(
    key: K,
    index: number
  ) {
    setForm((f) => {
      const arr = ([...(f as any)[key]] as any[]).filter((_, i) => i !== index);
      return { ...f, [key]: arr as any };
    });
  }
  function patchRow<K extends "experience" | "education">(
    key: K,
    index: number,
    patch: Record<string, unknown>
  ) {
    setForm((f) => {
      const arr = [...((f as any)[key] as any[])];
      arr[index] = { ...(arr[index] ?? {}), ...patch };
      return { ...f, [key]: arr as any };
    });
  }

  // Save NOW (used by upload/remove flows and the new top "Save" button)
  async function saveNow(next?: GuestProfileV2DTO) {
    const payload = buildPayload(next);
    const parsed = safeParseGuestProfileV2(payload);
    if (!parsed.success) {
      setStatus({
        kind: "error",
        msg: parsed.error.issues.map((i) => i.message).join(" · "),
      });
      return false;
    }
    try {
      setStatus({ kind: "saving" });
      const res = await fetch("/api/profile/guest/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || `Save failed (${res.status})`);
      }
      setSavedPayload(parsed.data);
      setStatus({ kind: "success", msg: "Saved" });

      return true;
    } catch (e: any) {
      setStatus({ kind: "error", msg: e?.message ?? "Failed to save" });
      return false;
    }
  }

  // Headshot: open file dialog
  function pickHeadshot() {
    setUploadError(null);
    fileInputRef.current?.click();
  }

  // Headshot: upload to Blob (server auto-saves; client just refreshes preview)
  async function onHeadshotSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.currentTarget.value = ""; // allow re-picking same file
    if (!file) return;

    // light client guardrails
    const maxBytes = 5 * 1024 * 1024; // 5MB
    if (!file.type.startsWith("image/")) {
      setUploadError("Please select an image file.");
      return;
    }
    if (file.size > maxBytes) {
      setUploadError("Image too large (max 5MB).");
      return;
    }

    setUploadingHeadshot(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);

      const res = await fetch("/api/uploads/profile-photo", {
        method: "POST",
        body: fd,
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok || !payload?.url) {
        throw new Error(payload?.message || `Upload failed (${res.status})`);
      }

      // Cache-bust because the path is deterministic (same URL path)
      const bust = typeof payload.bust === "number" ? payload.bust : Date.now();
      const next = {
        ...form,
        headshotUrl: `${payload.url}?v=${bust}`,
      } as GuestProfileV2DTO;

      // Server already saved avatarUrl; we only refresh local state for preview
      setForm(next);
      setSavedPayload(buildPayload(next));

      setStatus({ kind: "success", msg: "Photo updated" });
      setHeadshotBroken(false);
    } catch (err: any) {
      setUploadError(err?.message || "Upload failed");
      setStatus({ kind: "error", msg: err?.message || "Upload failed" });
    } finally {
      setUploadingHeadshot(false);
    }
  }

  // Headshot: remove from Blob (server auto-clears DB; client clears preview)
  async function removeHeadshot() {
    try {
      setUploadError(null);
      setUploadingHeadshot(true);

      const res = await fetch("/api/uploads/profile-photo", {
        method: "DELETE",
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.message || `Delete failed (${res.status})`);
      }

      // Clear locally; server already cleared avatarUrl
      const next = { ...form, headshotUrl: undefined } as GuestProfileV2DTO;
      setForm(next);
      setSavedPayload(buildPayload(next));

      setHeadshotBroken(false);

      setStatus({ kind: "success", msg: "Photo removed" });
    } catch (e: any) {
      setUploadError(e?.message || "Failed to remove photo");
      setStatus({ kind: "error", msg: e?.message || "Failed to remove photo" });
    } finally {
      setUploadingHeadshot(false);
    }
  }

  // Do not render the editor until guest access is confirmed
  if (allow !== true) return null;

  // Save (form submit)
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "saving" });

    // Build the exact DTO shape the server expects (incl. S4 mapping)
    const payload = buildPayload(form);

    // Optional Zod check on client for instant feedback
    const parsed = safeParseGuestProfileV2(payload);
    if (!parsed.success) {
      setStatus({
        kind: "error",
        msg: parsed.error.issues.map((i) => i.message).join(" · "),
      });
      return;
    }

    try {
      const res = await fetch("/api/profile/guest/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || `Save failed (${res.status})`);
      }
      setSavedPayload(parsed.data);
      setStatus({ kind: "success", msg: "Saved" });
    } catch (e: any) {
      setStatus({ kind: "error", msg: e?.message ?? "Failed to save" });
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-4">Edit guest profile</h1>

      {/* Top row: Status (left) + Buttons (right) */}
      <div className="mb-6 flex items-center justify-between gap-3">
        {/* Status pill lives in the same row; hidden when idle */}
        <div className="flex-1">
          {status.kind !== "idle" && (
            <div
              role="status"
              className={`rounded-md border px-3 py-2 text-sm ${
                status.kind === "error"
                  ? "border-red-300 bg-red-50 text-red-700"
                  : status.kind === "success"
                  ? "border-green-300 bg-green-50 text-green-700"
                  : "border-gray-200 bg-gray-50 text-gray-600"
              }`}
            >
              {status.kind === "loading" && "Loading…"}
              {status.kind === "saving" && "Saving…"}
              {status.kind === "error" &&
                (status.msg || "Something went wrong")}
              {status.kind === "success" && (status.msg || "Saved")}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void saveNow()}
            className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50"
            disabled={
              status.kind === "loading" ||
              status.kind === "saving" ||
              uploadingHeadshot
            }
            aria-label="Save changes"
          >
            {status.kind === "saving" ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                dirty &&
                !window.confirm(
                  "You have unsaved changes. Leave without saving?"
                )
              )
                return;
              router.push("/modules/profile/view-v2/guest");
            }}
            className="rounded-md bg-black text-white px-4 py-2"
            aria-label="View profile"
          >
            View profile
          </button>
        </div>
      </div>

      <form onSubmit={onSave} className="space-y-10">
        {/* Identity */}
        <section>
          <Section
            title="Identity"
            subtitle="Your public identity as it appears in the directory."
          />
          <div className="grid grid-cols-1 gap-4">
            {/* Headshot */}
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 rounded-full overflow-hidden border bg-white">
                {form.headshotUrl && !headshotBroken ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.headshotUrl}
                    alt="Headshot preview"
                    className="w-full h-full object-cover"
                    onError={() => setHeadshotBroken(true)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                    No photo
                  </div>
                )}
              </div>

              <div className="flex-1">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={pickHeadshot}
                    className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                    disabled={uploadingHeadshot}
                  >
                    {uploadingHeadshot ? "Uploading…" : "Choose photo"}
                  </button>
                  {form.headshotUrl ? (
                    <button
                      type="button"
                      onClick={removeHeadshot}
                      className="rounded-md border px-3 py-2 text-sm"
                      disabled={uploadingHeadshot}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  JPG/PNG, up to 5MB. Saved automatically.
                </p>

                {uploadError ? (
                  <p className="text-xs text-red-600 mt-1">{uploadError}</p>
                ) : null}
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onHeadshotSelected}
              />
            </div>

            <label className="block">
              <span className="block text-sm font-medium">Display name</span>
              <input
                type="text"
                value={form.displayName ?? ""}
                onChange={(e) => update("displayName", e.target.value)}
                className="mt-1 w-full rounded-md border px-3 py-2"
                placeholder="e.g., Dr. Lina Farouk"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="block">
                <span className="block text-sm font-medium">Honorific</span>
                <select
                  value={form.honorific ?? ""}
                  onChange={(e) =>
                    update(
                      "honorific",
                      (e.target.value ||
                        undefined) as GuestProfileV2DTO["honorific"]
                    )
                  }
                  className="mt-1 w-full rounded-md border px-3 py-2"
                >
                  <option value="">—</option>
                  {HonorificLiterals.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-sm font-medium">Pronouns</span>
                <select
                  value={form.pronouns ?? ""}
                  onChange={(e) =>
                    update(
                      "pronouns",
                      (e.target.value ||
                        undefined) as GuestProfileV2DTO["pronouns"]
                    )
                  }
                  className="mt-1 w-full rounded-md border px-3 py-2"
                >
                  <option value="">—</option>
                  {PronounsLiterals.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="block text-sm font-medium">
                  Name in native script
                </span>
                <input
                  type="text"
                  value={form.nativeName ?? ""}
                  onChange={(e) => update("nativeName", e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2"
                  placeholder="e.g., لينا فاروق"
                />
              </label>
            </div>
          </div>
        </section>

        {/* Headline & Summary */}
        <section>
          <Section
            title="Headline & summary"
            subtitle="A crisp headline and a short summary help producers find you quickly."
          />
          <label className="block mb-3">
            <span className="block text-sm font-medium">Headline (≤120)</span>
            <input
              type="text"
              value={form.headline ?? ""}
              onChange={(e) => update("headline", e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2"
              placeholder='e.g., "Political analyst; Head of XYZ Institute"'
              maxLength={120}
            />
          </label>
          <label className="block mb-3">
            <span className="block text-sm font-medium">Short bio (≤280)</span>
            <textarea
              value={form.shortBio ?? ""}
              onChange={(e) => update("shortBio", e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2"
              rows={3}
              maxLength={280}
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium">Full bio</span>
            <textarea
              value={form.fullBio ?? ""}
              onChange={(e) => update("fullBio", e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2"
              rows={6}
              placeholder="Longer background, publications, affiliations…"
            />
          </label>
        </section>

        {/* Expertise & Coverage */}
        <section>
          <Section
            title="Expertise & coverage"
            subtitle="Topics, regions, and languages used for search and filters."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium">
                Topics (comma-separated)
              </span>
              <input
                type="text"
                value={(form.topicKeys || []).join(", ")}
                onChange={(e) =>
                  update("topicKeys", onCommaList(e.target.value))
                }
                className="mt-1 w-full rounded-md border px-3 py-2"
                placeholder="e.g., MENA politics, energy, elections"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium">
                Regions (codes, comma-separated)
              </span>
              <input
                type="text"
                value={(form.regionCodes || []).join(", ")}
                onChange={(e) =>
                  update("regionCodes", onCommaList(e.target.value))
                }
                className="mt-1 w-full rounded-md border px-3 py-2"
                placeholder="e.g., MENA, 015, 145"
              />
            </label>
          </div>

          {/* Languages */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Languages</span>
              <button
                type="button"
                onClick={() =>
                  update("languages", [
                    ...(form.languages || []),
                    { isoCode: "", level: "B2" },
                  ])
                }
                className="text-sm px-2 py-1 rounded-md border"
              >
                + Add language
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {(form.languages || []).map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <input
                    aria-label="Language code"
                    className="col-span-6 rounded-md border px-3 py-2"
                    placeholder="e.g., en, ar"
                    value={l.isoCode}
                    onChange={(e) => {
                      const v = e.target.value;
                      const arr = [...(form.languages || [])];
                      arr[i] = { ...arr[i], isoCode: v };
                      update("languages", arr);
                    }}
                  />
                  <select
                    aria-label="Level"
                    className="col-span-4 rounded-md border px-3 py-2"
                    value={l.level}
                    onChange={(e) => {
                      const v = e.target
                        .value as GuestProfileV2DTO["languages"][number]["level"];
                      const arr = [...(form.languages || [])];
                      arr[i] = { ...arr[i], level: v };
                      update("languages", arr);
                    }}
                  >
                    {CEFRLiterals.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="col-span-2 rounded-md border px-3 py-2"
                    onClick={() => {
                      const arr = [...(form.languages || [])];
                      arr.splice(i, 1);
                      update("languages", arr);
                    }}
                    aria-label="Remove language"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {(form.languages || []).length === 0 ? (
                <p className="text-xs text-gray-500">No languages yet.</p>
              ) : null}
            </div>
          </div>
        </section>

        {/* Experience & Credentials */}
        <section>
          <Section
            title="Experience"
            subtitle="Your affiliations and past roles. Add the most relevant items first."
          />

          {(form.experience?.length ?? 0) === 0 ? (
            <div className="rounded-md border p-3 text-sm text-gray-600">
              No experience added yet.
            </div>
          ) : null}

          <div className="space-y-4 mt-2">
            {(form.experience as any[]).map((row, i) => (
              <div key={i} className="rounded-xl border p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-gray-700">Organization</span>
                    <input
                      value={(row?.org ?? "") as string}
                      onChange={(e) =>
                        patchRow("experience", i, { org: e.target.value })
                      }
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., XYZ Institute"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-gray-700">Role / Title</span>
                    <input
                      value={(row?.role ?? "") as string}
                      onChange={(e) =>
                        patchRow("experience", i, { role: e.target.value })
                      }
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., Senior Fellow"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-gray-700">From</span>
                    <input
                      value={(row?.from ?? "") as string}
                      onChange={(e) =>
                        patchRow("experience", i, { from: e.target.value })
                      }
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., 2021-06"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-gray-700">To</span>
                    <input
                      value={(row?.to ?? "") as string}
                      onChange={(e) =>
                        patchRow("experience", i, { to: e.target.value })
                      }
                      disabled={!!row?.current}
                      className="mt-1 w-full rounded-md border px-3 py-2 disabled:bg-gray-100"
                      placeholder="e.g., 2024-01"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!row?.current}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        patchRow("experience", i, {
                          current: checked,
                          to: checked ? "" : row?.to ?? "",
                        });
                      }}
                    />
                    <span>Current</span>
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="text-gray-700">Note (optional)</span>
                    <input
                      value={(row?.note ?? "") as string}
                      onChange={(e) =>
                        patchRow("experience", i, { note: e.target.value })
                      }
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="Team lead, managed 5 researchers…"
                    />
                  </label>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeRow("experience", i)}
                    className="rounded-md border px-3 py-1.5 text-sm"
                    aria-label={`Remove experience row ${i + 1}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={() => addRow("experience")}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              + Add experience
            </button>
          </div>
        </section>

        <section>
          <Section
            title="Education & Certifications"
            subtitle="Schools, degrees, and certifications."
          />

          {(form.education?.length ?? 0) === 0 ? (
            <div className="rounded-md border p-3 text-sm text-gray-600">
              No education added yet.
            </div>
          ) : null}

          <div className="space-y-4 mt-2">
            {(form.education as any[]).map((row, i) => (
              <div key={i} className="rounded-xl border p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-gray-700">Institution</span>
                    <input
                      value={(row?.institution ?? "") as string}
                      onChange={(e) =>
                        patchRow("education", i, {
                          institution: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., University of X"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-gray-700">Program / Degree</span>
                    <input
                      value={(row?.program ?? "") as string}
                      onChange={(e) =>
                        patchRow("education", i, { program: e.target.value })
                      }
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., MA International Relations"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-gray-700">From</span>
                    <input
                      value={(row?.from ?? "") as string}
                      onChange={(e) =>
                        patchRow("education", i, { from: e.target.value })
                      }
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., 2019"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-gray-700">To</span>
                    <input
                      value={(row?.to ?? "") as string}
                      onChange={(e) =>
                        patchRow("education", i, { to: e.target.value })
                      }
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., 2021"
                    />
                  </label>
                  <label className="block text-sm md:col-span-2">
                    <span className="text-gray-700">Note (optional)</span>
                    <input
                      value={(row?.note ?? "") as string}
                      onChange={(e) =>
                        patchRow("education", i, { note: e.target.value })
                      }
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="Thesis, honors, certification ID…"
                    />
                  </label>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => removeRow("education", i)}
                    className="rounded-md border px-3 py-1.5 text-sm"
                    aria-label={`Remove education row ${i + 1}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={() => addRow("education")}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              + Add education
            </button>
          </div>
        </section>

        {/* Publications & Media */}
        <section>
          <Section
            title="Publications & media"
            subtitle="Articles, op-eds, books, and TV/radio/online appearances."
          />

          {/* Publications */}
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Publications</span>
              <button
                type="button"
                onClick={() =>
                  update("publications", [
                    ...(form.publications || []),
                    { title: "", outlet: "", date: "", url: "" } as any,
                  ])
                }
                className="text-sm px-2 py-1 rounded-md border"
              >
                + Add publication
              </button>
            </div>

            <div className="mt-2 space-y-2">
              {((form.publications as any[]) || []).map((p: any, i: number) => (
                <div key={i} className="grid gap-2 md:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-gray-700">Title</span>
                    <input
                      value={(p?.title ?? "") as string}
                      onChange={(e) => {
                        const arr = [...((form.publications as any[]) || [])];
                        arr[i] = { ...(arr[i] ?? {}), title: e.target.value };
                        update("publications", arr as any);
                      }}
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., Elections and Energy Markets"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="text-gray-700">Outlet / Publisher</span>
                    <input
                      value={(p?.outlet ?? "") as string}
                      onChange={(e) => {
                        const arr = [...((form.publications as any[]) || [])];
                        arr[i] = { ...(arr[i] ?? {}), outlet: e.target.value };
                        update("publications", arr as any);
                      }}
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., Foreign Affairs"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="text-gray-700">Date</span>
                    <input
                      value={(p?.date ?? "") as string}
                      onChange={(e) => {
                        const arr = [...((form.publications as any[]) || [])];
                        arr[i] = { ...(arr[i] ?? {}), date: e.target.value };
                        update("publications", arr as any);
                      }}
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., 2024 or 2024-06"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="text-gray-700">URL</span>
                    <input
                      value={(p?.url ?? "") as string}
                      onChange={(e) => {
                        const arr = [...((form.publications as any[]) || [])];
                        arr[i] = { ...(arr[i] ?? {}), url: e.target.value };
                        update("publications", arr as any);
                      }}
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="https://…"
                    />
                  </label>

                  <div className="md:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const arr = [...((form.publications as any[]) || [])];
                        arr.splice(i, 1);
                        update("publications", arr as any);
                      }}
                      className="rounded-md border px-3 py-1.5 text-sm"
                      aria-label={`Remove publication row ${i + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}

              {((form.publications as any[]) || []).length === 0 ? (
                <p className="text-xs text-gray-500">No publications yet.</p>
              ) : null}
            </div>
          </div>

          {/* Media appearances */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Media appearances</span>
              <button
                type="button"
                onClick={() =>
                  update("media", [
                    ...(form.media || []),
                    { title: "", network: "", date: "", url: "" } as any,
                  ])
                }
                className="text-sm px-2 py-1 rounded-md border"
              >
                + Add appearance
              </button>
            </div>

            <div className="mt-2 space-y-2">
              {((form.media as any[]) || []).map((m: any, i: number) => (
                <div key={i} className="grid gap-2 md:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-gray-700">Title</span>
                    <input
                      value={(m?.title ?? "") as string}
                      onChange={(e) => {
                        const arr = [...((form.media as any[]) || [])];
                        arr[i] = { ...(arr[i] ?? {}), title: e.target.value };
                        update("media", arr as any);
                      }}
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., Interview on election night"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="text-gray-700">Network / Program</span>
                    <input
                      value={(m?.network ?? "") as string}
                      onChange={(e) => {
                        const arr = [...((form.media as any[]) || [])];
                        arr[i] = { ...(arr[i] ?? {}), network: e.target.value };
                        update("media", arr as any);
                      }}
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., BBC World"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="text-gray-700">Date</span>
                    <input
                      value={(m?.date ?? "") as string}
                      onChange={(e) => {
                        const arr = [...((form.media as any[]) || [])];
                        arr[i] = { ...(arr[i] ?? {}), date: e.target.value };
                        update("media", arr as any);
                      }}
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="e.g., 2023-11"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="text-gray-700">URL</span>
                    <input
                      value={(m?.url ?? "") as string}
                      onChange={(e) => {
                        const arr = [...((form.media as any[]) || [])];
                        arr[i] = { ...(arr[i] ?? {}), url: e.target.value };
                        update("media", arr as any);
                      }}
                      className="mt-1 w-full rounded-md border px-3 py-2"
                      placeholder="https://…"
                    />
                  </label>

                  <div className="md:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const arr = [...((form.media as any[]) || [])];
                        arr.splice(i, 1);
                        update("media", arr as any);
                      }}
                      className="rounded-md border px-3 py-1.5 text-sm"
                      aria-label={`Remove appearance row ${i + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}

              {((form.media as any[]) || []).length === 0 ? (
                <p className="text-xs text-gray-500">
                  No media appearances yet.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {/* Logistics */}
        <section>
          <Section
            title="Logistics"
            subtitle="Where you are and how you prefer to appear."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="block">
              <span className="block text-sm font-medium">Country (ISO-2)</span>
              <input
                type="text"
                value={form.countryCode ?? ""}
                onChange={(e) => update("countryCode", e.target.value)}
                className="mt-1 w-full rounded-md border px-3 py-2"
                placeholder="e.g., EG"
                maxLength={2}
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium">City</span>
              <input
                type="text"
                value={form.city ?? ""}
                onChange={(e) => update("city", e.target.value)}
                className="mt-1 w-full rounded-md border px-3 py-2"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium">Timezone (IANA)</span>
              <input
                type="text"
                value={form.timezone ?? ""}
                onChange={(e) => update("timezone", e.target.value)}
                className="mt-1 w-full rounded-md border px-3 py-2"
                placeholder="e.g., Africa/Cairo"
              />
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="text-sm font-medium mb-2">
              Appearance types
            </legend>
            <div className="flex flex-wrap gap-3">
              {AppearanceTypeLiterals.map((t) => {
                const checked = (form.appearanceTypes || []).includes(t);
                return (
                  <label key={t} className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const set = new Set(form.appearanceTypes || []);
                        if (e.target.checked) set.add(t);
                        else set.delete(t);
                        update("appearanceTypes", Array.from(set));
                      }}
                    />
                    <span className="text-sm">{t}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="block mt-4">
            <span className="block text-sm font-medium">Travel readiness</span>
            <select
              value={form.travelReadiness ?? ""}
              onChange={(e) =>
                update(
                  "travelReadiness",
                  (e.target.value ||
                    undefined) as GuestProfileV2DTO["travelReadiness"]
                )
              }
              className="mt-1 w-full rounded-md border px-3 py-2"
            >
              <option value="">—</option>
              {TravelReadinessLiterals.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </section>

        {/* Contacts */}
        <section>
          <Section
            title="Contacts"
            subtitle="Additional emails and contact methods are visible internally unless you change visibility."
          />

          {/* Additional emails */}
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Additional emails</span>
              <button
                type="button"
                onClick={() =>
                  update("additionalEmails", [
                    ...(form.additionalEmails || []),
                    { email: "", visibility: "INTERNAL", verified: false },
                  ])
                }
                className="text-sm px-2 py-1 rounded-md border"
              >
                + Add email
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {(form.additionalEmails || []).map((e, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <input
                    aria-label="Email"
                    className="col-span-6 rounded-md border px-3 py-2"
                    placeholder="name@example.com"
                    value={e.email}
                    onChange={(ev) => {
                      const arr = [...(form.additionalEmails || [])];
                      arr[i] = { ...arr[i], email: ev.target.value };
                      update("additionalEmails", arr);
                    }}
                  />
                  <select
                    aria-label="Visibility"
                    className="col-span-4 rounded-md border px-3 py-2"
                    value={e.visibility}
                    onChange={(ev) => {
                      const arr = [...(form.additionalEmails || [])];
                      arr[i] = {
                        ...arr[i],
                        visibility: ev.target
                          .value as GuestProfileV2DTO["additionalEmails"][number]["visibility"],
                      };
                      update("additionalEmails", arr);
                    }}
                  >
                    {ContactVisibilityLiterals.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="col-span-2 rounded-md border px-3 py-2"
                    onClick={() => {
                      const arr = [...(form.additionalEmails || [])];
                      arr.splice(i, 1);
                      update("additionalEmails", arr);
                    }}
                    aria-label="Remove email"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {(form.additionalEmails || []).length === 0 ? (
                <p className="text-xs text-gray-500">No additional emails.</p>
              ) : null}
            </div>
          </div>

          {/* Contact methods */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Contact methods</span>
              <button
                type="button"
                onClick={() =>
                  update("contacts", [
                    ...(form.contacts || []),
                    { type: "PHONE", value: "", visibility: "INTERNAL" },
                  ])
                }
                className="text-sm px-2 py-1 rounded-md border"
              >
                + Add contact
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {(form.contacts || []).map((c, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <select
                    aria-label="Type"
                    className="col-span-3 rounded-md border px-3 py-2"
                    value={c.type}
                    onChange={(ev) => {
                      const arr = [...(form.contacts || [])];
                      arr[i] = {
                        ...arr[i],
                        type: ev.target
                          .value as GuestProfileV2DTO["contacts"][number]["type"],
                      };
                      update("contacts", arr);
                    }}
                  >
                    {ContactTypeLiterals.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Value"
                    className="col-span-5 rounded-md border px-3 py-2"
                    placeholder="e.g., +20123…, @username, link"
                    value={c.value}
                    onChange={(ev) => {
                      const arr = [...(form.contacts || [])];
                      arr[i] = { ...arr[i], value: ev.target.value };
                      update("contacts", arr);
                    }}
                  />
                  <select
                    aria-label="Visibility"
                    className="col-span-2 rounded-md border px-3 py-2"
                    value={c.visibility}
                    onChange={(ev) => {
                      const arr = [...(form.contacts || [])];
                      arr[i] = {
                        ...arr[i],
                        visibility: ev.target
                          .value as GuestProfileV2DTO["contacts"][number]["visibility"],
                      };
                      update("contacts", arr);
                    }}
                  >
                    {ContactVisibilityLiterals.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="col-span-2 rounded-md border px-3 py-2"
                    onClick={() => {
                      const arr = [...(form.contacts || [])];
                      arr.splice(i, 1);
                      update("contacts", arr);
                    }}
                    aria-label="Remove contact"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {(form.contacts || []).length === 0 ? (
                <p className="text-xs text-gray-500">No contacts yet.</p>
              ) : null}
            </div>
          </div>
        </section>

        {/* Visibility flags */}
        <section>
          <Section title="Visibility" />
          <div className="flex items-center gap-6">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!form.listedPublic}
                onChange={(e) => update("listedPublic", e.target.checked)}
              />
              <span className="text-sm">List my profile publicly</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!form.inviteable}
                onChange={(e) => update("inviteable", e.target.checked)}
              />
              <span className="text-sm">Allow booking invites</span>
            </label>
          </div>
        </section>

        <div className="pt-2 flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50"
            disabled={
              status.kind === "loading" ||
              status.kind === "saving" ||
              uploadingHeadshot
            }
          >
            {status.kind === "saving" ? "Saving…" : "Save changes"}
          </button>
          <span className="text-xs text-gray-500">
            All fields are optional; empty ones are hidden on your profile.
          </span>
        </div>
      </form>
    </main>
  );
}
