// src/components/profile/OrgOverlay.tsx

import * as React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
} from "../../lib/server/profile/notes";

/** Helpers (UI only) */
function formatWhen(iso: string) {
  // Friendly, locale-aware without seconds (e.g., "Oct 19, 2025, 10:49 PM")
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function isTombstone(body: string) {
  const s = (body || "").trim();
  // Our delete system-note pattern from server: "— {actor} deleted a note on {ISO}"
  return s.startsWith("—") && s.includes("deleted a note");
}
function parseEditedMarker(body: string) {
  const trimmed = (body || "").trim();

  // Prefer a timestamped marker: [edited:ISO]
  const withIso = trimmed.match(/\s*\[edited:([^\]]+)\]\s*$/i);
  if (withIso) {
    const clean = trimmed.replace(/\s*\[edited:[^\]]+\]\s*$/i, "").trim();
    const editedAt = withIso[1];
    return { clean, edited: true, editedAt };
  }

  // Back-compat: plain [edited] (no timestamp)
  if (/\s*\[edited\]\s*$/i.test(trimmed)) {
    const clean = trimmed.replace(/\s*\[edited\]\s*$/i, "").trim();
    return { clean, edited: true, editedAt: null as string | null };
  }

  return { clean: body, edited: false, editedAt: null as string | null };
}

/** Server action — adds a note and revalidates the public page. */
async function postNoteAction(formData: FormData) {
  "use server";

  const session = await getServerSession(authOptions);
  const viewerOrgId =
    (session as any)?.orgId ||
    (session as any)?.user?.orgId ||
    (session as any)?.user?.org?.id ||
    "";
  if (!viewerOrgId) return;

  const orgId = String(formData.get("orgId") || "") || viewerOrgId;
  const guestId = String(formData.get("guestId") || "");
  const body = String(formData.get("note") || "").trim();
  if (!guestId || !body) return;

  const authorUserId =
    (session as any)?.user?.id ||
    (session as any)?.user?.sub ||
    (session as any)?.user?.userId ||
    "";
  const authorName =
    (session as any)?.user?.name ||
    (session as any)?.user?.displayName ||
    (session as any)?.user?.email ||
    null;

  await createNote({ orgId, guestId, authorUserId, authorName, body });

  const qp = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  revalidatePath(`/modules/profile/public/${guestId}`, "page");
  redirect(`/modules/profile/public/${guestId}${qp}#internal-notes`);
}

/** Server action — updates an existing note (author-only) and revalidates. */
async function updateNoteAction(formData: FormData) {
  "use server";

  const session = await getServerSession(authOptions);
  const viewerOrgId =
    (session as any)?.orgId ||
    (session as any)?.user?.orgId ||
    (session as any)?.user?.org?.id ||
    "";
  if (!viewerOrgId) return;

  const id = String(formData.get("id") || "").trim();
  const guestId = String(formData.get("guestId") || "").trim();
  const orgId = String(formData.get("orgId") || "") || viewerOrgId;
  const body = String(formData.get("note") || "").trim();
  if (!id || !guestId || !body) return;

  const authorUserId =
    (session as any)?.user?.id ||
    (session as any)?.user?.sub ||
    (session as any)?.user?.userId ||
    "";

  // Persist an "[edited]" marker so we can show a small "Edited" label in UI.
  const bodyWithMarker = body.endsWith("[edited]") ? body : `${body} [edited]`;

  await updateNote({ id, orgId, guestId, authorUserId, body: bodyWithMarker });

  const qp = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  revalidatePath(`/modules/profile/public/${guestId}`, "page");
  redirect(`/modules/profile/public/${guestId}${qp}#internal-notes`);
}

/** Server action — deletes a note (author-only), creates tombstone, revalidates. */
async function deleteNoteAction(formData: FormData) {
  "use server";

  const session = await getServerSession(authOptions);
  const viewerOrgId =
    (session as any)?.orgId ||
    (session as any)?.user?.orgId ||
    (session as any)?.user?.org?.id ||
    "";
  if (!viewerOrgId) return;

  const id = String(formData.get("id") || "").trim();
  const guestId = String(formData.get("guestId") || "").trim();
  const orgId = String(formData.get("orgId") || "") || viewerOrgId;
  if (!id || !guestId) return;

  const authorUserId =
    (session as any)?.user?.id ||
    (session as any)?.user?.sub ||
    (session as any)?.user?.userId ||
    "";
  const authorName =
    (session as any)?.user?.name ||
    (session as any)?.user?.displayName ||
    (session as any)?.user?.email ||
    null;

  await deleteNote({ id, orgId, guestId, authorUserId, authorName });

  const qp = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  // Add a cache-busting param so the browser doesn't restore the form value
  const bump = `_r=${Math.random().toString(36).slice(2)}`;
  const path = `/modules/profile/public/${guestId}${qp}${
    qp ? "&" : "?"
  }${bump}#internal-notes`;

  revalidatePath(`/modules/profile/public/${guestId}`, "page");
  redirect(path);
}

/** Internal Notes (org-only). Renders via footerSlot below the profile. */
export default async function OrgOverlay(props: {
  orgId: string;
  guestId: string;
}) {
  // Only org viewers may see/post notes
  const session = await getServerSession(authOptions);
  const viewerOrgId =
    (session as any)?.orgId ||
    (session as any)?.user?.orgId ||
    (session as any)?.user?.org?.id ||
    "";
  if (!viewerOrgId) return null;

  const effectiveOrgId = props.orgId || viewerOrgId;

  // Who is the viewer? (for author-only buttons)
  const viewerUserId =
    (session as any)?.user?.id ||
    (session as any)?.user?.sub ||
    (session as any)?.user?.userId ||
    "";

  // Load existing notes from DB (newest first)
  const notes = await listNotes(effectiveOrgId, props.guestId);

  // Force the post form to remount after navigation so the textarea clears
  const formKey =
    (global as any).crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2);

  return (
    <section aria-labelledby="internal-notes-title" className="mt-8">
      <h2
        id="internal-notes-title"
        className="text-sm font-medium text-gray-900"
      >
        Internal notes (org-only)
      </h2>

      {/* Post form */}
      <form
        key={formKey}
        action={postNoteAction}
        className="mt-2 space-y-2"
        autoComplete="off"
      >
        <input type="hidden" name="orgId" value={effectiveOrgId} />
        <input type="hidden" name="guestId" value={props.guestId} />
        <textarea
          name="note"
          rows={3}
          required
          placeholder="Write a note for your producers…"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md border bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-900"
          >
            Post
          </button>
        </div>
      </form>

      {/* Notes list */}
      <div id="internal-notes" className="mt-4 space-y-3">
        {notes.length === 0 ? (
          <div className="text-sm text-gray-500">No notes yet.</div>
        ) : (
          notes.map((n) => {
            // System tombstone -> render as a simple gray line, no container, no controls
            if (isTombstone(n.body)) {
              const actor = n.authorName || "Staff";
              return (
                <p key={n.id} className="text-xs text-gray-500 italic px-1">
                  — {actor} deleted a note ·{" "}
                  <time dateTime={n.createdAt}>{formatWhen(n.createdAt)}</time>
                </p>
              );
            }

            // Normal note
            const { clean, edited, editedAt } = parseEditedMarker(n.body);
            const isAuthor = n.authorUserId === viewerUserId;

            return (
              <article key={n.id} className="rounded-md border bg-white p-3">
                <div className="whitespace-pre-wrap text-sm text-gray-900">
                  {clean}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  <span>
                    <span className="font-medium">
                      {n.authorName ?? "Staff"}
                    </span>
                  </span>

                  <span aria-hidden>|</span>
                  <span>
                    Created at{" "}
                    <time dateTime={n.createdAt}>
                      {formatWhen(n.createdAt)}
                    </time>
                  </span>
                  {edited && (
                    <>
                      <span aria-hidden>·</span>
                      {editedAt ? (
                        <span>
                          Edited at{" "}
                          <time dateTime={editedAt}>
                            {formatWhen(editedAt)}
                          </time>
                        </span>
                      ) : (
                        <span>Edited</span>
                      )}
                    </>
                  )}

                  {/* Author-only controls */}
                  {isAuthor && (
                    <>
                      <span aria-hidden>·</span>

                      {/* Edit: native <details> to avoid client JS */}
                      <details
                        key={n.id + ":" + (n.body?.length ?? 0)}
                        className="inline-block"
                      >
                        <summary className="cursor-pointer select-none text-gray-700 hover:text-gray-900">
                          Edit
                        </summary>
                        <form
                          action={updateNoteAction}
                          className="mt-2 space-y-2"
                        >
                          <input type="hidden" name="id" value={n.id} />
                          <input
                            type="hidden"
                            name="orgId"
                            value={effectiveOrgId}
                          />
                          <input
                            type="hidden"
                            name="guestId"
                            value={props.guestId}
                          />
                          <textarea
                            name="note"
                            rows={3}
                            required
                            defaultValue={clean}
                            className="w-full rounded-md border px-3 py-2 text-xs"
                            aria-label="Edit note"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              className="rounded-md border bg-black px-2.5 py-1 text-xs text-white hover:bg-gray-900"
                            >
                              Save
                            </button>
                            {/* Close details without JS: rely on native toggle */}
                            <span className="text-gray-400">or</span>
                            <span className="underline decoration-dotted">
                              Click “Edit” again to close
                            </span>
                          </div>
                        </form>
                      </details>

                      {/* Delete */}
                      <form action={deleteNoteAction} className="inline-block">
                        <input type="hidden" name="id" value={n.id} />
                        <input
                          type="hidden"
                          name="orgId"
                          value={effectiveOrgId}
                        />
                        <input
                          type="hidden"
                          name="guestId"
                          value={props.guestId}
                        />
                        <button
                          type="submit"
                          className="ml-1 rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
                          aria-label="Delete note"
                        >
                          Delete
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
